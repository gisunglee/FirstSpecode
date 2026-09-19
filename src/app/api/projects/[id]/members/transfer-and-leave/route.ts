/**
 * POST /api/projects/[id]/members/transfer-and-leave — OWNER 양도 후 탈퇴 (FID-00087)
 *
 * 역할:
 *   - OWNER가 새 OWNER를 지정하고 탈퇴
 *   - 트랜잭션: 대상 role → OWNER, 프로젝트 owner_mber_id → 대상, 본인 status → LEFT
 *   - OWNER만 호출 가능
 *
 * 소유자는 항상 1명 — 멤버 역할(OWNER)과 프로젝트 소유자 컬럼(owner_mber_id)을
 * 같은 트랜잭션에서 함께 바꿔야 한다. 하나만 바꾸면 탈퇴·상한·결제 판정이 갈린다.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;

  // OWNER만 호출 가능
  const myMembership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!myMembership || myMembership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  if (myMembership.role_code !== "OWNER") {
    return apiError("FORBIDDEN", "OWNER만 양도할 수 있습니다.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { newOwnerId } = body as { newOwnerId?: string };
  if (!newOwnerId?.trim()) {
    return apiError("VALIDATION_ERROR", "양도할 멤버를 선택해 주세요.", 400);
  }
  if (newOwnerId === auth.mberId) {
    return apiError("VALIDATION_ERROR", "본인에게는 양도할 수 없습니다.", 400);
  }

  // 양도 대상 멤버 확인
  const newOwner = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: newOwnerId } },
  });
  if (!newOwner || newOwner.mber_sttus_code !== "ACTIVE") {
    return apiError("NOT_FOUND", "양도 대상 멤버를 찾을 수 없습니다.", 404);
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 새 OWNER에게 OWNER 역할 부여
      await tx.tbPjProjectMember.update({
        where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: newOwnerId } },
        data: {
          role_code:    "OWNER",
          sttus_chg_dt: new Date(),
        },
      });

      // 프로젝트 소유자 컬럼도 함께 갱신 — 소유 판정의 단일 기준
      await tx.tbPjProject.update({
        where: { prjct_id: projectId },
        data:  { owner_mber_id: newOwnerId },
      });

      // 본인 탈퇴 처리
      await tx.tbPjProjectMember.update({
        where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
        data: {
          mber_sttus_code: "LEFT",
          sttus_chg_dt:    new Date(),
        },
      });
    });

    return apiSuccess({ ok: true });
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/members/transfer-and-leave] DB 오류:`, err);
    return apiError("DB_ERROR", "처리 중 오류가 발생했습니다.", 500);
  }
}
