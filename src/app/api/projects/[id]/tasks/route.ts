/**
 * GET  /api/projects/[id]/tasks — 과업 목록 조회 (FID-00092)
 * POST /api/projects/[id]/tasks — 과업 생성 (FID-00097 신규)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 과업 목록 조회 ─────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // 멤버십 확인 (모든 역할 조회 가능)
  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const tasks = await prisma.tbRqTask.findMany({
      where: { prjct_id: projectId },
      include: {
        requirements: {
          select: { req_id: true, priort_code: true },
        },
      },
      orderBy: { sort_ordr: "asc" },
    });

    const items = tasks.map((t) => {
      const reqs  = t.requirements;
      const high   = reqs.filter((r) => r.priort_code === "HIGH").length;
      const medium = reqs.filter((r) => r.priort_code === "MEDIUM").length;
      const low    = reqs.filter((r) => r.priort_code === "LOW").length;

      return {
        taskId:           t.task_id,
        displayId:        t.task_display_id,
        name:             t.task_nm,
        category:         t.ctgry_code,
        requirementCount: reqs.length,
        prioritySummary:  { high, medium, low },
        // 진행률: 설계·구현 테이블 미구현 → 0으로 고정 (추후 교체)
        progressRate: 0,
        sortOrder: t.sort_ordr,
      };
    });

    return apiSuccess({ tasks: items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "과업 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 과업 생성 ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

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

  const { name, category, definition, content, outputInfo, rfpPage } = body as {
    name?: string; category?: string;
    definition?: string; content?: string;
    outputInfo?: string; rfpPage?: string;
  };

  if (!name?.trim()) return apiError("VALIDATION_ERROR", "과업명을 입력해 주세요.", 400);
  if (!category?.trim()) return apiError("VALIDATION_ERROR", "카테고리를 선택해 주세요.", 400);

  try {
    // 표시 ID 채번 (프로젝트 내 최대값 + 1)
    const maxTask = await prisma.tbRqTask.findFirst({
      where: { prjct_id: projectId },
      orderBy: { task_display_id: "desc" },
      select: { task_display_id: true },
    });
    const nextSeq = maxTask
      ? (parseInt(maxTask.task_display_id.replace(/\D/g, "")) || 0) + 1
      : 1;
    const displayId = `SFR-${String(nextSeq).padStart(5, "0")}`;

    // sort_ordr: 마지막 + 1
    const maxSort = await prisma.tbRqTask.findFirst({
      where: { prjct_id: projectId },
      orderBy: { sort_ordr: "desc" },
      select: { sort_ordr: true },
    });
    const sortOrder = (maxSort?.sort_ordr ?? 0) + 1;

    const task = await prisma.tbRqTask.create({
      data: {
        prjct_id:        projectId,
        task_display_id: displayId,
        task_nm:         name.trim(),
        ctgry_code:      category,
        defn_cn:         definition?.trim() || null,
        dtl_cn:          content?.trim() || null,
        output_info_cn:  outputInfo?.trim() || null,
        rfp_page_no:     rfpPage?.trim() || null,
        sort_ordr:       sortOrder,
      },
    });

    return apiSuccess({ taskId: task.task_id, displayId: task.task_display_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/tasks] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
