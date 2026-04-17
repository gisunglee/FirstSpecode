/**
 * DELETE /api/projects/[id]/members/[memberId] — 멤버 강제 제거 (FID-00084)
 *
 * 역할:
 *   - OWNER/ADMIN이 특정 멤버를 강제 제거 (REMOVED 상태)
 *   - OWNER는 제거 불가
 *   - 제거된 멤버에게 removal notice 생성 (다음 로그인 시 안내 모달용)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string; memberId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId, memberId } = await params;

  // OWNER/ADMIN만 제거 가능
  const myMembership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!myMembership || myMembership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  if (!["OWNER", "ADMIN"].includes(myMembership.role_code)) {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }

  // 대상 멤버 확인
  const target = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: memberId } },
  });
  if (!target || target.mber_sttus_code !== "ACTIVE") {
    return apiError("NOT_FOUND", "멤버를 찾을 수 없습니다.", 404);
  }

  // OWNER는 제거 불가
  if (target.role_code === "OWNER") {
    return apiError("VALIDATION_ERROR", "OWNER는 제거할 수 없습니다.", 400);
  }

  // 프로젝트명 조회 (removal notice 스냅샷용)
  const project = await prisma.tbPjProject.findUnique({
    where: { prjct_id: projectId },
    select: { prjct_nm: true },
  });
  if (!project) {
    return apiError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.", 404);
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 멤버 상태 → REMOVED
      await tx.tbPjProjectMember.update({
        where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: memberId } },
        data: {
          mber_sttus_code: "REMOVED",
          sttus_chg_dt:    new Date(),
        },
      });

      // 제거 안내 INSERT (다음 로그인 시 모달 표시)
      await tx.tbPjMemberRemovalNotice.create({
        data: {
          mber_id:  memberId,
          prjct_id: projectId,
          prjct_nm: project.prjct_nm,
          cnfrm_yn: "N",
        },
      });
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[DELETE /api/projects/${projectId}/members/${memberId}] DB 오류:`, err);
    return apiError("DB_ERROR", "제거 중 오류가 발생했습니다.", 500);
  }
}
