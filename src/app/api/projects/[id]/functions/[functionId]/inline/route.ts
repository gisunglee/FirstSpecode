/**
 * PATCH /api/projects/[id]/functions/[functionId]/inline — 복잡도·공수 인라인 편집 (FID-00168, 00169)
 *   + My Task 페이지용 담당자·구현일정 인라인 편집 추가
 *
 * Body: { field: "complexity" | "effort" | "assignee" | "startDate" | "endDate", value: string | null }
 *   - startDate/endDate는 구현 축(impl_bgng_de/impl_end_de).
 *
 * 게이트는 sibling route.ts(PUT)의 requireFunctionWrite와 동일 조건 —
 * OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 담당자. (기존엔 requireAuth+checkRole 이었으나,
 * 담당자 변경까지 다루게 되면서 PUT 라우트와 같은 기준으로 통일 — 지원 세션 시 멤버십이 없어
 * 어차피 막히긴 했지만, 명시적으로 동일 정책을 쓰는 게 맞음)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { hasPermission, isRoleCode, isJobCode, type RoleCode, type JobCode } from "@/lib/permissions";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; functionId: string }> };

async function requireFunctionWrite(
  request: NextRequest,
  projectId: string,
  functionId: string
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

  const target = await prisma.tbDsFunction.findUnique({
    where:  { func_id: functionId },
    select: { asign_mber_id: true, prjct_id: true },
  });
  if (!target || target.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
  }
  if (target.asign_mber_id !== auth.mberId) {
    return apiError("FORBIDDEN", "이 기능을 수정할 권한이 없습니다.", 403);
  }

  return { mberId: auth.mberId };
}

const VALID_FIELDS = ["complexity", "effort", "assignee", "startDate", "endDate"] as const;

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, functionId } = await params;

  const gate = await requireFunctionWrite(request, projectId, functionId);
  if (gate instanceof Response) return gate;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { field, value } = body as { field?: string; value?: string | null };
  if (!field || value === undefined) {
    return apiError("VALIDATION_ERROR", "field와 value가 필요합니다.", 400);
  }
  if (!(VALID_FIELDS as readonly string[]).includes(field)) {
    return apiError("VALIDATION_ERROR", `field는 ${VALID_FIELDS.join(", ")} 중 하나여야 합니다.`, 400);
  }

  try {
    const existing = await prisma.tbDsFunction.findUnique({ where: { func_id: functionId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
    }

    if (field === "startDate" || field === "endDate") {
      await prisma.tbDsFunction.update({
        where: { func_id: functionId },
        data:  { [field === "startDate" ? "impl_bgng_de" : "impl_end_de"]: value || null, mdfcn_dt: new Date() },
      });
      return apiSuccess({ funcId: functionId, field, value: value || null });
    }

    if (field === "complexity" || field === "effort") {
      const updateData = field === "complexity"
        ? { cmplx_code: value as string, mdfcn_dt: new Date() }
        : { efrt_val: value || null, mdfcn_dt: new Date() };

      await prisma.$transaction([
        prisma.tbDsFunction.update({ where: { func_id: functionId }, data: updateData }),
        prisma.tbDsDesignChange.create({
          data: {
            prjct_id: projectId, ref_tbl_nm: "tb_ds_function", ref_id: functionId,
            chg_type_code: "UPDATE",
            chg_rsn_cn: field === "complexity" ? "복잡도 인라인 편집" : "공수 인라인 편집",
            snapshot_data: { funcId: functionId, displayId: existing.func_display_id, field, value },
            chg_mber_id: gate.mberId,
          },
        }),
      ]);
      return apiSuccess({ funcId: functionId, field, value });
    }

    // field === "assignee" — 값이 실제로 바뀌었을 때만 이력 저장(no-op 스킵)
    const prevAssignee = existing.asign_mber_id ?? null;
    const nextAssignee = value || null;

    if (prevAssignee === nextAssignee) {
      return apiSuccess({ funcId: functionId, field, value: nextAssignee });
    }

    const ids = [prevAssignee, nextAssignee].filter((v): v is string => !!v);
    const memberRows = ids.length > 0
      ? await prisma.tbCmMember.findMany({ where: { mber_id: { in: ids } }, select: { mber_id: true, mber_nm: true, email_addr: true } })
      : [];
    const nameMap = new Map(memberRows.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

    await prisma.$transaction([
      prisma.tbDsFunction.update({
        where: { func_id: functionId },
        data:  { asign_mber_id: nextAssignee, mdfcn_dt: new Date() },
      }),
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id: projectId, ref_tbl_nm: "tb_ds_function", ref_id: functionId,
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

    return apiSuccess({ funcId: functionId, field, value: nextAssignee });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/functions/${functionId}/inline] DB 오류:`, err);
    return apiError("DB_ERROR", "인라인 편집 저장에 실패했습니다.", 500);
  }
}
