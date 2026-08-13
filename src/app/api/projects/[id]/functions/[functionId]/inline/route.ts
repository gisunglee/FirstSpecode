/**
 * PATCH /api/projects/[id]/functions/[functionId]/inline — 복잡도·공수·담당자 인라인 편집 (FID-00168, 00169)
 *
 * Body: { field: "complexity" | "effort" | "assignee", value: string | null }
 *   - 구현 일정(startDate/endDate)은 2026-07-28부터 기능이 아니라 소속 화면 단위로 관리 —
 *     화면 인라인 편집(screens/[screenId]/inline/route.ts)에서 처리.
 *
 * 게이트는 sibling route.ts(PUT)의 requireFunctionWrite와 동일 조건 —
 * OWNER/ADMIN 역할 OR PM/PL 직무 OR 본인이 담당자. (기존엔 requireAuth+checkRole 이었으나,
 * 담당자 변경까지 다루게 되면서 PUT 라우트와 같은 기준으로 통일 — 지원 세션 시 멤버십이 없어
 * 어차피 막히긴 했지만, 명시적으로 동일 정책을 쓰는 게 맞음)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  requireSpecContentWrite,
  requireSpecChangedFields,
} from "@/lib/specContentWritePolicy";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { functionInlineSchema } from "@/lib/specContentSchemas";

type RouteParams = { params: Promise<{ id: string; functionId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, functionId } = await params;

  const gate = await requireSpecContentWrite(request, projectId, "FUNCTION", functionId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, functionInlineSchema);
  if (parsed instanceof Response) return parsed;
  const { field, value } = parsed.data;
  const policyField = field === "assignee" ? "assignMemberId" : field;
  const fieldError = requireSpecChangedFields(gate, "FUNCTION", [policyField]);
  if (fieldError) return fieldError;

  try {
    const existing = await prisma.tbDsFunction.findUnique({ where: { func_id: functionId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "기능을 찾을 수 없습니다.", 404);
    }

    if (field === "complexity" || field === "effort") {
      const updateData = field === "complexity"
        ? { cmplx_code: value as string, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() }
        : { impl_efrt_val: value || null, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() };

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
        data:  { asign_mber_id: nextAssignee, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() },
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
