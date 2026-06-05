/**
 * exports/doc-number.ts — 문서번호 생성기 (순수 함수)
 *
 * 역할:
 *   - 프로젝트 설정의 문서번호 템플릿 + 치환값으로 문서번호 문자열을 만든다.
 *   - 예) 템플릿 "{SYS}_{DOC}_{SEQ:3}" + { sys:"GDBS", doc:"A301", seq:1 } → "GDBS_A301_001"
 *
 * 지원 변수:
 *   - {SYS}      : 시스템코드 (프로젝트 설정 system_code, fallback 약어)
 *   - {DOC}      : 산출물 문서코드 (카탈로그 docMeta.docCode, 예 "A301")
 *   - {SEQ}      : 일련번호 (0패딩 없음)
 *   - {SEQ:n}    : 일련번호 n자리 0패딩 (예 {SEQ:3} → "001")
 *   - {YYYY}     : 4자리 연도
 *
 * 정책:
 *   - 매칭 안 되는 변수/오타는 그대로 둔다 (사용자가 입력 실수해도 빌드는 안 깨지게).
 *   - 빈 치환값은 빈 문자열로 — 단, 호출부에서 sys/doc 가 비지 않도록 fallback 처리 권장.
 */

export const DEFAULT_DOC_NO_TEMPLATE = "{SYS}_{DOC}_{SEQ:3}";

export type DocNumberVars = {
  sys:   string;  // {SYS}
  doc:   string;  // {DOC}
  seq:   number;  // {SEQ} / {SEQ:n}
  year:  number;  // {YYYY}
};

/**
 * 템플릿 문자열의 변수를 치환해 문서번호를 만든다.
 *
 * @param template  문서번호 템플릿 (미지정/빈값이면 DEFAULT_DOC_NO_TEMPLATE)
 * @param vars      치환값
 */
export function buildDocNo(template: string | null | undefined, vars: DocNumberVars): string {
  const tpl = (template ?? "").trim() || DEFAULT_DOC_NO_TEMPLATE;

  return tpl
    // {SEQ:n} — n자리 0패딩 (먼저 처리해야 {SEQ} 와 충돌 안 함)
    .replace(/\{SEQ:(\d+)\}/g, (_m, n: string) => String(vars.seq).padStart(parseInt(n, 10), "0"))
    // {SEQ} — 패딩 없음
    .replace(/\{SEQ\}/g,  String(vars.seq))
    .replace(/\{SYS\}/g,  vars.sys)
    .replace(/\{DOC\}/g,  vars.doc)
    .replace(/\{YYYY\}/g, String(vars.year));
}
