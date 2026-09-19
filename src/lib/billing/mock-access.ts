/**
 * billing/mock-access — Mock PG 로 구독을 만들 수 있는 사람 제한 (정책 §1-1, §3)
 *
 * 왜 필요한가:
 *   Mock 게이트웨이는 돈이 오가지 않으면서도 실제 BASIC 플랜(무제한 프로젝트·멤버·첨부)을 켜 준다.
 *   운영에서 Mock 을 쓰는 전제는 "사용자가 회사 내부 인원뿐"인데, 회원가입은 이메일 인증만 하면
 *   누구나 할 수 있어 코드가 그 전제를 강제하지 않았다(2026-09-20 점검). 그래서 Mock 으로 카드를
 *   등록하는 두 지점(등록 시작·콜백)에서 호출자를 확인한다.
 *
 * 규칙:
 *   - 게이트웨이가 Mock 이 아니면(토스 등 실결제) 제한 없음 — 실제 카드가 곧 자격이다.
 *   - 시스템 관리자(SUPER_ADMIN)는 항상 허용.
 *   - 그 외에는 이메일 도메인이 허용목록에 있어야 한다.
 *       env BILLING_MOCK_ALLOWED_EMAIL_DOMAINS = "bareun.io,example.com"   (쉼표 구분, 대소문자 무시)
 *       비어 있으면 기본값 DEFAULT_ALLOWED_DOMAINS 를 쓴다 — 운영에 env 를 추가하지 않아도
 *       내부 팀은 그대로 쓰고 외부 가입자는 막힌다.
 *   - 개발 환경(NODE_ENV !== "production")에서는 제한하지 않는다 — 로컬에서 아무 계정으로 흐름을 볼 수 있게.
 *
 * 조회(GET /api/billing/subscription)·해지·좌석 축소는 막지 않는다. 막는 것은 "새 결제 수단으로
 * 구독을 시작/교체하는" 두 경로만이다.
 */

import { apiError } from "@/lib/apiResponse";
import type { BillingActor } from "./actor";
import { PG_PROVIDER } from "./constants";
import type { PaymentGateway } from "./gateway";

/** env 가 비어 있을 때의 허용 도메인 — 운영 회사 도메인 */
const DEFAULT_ALLOWED_DOMAINS: readonly string[] = ["bareun.io"];

function allowedDomains(): string[] {
  const raw = process.env.BILLING_MOCK_ALLOWED_EMAIL_DOMAINS ?? "";
  const fromEnv = raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : [...DEFAULT_ALLOWED_DOMAINS];
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

/**
 * Mock 게이트웨이로 카드 등록을 시작/완료할 수 있는 호출자인지 확인.
 * 허용이면 null, 아니면 403 Response.
 */
export function checkMockBillingAccess(gateway: PaymentGateway, actor: BillingActor): Response | null {
  if (gateway.provider !== PG_PROVIDER.MOCK) return null;
  if (process.env.NODE_ENV !== "production") return null;
  if (actor.isSystemAdmin) return null;
  if (allowedDomains().includes(emailDomain(actor.email))) return null;

  return apiError(
    "BILLING_MOCK_RESTRICTED",
    "현재 결제는 내부 검증(모의 결제) 단계라 지정된 계정만 구독을 시작할 수 있습니다. 정식 결제 오픈 후 이용해 주세요.",
    403,
  );
}
