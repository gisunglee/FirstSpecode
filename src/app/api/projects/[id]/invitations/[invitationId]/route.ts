/**
 * DELETE /api/projects/[id]/invitations/[invitationId] — 초대 취소·삭제 (FID-00067)
 *
 * 동작 — 현재 상태에 따라 결과가 달라진다:
 *   - PENDING / EXPIRED → 소프트 취소 (상태를 CANCELLED 로 변경, 이력 보존)
 *   - CANCELLED         → 영구 삭제 (목록 정리 목적)
 *   - ACCEPTED          → 거부 (이미 수락된 초대는 손대지 않음)
 *
 * 한 엔드포인트로 두 가지 동작을 묶은 이유:
 *   클라이언트가 "어떤 액션인지" 결정할 필요 없이 현재 상태에 맞춰 자연스럽게
 *   취소→삭제로 단계가 진행되도록 함. 외부 인터페이스(URL/메서드/응답)는 동일.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; invitationId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, invitationId } = await params;

  // OWNER/ADMIN 확인
  const member = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!member || member.mber_sttus_code !== "ACTIVE" ||
      (member.role_code !== "OWNER" && member.role_code !== "ADMIN")) {
    return apiError("FORBIDDEN", "권한이 없습니다.", 403);
  }

  const invitation = await prisma.tbPjProjectInvitation.findFirst({
    where: { invt_id: invitationId, prjct_id: projectId },
  });
  if (!invitation) return apiError("NOT_FOUND", "초대 내역을 찾을 수 없습니다.", 404);
  if (invitation.invt_sttus_code === "ACCEPTED") {
    return apiError("BAD_REQUEST", "이미 수락된 초대는 취소·삭제할 수 없습니다.", 400);
  }

  try {
    if (invitation.invt_sttus_code === "CANCELLED") {
      // 이미 취소된 초대 → 영구 삭제 (목록 정리)
      await prisma.tbPjProjectInvitation.delete({
        where: { invt_id: invitationId },
      });
    } else {
      // PENDING / EXPIRED → 소프트 취소 (상태 변경)
      await prisma.tbPjProjectInvitation.update({
        where: { invt_id: invitationId },
        data: { invt_sttus_code: "CANCELLED", cancel_dt: new Date() },
      });
    }
    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[DELETE /invitations/${invitationId}] DB 오류:`, err);
    return apiError("DB_ERROR", "처리 중 오류가 발생했습니다.", 500);
  }
}
