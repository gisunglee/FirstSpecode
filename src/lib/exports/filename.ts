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
 * "<displayId>_<이름>_<문서유형>.docx" 형식 파일명 생성.
 * 이름이 비어있으면 "_<이름>_" 부분을 생략해 "<displayId>_<문서유형>.docx" 로 fallback.
 *
 * @param displayId  외부 표시 ID (예: "RQ-00001")
 * @param name       산출물의 도메인 이름 (예: "사용자 로그인")
 * @param docKindKo  한글 문서 종류 (예: "요구사항명세서", "프로그램사양서")
 * @param opts       opts.projectAbbr — 지정 시 파일명 앞에 "<ABBR>_" prefix 가 붙는다
 *                     예) projectAbbr="GBMS" → "GBMS_RQ-00001_사용자로그인_요구사항명세서.docx"
 *                   null/빈문자열이면 prefix 생략 — 약어 미설정 프로젝트 호환.
 */
export function buildDocxFilename(
  displayId: string,
  name:      string | null | undefined,
  docKindKo: string,
  opts?:     { projectAbbr?: string | null },
): string {
  const safeName   = filenameSafe(name);
  const safeAbbr   = filenameSafe(opts?.projectAbbr);
  const corePart   = safeName
    ? `${displayId}_${safeName}_${docKindKo}`
    : `${displayId}_${docKindKo}`;
  return safeAbbr
    ? `${safeAbbr}_${corePart}.docx`
    : `${corePart}.docx`;
}
