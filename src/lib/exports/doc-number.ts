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
  sys:   string;          // {SYS}
  doc:   string;          // {DOC}
  // {SEQ} / {SEQ:n} — 숫자(예 1) 또는 이미 만들어진 문자열(예 "007","ㅁㅁㅁ") 둘 다 허용.
  // 문자열이면 {SEQ:n} 의 0패딩은 사실상 그대로 통과(이미 n자리), 숫자면 n자리로 패딩.
  seq:   number | string;
  year:  number;          // {YYYY}
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

/**
 * 표시ID 의 "끝 세 자리" 를 문서번호 일련번호({SEQ}) 문자열로 변환.
 *
 * 규칙 (하나로 단순):
 *   - 숫자로 끝나면 → 끝 3자리 숫자를 3자리로 0패딩
 *       "UW-00007" → "007",  "RQ-00026" → "026",  "UW-7" → "007",  "UW-01234" → "234"
 *   - 문자로 끝나면 → 표시ID 끝 3글자를 그대로
 *       "UW-00ㅁㅁㅁ" → "ㅁㅁㅁ"
 *   - 빈 값이면 "001"
 *
 * 표시ID 는 자동 채번이지만 수동 편집이 가능해서 문자도 들어올 수 있다.
 * 숫자든 문자든 "끝 세 글자" 규칙 하나로 처리해 단순하게 유지한다.
 */
export function displayIdToSeq(displayId: string | null | undefined): string {
  const id = (displayId ?? "").trim();
  // 숫자로 끝나면: 끝 3자리 숫자만 떼어 3자리 0패딩
  const trailing = id.match(/\d+$/);
  if (trailing) return trailing[0].slice(-3).padStart(3, "0");
  // 문자로 끝나면: 끝 3글자 그대로 (없으면 001)
  return id.slice(-3) || "001";
}
