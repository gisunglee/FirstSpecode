/**
 * billing/errors — 도메인 서비스가 던지는 에러 → 라우트가 apiError 로 변환
 *
 * 서비스 계층은 Response 를 모른다. 코드·메시지·HTTP 상태만 담아 던지고,
 * 라우트가 `toBillingErrorResponse` 한 줄로 변환한다. 예상 밖 에러(DB 등)는 그대로
 * 위로 던져 라우트의 catch 에서 500 으로 처리한다.
 */

import { apiError } from "@/lib/apiResponse";

export class BillingError extends Error {
  readonly code:   string;
  readonly status: number;
  readonly extra?: Record<string, unknown>;

  constructor(code: string, message: string, status = 400, extra?: Record<string, unknown>) {
    super(message);
    this.name   = "BillingError";
    this.code   = code;
    this.status = status;
    this.extra  = extra;
  }
}

/** 라우트 catch 절에서: BillingError 면 그 내용으로, 아니면 null (호출자가 500 처리) */
export function toBillingErrorResponse(err: unknown): Response | null {
  if (err instanceof BillingError) {
    return apiError(err.code, err.message, err.status, err.extra);
  }
  return null;
}
