/**
 * rateLimit — DB 기반 Fixed Window Counter Rate Limit
 *
 * 역할:
 *   - 인증 엔드포인트(로그인/가입/재설정/토큰갱신) 남용 방어
 *   - PostgreSQL의 INSERT ... ON CONFLICT ... DO UPDATE 원자 연산으로 race-free
 *   - 외부 인프라(Redis 등) 없이 Prisma 한 쿼리로 동작
 *
 * 알고리즘 — Fixed Window:
 *   1. 키별로 "윈도우 시작 시각 + 카운터" 하나의 행을 유지
 *   2. 요청 시 현재 시각이 윈도우 밖이면 → 리셋(window_start_dt=NOW, req_cnt=1)
 *                                    안이면 → req_cnt++
 *   3. req_cnt > limit 이면 차단
 *
 * 한계(허용 범위):
 *   - 윈도우 경계에서 순간적으로 2배 허용 가능성(fixed window 일반 특성).
 *     보안 목적상 대략적인 "비정상 트래픽" 차단에는 충분.
 *
 * 사용:
 *   const result = await checkRateLimit({ key: `LOGIN_IP:${ip}`, limit: 20, windowSec: 600 });
 *   if (!result.ok) return apiError("RATE_LIMITED", ..., 429, { retryAfter: result.retryAfter }, { "Retry-After": String(result.retryAfter) });
 */

import { prisma } from "@/lib/prisma";

export type RateLimitArgs = {
  /** 키 — "<ENDPOINT>_<DIMENSION>:<value>" 형식 권장 (예: LOGIN_IP:1.2.3.4) */
  key:       string;
  /** 윈도우 내 허용 요청 수 */
  limit:     number;
  /** 윈도우 길이 (초) */
  windowSec: number;
};

export type RateLimitResult =
  | { ok: true;  count: number; retryAfter: 0 }
  | { ok: false; count: number; retryAfter: number };

/**
 * 원자 업서트 후 현재 윈도우의 요청 수를 반환한다.
 *
 * 반환 값의 req_cnt > limit 이면 차단.
 * retryAfter(초)는 "현재 윈도우가 끝날 때까지" 남은 시간 — 429의 Retry-After 헤더에 사용.
 */
export async function checkRateLimit(args: RateLimitArgs): Promise<RateLimitResult> {
  const { key, limit, windowSec } = args;

  // 윈도우 만료 판정 기준 — 현재 시각 - windowSec.
  //   저장된 window_start_dt가 이 값보다 과거이면 "만료된 윈도우" → 리셋.
  //   (앱에서 먼저 계산해 파라미터 바인딩으로 넘긴다. SQL injection 방어)
  const windowExpireDt = new Date(Date.now() - windowSec * 1000);

  // PostgreSQL 원자 upsert — race-free
  //   - 신규 행: window_start=NOW, req_cnt=1
  //   - 기존 행 + 만료된 윈도우: 리셋
  //   - 기존 행 + 살아있는 윈도우: req_cnt++
  // Prisma $queryRaw의 태그드 템플릿은 파라미터 바인딩으로 안전.
  const rows = await prisma.$queryRaw<Array<{ req_cnt: number; window_start_dt: Date }>>`
    INSERT INTO tb_cm_rate_limit (rate_key_val, window_start_dt, req_cnt, creat_dt, updt_dt)
    VALUES (${key}, NOW(), 1, NOW(), NOW())
    ON CONFLICT (rate_key_val) DO UPDATE SET
      window_start_dt = CASE
        WHEN tb_cm_rate_limit.window_start_dt < ${windowExpireDt} THEN NOW()
        ELSE tb_cm_rate_limit.window_start_dt
      END,
      req_cnt = CASE
        WHEN tb_cm_rate_limit.window_start_dt < ${windowExpireDt} THEN 1
        ELSE tb_cm_rate_limit.req_cnt + 1
      END,
      updt_dt = NOW()
    RETURNING req_cnt, window_start_dt
  `;

  const row = rows[0];
  // upsert 특성상 RETURNING은 항상 1행이지만 방어적으로 처리
  if (!row) {
    // DB 예외 상황 — 차단보다 통과가 안전(가용성 우선). 운영 로그로만 남김
    console.warn(`[rateLimit] upsert returned empty result for key=${key}`);
    return { ok: true, count: 0, retryAfter: 0 };
  }

  if (row.req_cnt > limit) {
    // 윈도우 끝까지 남은 시간 — Retry-After 헤더용
    const windowEndMs = row.window_start_dt.getTime() + windowSec * 1000;
    const retryAfter  = Math.max(1, Math.ceil((windowEndMs - Date.now()) / 1000));
    return { ok: false, count: row.req_cnt, retryAfter };
  }

  return { ok: true, count: row.req_cnt, retryAfter: 0 };
}

/**
 * 요청 객체에서 클라이언트 IP를 추출하는 보조 함수.
 *   - x-forwarded-for 선두값 > x-real-ip > "unknown"
 *   - 프록시 체인이 없는 환경에선 위조 가능성에 주의(운영 환경의 프록시 정책에 의존)
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}
