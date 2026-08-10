/**
 * PATCH /api/projects/[id]/screens/[screenId]/inline — My Task 인라인 편집
 *
 * Body: { field: "assignee", value: string | null }
 *   - 일정/공수(실질설계/실질구현/구현공수)는 항목이 여러 개(설계기간은 화면에 없고
 *     단위업무 소관, 구현기간+공수는 sibling route.ts PUT에서 한꺼번에 편집)라 인라인
 *     한 필드씩 바꾸는 이 엔드포인트로는 다루지 않음 — 담당자만 여기서 즉시 변경.
 *
 * 게이트는 sibling route.ts(PUT)의 requireScreenWrite와 동일 조건 —
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
import { screenInlineSchema } from "@/lib/specContentSchemas";

type RouteParams = { params: Promise<{ id: string; screenId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, screenId } = await params;

  const gate = await requireSpecContentWrite(request, projectId, "SCREEN", screenId);
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, screenInlineSchema);
  if (parsed instanceof Response) return parsed;
  const { field, value } = parsed.data;
  const fieldError = requireSpecChangedFields(gate, "SCREEN", ["assignMemberId"]);
  if (fieldError) return fieldError;

  try {
    const existing = await prisma.tbDsScreen.findUnique({ where: { scrn_id: screenId } });
    if (!existing || existing.prjct_id !== projectId) {
      return apiError("NOT_FOUND", "화면을 찾을 수 없습니다.", 404);
    }

    // field === "assignee" — 값이 실제로 바뀌었을 때만 이력 저장(no-op 스킵)
    const prevAssignee = existing.asign_mber_id ?? null;
    const nextAssignee = value || null;

    if (prevAssignee === nextAssignee) {
      return apiSuccess({ screenId, field, value: nextAssignee });
    }

    const ids = [prevAssignee, nextAssignee].filter((v): v is string => !!v);
    const memberRows = ids.length > 0
      ? await prisma.tbCmMember.findMany({ where: { mber_id: { in: ids } }, select: { mber_id: true, mber_nm: true, email_addr: true } })
      : [];
    const nameMap = new Map(memberRows.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

    await prisma.$transaction([
      prisma.tbDsScreen.update({
        where: { scrn_id: screenId },
        data:  { asign_mber_id: nextAssignee, mdfcn_mber_id: gate.mberId, mdfcn_dt: new Date() },
      }),
      prisma.tbDsDesignChange.create({
        data: {
          prjct_id: projectId, ref_tbl_nm: "tb_ds_screen", ref_id: screenId,
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

    return apiSuccess({ screenId, field, value: nextAssignee });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/screens/${screenId}/inline] DB 오류:`, err);
    return apiError("DB_ERROR", "인라인 편집 저장에 실패했습니다.", 500);
  }
}
