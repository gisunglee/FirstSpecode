/**
 * GET    /api/projects/[id]/requirements/[reqId] — 요구사항 상세 조회 (FID-00102)
 * PUT    /api/projects/[id]/requirements/[reqId] — 요구사항 수정 + 이력 자동 생성 (FID-00103)
 * DELETE /api/projects/[id]/requirements/[reqId] — 요구사항 삭제 (FID-00109)
 */

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { requireAuth } from "@/lib/requireAuth";
import {
  hasPermission, isRoleCode, isJobCode,
  type RoleCode, type JobCode,
} from "@/lib/permissions";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { deleteFile } from "@/lib/fileStorage";

type RouteParams = { params: Promise<{ id: string; reqId: string }> };

/**
 * 요구사항 편집/삭제 권한 게이트.
 *
 * 통과 조건 (OR):
 *   ① permissions 매트릭스 "requirement.update" 통과 — OWNER/ADMIN 역할 또는 PM/PL 직무
 *   ② 본인이 해당 요구사항의 담당자(asign_mber_id) — 매트릭스로 표현 못 하는 동적 조건
 *
 * 둘 다 실패하면 403 Response 반환.
 * requirePermission 을 직접 쓰지 않는 이유: 매트릭스 + 리소스 동적 조건 OR 합산이 필요하기 때문.
 */
async function requireRequirementWrite(
  request: NextRequest,
  projectId: string,
  reqId: string
): Promise<{ mberId: string } | Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where:  { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
    select: { role_code: true, job_title_code: true, mber_sttus_code: true },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "프로젝트 멤버가 아닙니다.", 403);
  }

  const role: RoleCode | null = isRoleCode(membership.role_code) ? membership.role_code : null;
  const job:  JobCode  | null = isJobCode(membership.job_title_code) ? membership.job_title_code : null;

  // ① 매트릭스 권한 체크 — plan 은 이 권한 규칙에 영향 없으므로 FREE 고정
  const matrixOK = hasPermission(
    { role, job, plan: "FREE", systemRole: null },
    "requirement.update"
  );

  if (matrixOK) return { mberId: auth.mberId };

  // ② 본인이 담당자인지 확인
  const existing = await prisma.tbRqRequirement.findUnique({
    where:  { req_id: reqId },
    select: { asign_mber_id: true, prjct_id: true },
  });
  if (!existing || existing.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
  }
  if (existing.asign_mber_id !== auth.mberId) {
    return apiError("FORBIDDEN", "이 요구사항을 수정할 권한이 없습니다.", 403);
  }

  return { mberId: auth.mberId };
}

// ─── GET: 요구사항 상세 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reqId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    const req = await prisma.tbRqRequirement.findUnique({
      where:   { req_id: reqId },
      include: { task: { select: { task_id: true, task_nm: true } } },
    });

    if (!req || req.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
    }

    // 담당자 이름 조회 — 없거나 퇴장 멤버면 null
    const assignee = req.asign_mber_id
      ? await prisma.tbCmMember.findUnique({
          where:  { mber_id: req.asign_mber_id },
          // email_addr를 fallback으로 — mber_nm 미설정 계정도 식별 가능
          select: { mber_nm: true, email_addr: true },
        })
      : null;

    return apiSuccess({
      requirementId:    req.req_id,
      displayId:        req.req_display_id,
      name:             req.req_nm,
      priority:         req.priort_code,
      source:           req.src_code,
      rfpPage:          req.rfp_page_no ?? "",
      originalContent:  req.orgnl_cn ?? "",
      currentContent:   req.curncy_cn ?? "",
      analysisMemo:     req.analy_cn ?? "",
      detailSpec:       req.spec_cn ?? "",
      taskId:           req.task_id ?? null,
      taskName:         req.task?.task_nm ?? "미분류",
      assignMemberId:   req.asign_mber_id ?? null,
      assignMemberName: assignee ? (assignee.mber_nm || assignee.email_addr || null) : null,
      sortOrder:        req.sort_ordr ?? 0,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/requirements/${reqId}] DB 오류:`, err);
    return apiError("DB_ERROR", "요구사항 조회에 실패했습니다.", 500);
  }
}

// ─── PUT: 요구사항 수정 + 이력 생성 ─────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reqId } = await params;

  // OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 담당자만 수정 가능
  const gate = await requireRequirementWrite(request, projectId, reqId);
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const {
    taskId, name, priority, source, rfpPage,
    originalContent, currentContent, analysisMemo, detailSpec,
    reqDisplayId, sortOrder, assignMemberId,
    saveHistory, versionMode, versionComment,
    saveSpecHistory, saveAnalyHistory,
  } = body as {
    taskId?: string; name?: string; priority?: string; source?: string;
    rfpPage?: string; originalContent?: string; currentContent?: string;
    analysisMemo?: string; detailSpec?: string; reqDisplayId?: string;
    sortOrder?: number;
    assignMemberId?: string;
    saveHistory?: boolean;
    versionMode?: "major" | "minor";
    versionComment?: string;
    saveSpecHistory?: boolean;
    saveAnalyHistory?: boolean;
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

    const newOrgnlCn   = originalContent?.trim() || null;
    const newCurncyCn  = currentContent?.trim() || null;
    const newAnalyCn   = analysisMemo?.trim() || null;
    const newSpecCn    = detailSpec?.trim() || null;
    const oldAnalyCn   = existing.analy_cn ?? null;
    const oldSpecCn    = existing.spec_cn ?? null;

    // 담당자 변경 감지 — 값이 실제로 바뀌었을 때만 자동 이력 저장 (no-op 스킵)
    // itemName="담당자"로 SettingsHistoryDialog와 동일 문자열 사용
    const CHG_REASON_ASSIGNEE = "담당자";
    const prevAssignee    = existing.asign_mber_id ?? null;
    const nextAssignee    = assignMemberId !== undefined ? (assignMemberId || null) : prevAssignee;
    const assigneeChanged = assignMemberId !== undefined && prevAssignee !== nextAssignee;

    // 담당자 변경 시 이름도 함께 저장 — 멤버 탈퇴 후에도 이력 뷰 보존
    let assigneeNames: { before: string | null; after: string | null } = { before: null, after: null };
    if (assigneeChanged) {
      const ids = [prevAssignee, nextAssignee].filter((v): v is string => !!v);
      const membersForHistory = ids.length > 0
        ? await prisma.tbCmMember.findMany({
            where:  { mber_id: { in: ids } },
            // email_addr를 fallback으로 — mber_nm 미설정 계정도 이력에서 식별 가능
            select: { mber_id: true, mber_nm: true, email_addr: true },
          })
        : [];
      const nameMap = new Map(membersForHistory.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));
      assigneeNames = {
        before: prevAssignee ? (nameMap.get(prevAssignee) ?? null) : null,
        after:  nextAssignee ? (nameMap.get(nextAssignee) ?? null) : null,
      };
    }

    // ── 트랜잭션 구성 ────────────────────────────────────────────────────
    // $transaction 오버로드가 배열/함수 두 가지라 Parameters[0] 만으론 배열 타입이
    // 좁혀지지 않음 → PrismaPromise 배열로 명시
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    // 1. 요구사항 본문 UPDATE (항상 실행)
    ops.push(
      prisma.tbRqRequirement.update({
        where: { req_id: reqId },
        data:  {
          // taskId가 명시적으로 전달된 경우만 변경 (undefined면 기존 값 유지)
          task_id:        taskId !== undefined ? (taskId || null) : existing.task_id,
          req_display_id: reqDisplayId?.trim() || existing.req_display_id,
          req_nm:         name.trim(),
          priort_code:    priority,
          src_code:       source,
          rfp_page_no:    rfpPage !== undefined ? (rfpPage?.trim() || null) : existing.rfp_page_no,
          orgnl_cn:       originalContent !== undefined ? newOrgnlCn : existing.orgnl_cn,
          curncy_cn:      currentContent !== undefined ? newCurncyCn : existing.curncy_cn,
          analy_cn:       analysisMemo !== undefined ? newAnalyCn : existing.analy_cn,
          spec_cn:        detailSpec !== undefined ? newSpecCn : existing.spec_cn,
          asign_mber_id:  nextAssignee,
          sort_ordr:      typeof sortOrder === "number" ? sortOrder : existing.sort_ordr,
          mdfcn_dt:       new Date(),
        },
      })
    );

    // 1-b. 담당자 변경 이력 (자동 저장 — saveHistory 플래그 불필요)
    if (assigneeChanged) {
      ops.push(
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_rq_requirement",
            ref_id:        reqId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    CHG_REASON_ASSIGNEE,
            snapshot_data: {
              before:     prevAssignee,
              after:      nextAssignee,
              beforeName: assigneeNames.before,
              afterName:  assigneeNames.after,
            },
            chg_mber_id: gate.mberId,
          },
        })
      );
    }

    // 2. 이력 저장 (saveHistory=true 일 때만)
    let nextVersion: string | null = null;
    if (saveHistory) {
      const lastHistory = await prisma.tbRqRequirementHistory.findFirst({
        where:   { req_id: reqId },
        orderBy: { creat_dt: "desc" },
        select:  { vrsn_no: true },
      });

      if (!lastHistory) {
        nextVersion = "V1.0";
      } else {
        const parts = lastHistory.vrsn_no.replace("V", "").split(".");
        const major = parseInt(parts[0] ?? "1", 10);
        const minor = parseInt(parts[1] ?? "0", 10);

        if (versionMode === "major") {
          nextVersion = `V${major + 1}.0`;
        } else {
          // minor (기본)
          nextVersion = `V${major}.${minor + 1}`;
        }
      }

      ops.push(
        prisma.tbRqRequirementHistory.create({
          data: {
            req_id:         reqId,
            vrsn_no:        nextVersion,
            orgnl_cn:       newOrgnlCn,
            curncy_cn:      newCurncyCn,
            vrsn_coment_cn: versionComment?.trim() || null,
            chg_mber_id:    gate.mberId,
          },
        })
      );
    }

    // 3. 분석 메모 변경 → tbDsDesignChange (saveAnalyHistory=true 일 때만)
    if (saveAnalyHistory && newAnalyCn !== oldAnalyCn) {
      ops.push(
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_rq_requirement",
            ref_id:        reqId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    "분석 메모",
            snapshot_data: { before: oldAnalyCn, after: newAnalyCn },
            chg_mber_id:   gate.mberId,
          },
        })
      );
    }

    // 4. 상세 명세 변경 → tbDsDesignChange (saveSpecHistory=true 일 때만)
    if (saveSpecHistory && newSpecCn !== oldSpecCn) {
      ops.push(
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id:      projectId,
            ref_tbl_nm:    "tb_rq_requirement",
            ref_id:        reqId,
            chg_type_code: "UPDATE",
            chg_rsn_cn:    "상세 명세",
            snapshot_data: { before: oldSpecCn, after: newSpecCn },
            chg_mber_id:   gate.mberId,
          },
        })
      );
    }

    await prisma.$transaction(ops);

    return apiSuccess({ requirementId: reqId, version: nextVersion });
  } catch (err) {
    console.error(`[PUT /api/projects/${projectId}/requirements/${reqId}] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}

// ─── DELETE: 요구사항 삭제 ───────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, reqId } = await params;
  const url          = new URL(request.url);
  const deleteChildren = url.searchParams.get("deleteChildren") !== "false"; // 기본 true

  // OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 담당자만 삭제 가능
  const gate = await requireRequirementWrite(request, projectId, reqId);
  if (gate instanceof Response) return gate;

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
