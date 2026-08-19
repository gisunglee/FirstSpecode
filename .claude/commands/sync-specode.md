---
description: 현재 소스와 지정 UW 설계를 비교하고, 검토 가능한 결과를 SPECODE에 제출합니다.
argument-hint: UW-XXXXX [--deep]
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, mcp__specode__list_projects, mcp__specode__start_spec_sync, mcp__specode__submit_spec_sync_result, mcp__specode__get_design_template
---

# /sync-specode — 현재 소스를 SPECODE 설계와 비교

이 명령은 Git diff나 과거 기준선을 사용하지 않는다. 실행할 때마다 지정한 UW의 현재 설계와
현재 저장소의 관련 소스를 직접 비교한다. 분석 결과만 제출하며 설계 적용은 웹에서 사람이 한다.

## 1. 실행 범위 확인

`$ARGUMENTS`에서 `UW-XXXXX`를 찾는다.

- UW가 없으면 바로 전체 프로젝트를 분석하지 않는다. “단위업무별 실행이 범위와 정확도가 가장
  좋습니다. 동기화할 UW 번호를 알려주세요.”라고 질문한다.
- `--deep`이 없으면 `CHECK`, 있으면 `DEEP_SYNC`다.
- `DEEP_SYNC`는 관련 프로그램을 더 넓게 역설계하므로 시간과 검토량이 커진다고 알리고 확인한다.
- 프로젝트가 하나면 그 ID를 사용한다. 여러 개면 사용자에게 선택받는다.

## 2. 실행 생성과 소스 범위 확정

`start_spec_sync(projectId, unitWorkRef, mode, clientSubmissionKey)`를 호출한다.
`clientSubmissionKey`는 현재 세션에서 재호출해도 같은 값이 되도록 임의의 고유 문자열을 쓴다.

응답의 `sourceDiscoveryPrompt`와 `designSnapshot`을 기준으로 현재 저장소를 검색한다.

1. URL/API path/테이블명/화면·기능 이름과 ID를 검색한다.
2. 발견한 route/component/service/repository/query의 import·호출 관계를 따라간다.
3. 같은 업무 폴더의 route 등록, 메뉴와 인접 entrypoint도 확인한다.
4. 테스트는 근거 보조로만 표시하고 generated/vendor/build/secret은 제외한다.
5. 실제 실행 경로나 UW 소속이 불확실하면 추측하지 말고 사용자에게 관련 경로를 질문한다.

질문에 답을 받지 못하면 `NEEDS_INPUT` 결과를 제출하고 종료한다. 확정했다면 저장소 상대 경로만으로
`sourceScope`를 만든다.

## 3. 모드별 분석

응답의 `analysisPromptTemplate`에서 sourceScope 자리표시자를 방금 확정한 `sourceScope` JSON으로
바꾸고, 그 프롬프트를 분석의 최종 지시로 사용한다. 아래 규칙은 이를 사람이 확인하기 위한 요약이다.

### CHECK — 기본

- 설계 target 각각을 `MATCH | MISMATCH | NOT_IMPLEMENTED | UNKNOWN`으로 판정한다.
- 소스에 기능이 더 많다는 이유로 구현 실패로 판정하지 않는다.
- 소스에만 있는 동작 중 사용자 기능, 권한·보안, 핵심 업무 규칙, 데이터 변경, 공개 API,
  중요 검증·트랜잭션·실패 처리만 `IMPORTANT_GAP_CANDIDATE`로 별도 보고한다.
- 일반 구현 세부와 보통 수준의 추가 동작은 결과에 넣지 않는다.

### DEEP_SYNC — 별도 검증 기능

- 관련 소스의 사용자 동작, 권한·업무 규칙, 입출력, 데이터 변경, 외부 계약, 예외를 역설계한다.
- 중요 누락과 일반 누락을 모두 보고한다.
- 신규 화면·영역·기능이 필요하면 `STRUCTURE_GAP`으로 남기고 자동 proposal을 만들지 않는다.
- 프레임워크 boilerplate/helper/logging/refactoring은 `IMPLEMENTATION_DETAIL`이다.

두 모드 모두 구현 정합성과 설계 커버리지를 독립 판정한다. 구현이 PASS여도 중요한 설계 누락
후보가 함께 있을 수 있다. 과거 실행 결정을 근거로 이번 분석을 생략하거나 결과를 숨기지 않는다.
테스트 코드만으로 현재 구현을 확정하지 않는다. 구현 수정안은 `MISMATCH`, 커버리지 수정안은
누락 후보에만 만들며 `NOT_IMPLEMENTED`, `UNKNOWN`, 정보성 항목에는 만들지 않는다.

## 4. 결과 계약

`resultStatus=ANALYZED`일 때 아래 구조를 정확히 만든다. 모든 설계 target은 implementation.items에
정확히 한 번 들어가야 한다. `proposal`에는 TO-BE만 넣고 AS-IS/hash는 만들지 않는다.

`proposal` 텍스트를 작성하기 전에는 대상 `targetType`(REQUIREMENT/UNIT_WORK/SCREEN/AREA/
FUNCTION)에 해당하는 refType으로 `get_design_template(projectId, refType)`을 호출해서
표준 양식(`templateCn`/`exampleCn`)을 확인하고, 그 표·섹션 구조를 그대로 따라 작성한다 —
자유 서식으로 제안하지 않는다. 웹에서 사람이 그대로 승인하면 설계 description에 반영되므로,
새로 등록하는 것과 동일한 기준을 적용한다. 이번 실행에서 같은 refType은 한 번만 조회해서
재사용하고, `targetField`가 이미 표준 양식을 따르는 기존 값이면(부분 수정) 그 구조를 깨지
않는 선에서 해당 부분만 고친 전체 텍스트를 proposal로 만든다.

```json
{
  "resultStatus": "ANALYZED",
  "analysis": {
    "mode": "CHECK",
    "sourceScope": {
      "status": "CONFIRMED",
      "files": [
        { "path": "src/...", "symbols": ["POST"], "kind": "PRIMARY", "reason": "..." }
      ],
      "userConfirmed": false,
      "confirmationNote": null
    },
    "implementation": {
      "verdict": "PASS",
      "summary": "...",
      "items": [
        {
          "targetType": "FUNCTION",
          "targetId": "uuid",
          "targetField": "func_dc",
          "resultCode": "MATCH",
          "designStatement": "...",
          "sourceFact": "...",
          "reason": "...",
          "evidence": [
            {
              "path": "src/...",
              "symbol": "POST",
              "startLine": 10,
              "endLine": 15,
              "snippet": "줄 범위의 원문 그대로",
              "snippetHash": "sha256 lowercase hex",
              "redacted": false
            }
          ],
          "confidence": "HIGH",
          "proposal": null
        }
      ]
    },
    "designCoverage": {
      "verdict": "CLEAR",
      "summary": "...",
      "items": []
    }
  }
}
```

구현 verdict는 MISMATCH/NOT_IMPLEMENTED가 하나라도 있으면 `FAIL`, 그것 없이 UNKNOWN이 있으면
`UNKNOWN`, 나머지는 `PASS`다. 커버리지 verdict는 중요/일반/구조 누락이 있으면
`GAP_CANDIDATE`, 그것 없이 UNKNOWN이 있으면 `UNKNOWN`, 나머지는 `CLEAR`다.

evidence snippet은 지정 줄의 실제 원문과 정확히 같아야 한다. 인식 가능한 credential이 포함되면
검증기의 결정적 마스킹 값으로 바꾸고 `redacted=true`로 제출한다. 다른 근거로 대체할 수 있으면
비밀값이 없는 줄을 우선하고, 검증할 수 없으면 UNKNOWN으로 둔다.
사용자가 소스 범위를 확인했다면 `userConfirmed=true`와 함께 확인 내용을 `confirmationNote`에 남긴다.

## 5. 로컬 검증 후 제출

결과 JSON을 OS 임시 파일에 저장하고 다음 검증기를 실행한다.

```bash
node .claude/commands/validate_specode_sync.mjs --repo . --input "<임시 JSON 경로>"
```

검증 실패를 고친 뒤 `submit_spec_sync_result(projectId, runId, result)`를 호출한다. 임시 파일은
성공·실패와 무관하게 삭제한다. 서버는 target 소속, 결과 모순, evidence, proposal을 다시 검증한다.

마지막에 실행 ID, 두 verdict, 검토 대기 수와 다음 웹 경로를 알려준다.

`/projects/{projectId}/spec-reconciliations/{runId}`

웹 검토자가 항목별로 적용·거부·보류한다. 이 명령과 MCP에서는 설계를 직접 적용하지 않는다.
