/**
 * exports/doc-meta.ts — 산출물 문서 메타/번호 해석기 (순수 함수)
 *
 * 역할:
 *   - 산출물 종류(카탈로그 docMeta) + 프로젝트 설정(시스템명/코드/템플릿/오버라이드)을 합쳐
 *     표지·머리글에 들어갈 최종 메타(ResolvedDocMeta)를 만든다.
 *   - 모든 산출물 빌더가 같은 규칙으로 돌도록 "기준을 한 곳에" 모은 모듈.
 *
 * 해석 우선순위:
 *   - 단계/활동/작업/문서코드 : 설정 오버라이드(artifact_meta_json[key]) → 카탈로그 docMeta → 빈값
 *   - 시스템명               : 설정 system_nm → 프로젝트명
 *   - 시스템코드({SYS})       : 설정 system_code → 약어(prjct_abrv) → 프로젝트명
 *   - 문서번호               : doc_no_template 에 위 값 치환 (doc-number.ts)
 *
 * 책임 분리:
 *   - 본 모듈 : 값 머지 + 문서번호 계산 (HTTP/DB/docx 무관, 순수)
 *   - 데이터  : DB 에서 settings/project 읽어 이 함수에 넘김
 *   - 빌더    : ResolvedDocMeta 를 표지/머리글에 출력
 */

import type { DocMetaKey, DocMetaFields } from "@/lib/exports/doc-meta-catalog";
import { buildDocNo } from "@/lib/exports/doc-number";

/** 빌더가 표지/머리글에 그대로 출력하는 최종 메타. */
export type ResolvedDocMeta = {
  systemName: string;  // 표지 "시스템명"
  phase:      string;  // 표지 "단계"
  activity:   string;  // 표지 "활동"
  work:       string;  // 표지 "작업"
  docNo:      string;  // 머리글 "문서번호"
};

/**
 * 표지 메타의 [라벨, 값] 행 목록 — 시스템명/단계/활동/작업 (+옵션 문서번호).
 *
 * docx·xlsx 표지가 같은 라벨/순서를 쓰도록 한 곳에서 만든다. 값이 있는 행만 반환.
 *   - docx : 문서번호는 머리글에 두므로 includeDocNo 생략
 *   - xlsx : 머리글이 없어 문서번호도 표지 행으로 (includeDocNo: true)
 */
export function docMetaCoverRows(
  meta: ResolvedDocMeta,
  opts: { includeDocNo?: boolean } = {},
): [string, string][] {
  const rows: [string, string][] = [];
  if (meta.systemName) rows.push(["시스템명", meta.systemName]);
  if (meta.phase)      rows.push(["단계",     meta.phase]);
  if (meta.activity)   rows.push(["활동",     meta.activity]);
  if (meta.work)       rows.push(["작업",     meta.work]);
  if (opts.includeDocNo && meta.docNo) rows.push(["문서번호", meta.docNo]);
  return rows;
}

/** 본 해석기에 넘기는 프로젝트 설정값 (DB 컬럼 → 데이터 모듈이 매핑해 전달). */
export type DocMetaSettings = {
  systemNm:       string | null | undefined;  // system_nm
  systemCode:     string | null | undefined;  // system_code
  docNoTemplate:  string | null | undefined;  // doc_no_template
  /** artifact_meta_json — 산출물 key 별 오버라이드. 파싱 실패/미설정이면 빈 객체 권장. */
  artifactMeta?:  Partial<Record<DocMetaKey, Partial<DocMetaFields>>> | null;
};

/** 프로젝트 식별 정보 (fallback 용). */
export type DocMetaProject = {
  projectName: string;
  projectAbbr: string | null | undefined;
};

/** 첫 번째 비지 않은 trim 문자열 반환 (없으면 ""). */
function firstNonEmpty(...vals: (string | null | undefined)[]): string {
  for (const v of vals) {
    const t = (v ?? "").trim();
    if (t) return t;
  }
  return "";
}

/**
 * 산출물 1건의 최종 문서 메타/번호 해석.
 *
 * @param catalogMeta  카탈로그 docMeta (산출물 종류 기본값) — 없을 수도 있음
 * @param artifactKey  산출물 key (오버라이드 조회용)
 * @param settings     프로젝트 설정값
 * @param project      프로젝트 식별 정보
 * @param year         문서번호 {YYYY} 용 연도 (호출부에서 주입 — 모듈은 Date 직접 안 씀)
 * @param seq          일련번호 (기본 1 — 프로젝트당 단일 산출물은 항상 1)
 */
export function resolveDocMeta(opts: {
  catalogMeta?: DocMetaFields;
  artifactKey:  DocMetaKey;
  settings:     DocMetaSettings;
  project:      DocMetaProject;
  year:         number;
  // 일련번호 — 숫자(기본 1) 또는 이미 포맷된 문자열("007","ㅁㅁㅁ"). 미지정 시 1(→"001").
  seq?:         number | string;
}): ResolvedDocMeta {
  const { catalogMeta, artifactKey, settings, project, year } = opts;
  const seq = opts.seq ?? 1;

  const override = settings.artifactMeta?.[artifactKey] ?? {};

  // 단계/활동/작업/문서코드 — 오버라이드 → 카탈로그 → 빈값
  const phase    = firstNonEmpty(override.phase,    catalogMeta?.phase);
  const activity = firstNonEmpty(override.activity, catalogMeta?.activity);
  const work     = firstNonEmpty(override.work,     catalogMeta?.work);
  const docCode  = firstNonEmpty(override.docCode,  catalogMeta?.docCode);

  // 시스템명 / 시스템코드 — 설정 → 프로젝트 정보 fallback
  const systemName = firstNonEmpty(settings.systemNm, project.projectName);
  const systemCode = firstNonEmpty(settings.systemCode, project.projectAbbr, project.projectName);

  // 문서번호 — 문서코드가 없으면 번호 생성 생략(빈 문자열) → 머리글에 안 찍힘
  const docNo = docCode
    ? buildDocNo(settings.docNoTemplate, { sys: systemCode, doc: docCode, seq, year })
    : "";

  return { systemName, phase, activity, work, docNo };
}
