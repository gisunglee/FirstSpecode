/**
 * scopeStatus — 설계 5계층 "사업 범위 구분" 공용 상수·판정 헬퍼
 *
 * 역할:
 *   - scope_sttus_code 의 허용값·한글 라벨을 한 곳에서 관리
 *   - API 입력값 검증 (허용값 외 문자열이 DB 로 들어가는 것을 차단)
 *   - 산출물 출력 범위(ALL | SCOPED) 에 따른 필터 판정
 *
 * 배경:
 *   고도화(2차 이상) 사업에서는 한 프로젝트 안에 "이번 사업으로 만든 것"과
 *   "이전 사업 결과물"이 섞여 산다. 발주처 제출 산출물은 보통 현행 포함
 *   전체를 요구하지만, 그때도 항목마다 어느 쪽인지 표기돼 있어야
 *   "이걸 이번에 다 했다는 거냐"는 오해가 생기지 않는다.
 *
 * 관련:
 *   - tb_ds_db_table.tbl_sttus_code — DB 테이블에 대해 먼저 쓰던 같은 개념
 *   - lib/mdfcnSource.ts — "누가/어느 경로로 고쳤나"(WEB|MCP|SYNC). 축이 다르므로 혼동 금지
 */

/**
 * 사업 범위 구분 — DB(scope_sttus_code varchar(10)) 에 저장되는 값.
 *
 *   NEW        — 이번 사업에서 신규 등록
 *   MODIFIED   — 이전 사업에 있었고 이번 사업에서 수정
 *   EXISTING   — 이전 사업 그대로. 상위 맥락 제공용으로만 등록됨
 *   DEPRECATED — 이번 사업에서 걷어냄
 *
 * 자동 판정하지 않는다 — mdfcn_dt 로는 "오타 수정"과 "사업 범위상 수정"이
 * 구분되지 않기 때문에, 전부 사람(또는 AS-IS 온보딩 경로)이 지정한다.
 */
export const SCOPE_STTUS = {
  NEW:        "NEW",
  MODIFIED:   "MODIFIED",
  EXISTING:   "EXISTING",
  DEPRECATED: "DEPRECATED",
} as const;

export type ScopeSttusCode = (typeof SCOPE_STTUS)[keyof typeof SCOPE_STTUS];

/** 신규 등록 시 기본값 — DB DEFAULT 와 반드시 같아야 한다. */
export const SCOPE_STTUS_DEFAULT: ScopeSttusCode = SCOPE_STTUS.NEW;

/** 화면·엑셀 산출물에 그대로 찍히는 한글 라벨 */
export const SCOPE_STTUS_LABELS: Record<ScopeSttusCode, string> = {
  NEW:        "신규",
  MODIFIED:   "수정",
  EXISTING:   "기존",
  DEPRECATED: "폐기",
};

const ALL_SCOPE_STTUS: readonly string[] = Object.values(SCOPE_STTUS);

/**
 * isScopeSttusCode — 허용값 여부 (타입 가드)
 */
export function isScopeSttusCode(value: unknown): value is ScopeSttusCode {
  return typeof value === "string" && ALL_SCOPE_STTUS.includes(value);
}

/**
 * parseScopeSttus — API 입력값을 안전하게 변환
 *
 * 미지정(undefined/null) 이면 undefined 를 돌려준다. 호출부는 이 경우
 * 필드를 아예 넘기지 않아 DB DEFAULT('NEW') 가 적용되게 해야 한다.
 * 허용값이 아닌 문자열이 오면 null — 호출부에서 400 으로 막는다.
 *
 *   const parsed = parseScopeSttus(body.scopeStatus);
 *   if (parsed === null) return apiError("VALIDATION_ERROR", "...", 400);
 *   ...(parsed ? { scope_sttus_code: parsed } : {})
 */
export function parseScopeSttus(value: unknown): ScopeSttusCode | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return isScopeSttusCode(value) ? value : null;
}

/** 검증 실패 시 사용자에게 보여줄 메시지 (모든 호출부 동일 문구) */
export const SCOPE_STTUS_ERROR_MSG =
  `사업 범위 구분은 ${ALL_SCOPE_STTUS.join(" / ")} 중 하나여야 합니다.`;

// ── 산출물 출력 범위 ────────────────────────────────────────────────────────

/**
 * 산출물 출력 범위 — tb_pj_project_settings.artifact_scope_code
 *
 *   ALL    — 전체 출력 (기본). 이전 사업분까지 포함하고 항목마다 구분을 표기
 *   SCOPED — 이번 사업분 + 그 상위 계층만
 */
export const ARTIFACT_SCOPE = {
  ALL:    "ALL",
  SCOPED: "SCOPED",
} as const;

export type ArtifactScopeCode = (typeof ARTIFACT_SCOPE)[keyof typeof ARTIFACT_SCOPE];

export const ARTIFACT_SCOPE_DEFAULT: ArtifactScopeCode = ARTIFACT_SCOPE.ALL;

export function isArtifactScopeCode(value: unknown): value is ArtifactScopeCode {
  return value === ARTIFACT_SCOPE.ALL || value === ARTIFACT_SCOPE.SCOPED;
}

/**
 * 이번 사업분으로 간주되는 값들.
 *
 * DEPRECATED 가 포함되는 이유: 이번 사업에서 "걷어낸 것"도 이번 사업의
 * 작업 결과다. 산출물에서 빠지면 폐기 사실 자체가 기록되지 않는다.
 */
export const IN_SCOPE_CODES: readonly ScopeSttusCode[] = [
  SCOPE_STTUS.NEW,
  SCOPE_STTUS.MODIFIED,
  SCOPE_STTUS.DEPRECATED,
];

/**
 * isInBusinessScope — 이 항목 자체가 이번 사업분인가
 *
 * 계층형 산출물(단위업무 설계서 등)에서는 이것만으로 판단하면 안 된다.
 * 이번 사업분 기능을 담고 있는 EXISTING 화면은 맥락으로 남아야 하므로,
 * 자식부터 올라오며 걸러내는 pruneToScope 를 써야 한다.
 */
export function isInBusinessScope(code: string | null | undefined): boolean {
  return IN_SCOPE_CODES.includes(code as ScopeSttusCode);
}

/**
 * scopeWhere — 평면 목록 조회용 Prisma where 조각
 *
 * 기능 목록·화면 목록처럼 계층을 펼치지 않는 산출물에 쓴다.
 * ALL 이면 빈 객체를 돌려주므로 스프레드해도 조건이 붙지 않는다.
 *
 *   where: { prjct_id: projectId, ...scopeWhere(scope) }
 */
export function scopeWhere(scope: ArtifactScopeCode) {
  if (scope === ARTIFACT_SCOPE.ALL) return {};
  return { scope_sttus_code: { in: [...IN_SCOPE_CODES] } };
}

/**
 * effortScopeWhere — 공수·진척·지연 집계용 Prisma where 조각
 *
 * 이전 사업분(EXISTING)은 이번 사업의 작업량이 아니다. 집계에 섞이면 견적과
 * 진척률이 통째로 부풀어 오른다 — 산출물에서 빼는 것보다 더 조용히 틀리는
 * 종류의 오류라서, 출력 범위 설정(ALL/SCOPED)과 무관하게 항상 제외한다.
 *
 * DEPRECATED 는 제외하지 않는다. 걷어내는 작업에도 공수가 들고, 그 값은 사람이
 * 직접 입력한 숫자다 — 시스템이 임의로 0 취급할 근거가 없다.
 */
export function effortScopeWhere() {
  return { scope_sttus_code: { in: [...IN_SCOPE_CODES] } };
}

/**
 * keepInScope — 계층형 산출물에서 이 노드를 남길지 판정
 *
 * 자기 자신이 이번 사업분이거나, 걸러내고도 살아남은 자식이 하나라도 있으면
 * 남긴다. 그래야 "EXISTING 화면 밑의 신규 기능"이 문서에서 부모를 잃고
 * 떠다니지 않는다.
 *
 * 화면 > 영역 > 기능은 서로 타입이 다르므로 트리 전체를 한 번에 훑는
 * 범용 함수를 두지 않았다. 호출부에서 말단(기능)부터 올라오며 쓴다.
 *
 *   const keptFunctions = functions.filter((f) => isInBusinessScope(f.scopeStatus));
 *   const keptAreas = areas
 *     .map((a) => ({ ...a, functions: pickFns(a) }))
 *     .filter((a) => keepInScope(a.scopeStatus, a.functions.length));
 */
export function keepInScope(
  code: string | null | undefined,
  keptChildCount: number,
): boolean {
  return isInBusinessScope(code) || keptChildCount > 0;
}
