/**
 * POST /api/auth/login — 이메일/비밀번호 로그인 (FID-00015)
 *
 * 역할:
 *   1. 계정 잠금 확인 → 423
 *   2. 비밀번호 bcrypt 비교
 *   3. 실패 시 로그인 시도 기록 + 연속 실패 5회 → 계정 잠금 → 423
 *   4. 성공 시 AT/RT 발급, 세션 기록
 *
 * Body: { email: string, password: string, rememberMe?: boolean }
 *
 * 응답:
 *   200  { data: { accessToken, refreshToken } }
 *   401  { code, message, failCount }
 *   403  { code, message }            — 미인증 계정
 *   423  { code, message, lockExpiredAt } — 계정 잠금
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import {
  verifyPassword,
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiryDate,
} from "@/lib/auth";

// 계정 잠금 기준 연속 실패 횟수
const MAX_FAIL_COUNT = 5;
// 계정 잠금 지속 시간 (밀리초) — 1시간
const LOCK_DURATION_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { email, password, rememberMe } = (body ?? {}) as Record<string, unknown>;

  // 공백 입력 검증
  if (!email || typeof email !== "string" || !email.trim()) {
    return apiError("VALIDATION_ERROR", "이메일을 입력해 주세요.", 400);
  }
  if (!password || typeof password !== "string" || !password.trim()) {
    return apiError("VALIDATION_ERROR", "비밀번호를 입력해 주세요.", 400);
  }

  // 클라이언트 IP, User-Agent (세션 기록용)
  const ipAddr    = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
                 ?? request.headers.get("x-real-ip")
                 ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  try {
    // ① 회원 조회 — 없으면 보안상 동일 메시지 반환 (이메일 존재 여부 노출 방지)
    const member = await prisma.tbCmMember.findUnique({
      where:  { email_addr: email },
      select: { mber_id: true, pswd_hash: true, mber_sttus_code: true },
    });

    if (!member || !member.pswd_hash) {
      return NextResponse.json(
        { code: "INVALID_CREDENTIALS", message: "이메일 또는 비밀번호가 올바르지 않습니다.", failCount: 0 },
        { status: 401 }
      );
    }

    // ② 미인증 계정 확인
    if (member.mber_sttus_code === "UNVERIFIED") {
      return apiError("UNVERIFIED", "이메일 인증이 완료되지 않았습니다.", 403);
    }

    // ③ 활성 계정 잠금 확인 (LOCKED 또는 UNLOCK_PENDING 상태, 만료 전)
    const activeLock = await prisma.tbCmAccountLock.findFirst({
      where: {
        mber_id:        member.mber_id,
        lock_sttus_code: { in: ["LOCKED", "UNLOCK_PENDING"] },
        lock_expiry_dt: { gt: new Date() },
      },
      orderBy: { creat_dt: "desc" },
    });

    if (activeLock?.lock_expiry_dt) {
      return NextResponse.json(
        {
          code:          "ACCOUNT_LOCKED",
          message:       "계정이 잠금 상태입니다.",
          lockExpiredAt: activeLock.lock_expiry_dt.toISOString(),
        },
        { status: 423 }
      );
    }

    // ④ 비밀번호 비교
    const isValid = await verifyPassword(password, member.pswd_hash);

    if (!isValid) {
      // 실패 시도 기록 + 연속 실패 카운트 (트랜잭션으로 원자 처리)
      let lockExpiry: Date | null = null;

      const { failCount } = await prisma.$transaction(async (tx) => {
        // 실패 시도 INSERT
        await tx.tbCmLoginAttempt.create({
          data: {
            mber_id:         member.mber_id,
            attempt_ip_addr: ipAddr,
            succes_yn:       "N",
            fail_rsn_cn:     "INVALID_PASSWORD",
          },
        });

        // 마지막 성공 이후 연속 실패 횟수
        const lastSuccess = await tx.tbCmLoginAttempt.findFirst({
          where:   { mber_id: member.mber_id, succes_yn: "Y" },
          orderBy: { creat_dt: "desc" },
        });

        const count = await tx.tbCmLoginAttempt.count({
          where: {
            mber_id:   member.mber_id,
            succes_yn: "N",
            ...(lastSuccess ? { creat_dt: { gt: lastSuccess.creat_dt } } : {}),
          },
        });

        // 5회 도달 시 계정 잠금 INSERT
        if (count >= MAX_FAIL_COUNT) {
          lockExpiry = new Date(Date.now() + LOCK_DURATION_MS);
          await tx.tbCmAccountLock.create({
            data: {
              mber_id:        member.mber_id,
              lock_rsn_cn:    "5회 연속 로그인 실패",
              fail_cnt:       count,
              lock_expiry_dt: lockExpiry,
              lock_sttus_code:"LOCKED",
            },
          });
        }

        return { failCount: count };
      });

      // 잠금 발생 시 423
      if (lockExpiry) {
        return NextResponse.json(
          {
            code:          "ACCOUNT_LOCKED",
            message:       "5회 연속 실패로 계정이 잠겼습니다.",
            lockExpiredAt: (lockExpiry as Date).toISOString(),
          },
          { status: 423 }
        );
      }

      return NextResponse.json(
        {
          code:      "INVALID_CREDENTIALS",
          message:   `이메일 또는 비밀번호가 올바르지 않습니다. (${failCount}회 실패)`,
          failCount,
        },
        { status: 401 }
      );
    }

    // ⑤ 로그인 성공
    const refreshTokenRaw  = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshTokenRaw);
    const autoLoginYn      = rememberMe === true ? "Y" : "N";
    const rtExpiry         = refreshTokenExpiryDate();

    await prisma.$transaction(async (tx) => {
      // 성공 시도 기록
      await tx.tbCmLoginAttempt.create({
        data: {
          mber_id:         member.mber_id,
          attempt_ip_addr: ipAddr,
          succes_yn:       "Y",
        },
      });

      // 세션 먼저 생성 — sesn_id를 RT에 연결해야 기기별 로그아웃이 가능
      const sesn = await tx.tbCmMemberSession.create({
        data: {
          mber_id:        member.mber_id,
          device_info_cn: userAgent,
          ip_addr:        ipAddr,
        },
      });

      // 리프레시 토큰 저장 + 세션 연결
      await tx.tbCmRefreshToken.create({
        data: {
          mber_id:        member.mber_id,
          token_hash_val: refreshTokenHash,
          auto_login_yn:  autoLoginYn,
          expiry_dt:      rtExpiry,
          sesn_id:        sesn.sesn_id,
        },
      });
    });

    const accessToken = signAccessToken({ mberId: member.mber_id, email });

    return apiSuccess({ accessToken, refreshToken: refreshTokenRaw });

  } catch (err) {
    console.error("[POST /api/auth/login] 오류:", err);
    return apiError("DB_ERROR", "로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
