/**
 * templateVars — 설계 양식(templateCn) 플레이스홀더 치환 (서버·클라이언트 공용)
 *
 * {{displayId}}/{{name}}은 표준 양식(templateCn) 안에 박혀 있는 토큰이다.
 * 원래는 브라우저의 "템플릿 삽입" 버튼(5계층 상세 페이지)을 눌렀을 때만 실제 값으로
 * 바뀌는 클라이언트 전용 로직(@/lib/designTemplate의 applyTemplateVars)이었다.
 * MCP로 description을 작성하는 경로는 이 버튼을 거치지 않아 토큰이 그대로 DB에
 * 저장될 수 있어서, 저장 직전(POST/PUT API route)에도 이 함수를 한 번 더 통과시켜
 * "누가 어떻게 호출하든 항상 실제 값이 들어가도록" 안전망으로 쓴다.
 *
 * 신뢰 경계: 템플릿 본문은 운영자가 관리 UI에서 작성한 마크다운이므로 신뢰 가능.
 * XSS는 렌더 단계(marked + CSS scope)에서 처리하므로 여기선 단순 replaceAll.
 */
export const DESIGN_TEMPLATE_MCP_PLACEHOLDER_GUIDANCE =
  "자동 채번으로 신규 생성할 때는 templateCn의 {{displayId}} 토큰을 description/detailSpec에 " +
  "문자 그대로 유지하세요. SCR, AR, FN, UW, REQ처럼 접두어만 남기거나 번호를 추측하지 마세요. " +
  "저장 API가 채번 후 실제 표시 ID로 치환합니다. 이미 displayId를 조회한 수정 작업에서는 " +
  "{{displayId}} 대신 조회된 실제 displayId를 사용하세요.";

export function applyTemplateVars(
  template: string,
  vars: { displayId?: string | null; name?: string | null },
): string {
  return template
    .replaceAll("{{displayId}}", vars.displayId ?? "")
    .replaceAll("{{name}}",      vars.name      ?? "");
}
