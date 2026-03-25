/**
 * DELETE /api/member/me — 회원 탈퇴 (FID-00050, FID-00051, FID-00052)
 *
 * 역할:
 *   1. 본인 확인: password 또는 socialToken 중 하나로 검증
 *      - password: pswd_hash bcrypt 비교
 *      - socialToken: 소셜 토큰 검증 후 연동 계정 확인
 *      - 둘 다 없으면: 소유 프로젝트 없는 경우의 단순 탈퇴 (AT만으로 진행)
 *   2. 트랜잭션:
 *      a. 회원 논리 삭제 (WITHDRAWN + wthdrw_dt)
 *      b. 소유 프로젝트 물리 삭제 (CASCADE)
 *      c. 참여 프로젝트 멤버 상태 LEFT 처리
 *      d. 참여 프로젝트 OWNER에게 제거 안내 INSERT
 *      e. 소셜 계정 삭제
 *      f. 전 RT·세션 무효화
 *
 * Body: { password?: string, socialToken?: string }
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { verifyPassword, verifySocialToken } from "@/lib/auth";

export async function DELETE(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { password, socialToken } = (body ?? {}) as Record<string, unknown>;

  try {
    const member = await prisma.tbCmMember.findUnique({
      where:  { mber_id: auth.mberId },
      select: { pswd_hash: true, mber_sttus_code: true },
    });

    if (!member) {
      return apiError("NOT_FOUND", "회원 정보를 찾을 수 없습니다.", 404);
    }
    if (member.mber_sttus_code === "WITHDRAWN") {
      return apiError("ALREADY_WITHDRAWN", "이미 탈퇴한 계정입니다.", 400);
    }

    // ── 본인 확인 ────────────────────────────────────────────────────────
    if (member.pswd_hash) {
      // 이메일 계정 → 비밀번호 필수
      if (!password || typeof password !== "string") {
        return apiError("VALIDATION_ERROR", "비밀번호를 입력해 주세요.", 400);
      }
      const isValid = await verifyPassword(password, member.pswd_hash);
      if (!isValid) {
        return apiError("INVALID_CREDENTIALS", "비밀번호가 올바르지 않습니다.", 401);
      }

    } else if (socialToken && typeof socialToken === "string") {
      // 소셜 전용 계정 → socialToken 검증
      const social = verifySocialToken(socialToken);
      if (!social) {
        return apiError("INVALID_TOKEN", "본인 확인에 실패했습니다. 다시 시도해 주세요.", 400);
      }

      // socialToken의 provdrUserId가 이 회원에 연동된 계정인지 확인
      const linkedAccount = await prisma.tbCmSocialAccount.findUnique({
        where: {
          provdr_code_provdr_user_id: {
            provdr_code:    social.provdrCode,
            provdr_user_id: social.provdrUserId,
          },
        },
        select: { mber_id: true },
      });

      if (!linkedAccount || linkedAccount.mber_id !== auth.mberId) {
        return apiError("INVALID_TOKEN", "본인 확인에 실패했습니다. 다시 시도해 주세요.", 400);
      }

    } else if (!member.pswd_hash) {
      // 소셜 전용 계정인데 socialToken 없음 → 프로젝트 없는 경우 단순 탈퇴도 허용
      // (프론트에서 프로젝트 없을 때는 다이얼로그 확인만으로 탈퇴 가능)
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // a. 회원 논리 삭제
      await tx.tbCmMember.update({
        where: { mber_id: auth.mberId },
        data:  { mber_sttus_code: "WITHDRAWN", wthdrw_dt: now },
      });

      // b. 소유 프로젝트 물리 삭제 (creat_mber_id 기준)
      //    CASCADE가 없을 경우 멤버 레코드를 먼저 삭제 후 프로젝트 삭제
      const ownedProjects = await tx.tbPjProject.findMany({
        where:  { creat_mber_id: auth.mberId },
        select: { prjct_id: true },
      });
      const ownedProjectIds = ownedProjects.map((p) => p.prjct_id);

      if (ownedProjectIds.length > 0) {
        // 소유 프로젝트의 멤버 레코드 먼저 삭제 (FK 제약)
        await tx.tbPjProjectMember.deleteMany({
          where: { prjct_id: { in: ownedProjectIds } },
        });
        await tx.tbPjProject.deleteMany({
          where: { prjct_id: { in: ownedProjectIds } },
        });
      }

      // c. 참여 프로젝트 멤버 상태 LEFT 처리 (소유 프로젝트 제외)
      const participatingMembers = await tx.tbPjProjectMember.findMany({
        where: {
          mber_id:         auth.mberId,
          mber_sttus_code: "ACTIVE",
          prjct_id:        { notIn: ownedProjectIds },
        },
        include: {
          project: { select: { prjct_id: true, prjct_nm: true } },
        },
      });

      if (participatingMembers.length > 0) {
        await tx.tbPjProjectMember.updateMany({
          where: {
            mber_id:  auth.mberId,
            prjct_id: { notIn: ownedProjectIds },
          },
          data: { mber_sttus_code: "LEFT", sttus_chg_dt: now },
        });

        // d. 참여 프로젝트 OWNER에게 제거 안내 INSERT
        for (const pm of participatingMembers) {
          const owner = await tx.tbPjProjectMember.findFirst({
            where: {
              prjct_id:        pm.prjct_id,
              role_code:       "OWNER",
              mber_sttus_code: "ACTIVE",
            },
            select: { mber_id: true },
          });

          if (owner) {
            await tx.tbPjMemberRemovalNotice.create({
              data: {
                mber_id:  owner.mber_id,
                prjct_id: pm.prjct_id,
                prjct_nm: pm.project.prjct_nm,
              },
            });
          }
        }
      }

      // e. 소셜 계정 삭제
      await tx.tbCmSocialAccount.deleteMany({
        where: { mber_id: auth.mberId },
      });

      // f. 전 RT 무효화
      await tx.tbCmRefreshToken.updateMany({
        where: { mber_id: auth.mberId, revoked_dt: null },
        data:  { revoked_dt: now },
      });

      // f. 전 세션 무효화
      await tx.tbCmMemberSession.updateMany({
        where: { mber_id: auth.mberId, invald_dt: null },
        data:  { invald_dt: now },
      });
    });

    return apiSuccess({ message: "탈퇴가 완료되었습니다." });

  } catch (err) {
    console.error("[DELETE /api/member/me] 오류:", err);
    return apiError("DB_ERROR", "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
