/**
 * PATCH /api/worker/tasks/[taskId]/start — AI 태스크 처리 시작
 *
 * 역할:
 *   - 태스크 상태를 PENDING → IN_PROGRESS로 전환
 *   - 워커가 처리를 시작할 때 호출하여 중복 처리 방지
 *   - PENDING이 아닌 태스크 시작 시도는 409 반환
 *
 * 인증:
 *   - X-Mcp-Key (WORKER 용도 키) 단일 채널
 *   - 본인 요청 + 자기 프로젝트 태스크만 조작 가능 (소유권 검증)
 *
 * 동시성:
 *   - atomic updateMany 패턴 — `where` 절에 상태/소유권을 모두 박아 race condition 차단
 *   - 동일 사용자가 두 PC 에서 동일 키로 동시 호출해도 하나만 통과 (DB 행 락)
 *   - 실패 시(count=0)에만 진단을 위한 추가 조회 → NOT_FOUND/FORBIDDEN/CONFLICT 구분
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireWorkerAuth } from "../../../_lib/auth";

type RouteParams = { params: Promise<{ taskId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  // 워커 인증 — MCP 키(WORKER 용도) 단일 채널
  const auth = await requireWorkerAuth(request);
  if (auth instanceof Response) return auth;

  const { taskId } = await params;

  try {
    // ── atomic update — race condition 차단의 핵심 ─────────────────
    // where 절에 상태(PENDING) + 소유권(prjct_id, req_mber_id)을 모두 박아
    // 단일 SQL 문으로 검증과 갱신을 원자적으로 수행.
    // 동시 호출 시 DB 행 락으로 단 하나만 count=1 을 받고 나머지는 0.
    const updated = await prisma.tbAiTask.updateMany({
      where: {
        ai_task_id:      taskId,
        task_sttus_code: "PENDING",
        prjct_id:        auth.prjctId,
        req_mber_id:     auth.mberId,
      },
      data: { task_sttus_code: "IN_PROGRESS" },
    });

    if (updated.count === 1) {
      return apiSuccess({ taskId, status: "IN_PROGRESS" });
    }

    // ── count=0 인 케이스 진단 (느린 path) ────────────────────────
    // 정상 흐름(본인 큐 조회 후 호출)에서는 거의 도달하지 않음.
    // 도달 시 사용자 디버깅을 위해 NOT_FOUND/FORBIDDEN/CONFLICT 를 구분.
    const task = await prisma.tbAiTask.findUnique({
      where:  { ai_task_id: taskId },
      select: { task_sttus_code: true, prjct_id: true, req_mber_id: true },
    });

    if (!task) {
      return apiError("NOT_FOUND", "AI 태스크를 찾을 수 없습니다.", 404);
    }

    if (task.prjct_id !== auth.prjctId || task.req_mber_id !== auth.mberId) {
      return apiError(
        "FORBIDDEN_TASK_OWNERSHIP",
        "이 태스크에 접근할 권한이 없습니다.",
        403,
      );
    }

    // 본인 태스크지만 PENDING 이 아님 — race 패배 또는 이미 처리됨
    return apiError(
      "CONFLICT",
      `현재 상태(${task.task_sttus_code})에서는 시작할 수 없습니다. ` +
      `다른 워커가 먼저 가져갔거나 이미 처리된 태스크입니다.`,
      409,
    );
  } catch (err) {
    console.error(`[PATCH /api/worker/tasks/${taskId}/start] DB 오류:`, err);
    return apiError("DB_ERROR", "태스크 시작 처리에 실패했습니다.", 500);
  }
}
