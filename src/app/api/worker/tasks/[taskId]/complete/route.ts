/**
 * POST /api/worker/tasks/[taskId]/complete — AI 태스크 처리 완료
 *
 * 역할:
 *   - 태스크 상태를 IN_PROGRESS → DONE(성공) 또는 FAILED(실패)로 전환
 *   - AI 처리 결과(result_cn)를 저장하고 완료 시각(compl_dt)을 기록
 *   - DONE 인 경우 refType 별로 ref 엔티티의 본문 컬럼까지 자동 반영 (applyResultToRef 참고)
 *   - IN_PROGRESS 상태가 아닌 경우 409 반환
 *
 * 인증:
 *   - X-Mcp-Key (WORKER 용도 키) 단일 채널
 *   - 본인 요청 + 자기 프로젝트 태스크만 완료 처리 가능 (소유권 검증)
 *
 * 동시성:
 *   - 트랜잭션 내 atomic updateMany — `where` 에 IN_PROGRESS + 소유권 박음
 *   - count=1 인 경우만 ref 엔티티 결과 전파. 같은 트랜잭션이라 일관성 보장.
 *   - 두 워커가 동시 complete 시도해도 하나만 통과, 다른 하나는 409.
 *
 * Body:
 *   {
 *     status:   "DONE" | "FAILED"   — 처리 결과 상태
 *     resultCn: string              — AI 결과 내용 (마크다운)
 *   }
 */

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireWorkerAuth } from "../../../_lib/auth";

type RouteParams = { params: Promise<{ taskId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  // 워커 인증 — MCP 키(WORKER 용도) 단일 채널
  const auth = await requireWorkerAuth(request);
  if (auth instanceof Response) return auth;

  const { taskId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { status, resultCn } = body as { status?: string; resultCn?: string };

  // status는 DONE 또는 FAILED만 허용
  if (!status || !["DONE", "FAILED"].includes(status)) {
    return apiError("VALIDATION_ERROR", "status는 DONE 또는 FAILED여야 합니다.", 400);
  }

  // 공백만 들어온 결과는 빈 문자열로 간주 — 이후 로직 일관성 확보
  const trimmedResult = resultCn?.trim() ?? "";

  if (status === "DONE" && !trimmedResult) {
    return apiError("VALIDATION_ERROR", "DONE 상태는 resultCn이 필요합니다.", 400);
  }

  try {
    // ── 트랜잭션 안 atomic update + ref 엔티티 결과 전파 ─────────────
    // updateMany 의 where 절에 상태(IN_PROGRESS) + 소유권을 모두 박아 race 차단.
    // count !== 1 이면 트랜잭션 자체에서 일찍 빠져나와 진단 path 로 이동.
    // count === 1 인 경우에만 ref 정보 조회 → applyResultToRef.
    //   같은 트랜잭션이라 task 의 ref_ty_code/ref_id 가 일관됨.
    //   ref 갱신 실패 시 트랜잭션 롤백 → task 상태 전환도 함께 되돌아감 (상태 불일치 차단).
    const txResult = await prisma.$transaction(async (tx) => {
      const updated = await tx.tbAiTask.updateMany({
        where: {
          ai_task_id:      taskId,
          task_sttus_code: "IN_PROGRESS",
          prjct_id:        auth.prjctId,
          req_mber_id:     auth.mberId,
        },
        data: {
          task_sttus_code: status,
          result_cn:       trimmedResult || null,
          compl_dt:        new Date(),
        },
      });

      if (updated.count !== 1) {
        return { ok: false as const };
      }

      // DONE 성공 건에만 ref 엔티티로 결과 전파.
      // FAILED 의 resultCn 은 에러 메시지일 가능성이 높아 사용자 컨텐츠 컬럼 오염 방지.
      if (status === "DONE") {
        const task = await tx.tbAiTask.findUnique({
          where:  { ai_task_id: taskId },
          select: { ref_ty_code: true, ref_id: true },
        });
        if (task) {
          await applyResultToRef(tx, task.ref_ty_code, task.ref_id, trimmedResult);
        }
      }

      return { ok: true as const };
    });

    if (txResult.ok) {
      return apiSuccess({ taskId, status, completedAt: new Date().toISOString() });
    }

    // ── count=0 진단 (느린 path) ────────────────────────────────────
    // 정상 흐름에서는 거의 도달 안 함. 도달 시 사용자 디버깅용 에러 구분.
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

    return apiError(
      "CONFLICT",
      `현재 상태(${task.task_sttus_code})에서는 완료 처리할 수 없습니다. ` +
      `IN_PROGRESS 상태여야 하며, 다른 워커가 이미 완료 처리했을 수 있습니다.`,
      409,
    );
  } catch (err) {
    console.error(`[POST /api/worker/tasks/${taskId}/complete] 오류:`, err);
    return apiError("DB_ERROR", "태스크 완료 처리에 실패했습니다.", 500);
  }
}

/**
 * AI 태스크 결과를 refType 에 해당하는 실제 ref 엔티티의 본문 컬럼으로 전파한다.
 *
 * 현재 지원 대상:
 *   - PLAN_STUDIO_ARTF → tb_ds_plan_studio_artf.artf_cn
 *     기획 스튜디오 아티팩트는 결과물(마크다운·Mermaid 등) 자체가 화면 렌더링 대상이라,
 *     ai_task.result_cn 에만 쌓이면 UI 조회 동선이 어긋난다.
 *     → 아티팩트 본문 컬럼에 즉시 반영하여 완료와 동시에 화면에 노출되게 한다.
 *
 * 지원하지 않는 refType 은 의도적으로 no-op — ai_task.result_cn 만으로 이력 조회 가능.
 * 새 refType 을 전파 대상으로 추가하려면 이 switch 에 case 만 덧붙이면 된다.
 *
 * mdfr_mber_id 는 갱신하지 않는다 — AI 워커는 사용자 세션이 없어 쓸 값이 없음.
 * 수정 이력은 ai_task(creat_mber_id) 로 역추적한다.
 *
 * 대상 엔티티가 존재하지 않으면 Prisma 가 P2025 예외를 던져 트랜잭션이 자동 롤백된다.
 * → ai_task 상태 전환도 함께 되돌아가므로 상태 불일치는 발생하지 않는다.
 *   호출부 catch 는 일반 DB 오류(500) 로 응답한다 (워커 내부 통신이므로 500 수용 가능).
 */
async function applyResultToRef(
  tx:      Prisma.TransactionClient,
  refType: string,
  refId:   string,
  result:  string,
): Promise<void> {
  switch (refType) {
    case "PLAN_STUDIO_ARTF": {
      await tx.tbDsPlanStudioArtf.update({
        where: { artf_id: refId },
        data:  {
          artf_cn:  result,
          mdfcn_dt: new Date(),
        },
      });
      return;
    }
  }
}
