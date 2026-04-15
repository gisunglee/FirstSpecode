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
 *              쉼표로 복수 지정 가능 (예: taskType=INSPECT,IMPACT,DESIGN)
 *              → 클라이언트(슬래시 명령 등)에서 그룹 약어를 풀어 보낼 때 사용
 *   refType  — 참조 유형 필터 (AREA|FUNCTION), 쉼표 복수 지원
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

  // 쉼표로 구분된 복수 값을 지원 — "INSPECT,IMPACT" 같은 그룹 필터용
  // 공백 제거 후 빈 문자열은 탈락시켜 방어 처리
  const taskTypes = parseCsvParam(url.searchParams.get("taskType"));
  const refTypes  = parseCsvParam(url.searchParams.get("refType"));

  try {
    const tasks = await prisma.tbAiTask.findMany({
      where: {
        task_sttus_code: "PENDING",
        // exec_avlbl_dt가 설정된 경우 해당 시각 이후에만 처리
        OR: [
          { exec_avlbl_dt: null },
          { exec_avlbl_dt: { lte: new Date() } },
        ],
        // 단일 값이면 eq, 복수 값이면 in — Prisma 가 자동 최적화해주진 않으므로 명시적으로 분기
        ...(taskTypes.length === 1 ? { task_ty_code: taskTypes[0] } : {}),
        ...(taskTypes.length >  1 ? { task_ty_code: { in: taskTypes } } : {}),
        ...(refTypes.length === 1  ? { ref_ty_code: refTypes[0]   } : {}),
        ...(refTypes.length >  1  ? { ref_ty_code: { in: refTypes } }   : {}),
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

/**
 * 쉼표 구분 쿼리 파라미터를 string[] 로 파싱.
 *   - null/빈 문자열이면 빈 배열 반환 → 호출부에서 "필터 없음" 으로 해석
 *   - 공백 제거, 대문자 변환(대소문자 무관 필터링)
 *   - 중복 제거 (같은 값 여러 번 와도 쿼리 한 번만 추가)
 */
function parseCsvParam(raw: string | null): string[] {
  if (!raw) return [];
  const set = new Set(
    raw.split(",")
       .map((v) => v.trim().toUpperCase())
       .filter((v) => v.length > 0)
  );
  return Array.from(set);
}
