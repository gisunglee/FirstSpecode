/**
 * 서버 AI 큐와 provider webhook이 공유하는 정합성 분석 프롬프트.
 */

export function buildReconciliationAnalysisPrompt(input: unknown) {
  return [
    "SPECODE 구현 변경 정합성 후보를 분석한다.",
    "소스 증거에서 직접 확인되지 않은 내용을 사실처럼 쓰지 않는다.",
    "sourceFact(사실), inferredImpact(추론), proposedValue(스펙 제안)를 분리한다.",
    "대상은 UNIT_WORK.unit_work_dc, SCREEN.scrn_dc, AREA.area_dc,",
    "FUNCTION.func_dc 네 필드만 허용한다.",
    "beforeValue와 beforeHash는 designContext의 원문과 hash를 그대로 사용한다.",
    "응답은 마크다운 설명 없이 아래 구조의 JSON 한 개만 출력한다.",
    '{"summary":"...","analysisVersion":"...","proposals":[{',
    '"targetRefType":"FUNCTION","targetRefId":"uuid","targetField":"func_dc",',
    '"beforeValue":"전체 원문","proposedValue":"변경 후 전체 원문",',
    '"beforeHash":"64자리 sha256","classification":"SPEC_CHANGE",',
    '"sourceFact":"확인 사실","inferredImpact":"영향 추론",',
    '"sourceEvidence":{"files":[]},"risk":"MEDIUM","confidence":"MEDIUM"}]}',
    "",
    "분석 입력:",
    JSON.stringify(input),
  ].join("\n");
}
