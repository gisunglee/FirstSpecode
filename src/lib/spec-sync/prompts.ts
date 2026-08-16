/**
 * 구현-설계 동기화 V2 프롬프트.
 *
 * 소스 탐색, 설계 중심 CHECK, 소스 중심 DEEP_SYNC를 분리해 한 프롬프트가
 * 서로 반대 방향의 판정을 섞지 않도록 한다.
 */

import type { DesignSnapshot, SyncMode } from "./contracts";

export function buildSourceDiscoveryPrompt(snapshot: DesignSnapshot): string {
  return [
    "지정한 UW와 관련된 현재 저장소 소스 범위를 찾는다.",
    "설계에 있는 URL, API path, 테이블명, 화면·기능 식별자를 실제 파일에서 검색한다.",
    "찾은 route/component/service/repository/query의 import·호출 관계를 확인한다.",
    "같은 업무 폴더의 route 등록, 메뉴, 인접 entrypoint를 확인해 설계에 이름이 없는 중요 기능도 탐색한다.",
    "test/mock/generated/vendor/build/secret은 primary source와 구분하거나 제외한다.",
    "실제 실행 경로를 결정할 수 없거나 UW 경계가 불확실하면 추측하지 말고 질문을 반환한다.",
    "확정 결과에는 저장소 상대 path, symbol, PRIMARY/SUPPORTING/TEST, 선정 이유를 기록한다.",
    "",
    "설계 snapshot:",
    JSON.stringify(snapshot),
  ].join("\n");
}

export function buildSyncAnalysisPrompt(input: {
  mode: SyncMode;
  snapshot: DesignSnapshot;
  sourceScope: unknown;
}): string {
  return input.mode === "CHECK"
    ? buildCheckPrompt(input)
    : buildDeepSyncPrompt(input);
}

function buildCheckPrompt(input: {
  snapshot: DesignSnapshot;
  sourceScope: unknown;
}): string {
  return [
    "현재 UW 설계가 현재 소스에 구현됐는지 CHECK한다.",
    "설계 항목마다 MATCH/MISMATCH/NOT_IMPLEMENTED/UNKNOWN 중 하나로 판정한다.",
    "MATCH와 MISMATCH에는 실제 path/line/snippet 근거를 반드시 첨부한다.",
    "테스트 코드는 보조 근거일 뿐 현재 구현을 확정하는 유일한 근거로 사용하지 않는다.",
    "소스에만 있는 기능을 구현 불일치로 합치지 않는다.",
    "소스에만 있는 동작 중 사용자 기능, 권한·보안, 핵심 업무 규칙, 데이터 변경, 공개 API,",
    "중요 검증·트랜잭션·실패 처리만 IMPORTANT_GAP_CANDIDATE로 별도 보고한다.",
    "일반 구현 세부사항과 보통 수준의 추가 동작을 GAP_CANDIDATE로 보고하지 않는다.",
    "근거 또는 UW 소속이 불확실하면 UNKNOWN으로 남긴다.",
    "구현 정합성과 설계 커버리지 verdict를 독립적으로 계산한다.",
    "구현 정합성 proposal은 소스 사실이 확인된 MISMATCH에만 만든다.",
    "설계 커버리지 proposal은 IMPORTANT_GAP_CANDIDATE에만 만들고 코드 근거를 첨부한다.",
    "beforeValue와 beforeHash를 만들지 않는다.",
    "마크다운 없이 계약에 맞는 JSON 하나만 출력한다.",
    "",
    "설계 snapshot:",
    JSON.stringify(input.snapshot),
    "",
    "확정 소스 범위:",
    JSON.stringify(input.sourceScope),
  ].join("\n");
}

function buildDeepSyncPrompt(input: {
  snapshot: DesignSnapshot;
  sourceScope: unknown;
}): string {
  return [
    "확정된 관련 소스 범위에서 관찰 가능한 업무 동작을 역설계하고 현재 UW 설계와 비교한다.",
    "사용자 동작, 권한·업무 규칙, 입출력, 데이터 변경, 외부 계약, 예외를 먼저 구조화한다.",
    "각 동작이 설계 어디에 표현됐는지 대응시키고 중요 누락과 일반 누락을 모두 후보로 보고한다.",
    "확인 판정에는 실제 path/line/snippet 근거를 붙이고 테스트만으로 구현을 확정하지 않는다.",
    "프레임워크 boilerplate, 내부 helper, 로깅, 단순 refactoring은 IMPLEMENTATION_DETAIL로 분류한다.",
    "신규 화면·영역·기능이 필요하면 기존 설명에 억지로 넣지 말고 STRUCTURE_GAP으로 남긴다.",
    "확인한 소스 범위 밖의 완전성을 주장하지 않는다.",
    "구현 정합성과 설계 커버리지 verdict를 독립적으로 계산한다.",
    "구현 정합성 proposal은 소스 사실이 확인된 MISMATCH에만 만든다.",
    "설계 커버리지 proposal은 IMPORTANT_GAP_CANDIDATE/GAP_CANDIDATE에만 만든다.",
    "beforeValue와 beforeHash를 만들지 않는다.",
    "마크다운 없이 계약에 맞는 JSON 하나만 출력한다.",
    "",
    "설계 snapshot:",
    JSON.stringify(input.snapshot),
    "",
    "확정 소스 범위:",
    JSON.stringify(input.sourceScope),
  ].join("\n");
}
