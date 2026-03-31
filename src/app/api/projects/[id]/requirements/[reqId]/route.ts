/**
 * GET    /api/projects/[id]/requirements/[reqId] — 요구사항 상세 조회 (FID-00102)
 * PUT    /api/projects/[id]/requirements/[reqId] — 요구사항 수정 + 이력 자동 생성 (FID-00103)
 * DELETE /api/projects/[id]/requirements/[reqId] — 요구사항 삭제 (FID-00109)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { deleteFile } from "@/lib/fileStorage";

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

// ─── GET: 요구사항 상세 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reqId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const req = await prisma.tbRqRequirement.findUnique({
      where:   { req_id: reqId },
      include: { task: { select: { task_id: true, task_nm: true } } },
    });

    if (!req || req.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
    }

    return apiSuccess({
      requirementId:   req.req_id,
      displayId:       req.req_display_id,
      name:            req.req_nm,
      priority:        req.priort_code,
      source:          req.src_code,
      rfpPage:         req.rfp_page_no ?? "",
      originalContent: req.orgnl_cn ?? "",
      currentContent:  req.curncy_cn ?? "",
      analysisMemo:    req.analy_cn ?? "",
      detailSpec:      req.spec_cn ?? "",
      taskId:          req.task_id ?? null,
      taskName:        req.task?.task_nm ?? "미분류",
      sortOrder:       req.sort_ordr ?? 0,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/requirements/${reqId}] DB 오류:`, err);
    return apiError("DB_ERROR", "요구사항 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 요구사항 수정 + 이력 생성 ─────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reqId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const {
    taskId, name, priority, source, rfpPage,
    originalContent, currentContent, analysisMemo, detailSpec,
    reqDisplayId, sortOrder,
  } = body as {
    taskId?: string; name?: string; priority?: string; source?: string;
    rfpPage?: string; originalContent?: string; currentContent?: string;
    analysisMemo?: string; detailSpec?: string; reqDisplayId?: string;
    sortOrder?: number;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "요구사항명을 입력해 주세요.", 400);
  if (!priority)     return apiError("VALIDATION_ERROR", "우선순위를 선택해 주세요.", 400);
  if (!source)       return apiError("VALIDATION_ERROR", "출처를 선택해 주세요.", 400);

  try {
    // 요구사항 존재·소속 확인
    const existing = await prisma.tbRqRequirement.findUnique({ where: { req_id: reqId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
    }

    // 버전 채번: 최신 이력의 vrsn_no + 0.1
    // 이력이 없으면 V1.0, 있으면 'V1.X' → 'V1.X+1'
    const lastHistory = await prisma.tbRqRequirementHistory.findFirst({
      where:   { req_id: reqId },
      orderBy: { creat_dt: "desc" },
      select:  { vrsn_no: true },
    });

    let nextVersion: string;
    if (!lastHistory) {
      nextVersion = "V1.0";
    } else {
      // "V1.X" 형식에서 major, minor 분리
      const parts = lastHistory.vrsn_no.replace("V", "").split(".");
      const major = parseInt(parts[0] ?? "1", 10);
      const minor = parseInt(parts[1] ?? "0", 10);
      nextVersion = `V${major}.${minor + 1}`;
    }

    // 수정 + 이력 생성 (트랜잭션)
    await prisma.$transaction([
      prisma.tbRqRequirement.update({
        where: { req_id: reqId },
        data:  {
          task_id:        taskId || null,
          req_display_id: reqDisplayId?.trim() || existing.req_display_id,
          req_nm:         name.trim(),
          priort_code:    priority,
          src_code:       source,
          rfp_page_no:    rfpPage?.trim() || null,
          orgnl_cn:       originalContent?.trim() || null,
          curncy_cn:      currentContent?.trim() || null,
          analy_cn:       analysisMemo?.trim() || null,
          spec_cn:        detailSpec?.trim() || null,
          sort_ordr:      typeof sortOrder === "number" ? sortOrder : existing.sort_ordr,
          mdfcn_dt:       new Date(),
        },
      }),
      prisma.tbRqRequirementHistory.create({
        data: {
          req_id:        reqId,
          vrsn_no:       nextVersion,
          vrsn_ty_code:  "INTERNAL",
          orgnl_cn:      originalContent?.trim() || null,
          curncy_cn:     currentContent?.trim() || null,
          spec_cn:       detailSpec?.trim() || null,
          chg_mber_id:   auth.mberId,
        },
      }),
    ]);

    return apiSuccess({ requirementId: reqId, version: nextVersion });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/requirements/${reqId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 요구사항 삭제 ───────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, reqId } = await params;
  const url          = new URL(request.url);
  const deleteChildren = url.searchParams.get("deleteChildren") !== "false"; // 기본 true

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleCheck = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleCheck) return roleCheck;

  try {
    const existing = await prisma.tbRqRequirement.findUnique({
      where: { req_id: reqId },
    });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
    }

    // 첨부파일 물리 삭제 (FK 제약 없는 다형성 참조 — ref_tbl_nm + ref_id로 조회)
    const attachFiles = await prisma.tbCmAttachFile.findMany({
      where: { ref_tbl_nm: "tb_rq_requirement", ref_id: reqId },
    });
    for (const file of attachFiles) {
      deleteFile(file.file_path_nm);
    }

    if (deleteChildren) {
      // 하위 전체 삭제: 인수기준 → 스토리 → 이력 → 첨부파일 → 요구사항 (수동 cascade)
      const stories = await prisma.tbRqUserStory.findMany({
        where:  { req_id: reqId },
        select: { story_id: true },
      });
      const storyIds = stories.map((s) => s.story_id);

      await prisma.$transaction([
        // 인수기준 삭제
        prisma.tbRqAcceptanceCriteria.deleteMany({ where: { story_id: { in: storyIds } } }),
        // 사용자스토리 삭제
        prisma.tbRqUserStory.deleteMany({ where: { req_id: reqId } }),
        // 이력 삭제
        prisma.tbRqRequirementHistory.deleteMany({ where: { req_id: reqId } }),
        // 첨부파일 DB 레코드 삭제
        prisma.tbCmAttachFile.deleteMany({ where: { ref_id: reqId } }),
        // 요구사항 삭제
        prisma.tbRqRequirement.delete({ where: { req_id: reqId } }),
      ]);
    } else {
      // DDL상 req_id NOT NULL이므로 스토리도 함께 삭제됨
      const stories = await prisma.tbRqUserStory.findMany({
        where:  { req_id: reqId },
        select: { story_id: true },
      });
      const storyIds = stories.map((s) => s.story_id);

      await prisma.$transaction([
        prisma.tbRqAcceptanceCriteria.deleteMany({ where: { story_id: { in: storyIds } } }),
        prisma.tbRqUserStory.deleteMany({ where: { req_id: reqId } }),
        prisma.tbRqRequirementHistory.deleteMany({ where: { req_id: reqId } }),
        prisma.tbCmAttachFile.deleteMany({ where: { ref_id: reqId } }),
        prisma.tbRqRequirement.delete({ where: { req_id: reqId } }),
      ]);
    }

    return apiSuccess({ deleted: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/requirements/${reqId}] DB 오류:`, err);
    return apiError("DB_ERROR", "삭제 중 오류가 발생했습니다.", 500);
  }
}
