/**
 * GET /api/worker/tasks — AI 워커용 PENDING 태스크 목록 조회
 *
 * 역할:
 *   - 외부 AI 워커(Python 스크립트 / Claude Code 커맨드)가 처리할 태스크를 가져옴
 *   - PENDING 상태인 태스크를 요청일시(req_dt) 오름차순(FIFO)으로 반환
 *   - 화면 CRUD API(/api/projects/...)와 완전히 분리된 워커 전용 엔드포인트
 *
 * 인증:
 *   X-Worker-Key 헤더 필수 (WORKER_API_KEY 환경변수)
 *
 * Query Parameters:
 *   limit    — 최대 조회 건수 (기본 10, 최대 50)
 *   taskType — 태스크 유형 필터 (DESIGN|INSPECT|IMPACT|IMPLEMENT|MOCKUP|CUSTOM)
 *   refType  — 참조 유형 필터 (AREA|FUNCTION)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireWorkerAuth } from "../_lib/auth";

export async function GET(request: NextRequest) {
  // 워커 인증 확인
  const authError = requireWorkerAuth(request);
  if (authError) return authError;

  const url      = new URL(request.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "10");
  const limit    = Math.min(Math.max(1, isNaN(limitRaw) ? 10 : limitRaw), 50);
  const taskType = url.searchParams.get("taskType") ?? null;
  const refType  = url.searchParams.get("refType")  ?? null;

  try {
    const tasks = await prisma.tbAiTask.findMany({
      where: {
        task_sttus_code: "PENDING",
        // exec_avlbl_dt가 설정된 경우 해당 시각 이후에만 처리
        OR: [
          { exec_avlbl_dt: null },
          { exec_avlbl_dt: { lte: new Date() } },
        ],
        ...(taskType ? { task_ty_code: taskType } : {}),
        ...(refType  ? { ref_ty_code: refType }   : {}),
      },
      orderBy: { req_dt: "asc" }, // FIFO — 오래된 요청부터 처리
      take: limit,
      select: {
        ai_task_id:        true,
        prjct_id:          true,
        ref_ty_code:       true,
        ref_id:            true,
        task_ty_code:      true,
        req_cn:            true,     // 프롬프트 조합에 사용할 요청 본문
        coment_cn:         true,     // AI 요청 코멘트
        req_snapshot_data: true,     // 요청 시점 스냅샷
        req_dt:            true,
        retry_cnt:         true,
        parent_task_id:    true,
      },
    });

    return apiSuccess({
      count: tasks.length,
      tasks: tasks.map((t) => ({
        taskId:           t.ai_task_id,
        projectId:        t.prjct_id,
        refType:          t.ref_ty_code,
        refId:            t.ref_id,
        taskType:         t.task_ty_code,
        reqCn:            t.req_cn            ?? "",
        commentCn:        t.coment_cn         ?? "",
        reqSnapshotData:  t.req_snapshot_data ?? {},
        requestedAt:      t.req_dt.toISOString(),
        retryCnt:         t.retry_cnt,
        parentTaskId:     t.parent_task_id    ?? null,
      })),
    });
  } catch (err) {
    console.error("[GET /api/worker/tasks] DB 오류:", err);
    return apiError("DB_ERROR", "태스크 조회에 실패했습니다.", 500);
  }
}
