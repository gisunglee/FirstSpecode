/**
 * GET /api/projects/[id]/status-summary — 워크플로우 지표 조회
 *
 * 역할:
 *   - StatusBar AI 지표 배지용 집계 데이터 반환 (FID-00206)
 *   - 미반영 설계 변경 건수 (ai_req_yn = 'N')
 *   - AI 태스크 상태별 집계 (PENDING / IN_PROGRESS / DONE)
 *
 * 폴링 주기: 클라이언트에서 30초 간격 refetch
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  // Next.js 16: params는 Promise — await 필수
  const { id: prjct_id } = await params;

  if (!prjct_id) {
    return apiError("VALIDATION_ERROR", "프로젝트 ID가 필요합니다.", 400);
  }

  try {
    // 의존 관계 없는 집계 쿼리 3개를 병렬 실행
    const [unsyncedCount, pendingCount, inProgressCount, doneCount] =
      await Promise.all([
        // 미반영 설계 변경: AI에게 아직 전달되지 않은 변경사항
        prisma.tbDsDesignChange.count({
          where: { prjct_id, ai_req_yn: "N" },
        }),
        // AI 태스크 — 대기
        prisma.tbAiTask.count({
          where: { prjct_id, task_sttus_code: "PENDING" },
        }),
        // AI 태스크 — 진행 중
        prisma.tbAiTask.count({
          where: { prjct_id, task_sttus_code: "IN_PROGRESS" },
        }),
        // AI 태스크 — 완료 (당일 완료분만 집계 — 누적 수치가 너무 커지지 않도록)
        prisma.tbAiTask.count({
          where: {
            prjct_id,
            task_sttus_code: "DONE",
            compl_dt: {
              // 오늘 00:00 이후 완료된 태스크만
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
            },
          },
        }),
      ]);

    return apiSuccess({
      unsyncedChanges: unsyncedCount,
      aiStats: {
        pending:    pendingCount,
        inProgress: inProgressCount,
        done:       doneCount,
      },
    });
  } catch (err) {
    console.error(`[GET /api/projects/${prjct_id}/status-summary] DB 오류:`, err);
    return apiError("DB_ERROR", "상태 요약 조회에 실패했습니다.", 500);
  }
}
