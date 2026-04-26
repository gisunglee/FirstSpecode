/**
 * GET /api/worker/tasks — AI 워커용 PENDING 태스크 목록 조회
 *
 * 역할:
 *   - 외부 AI 워커(Python 스크립트 / Claude Code 커맨드)가 처리할 태스크를 가져옴
 *   - PENDING 상태인 태스크를 요청일시(req_dt) 오름차순(FIFO)으로 반환
 *   - 화면 CRUD API(/api/projects/...)와 완전히 분리된 워커 전용 엔드포인트
 *
 * 인증:
 *   - X-Mcp-Key 헤더(WORKER 용도 키)만 허용. 자동으로 본인 요청 + 자기 프로젝트 PENDING 만 반환.
 *   - 자세한 가드는 src/app/api/worker/_lib/auth.ts 참조
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
 *   statusOnly      — "true" 이면 태스크 본문은 가져오지 않고 큐 카운트만 반환 (자가 점검용)
 *                     /run-ai-tasks STATUS 명령에서 사용 — 인증 정보 + 큐 통계만 필요
 *
 * 응답:
 *   { count, tasks, meta: { mberName, email, prjctName, prjctId, keyName, lastUsedAt, pending? } }
 *   meta 는 워커 클라이언트가 "지금 누구 키로 동작 중인지" 즉시 인지하도록 노출.
 *   meta.pending 은 statusOnly=true 일 때 큐 카운트(전체/타입별) 표시.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireWorkerAuth, type WorkerAuth } from "../_lib/auth";

type AttachmentDto = {
  fileId:      string;
  fileName:    string;
  extension:   string;
  fileType:    string;
  downloadUrl: string;
};

export async function GET(request: NextRequest) {
  // ── 워커 인증 — MCP 키(WORKER 용도) 단일 채널 ─────────────────
  const auth = await requireWorkerAuth(request);
  if (auth instanceof Response) return auth;

  const url      = new URL(request.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "10");
  const limit    = Math.min(Math.max(1, isNaN(limitRaw) ? 10 : limitRaw), 50);

  // [2026-04-26] 자가 점검 모드 — 태스크 본문 안 가져오고 카운트만
  // /run-ai-tasks STATUS 명령에서 사용. 사용자가 키 노출 의심 시 빠른 진단 가능.
  const statusOnly = url.searchParams.get("statusOnly") === "true";

  // 쉼표로 구분된 복수 값을 지원 — "INSPECT,IMPACT" 같은 그룹 필터용
  // 공백 제거 후 빈 문자열은 탈락시켜 방어 처리
  const taskTypes        = parseCsvParam(url.searchParams.get("taskType"));
  const excludeTaskTypes = parseCsvParam(url.searchParams.get("excludeTaskType"));
  const refTypes         = parseCsvParam(url.searchParams.get("refType"));

  // 포함/제외 조건을 하나의 task_ty_code 필터로 합친다.
  // Prisma where 에서 같은 키를 스프레드하면 뒤 값이 앞 값을 덮어쓰므로,
  // 두 필터를 따로 스프레드하면 제외 또는 포함 중 하나만 적용되는 버그가 생긴다.
  const taskTypeWhere = buildTaskTypeWhere(taskTypes, excludeTaskTypes);

  // ── 본인 요청 + 자기 프로젝트 자동 필터 ────────────────────────
  // 사칭 차단의 핵심 — 워커가 mberId/prjctId 를 명시적으로 보낼 필요 없이
  // 서버가 키에서 자동으로 결정하므로 헤더 위조로 다른 사용자 큐를 빼올 수 없음.
  const ownerFilter = { req_mber_id: auth.mberId, prjct_id: auth.prjctId };

  // 포함과 제외가 완전히 동일한 경우 → 결과는 반드시 공집합이므로 DB 쿼리 없이 빈 배열 반환
  // (예: taskType=IMPLEMENT & excludeTaskType=IMPLEMENT 같은 호출자 실수 방어)
  if (taskTypeWhere === "EMPTY_RESULT") {
    return apiSuccess({ count: 0, tasks: [], meta: buildAuthMeta(auth) });
  }

  // ── statusOnly 모드 — 본문 없이 카운트만 ────────────────────────
  // 자가 점검(/run-ai-tasks STATUS) 전용. DB 부하 최소화.
  // taskType/refType 필터도 동일하게 적용 — 본 조회와 일관된 카운트 보장
  // (예: ?statusOnly=true&taskType=IMPLEMENT → IMPLEMENT 만 카운트)
  if (statusOnly) {
    const baseWhere = {
      task_sttus_code: "PENDING",
      OR: [{ exec_avlbl_dt: null }, { exec_avlbl_dt: { lte: new Date() } }],
      ...(taskTypeWhere ? { task_ty_code: taskTypeWhere } : {}),
      ...(refTypes.length === 1  ? { ref_ty_code: refTypes[0]   } : {}),
      ...(refTypes.length >  1  ? { ref_ty_code: { in: refTypes } } : {}),
      ...ownerFilter,
    };
    // 타입별 카운트 — 사용자에게 "지금 SPEC 몇 건, IMP 몇 건" 같이 표시
    const groupByType = await prisma.tbAiTask.groupBy({
      by:    ["task_ty_code"],
      where: baseWhere,
      _count: { _all: true },
    });
    const pendingByType: Record<string, number> = {};
    let pendingTotal = 0;
    for (const g of groupByType) {
      pendingByType[g.task_ty_code] = g._count._all;
      pendingTotal += g._count._all;
    }
    return apiSuccess({
      count: 0,
      tasks: [],
      meta: { ...buildAuthMeta(auth), pending: { total: pendingTotal, byType: pendingByType } },
    });
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
        // 본인 요청 + 자기 프로젝트로 자동 한정 (사칭 차단)
        ...ownerFilter,
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
      // 워커 클라이언트가 "지금 누구 키로, 어느 프로젝트에서" 동작 중인지
      // 즉시 인지하도록 노출 — 잘못된 키 박았을 때 빠른 발견의 핵심
      meta: buildAuthMeta(auth),
    });
  } catch (err) {
    console.error("[GET /api/worker/tasks] DB 오류:", err);
    return apiError("DB_ERROR", "태스크 조회에 실패했습니다.", 500);
  }
}

/**
 * 응답의 meta 블록 생성 — 워커가 출력할 신원 정보.
 *
 * 사용자가 워커 첫 호출 직후 "어떤 키로, 누구로, 어떤 프로젝트에서" 동작 중인지
 * 한눈에 확인하도록 풍부한 정보를 내려보낸다.
 * → 잘못된 키를 박았을 때 즉시 인지 가능 (사용자 실수 차단의 핵심).
 */
function buildAuthMeta(auth: WorkerAuth) {
  return {
    mberName:   auth.mberNm ?? auth.email ?? "(이름 없음)",
    email:      auth.email,
    prjctName:  auth.prjctNm ?? "(프로젝트명 미상)",
    prjctId:    auth.prjctId,
    keyName:    auth.keyName,
    lastUsedAt: auth.lastUsedAt?.toISOString() ?? null,
  };
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
