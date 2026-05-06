/**
 * requireBatchAuth — 배치 엔드포인트의 호출자 인증
 *
 * 호출자는 두 가지 중 하나여야 한다.
 *   ① 외부 cron (CRON 트리거)
 *      - 헤더 `X-Cron-Secret: <env BATCH_CRON_SECRET>` 일치
 *      - 운영 cron(crontab/cloud scheduler 등)이 호출할 때 사용
 *   ② SUPER_ADMIN 운영자 (MANUAL 트리거)
 *      - 어드민 화면에서 "수동 실행" 버튼으로 호출할 때 사용
 *      - JWT 세션 + sys_role_code='SUPER_ADMIN' 필요
 *
 * 보안:
 *   - BATCH_CRON_SECRET 미설정 환경에서는 ① 경로가 비활성화된다 (timing 비교
 *     자체를 시도하지 않음). 운영 환경에서는 반드시 설정해야 한다.
 *   - secret 비교는 길이 비공개의 timing-safe 비교를 위해 Node 표준 API 사용.
 *
 * 반환:
 *   - 성공: { trigger: 'CRON' | 'MANUAL', mberId?: string }
 *   - 실패: 401/403 Response
 */

import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import { checkRateLimit } from "@/lib/rateLimit";

export type BatchAuth =
  | { trigger: "CRON";  mberId: null }
  | { trigger: "MANUAL"; mberId: string };

/** 환경변수 BATCH_CRON_SECRET 의 최소 길이 — 너무 짧으면 보안 의미 없음 */
const MIN_SECRET_LEN = 32;

/** 헤더에서 호출자 IP 추출 — Vercel/Nginx 프록시 대응 */
function extractIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri;
  return "unknown";
}

export async function requireBatchAuth(request: NextRequest): Promise<BatchAuth | Response> {
  const ip = extractIp(request);

  // ── 인증 실패 시도에 대한 IP 기반 rate limit ──────────────────────────
  // 잘못된 secret 으로 brute force 시도가 들어와도 무한히 못 두드리도록
  // 한 IP 당 10분에 30회 제한. timingSafeEqual 만으로도 brute force 는
  // 사실상 불가능하지만, 호출 자체가 폭주하면 DB / 로그 부하가 커지므로
  // 명시 차단.
  const rl = await checkRateLimit({
    key:       `BATCH_AUTH_IP:${ip}`,
    limit:     30,
    windowSec: 600,
  });
  if (!rl.ok) {
    console.warn(`[batch-auth] RATE_LIMITED ip=${ip} count=${rl.count}`);
    return apiError(
      "RATE_LIMITED",
      "배치 호출 빈도가 너무 높습니다. 잠시 후 다시 시도하세요.",
      429
    );
  }

  // ── ① 외부 cron — X-Cron-Secret 헤더 검사 ─────────────────────────────
  const headerSecret = request.headers.get("x-cron-secret");
  const envSecret    = process.env.BATCH_CRON_SECRET;

  // env 미설정 / 너무 짧음 → cron 인증 비활성. 실수 차단.
  const envSecretOk = !!envSecret && envSecret.length >= MIN_SECRET_LEN;

  if (envSecretOk && headerSecret) {
    // byte 길이 기반 비교 (멀티바이트 문자 대비)
    const a = Buffer.from(headerSecret, "utf8");
    const b = Buffer.from(envSecret!,    "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { trigger: "CRON", mberId: null };
    }
    // 헤더는 들어왔으나 불일치 → 즉시 차단 (SUPER_ADMIN 으로 fallthrough 안 함)
    console.warn(`[batch-auth] secret mismatch ip=${ip}`);
    return apiError("UNAUTHORIZED_CRON", "잘못된 cron 시크릿입니다.", 401);
  }

  if (headerSecret && !envSecretOk) {
    // env 가 미설정/너무 짧은데 호출자가 헤더는 보낸 경우 — 운영 misconfig
    // 운영자 인지를 위해 ERROR 레벨로 강조.
    console.error(
      `[batch-auth] BATCH_CRON_SECRET 환경변수가 ${MIN_SECRET_LEN}자 이상으로 설정되지 않아 ` +
      `cron 인증이 비활성 상태입니다. ip=${ip}`
    );
    return apiError(
      "UNAUTHORIZED_CRON",
      "서버에 cron 시크릿이 설정되지 않았습니다. 운영자에게 문의하세요.",
      401
    );
  }

  // ── ② SUPER_ADMIN 어드민 — JWT 세션 ───────────────────────────────────
  const admin = await requireSystemAdmin(request);
  if (admin instanceof Response) return admin;

  return { trigger: "MANUAL", mberId: admin.mberId };
}
