/**
 * consent — 약관·개인정보 동의 규칙 (가입 시 필수 2건)
 *
 * 역할:
 *   - 동의 종류·현재 버전 상수 (tb_cm_member_consent.consent_type / consent_ver)
 *   - 가입 요청 body 의 동의 플래그 검증
 *   - 트랜잭션 안에서 동의 기록 INSERT
 *
 * 사용처: POST /api/auth/register (이메일 가입), POST /api/auth/social/register (소셜 가입)
 */

import type { Prisma } from "@prisma/client";

export const CONSENT_TYPES = ["TERMS", "PRIVACY"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/**
 * 현재 약관 버전 = 시행일(YYYY-MM-DD). **단일 출처** —
 * 약관·방침 화면의 "시행일: …" 표기(siteInfo.ts)도 이 값을 한글로 변환해 쓴다. 개정 시 여기만 바꾼다.
 * 개정하면 이전 버전 원문도 복원 가능해야 한다(전자상거래법) — 첫 개정 때 이력 표기 방식을 정한다.
 */
export const CURRENT_CONSENT_VERSION: Record<ConsentType, string> = {
  TERMS:   "2026-11-01",
  PRIVACY: "2026-11-01",
};

/** "2026-10-01" → "2026년 10월 1일" (약관 화면 표기용) */
export function formatConsentVersionKo(version: string): string {
  const [y, m, d] = version.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

/** 약관 화면 경로 — 가입 폼의 동의 문구 링크 */
export const CONSENT_PAGE_PATH: Record<ConsentType, string> = {
  TERMS:   "/intro/terms",
  PRIVACY: "/intro/privacy",
};

/** 가입 body 의 동의 플래그 이름 */
export type ConsentBody = { agreeTerms?: unknown; agreePrivacy?: unknown };

/**
 * 필수 동의 2건이 모두 true 인지 확인. 하나라도 빠지면 사용자에게 보여줄 메시지를 돌려준다.
 * 체크박스를 우회해 API 를 직접 호출하는 경우를 막는 서버 측 최종 검증.
 */
export function validateRequiredConsents(body: ConsentBody): string | null {
  if (body.agreeTerms !== true)   return "이용약관에 동의해 주세요.";
  if (body.agreePrivacy !== true) return "개인정보 수집·이용에 동의해 주세요.";
  return null;
}

/** 가입 트랜잭션 안에서 필수 동의 2건을 현재 버전으로 기록한다. */
export async function recordRequiredConsents(
  tx: Prisma.TransactionClient,
  mberId: string,
  ipAddr: string | null,
): Promise<void> {
  await tx.tbCmMemberConsent.createMany({
    data: CONSENT_TYPES.map((type) => ({
      mber_id:      mberId,
      consent_type: type,
      consent_ver:  CURRENT_CONSENT_VERSION[type],
      ip_addr:      ipAddr,
    })),
  });
}
