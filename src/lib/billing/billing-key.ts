/**
 * billing/billing-key — 빌링키(PG 자동결제 키) 저장용 암호화 래퍼
 *
 * 역할:
 *   - src/lib/encrypt.ts 의 AES 암호화를 그대로 쓰되, 운영 환경에서 암호화 키(API_KEY_SECRET)가
 *     비어 있거나 짧으면 결제 경로만 fail-closed 로 막는다.
 *
 * 왜 encrypt.ts 에서 막지 않는가:
 *   encrypt.ts 는 AI API 키 저장에도 쓰인다. 거기서 throw 하면 결제와 무관한 기능까지 함께 멈춘다.
 *   빌링키는 유출 시 남의 카드로 결제할 수 있는 값이라 기본 개발 키로 저장되는 일만은 막아야 한다.
 *
 * 운영 주의:
 *   API_KEY_SECRET 을 한 번 정하면 바꾸지 않는다. 바꾸면 기존 빌링키가 전부 복호화되지 않아
 *   정기 결제가 실패하고 재시도 소진 뒤 강등된다. 바꿔야 한다면 재암호화 절차를 먼저 만든다.
 */

import { decryptApiKey, encryptApiKey } from "@/lib/encrypt";
import { BILLING_ERROR_CODES as E } from "./constants";
import { BillingError } from "./errors";

/** 정책 §2 — 32자(바이트) 키. encrypt.ts 가 32바이트로 맞추므로 그보다 짧으면 0 패딩되어 약해진다 */
const MIN_SECRET_LENGTH = 32;

function assertSecretConfigured(): void {
  if (process.env.NODE_ENV !== "production") return;
  const secret = process.env.API_KEY_SECRET ?? "";
  if (secret.length >= MIN_SECRET_LENGTH) return;
  console.error(
    `[billing] API_KEY_SECRET 이 ${MIN_SECRET_LENGTH}자 이상으로 설정되지 않아 결제 수단 저장·청구를 중단합니다. ` +
    "운영 환경변수를 설정해 주세요.",
  );
  throw new BillingError(
    E.GATEWAY_UNAVAILABLE,
    "결제 시스템 설정이 완료되지 않아 지금은 결제 수단을 처리할 수 없습니다. 운영자에게 문의해 주세요.",
    503,
  );
}

export function encryptBillingKey(plaintext: string): string {
  assertSecretConfigured();
  return encryptApiKey(plaintext);
}

export function decryptBillingKey(encrypted: string): string {
  assertSecretConfigured();
  return decryptApiKey(encrypted);
}
