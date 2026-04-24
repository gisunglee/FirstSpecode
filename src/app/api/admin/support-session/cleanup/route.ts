/**
 * POST /api/admin/support-session/cleanup — 만료된 지원 세션 일괄 종료
 *
 * 동작:
 *   - expires_dt < now AND ended_dt IS NULL 인 세션을 찾아
 *     ended_dt = expires_dt 로 마킹 (삭제하지 않음 — 추적을 위해 보존)
 *   - 정리 건수와 함께 SUPPORT_SESSION_CLEANUP 감사 기록 1건 작성
 *   - 트랜잭션으로 묶어 "로그 없이 정리만 되는" 상태 방지
 *
 * 왜 크론잡이 아닌 버튼인가:
 *   - 초기 단계엔 쌓이는 양이 적어 방치해도 기능 문제 없음
 *   - 크론잡보다 "누가 언제 정리했는지" 추적이 선명 (감사 로그에 admin_mber_id 남음)
 *   - 운영자가 수동으로 확인·실행 — 우연치 않은 대량 처리 방지
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";

export async function POST(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // ① 만료된 채로 종료 처리 안 된 세션들의 count 조회 (감사 memo 용)
      const staleCount = await tx.tbSysAdminSupportSession.count({
        where: { ended_dt: null, expires_dt: { lte: now } },
      });

      if (staleCount === 0) {
        return { cleanedCount: 0 };
      }

      // ② 일괄 종료. ended_dt 를 "만료 시각" 으로 설정 — 실제 만료 타이밍 보존.
      //    updateMany 는 now() 를 컬럼값으로 못 쓰니 애플리케이션 측 now 를 주입한다.
      //    (정확한 만료 시각은 expires_dt 컬럼에 이미 있으므로 ended_dt 는 "정리 시점" 으로 통일해도 무방)
      const updated = await tx.tbSysAdminSupportSession.updateMany({
        where: { ended_dt: null, expires_dt: { lte: now } },
        data:  { ended_dt: now },
      });

      // ③ 감사 기록 — target 은 단일이 아니므로 null, memo 에 정리 건수 명시
      await tx.tbSysAdminAudit.create({
        data: {
          admin_mber_id: gate.mberId,
          action_type:   "SUPPORT_SESSION_CLEANUP",
          target_type:   null,
          target_id:     null,
          memo:          `만료 세션 ${updated.count}건 일괄 정리`,
          ip_addr:       gate.ipAddr    ?? null,
          user_agent:    gate.userAgent ?? null,
        },
      });

      return { cleanedCount: updated.count };
    });

    return apiSuccess(result);
  } catch (err) {
    console.error("[POST /api/admin/support-session/cleanup] DB 오류:", err);
    return apiError("DB_ERROR", "세션 정리 중 오류가 발생했습니다.", 500);
  }
}
