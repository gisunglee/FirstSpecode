/**
 * DELETE /api/member/me — 회원 탈퇴 (FID-00050, FID-00051, FID-00052)
 *
 * 역할:
 *   1. 본인 확인: password 또는 socialToken 중 하나로 검증
 *      - password: pswd_hash bcrypt 비교
 *      - socialToken: 소셜 토큰 검증 후 연동 계정 확인
 *      - 둘 다 없으면: 소유 프로젝트 없는 경우의 단순 탈퇴 (AT만으로 진행)
 *   2. 트랜잭션:
 *      a. 회원 논리 삭제 + 가명처리 (WITHDRAWN + wthdrw_dt, 이메일→NULL·HMAC 가명값만 보존, 이름→"탈퇴회원",
 *         비밀번호·프로필 이미지 제거). 회원 row 는 FK(작성자·소유자·결제 이력) 때문에 남기고,
 *         이메일 UNIQUE 를 비워 같은 이메일로 즉시 재가입할 수 있게 한다. 복구 기간은 두지 않는다
 *         (2026-09-24 결정). 재가입은 새 mber_id — 이전 데이터와 이어지지 않는다.
 *      b. 소유 프로젝트 보관 삭제 (owner_mber_id 기준, 프로젝트 삭제와 같은 soft delete)
 *         — 과거엔 CASCADE 즉시 물리 삭제였음. 결제 도입 후 "실수 탈퇴 → 데이터 소멸"
 *           분쟁을 막기 위해 보관 기간을 두고 배치(project-hard-delete)가 정리하게 변경.
 *           탈퇴자는 돌아오지 않으므로 본인 멤버십도 함께 REMOVED 처리한다.
 *      c. 참여 프로젝트 멤버 상태 LEFT 처리
 *      d. 참여 프로젝트 OWNER에게 제거 안내 INSERT
 *      e. 소셜 계정 삭제 (→ 같은 구글 계정으로 다시 오면 EXISTING 이 아닌 NEW 로 판정됨)
 *      e-2. 평문 이메일이 남는 인증 메일 row·비밀번호 재설정 토큰 삭제, MCP 키 폐기, 동의 기록의 IP 제거
 *      f. 전 RT·세션 무효화
 *      g. 구독 해지 + 빌링키 삭제 (정책 §1-10 — 안 하면 탈퇴자 카드에서 계속 출금)
 *
 * Body: { password?: string, socialToken?: string }
 * Header: Authorization: Bearer <AT>
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireAuth } from "@/lib/requireAuth";
import { verifyPassword, verifySocialToken, hashWithdrawnEmail } from "@/lib/auth";
import { clearRefreshTokenCookie } from "@/lib/authRefreshCookie";
import { isSystemAdminWithdrawalBlocked, WITHDRAWN_MEMBER_NAME } from "@/lib/memberLifecyclePolicy";
import { resolveSoftDeleteRetentionDays, softDeleteProject } from "@/lib/projectLifecycle";
import { hasLiveSubscription, withdrawSubscription } from "@/lib/billing/subscription";
import { toBillingErrorResponse } from "@/lib/billing/errors";

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
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
      select: { email_addr: true, pswd_hash: true, mber_sttus_code: true, sys_role_code: true },
    });

    if (!member) {
      return apiError("NOT_FOUND", "회원 정보를 찾을 수 없습니다.", 404);
    }
    if (member.mber_sttus_code === "WITHDRAWN") {
      return apiError("ALREADY_WITHDRAWN", "이미 탈퇴한 계정입니다.", 400);
    }
    // 시스템 관리자는 역할을 먼저 다른 관리자에게 해임받아야 탈퇴할 수 있다.
    // 역할 API의 자기 해임 차단을 탈퇴로 우회해 마지막 관리자가 사라지는 사고를 방지한다.
    if (isSystemAdminWithdrawalBlocked(member.sys_role_code)) {
      return apiError(
        "SYSTEM_ADMIN_WITHDRAWAL_BLOCKED",
        "시스템 관리자 역할을 해임한 뒤 탈퇴할 수 있습니다. 다른 시스템 관리자에게 요청해 주세요.",
        409,
      );
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
      // 소셜 전용 계정인데 socialToken 없음 → 소유 프로젝트도, 살아 있는 구독도 없을 때만 단순 탈퇴 허용
      // (프론트도 같은 조건으로 재인증 여부를 정한다.)
      // 탈퇴는 소유 프로젝트 보관 삭제·구독 종료·빌링키 삭제까지 이어지므로, 탈취된 액세스 토큰 하나로
      // 되게 두면 안 된다 — 지킬 것이 있는 계정은 소셜 재인증을 거친다 (2026-09-20 점검).
      const [ownedProjectCount, liveSubscription] = await Promise.all([
        prisma.tbPjProject.count({ where: { owner_mber_id: auth.mberId, del_yn: "N" } }),
        hasLiveSubscription(auth.mberId),
      ]);
      if (ownedProjectCount > 0 || liveSubscription) {
        return apiError(
          "REAUTH_REQUIRED",
          "소유한 프로젝트나 이용 중인 구독이 있어 소셜 계정 재인증이 필요합니다. 다시 로그인한 뒤 탈퇴를 진행해 주세요.",
          400
        );
      }
    }

    const now = new Date();

    // 소유 프로젝트 보관 기간 — 프로젝트 직접 삭제와 동일한 설정값을 쓴다.
    const retentionDays = await resolveSoftDeleteRetentionDays(prisma);
    const hardDeleteAt  = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      // a. 회원 논리 삭제 + 가명처리
      //    email_addr 를 비우는 것이 핵심 — UNIQUE 가 풀려 같은 이메일로 바로 재가입할 수 있고,
      //    소셜 콜백의 "동일 이메일 기존 계정(LINK_REQUIRED)" 판정에도 걸리지 않아 새 계정이 된다.
      //    해시는 운영자가 이메일로 탈퇴 회원을 찾을 때(결제 분쟁 등)만 쓴다.
      await tx.tbCmMember.update({
        where: { mber_id: auth.mberId },
        data:  {
          mber_sttus_code: "WITHDRAWN",
          wthdrw_dt:       now,
          mdfcn_dt:        now,
          email_addr:      null,
          email_hash:      member.email_addr ? hashWithdrawnEmail(member.email_addr) : null,
          mber_nm:         WITHDRAWN_MEMBER_NAME,
          profl_img_url:   null,
          pswd_hash:       null,
        },
      });

      // b. 소유 프로젝트 보관 삭제 (owner_mber_id 기준)
      //    소유 판정은 owner_mber_id 단일 컬럼만 본다. creat_mber_id 로 고르면
      //    양도 후 나간 원 생성자가 탈퇴할 때 남의 프로젝트가 지워진다.
      //    이미 삭제 예정(del_yn='Y')인 프로젝트는 그대로 두고, 아래 c 단계의
      //    제외 목록에는 포함시켜 멤버십 상태를 건드리지 않는다.
      const ownedProjects = await tx.tbPjProject.findMany({
        where:  { owner_mber_id: auth.mberId },
        select: { prjct_id: true, prjct_nm: true, del_yn: true },
      });
      const ownedProjectIds = ownedProjects.map((p) => p.prjct_id);

      for (const project of ownedProjects) {
        if (project.del_yn === "Y") continue;
        await softDeleteProject(tx, {
          projectId:       project.prjct_id,
          projectName:     project.prjct_nm,
          actorMberId:     auth.mberId,
          keepActorActive: false,
          now,
          hardDeleteAt,
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

      // e-2. 잔여 개인정보·자격증명 정리
      //    인증 메일 row 는 평문 이메일(가입·이메일 변경 대기)을 들고 있어 함께 지운다.
      //    MCP 키는 인증 단계에서 비활성 회원을 거부하지만, 탈퇴 시점에 명시적으로 폐기해 둔다.
      await tx.tbCmEmailVerification.deleteMany({ where: { mber_id: auth.mberId } });
      await tx.tbCmPasswordResetToken.deleteMany({ where: { mber_id: auth.mberId } });
      await tx.tbCmMcpKey.updateMany({
        where: { mber_id: auth.mberId, revoke_dt: null },
        data:  { revoke_dt: now },
      });
      // 동의 기록은 증빙으로 남기되(종류·버전·일시) 개인정보인 IP 는 지운다 — 개인정보처리방침 "탈퇴 시 파기"와 맞춤
      await tx.tbCmMemberConsent.updateMany({
        where: { mber_id: auth.mberId, ip_addr: { not: null } },
        data:  { ip_addr: null },
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

      // g. 구독 해지 + 빌링키 삭제 — 살아 있는 구독이 있으면 CANCELED 로 닫는다.
      //    탈퇴자의 카드에서 다음 달에도 출금되는 사고를 여기서 끊는다.
      await withdrawSubscription(tx, auth.mberId, now);
    });

    return clearRefreshTokenCookie(apiSuccess({ message: "탈퇴가 완료되었습니다." }));

  } catch (err) {
    // 결제 청구가 진행 중이면 구독 종료가 409 로 막힌다 — 몇 초 뒤 다시 시도하면 된다
    const billing = toBillingErrorResponse(err);
    if (billing) return billing;
    console.error("[DELETE /api/member/me] 오류:", err);
    return apiError("DB_ERROR", "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
