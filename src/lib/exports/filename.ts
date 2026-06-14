/**
 * exports/filename.ts — 산출물 다운로드 파일명 유틸
 *
 * 역할:
 *   - .docx / .zip 파일명에 들어갈 동적 텍스트(요구사항명/단위업무명/프로젝트명 등)에서
 *     파일 시스템이 거부하는 문자(\ / : * ? " < > | + 제어문자) 를 안전하게 치환한다.
 *
 * 정책:
 *   - 부적절한 문자는 "_" 로 치환 (제거하지 않고 자리 보존 — 단어 경계 가독성 유지)
 *   - 앞뒤 공백 트림
 *   - 결과가 빈 문자열이면 호출부에서 빈 자리에 무엇을 넣을지 결정 (이 함수는 빈 문자열 그대로 반환)
 *
 * 사용 예:
 *   filenameSafe("프로젝트/A: V1.0")  → "프로젝트_A_ V1.0"
 *   buildDocxFilename("RQ-00001", "사용자 로그인", "요구사항명세서")
 *     → "RQ-00001_사용자 로그인_요구사항명세서.docx"
 */

/**
 * 파일명에 들어갈 한 부분(이름/제목 등)을 안전한 형태로 정제.
 * Windows 가 가장 빡빡하므로 그 기준으로 차단.
 */
export function filenameSafe(s: string | null | undefined): string {
  return (s ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .trim();
}

/**
 * 문서번호에서 끝 일련번호 토막을 떼어 파일명 prefix 로 만든다.
 *   "GBMS_A301_001" → "GBMS_A301"   (시스템코드_문서코드까지)
 *
 * 정책:
 *   - 끝 "_<숫자>" 한 토막만 제거 — 일련번호는 파일명에 불필요(프로젝트당 단일 산출물은 항상 001).
 *   - 문서번호가 비었으면(문서코드 미설정) "" 반환 → 호출부에서 약어/프로젝트명 fallback.
 */
export function docNoFilenamePrefix(docNo: string | null | undefined): string {
  const base = (docNo ?? "").replace(/_\d+$/, "");
  return filenameSafe(base);
}

/**
 * "[<ABBR>_]<문서유형>_<displayId>_<이름>.docx" 형식 파일명 생성.
 *
 * 토큰 순서 정책 (2026-05-30):
 *   문서유형을 앞에 배치한다 — 폴더 정렬 시 "요구사항명세서끼리, 프로그램사양서끼리"
 *   그룹지어 보이도록. ID·이름이 먼저면 도메인별로 명세서/결과서가 섞여 가독성↓.
 *
 *   예) GBMS_요구사항명세서_RQ-00001_사용자 로그인.docx
 *       GBMS_프로그램사양서_UW-00001_프로젝트 생성·관리.docx
 *
 *   - 이름이 비면 마지막 "_<이름>" 토큰 생략
 *   - 약어가 없으면 앞쪽 "<ABBR>_" prefix 생략
 *
 * @param displayId  외부 표시 ID (예: "RQ-00001")
 * @param name       산출물의 도메인 이름 (예: "사용자 로그인")
 * @param docKindKo  한글 문서 종류 (예: "요구사항명세서", "프로그램사양서")
 * @param opts       opts.projectAbbr — 약어 prefix (null/빈문자열이면 생략)
 */
export function buildDocxFilename(
  displayId: string,
  name:      string | null | undefined,
  docKindKo: string,
  opts?:     { projectAbbr?: string | null },
): string {
  const safeName = filenameSafe(name);
  const safeAbbr = filenameSafe(opts?.projectAbbr);
  const corePart = safeName
    ? `${docKindKo}_${displayId}_${safeName}`
    : `${docKindKo}_${displayId}`;
  return safeAbbr
    ? `${safeAbbr}_${corePart}.docx`
    : `${corePart}.docx`;
}
