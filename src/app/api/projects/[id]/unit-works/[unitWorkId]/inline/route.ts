/**
 * PATCH /api/projects/[id]/unit-works/[unitWorkId]/inline — My Task 인라인 편집
 *
 * Body: { field: "assignee" | "startDate" | "endDate", value: string | null }
 *
 * 게이트는 sibling route.ts(PUT)의 requireUnitWorkWrite와 동일 조건 —
 * OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 담당자.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { hasPermission, isRoleCode, isJobCode, type RoleCode, type JobCode } from "@/lib/permissions";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; unitWorkId: string }> };

async function requireUnitWorkWrite(
  request: NextRequest,
  projectId: string,
  unitWorkId: string
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

  const matrixOK = hasPermission({ role, job, plan: "FREE", systemRole: null }, "requirement.update");
  if (matrixOK) return { mberId: auth.mberId };

  const target = await prisma.tbDsUnitWork.findUnique({
    where:  { unit_work_id: unitWorkId },
    select: { asign_mber_id: true, prjct_id: true },
  });
  if (!target || target.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
  }
  if (target.asign_mber_id !== auth.mberId) {
    return apiError("FORBIDDEN", "이 단위업무를 수정할 권한이 없습니다.", 403);
  }

  return { mberId: auth.mberId };
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, unitWorkId } = await params;

  const gate = await requireUnitWorkWrite(request, projectId, unitWorkId);
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { field, value } = body as { field?: string; value?: string | null };
  if (!field) return apiError("VALIDATION_ERROR", "field가 필요합니다.", 400);
  if (!["assignee", "startDate", "endDate"].includes(field)) {
    return apiError("VALIDATION_ERROR", "field는 assignee, startDate, endDate 중 하나여야 합니다.", 400);
  }

  try {
    const existing = await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }

    if (field === "startDate" || field === "endDate") {
      await prisma.tbDsUnitWork.update({
        where: { unit_work_id: unitWorkId },
        data:  { [field === "startDate" ? "bgng_de" : "end_de"]: value || null, mdfcn_dt: new Date() },
      });
      return apiSuccess({ unitWorkId, field, value: value || null });
    }

    // field === "assignee" — 값이 실제로 바뀌었을 때만 이력 저장(no-op 스킵)
    const prevAssignee = existing.asign_mber_id ?? null;
    const nextAssignee = value || null;

    if (prevAssignee === nextAssignee) {
      return apiSuccess({ unitWorkId, field, value: nextAssignee });
    }

    const ids = [prevAssignee, nextAssignee].filter((v): v is string => !!v);
    const memberRows = ids.length > 0
      ? await prisma.tbCmMember.findMany({ where: { mber_id: { in: ids } }, select: { mber_id: true, mber_nm: true, email_addr: true } })
      : [];
    const nameMap = new Map(memberRows.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

    await prisma.$transaction([
      prisma.tbDsUnitWork.update({
        where: { unit_work_id: unitWorkId },
        data:  { asign_mber_id: nextAssignee, mdfcn_dt: new Date() },
      }),
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id: projectId, ref_tbl_nm: "tb_ds_unit_work", ref_id: unitWorkId,
          chg_type_code: "UPDATE", chg_rsn_cn: "담당자",
          snapshot_data: {
            before: prevAssignee, after: nextAssignee,
            beforeName: prevAssignee ? (nameMap.get(prevAssignee) ?? null) : null,
            afterName:  nextAssignee ? (nameMap.get(nextAssignee) ?? null) : null,
          },
          chg_mber_id: gate.mberId,
        },
      }),
    ]);

    return apiSuccess({ unitWorkId, field, value: nextAssignee });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/unit-works/${unitWorkId}/inline] DB 오류:`, err);
    return apiError("DB_ERROR", "인라인 편집 저장에 실패했습니다.", 500);
  }
}
