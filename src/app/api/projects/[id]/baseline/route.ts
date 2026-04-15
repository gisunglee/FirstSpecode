/**
 * GET  /api/projects/[id]/baseline — 요구사항 확정 조회 (FID-00123)
 * POST /api/projects/[id]/baseline — 전체 요구사항 일괄 확정 (FID-00124)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { checkRole } from "@/lib/checkRole";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 요구사항 확정 ─────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  try {
    const baselines = await prisma.tbRqBaselineSnapshot.findMany({
      where: { prjct_id: projectId },
      orderBy: { cnfrm_dt: "asc" },
    });

    // 확정자 이메일 일괄 조회
    const memberIds = [...new Set(baselines.map((b) => b.cnfrm_mber_id).filter(Boolean))] as string[];
    const members = await prisma.tbCmMember.findMany({
      where: { mber_id: { in: memberIds } },
      select: { mber_id: true, email_addr: true },
    });
    const emailMap = new Map(members.map((m) => [m.mber_id, m.email_addr ?? ""]));

    const items = baselines.map((b) => ({
      baselineId: b.basln_id,
      name: b.basln_nm,
      comment: b.coment_cn ?? "",
      requirementCount: b.req_cnt,
      confirmedAt: b.cnfrm_dt.toISOString(),
      confirmerEmail: b.cnfrm_mber_id ? (emailMap.get(b.cnfrm_mber_id) ?? "") : "",
    }));

    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/baseline] DB 오류:`, err);
    return apiError("DB_ERROR", "기준선 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 전체 요구사항 일괄 확정 ───────────────────────────────────────────
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

  const { name, comment } = (body ?? {}) as { name?: string; comment?: string };
  if (!name?.trim()) {
    return apiError("VALIDATION_ERROR", "기준선명을 입력해 주세요.", 400);
  }

  try {
    // 현재 프로젝트의 전체 요구사항 조회 → JSONB 스냅샷 생성
    const requirements = await prisma.tbRqRequirement.findMany({
      where: { prjct_id: projectId },
      select: {
        req_id: true,
        req_display_id: true,
        req_nm: true,
        priort_code: true,
        src_code: true,
        orgnl_cn: true,
        curncy_cn: true,
        spec_cn: true,
      },
      orderBy: { sort_ordr: "asc" },
    });

    const snapshotData = requirements.map((r) => ({
      reqId: r.req_id,
      displayId: r.req_display_id,
      name: r.req_nm,
      priority: r.priort_code ?? null,
      source: r.src_code ?? null,
      orgnlCn: r.orgnl_cn ?? "",
      curncyCn: r.curncy_cn ?? "",
      specCn: r.spec_cn ?? "",
    }));

    const baseline = await prisma.tbRqBaselineSnapshot.create({
      data: {
        prjct_id: projectId,
        basln_nm: name.trim(),
        coment_cn: comment?.trim() || null,
        req_cnt: requirements.length,
        snapshot_data: snapshotData,
        cnfrm_mber_id: auth.mberId,
        cnfrm_dt: new Date(),
      },
    });

    return apiSuccess({ baselineId: baseline.basln_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/baseline] DB 오류:`, err);
    return apiError("DB_ERROR", "기준선 저장 중 오류가 발생했습니다.", 500);
  }
}
