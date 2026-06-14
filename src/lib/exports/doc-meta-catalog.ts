/**
 * exports/doc-meta-catalog.ts — 문서 종류별 메타(단계/활동/작업/문서코드) 단일 카탈로그
 *
 * 역할:
 *   - Word 산출물 표지·문서번호에 쓰이는 "산출물 종류별 기본값"을 한 곳에 모은다.
 *   - 정보화 방법론(분석·설계 …)상 산출물 종류에 거의 고정되는 값.
 *   - 프로젝트 설정(artifact_meta_json)에서 산출물별로 오버라이드 가능 (없으면 이 기본값).
 *
 * 적용처:
 *   - doc-meta.ts(resolveDocMeta) : key 로 기본값 조회
 *   - 각 산출물 data 모듈          : findDocMeta(key) 로 기본값 주입
 *   - 프로젝트 설정 "산출물별 문서 메타" 표 : 이 목록을 그대로 행으로 렌더
 *   - artifact-meta API            : 유효 key 검증
 *
 * 비고:
 *   - 문서실 카드 목록(project-artifacts.ts) 과는 별개다. 카드가 없는 per-entity 산출물
 *     (요구사항 명세서·프로그램 사양서)도 여기엔 포함된다.
 *   - 요구사항 추적표(TRACE_MATRIX)는 아직 생성 빌더가 없어 제외 — 추가 시 여기에 등록.
 *   - 단위/통합 테스트는 "명세서·결과서" 두 시점 산출물이 같은 문서코드를 공유한다
 *     (테스트 종류 단위로 한 코드). 그래서 key 는 테스트 종류별 1개씩만 둔다.
 */

/** 메타/번호를 갖는 산출물 종류 key. (artifact_meta_json 의 key 와 동일) */
export type DocMetaKey =
  | "REQUIREMENTS_DEF"   // 요구사항 정의서 (프로젝트 전체)
  | "REQUIREMENT"        // 요구사항 명세서 (요구사항 1건)
  | "TASK_MATRIX"        // 과업대비표
  | "UNIT_WORK"          // 프로그램 사양서 (단위업무 1건)
  | "UNIT_TEST"          // 단위테스트 명세서·결과서 (테스트 명세서 1건, 종류=UNIT)
  | "INTEGRATION_TEST";  // 통합테스트 명세서·결과서 (테스트 명세서 1건, 종류=INTEGRATION)

/** 오버라이드/기본값에 공통으로 쓰는 메타 필드. */
export type DocMetaFields = {
  phase:    string;  // 단계 (예: "분석")
  activity: string;  // 활동 (예: "요구사항정의")
  work:     string;  // 작업 (예: "요건정의서 작성")
  docCode:  string;  // 문서번호 {DOC} 치환값 (예: "A302")
};

/** 카탈로그 한 항목 — key + 표시명 + 메타 기본값. */
export type DocTypeMeta = DocMetaFields & {
  key:   DocMetaKey;
  label: string;     // 설정 화면 등에 표시할 이름
};

/**
 * 문서 종류별 메타 기본값. 표시 순서대로.
 *   - 문서코드는 발주처(고객사)마다 다른 체계라, 여기 값은 "기본 시작점"일 뿐
 *     프로젝트 설정에서 덮어쓰도록 설계됨.
 */
export const DOC_META_CATALOG: DocTypeMeta[] = [
  { key: "REQUIREMENTS_DEF", label: "요구사항 정의서", phase: "분석", activity: "요구사항정의",   work: "요구사항정의",     docCode: "A101" },
  { key: "REQUIREMENT",      label: "요구사항 명세서", phase: "분석", activity: "업무 분석",       work: "요건정의서 작성",   docCode: "A302" },
  { key: "TASK_MATRIX",      label: "과업대비표",     phase: "분석", activity: "요구사항정의",   work: "요구사항추적",     docCode: "A301" },
  { key: "UNIT_WORK",        label: "프로그램 사양서", phase: "설계", activity: "어플리케이션 설계", work: "프로그램사양서 작성", docCode: "D406" },
  { key: "UNIT_TEST",        label: "단위테스트",     phase: "시험", activity: "단위시험",       work: "단위테스트 수행",   docCode: "I501" },
  { key: "INTEGRATION_TEST", label: "통합테스트",     phase: "시험", activity: "통합시험",       work: "통합테스트 수행",   docCode: "T601" },
];

/** key 로 카탈로그 항목 조회 (없으면 undefined). */
export function findDocMeta(key: DocMetaKey): DocTypeMeta | undefined {
  return DOC_META_CATALOG.find((d) => d.key === key);
}
