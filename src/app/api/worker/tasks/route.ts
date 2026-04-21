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
 *   limit           — 최대 조회 건수 (기본 10, 최대 50)
 *   taskType        — 태스크 유형 필터 (DESIGN|INSPECT|IMPACT|IMPLEMENT|MOCKUP|CUSTOM)
 *                     쉼표로 복수 지정 가능 (예: taskType=INSPECT,IMPACT,DESIGN)
 *   excludeTaskType — 태스크 유형 "제외" 필터. 쉼표 복수 지원
 *                     예) excludeTaskType=IMPLEMENT → 구현 외 전체 조회
 *                     향후 taskType 종류가 늘어나도 "구현만 빼기" 식 호출이 가능하도록 분리
 *                     taskType(포함)과 동시에 주면 포함 후 제외 순으로 적용
 *   refType         — 참조 유형 필터 (AREA|FUNCTION), 쉼표 복수 지원
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireWorkerAuth } from "../_lib/auth";

type AttachmentDto = {
  fileId:      string;
  fileName:    string;
  extension:   string;
  fileType:    string;
  downloadUrl: string;
};

export async function GET(request: NextRequest) {
  // 워커 인증 확인
  const authError = requireWorkerAuth(request);
  if (authError) return authError;

  const url      = new URL(request.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "10");
  const limit    = Math.min(Math.max(1, isNaN(limitRaw) ? 10 : limitRaw), 50);

  // 쉼표로 구분된 복수 값을 지원 — "INSPECT,IMPACT" 같은 그룹 필터용
  // 공백 제거 후 빈 문자열은 탈락시켜 방어 처리
  const taskTypes        = parseCsvParam(url.searchParams.get("taskType"));
  const excludeTaskTypes = parseCsvParam(url.searchParams.get("excludeTaskType"));
  const refTypes         = parseCsvParam(url.searchParams.get("refType"));

  // 포함/제외 조건을 하나의 task_ty_code 필터로 합친다.
  // Prisma where 에서 같은 키를 스프레드하면 뒤 값이 앞 값을 덮어쓰므로,
  // 두 필터를 따로 스프레드하면 제외 또는 포함 중 하나만 적용되는 버그가 생긴다.
  const taskTypeWhere = buildTaskTypeWhere(taskTypes, excludeTaskTypes);

  // 포함과 제외가 완전히 동일한 경우 → 결과는 반드시 공집합이므로 DB 쿼리 없이 빈 배열 반환
  // (예: taskType=IMPLEMENT & excludeTaskType=IMPLEMENT 같은 호출자 실수 방어)
  if (taskTypeWhere === "EMPTY_RESULT") {
    return apiSuccess({ count: 0, tasks: [] });
  }

  try {
    const tasks = await prisma.tbAiTask.findMany({
      where: {
        task_sttus_code: "PENDING",
        // exec_avlbl_dt가 설정된 경우 해당 시각 이후에만 처리
        OR: [
          { exec_avlbl_dt: null },
          { exec_avlbl_dt: { lte: new Date() } },
        ],
        ...(taskTypeWhere ? { task_ty_code: taskTypeWhere } : {}),
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

    // ── 첨부 이미지 조인 ─────────────────────────────────────────────────────
    // 조회된 태스크 ID 집합으로 tb_cm_attach_file 일괄 조회 (N+1 방지)
    // req_ref_yn='Y'만 내려보낸다 — AI 참조 대상으로 명시된 첨부만 워커에 전달
    // 워커는 downloadUrl(HTTP) 을 통해서만 파일을 수신한다 — 서비스 환경에서
    // 워커가 서버와 같은 머신에 있다는 보장이 없으므로 로컬 경로는 내려보내지 않는다
    const taskIds = tasks.map((t) => t.ai_task_id);
    const attachmentMap = new Map<string, AttachmentDto[]>();

    if (taskIds.length > 0) {
      const attaches = await prisma.tbCmAttachFile.findMany({
        where: {
          ref_tbl_nm: "tb_ai_task",
          ref_id:     { in: taskIds },
          req_ref_yn: "Y",
        },
        orderBy: { creat_dt: "asc" },
        select: {
          ref_id:        true,
          attach_file_id: true,
          orgnl_file_nm: true,
          file_path_nm:  true,
          file_extsn_nm: true,
          file_ty_code:  true,
        },
      });

      for (const a of attaches) {
        const dto: AttachmentDto = {
          fileId:      a.attach_file_id,
          fileName:    a.orgnl_file_nm,
          extension:   a.file_extsn_nm,
          fileType:    a.file_ty_code,
          downloadUrl: `/api/worker/tasks/${a.ref_id}/files/${a.attach_file_id}/download`,
        };
        const list = attachmentMap.get(a.ref_id) ?? [];
        list.push(dto);
        attachmentMap.set(a.ref_id, list);
      }
    }

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
        attachments:      attachmentMap.get(t.ai_task_id) ?? [],
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

/**
 * 포함(taskType) / 제외(excludeTaskType) 필터를 하나의 Prisma where 조건으로 합친다.
 *
 * 반환값 의미:
 *   - null          : 필터 없음 (task_ty_code 조건 스프레드 생략)
 *   - "EMPTY_RESULT": 포함과 제외가 서로 모순 → 쿼리 생략하고 빈 배열 반환할 것
 *   - string        : 단일 값 equality 비교 (taskType 1개만 지정된 경우)
 *   - object        : { in, notIn } 형태의 Prisma 필터
 *
 * 주의: Prisma 는 같은 필드에 `in` 과 `notIn` 을 동시에 지정하면 둘 다 적용해준다 (AND).
 * 따라서 포함과 제외를 한 객체에 담는 것이 의도된 동작.
 */
type TaskTypeWhere =
  | null
  | "EMPTY_RESULT"
  | string
  | { in?: string[]; notIn?: string[] };

function buildTaskTypeWhere(
  includes: string[],
  excludes: string[],
): TaskTypeWhere {
  // 포함과 제외가 동일한 집합 → 결과 공집합
  if (
    includes.length > 0 &&
    excludes.length > 0 &&
    includes.every((t) => excludes.includes(t))
  ) {
    return "EMPTY_RESULT";
  }

  // 포함만 단일 값 + 제외 없음 → equality 쿼리 (인덱스 활용 최적)
  if (includes.length === 1 && excludes.length === 0) {
    return includes[0];
  }

  const filter: { in?: string[]; notIn?: string[] } = {};
  if (includes.length > 0) filter.in    = includes;
  if (excludes.length > 0) filter.notIn = excludes;

  // 포함/제외 둘 다 없으면 null 반환 — 호출부에서 조건 스프레드를 건너뛴다
  return Object.keys(filter).length === 0 ? null : filter;
}
