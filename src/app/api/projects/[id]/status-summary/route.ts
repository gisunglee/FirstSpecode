/**
 * GET /api/projects/[id]/status-summary — 워크플로우 지표 조회
 *
 * 역할:
 *   - StatusBar AI 지표 배지용 집계 데이터 반환 (FID-00206)
 *   - 미반영 설계 변경 건수 (ai_req_yn = 'N')
 *   - AI 태스크 상태별 집계 (PENDING / IN_PROGRESS / DONE)
 *
 * 폴링 주기: 클라이언트에서 30초 간격 refetch
 *
 * 보안 (2026-05-06 보강):
 *   - 인증·멤버십 가드 추가. 이전엔 익명 접근 가능했고 30초 폴링이라 트래픽
 *     분석으로 가장 먼저 노출되는 엔드포인트였음 → 다른 프로젝트의 AI 워크플로우
 *     진척도(미반영 변경 건수, 태스크 상태) 가 외부에서 모니터링 가능했음.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  // Next.js 16: params는 Promise — await 필수
  const { id: projectId } = await params;

  // 인증 + 멤버십 + 읽기 권한 — 이 한 줄이 빠지면 익명 접근 가능
  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  try {
    // 의존 관계 없는 집계 쿼리 4개를 병렬 실행
    const [unsyncedCount, pendingCount, inProgressCount, doneCount] =
      await Promise.all([
        // 미반영 설계 변경: AI에게 아직 전달되지 않은 변경사항
        prisma.tbDsDesignChange.count({
          where: { prjct_id: projectId, ai_req_yn: "N" },
        }),
        // AI 태스크 — 대기
        prisma.tbAiTask.count({
          where: { prjct_id: projectId, task_sttus_code: "PENDING" },
        }),
        // AI 태스크 — 진행 중
        prisma.tbAiTask.count({
          where: { prjct_id: projectId, task_sttus_code: "IN_PROGRESS" },
        }),
        // AI 태스크 — 완료 (당일 완료분만 집계 — 누적 수치가 너무 커지지 않도록)
        prisma.tbAiTask.count({
          where: {
            prjct_id: projectId,
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
    console.error(`[GET /api/projects/${projectId}/status-summary] DB 오류:`, err);
    return apiError("DB_ERROR", "상태 요약 조회에 실패했습니다.", 500);
  }
}
