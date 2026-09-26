/**
 * POST /api/admin/batch/run/access-log-cleanup — 접속 기록 보존기간 만료 정리 배치
 *
 * 왜:
 *   개인정보처리방침 제3조가 "서비스 접속 기록(IP 등) 3개월 보관(통신비밀보호법)"으로 안내하는데,
 *   로그인 시도·세션·리프레시 토큰·레이트리밋 행은 지우는 곳이 없어 영구 보존되고 있었다(2026-09-24 GPT 검토 지적).
 *   탈퇴 시점에 지우는 게 아니라 — 탈퇴자든 아니든 — 90일이 지난 접속 기록을 매일 지운다.
 *
 * 대상 (모두 creat_dt / window_start_dt 가 90일 이전인 행):
 *   - tb_cm_login_attempt   로그인 시도 (IP 포함)
 *   - tb_cm_refresh_token   리프레시 토큰 (절대 만료 30일 — 90일이면 전부 죽은 토큰)
 *   - tb_cm_member_session  세션 (IP·기기 정보). RT 절대 만료가 30일이라 90일 지난 세션은 전부 종료 상태
 *   - tb_cm_rate_limit      레이트리밋 윈도(≤1시간짜리) — 남은 행은 키만 차지
 *
 * 항목 단위는 "테이블"이다(행 단위가 아님). 행이 수만 건이어도 잡 로그는 4건, 삭제 건수는 meta 에 남긴다.
 * 어드민 잡 이력 화면(/admin/batch)의 종류 필터에 ACCESS_LOG_CLEANUP 을 함께 등록했다.
 *
 * 호출: 외부 cron(일 1회, BATCH_CRON_SECRET) 또는 SUPER_ADMIN 세션 — requireBatchAuth 가 판정
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { runJob } from "@/lib/batch/runJob";
import { requireBatchAuth } from "@/lib/batch/requireBatchAuth";

/** 접속 기록 보존기간 — 통신비밀보호법 3개월. 개인정보처리방침 제3조 표와 함께 바꿔야 한다. */
export const ACCESS_LOG_RETENTION_DAYS = 90;

type TargetTable = "LOGIN_ATTEMPT" | "REFRESH_TOKEN" | "MEMBER_SESSION" | "RATE_LIMIT";

const TARGETS: { key: TargetTable; label: string }[] = [
  { key: "LOGIN_ATTEMPT",  label: "tb_cm_login_attempt" },
  // 세션보다 먼저 — 토큰이 세션(sesn_id)을 가리킨다 (DB FK 는 없지만 참조 방향을 지킨다)
  { key: "REFRESH_TOKEN",  label: "tb_cm_refresh_token" },
  { key: "MEMBER_SESSION", label: "tb_cm_member_session" },
  { key: "RATE_LIMIT",     label: "tb_cm_rate_limit" },
];

/** 테이블 1개의 만료 행 삭제 — 삭제 건수 반환 */
async function purgeTable(key: TargetTable, cutoff: Date): Promise<number> {
  switch (key) {
    case "LOGIN_ATTEMPT":
      return (await prisma.tbCmLoginAttempt.deleteMany({ where: { creat_dt: { lt: cutoff } } })).count;
    case "REFRESH_TOKEN":
      return (await prisma.tbCmRefreshToken.deleteMany({ where: { creat_dt: { lt: cutoff } } })).count;
    case "MEMBER_SESSION":
      return (await prisma.tbCmMemberSession.deleteMany({ where: { creat_dt: { lt: cutoff } } })).count;
    case "RATE_LIMIT":
      return (await prisma.tbCmRateLimit.deleteMany({ where: { window_start_dt: { lt: cutoff } } })).count;
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireBatchAuth(request);
  if (auth instanceof Response) return auth;

  const cutoff = new Date(Date.now() - ACCESS_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  try {
    const result = await runJob<TargetTable>({
      jobTyCode:  "ACCESS_LOG_CLEANUP",
      jobNm:      "접속 기록 보존기간 만료 정리",
      trgrTyCode: auth.trigger,
      trgrMberId: auth.mberId,
      maxItems:   TARGETS.length,
      summary:    { retentionDays: ACCESS_LOG_RETENTION_DAYS, cutoff: cutoff.toISOString() },

      async loadTargets() {
        return TARGETS.map((t) => ({ item: t.key, trgtId: t.key, label: t.label, trgtTy: "TABLE" }));
      },

      async processItem(key) {
        const deleted = await purgeTable(key, cutoff);
        // 지울 게 없어도 정상 — SKIPPED 가 아니라 SUCCESS(0건) 으로 남겨 "돌았다"는 기록을 유지
        return { status: "SUCCESS", meta: { deleted, cutoff: cutoff.toISOString() } };
      },
    });

    return apiSuccess(result);
  } catch (err) {
    console.error("[POST /api/admin/batch/run/access-log-cleanup] 오류:", err);
    return apiError("BATCH_ERROR", "배치 실행 중 오류가 발생했습니다.", 500);
  }
}
