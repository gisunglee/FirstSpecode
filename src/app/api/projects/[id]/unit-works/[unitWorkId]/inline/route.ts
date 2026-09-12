/**
 * PATCH /api/projects/[id]/unit-works/[unitWorkId]/inline — My Task 인라인 편집
 *
 * Body: { field: "assignee" | "startDate" | "endDate" | "scopeStatus", value: string | null }
 *   - scopeStatus(사업 범위 구분)는 MANAGER 만 변경 가능 — specContentFieldPolicy.ts 주석 참조.
 *
 * 게이트는 sibling route.ts(PUT)의 requireUnitWorkWrite와 동일 조건 —
 * OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 담당자.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  requireSpecContentWrite,
  requireSpecChangedFields,
} from "@/lib/specContentWritePolicy";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { unitWorkInlineSchema } from "@/lib/specContentSchemas";
import { buildMdfcnAudit } from "@/lib/mdfcnSource";
import { parseScopeSttus, SCOPE_STTUS_ERROR_MSG } from "@/lib/scopeStatus";

type RouteParams = { params: Promise<{ id: string; unitWorkId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, unitWorkId } = await params;

  const gate = await requireSpecContentWrite(request, projectId, "UNIT_WORK", unitWorkId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, unitWorkInlineSchema);
  if (parsed instanceof Response) return parsed;
  const { field, value } = parsed.data;
  // 인라인 필드명 → 권한 정책 필드명 (allow-list 대조용)
  const POLICY_FIELD: Record<typeof field, string> = {
    assignee:    "assignMemberId",
    startDate:   "planStartDate",
    endDate:     "planEndDate",
    scopeStatus: "scopeStatus",
  };
  const policyField = POLICY_FIELD[field];
  const fieldError = requireSpecChangedFields(gate, "UNIT_WORK", [policyField]);
  if (fieldError) return fieldError;

  try {
    const existing = await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "단위업무를 찾을 수 없습니다.", 404);
    }

    // 사업 범위 구분 — AS-IS 등록 후 잘못 찍힌 항목을 목록에서 바로 정정하는 경로.
    // 컬럼이 NOT NULL 이라 빈 값으로 지우는 것은 허용하지 않는다.
    if (field === "scopeStatus") {
      const nextScope = parseScopeSttus(value);
      if (!nextScope) return apiError("VALIDATION_ERROR", SCOPE_STTUS_ERROR_MSG, 400);

      await prisma.tbDsUnitWork.update({
        where: { unit_work_id: unitWorkId },
        data:  { scope_sttus_code: nextScope, ...buildMdfcnAudit(gate) },
      });
      return apiSuccess({ unitWorkId, field, value: nextScope });
    }

    if (field === "startDate" || field === "endDate") {
      await prisma.tbDsUnitWork.update({
        where: { unit_work_id: unitWorkId },
        data:  { [field === "startDate" ? "plan_dsgn_bgng_de" : "plan_dsgn_end_de"]: value || null, ...buildMdfcnAudit(gate) },
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
        data:  { asign_mber_id: nextAssignee, ...buildMdfcnAudit(gate) },
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
