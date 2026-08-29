---
description: 현재 소스와 지정 UW 설계를 비교하고 문제 항목만 SPECODE에 제출합니다.
argument-hint: UW-XXXXX [--deep]
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, mcp__specode__get_design_template
---

# /sync-specode — 현재 소스와 SPECODE 설계 비교

이 명령은 Git diff나 과거 기준선을 사용하지 않는다. 실행할 때마다 지정 UW의 현재 설계 전체와
현재 저장소의 관련 소스를 비교한다. 정상 항목은 로컬에서 확인만 하고, 사람이 검토할 문제와
설계 수정안만 서버에 제출한다. 설계 적용은 SPECODE 웹에서 사람이 한다.

## 1. 인자와 실행 대상 확인

`$ARGUMENTS`에서 `UW-XXXXX`를 찾는다. UW가 없으면 전체 프로젝트를 실행하지 말고
“단위업무별 실행이 범위와 정확도가 가장 좋습니다. 동기화할 UW 번호를 알려주세요.”라고 묻는다.
`--deep`이 없으면 `CHECK`, 있으면 `DEEP_SYNC`다.

다음 명령으로 프로젝트 범위를 먼저 확인한다.

```bash
node .claude/commands/sync_specode.mjs context UW-XXXXX CHECK
```

출력된 **프로젝트명·프로젝트 ID·UW·모드**를 그대로 보여주고 진행 여부를 확인한다. 프로젝트가
하나여도 생략하지 않는다. `DEEP_SYNC`라면 관련 프로그램을 더 넓게 역설계해 시간과 검토량이
커진다는 점도 함께 알린다. 사용자가 승인하기 전에는 실행을 만들지 않는다.

## 2. 실행 생성과 설계 읽기

현재 실행만의 `.claude/tmp/spec-sync-<고유값>` 폴더를 정하고 다음을 실행한다.

```bash
node .claude/commands/sync_specode.mjs start \
  UW-XXXXX CHECK ".claude/tmp/spec-sync-<고유값>"
```

helper는 큰 설계 응답을 대화에 출력하지 않고 다음처럼 나눠 저장한다.

- `manifest.json`: 프로젝트·UW·모드·실행 ID·대상 수
- `discovery.json`: 요구사항·API·DB 참조와 설계 대상 색인
- `targets/*.json`: 화면·영역·기능·UW별 실제 설계 설명

`manifest.json`과 `discovery.json`을 먼저 읽는다. 대상 설명은 `targets/*.json`을 5~10건씩 읽어
한 번 읽은 파일을 불필요하게 다시 읽지 않는다.

## 3. 관련 소스 범위 확정

설계의 URL/API path/테이블명/화면·기능 이름과 ID를 검색하고, 발견한 route/component/service/
repository/query의 import·호출 관계를 따라간다. 같은 업무 폴더의 route 등록·메뉴·인접
entrypoint도 확인한다. test는 보조 근거로만 쓰고 generated/vendor/build/secret은 제외한다.

실행 경로나 UW 소속이 불확실하면 추측하지 말고 사용자에게 관련 경로를 질문한다. 답을 받지
못하면 `NEEDS_INPUT`으로 제출하고 종료한다.

확정한 저장소 상대 경로를 `source-scope.json`에 쓴 뒤 분석 **전에** 고정한다.

```bash
node .claude/commands/sync_specode.mjs hash-scope \
  ".claude/tmp/spec-sync-<고유값>/source-scope.json" \
  ".claude/tmp/spec-sync-<고유값>/source-scope-hashed.json"
```

`source-scope-hashed.json`을 이후 결과의 `analysis.sourceScope`로 그대로 사용한다.

## 4. 분석 규칙

### CHECK — 기본

- 모든 설계 target을 실제로 확인한다.
- 문제가 있는 target만 `MISMATCH | NOT_IMPLEMENTED | UNKNOWN`으로 상세 작성한다.
- 소스에 기능이 더 많다는 이유만으로 구현 실패로 판정하지 않는다.
- 소스에만 있는 사용자 기능, 권한·보안, 핵심 업무 규칙, 데이터 변경, 공개 API,
  중요 검증·트랜잭션·실패 처리만 `IMPORTANT_GAP_CANDIDATE`로 보고한다.
- 일반 구현 세부사항과 보통 수준의 추가 동작은 결과에 넣지 않는다.

### DEEP_SYNC — 별도 정밀 기능

- 관련 소스의 사용자 동작, 권한·업무 규칙, 입출력, 데이터 변경, 외부 계약, 예외를 역설계한다.
- 중요 누락과 일반 누락을 `IMPORTANT_GAP_CANDIDATE | GAP_CANDIDATE`로 보고한다.
- 신규 화면·영역·기능이 필요하면 `STRUCTURE_GAP`으로 남기고 자동 수정안을 만들지 않는다.
- boilerplate/helper/logging/refactoring과 UW 범위 밖 내용은 결과에 넣지 않는다.

테스트 코드만으로 현재 구현을 확정하지 않는다. 과거 실행 결정을 근거로 이번 분석을 생략하지
않는다. 근거 또는 UW 소속이 불확실하면 `UNKNOWN`으로 남긴다.

## 5. 문제 전용 결과 작성

`resultStatus=ANALYZED` 결과는 다음 원칙을 지킨다.

1. `implementation.evaluatedTargets`에는 `discovery.json`의 모든 target을 유형·ID·필드만 넣는다.
2. `implementation.issues`에는 문제 target만 넣는다. `MATCH` 상세 결과는 절대 넣지 않는다.
3. `designCoverage.issues`에는 실제 검토할 누락·구조·불확실 항목만 넣는다.
4. evidence는 초안에서 `path/symbol/startLine/endLine`만 작성한다. snippet과 hash는 helper가 만든다.
5. 확인된 `MISMATCH`와 기존 대상의 누락 후보는 안전할 때 설계 수정안을 함께 만든다. 불일치나
   누락은 명확하지만 올바른 TO-BE를 확정할 수 없으면 판정은 유지하고 `proposal: null`로 둔다.

수정안을 만들기 전에는 대상 refType으로 `get_design_template(projectId, refType)`을 호출한다.
같은 refType은 실행 중 한 번만 조회한다. 표준 양식의 표·섹션 구조를 유지하면서 잘못되거나
부족한 부분을 고친 **전체 TO-BE 설명**을 `proposal.proposedValue`로 만든다. 기존 target에 연결한
설계 누락 후보도 같은 방식으로 수정안을 만들 수 있다. 신규 구조나 안전한 전체 설명을 확정할
수 없는 문제는 proposal을 만들지 않는다. 수정안이 없는 문제도 웹에서 거부·보류할 수 있다.

```json
{
  "resultStatus": "ANALYZED",
  "analysis": {
    "mode": "CHECK",
    "sourceScope": {
      "status": "CONFIRMED",
      "files": [
        {
          "path": "src/...",
          "symbols": ["save"],
          "kind": "PRIMARY",
          "reason": "실행 경로",
          "contentHash": "hash-scope helper가 만든 sha256"
        }
      ],
      "userConfirmed": false,
      "confirmationNote": null
    },
    "implementation": {
      "verdict": "FAIL",
      "summary": "문제만 요약",
      "evaluatedTargets": [
        { "targetType": "FUNCTION", "targetId": "uuid", "targetField": "func_dc" }
      ],
      "issues": [
        {
          "targetType": "FUNCTION",
          "targetId": "uuid",
          "targetField": "func_dc",
          "resultCode": "MISMATCH",
          "designStatement": "현재 설계 내용",
          "sourceFact": "소스에서 확인한 현재 동작",
          "reason": "차이의 이유",
          "evidence": [
            { "path": "src/...", "symbol": "save", "startLine": 10, "endLine": 15 }
          ],
          "confidence": "HIGH",
          "proposal": {
            "targetType": "FUNCTION",
            "targetId": "uuid",
            "targetField": "func_dc",
            "proposedValue": "표준 양식에 맞춘 전체 TO-BE 설명"
          }
        }
      ]
    },
    "designCoverage": { "verdict": "CLEAR", "summary": "중요 누락 없음", "issues": [] }
  }
}
```

구현 verdict는 문제에 `MISMATCH/NOT_IMPLEMENTED`가 있으면 `FAIL`, 그것 없이 `UNKNOWN`만 있으면
`UNKNOWN`, 문제가 없으면 `PASS`다. 커버리지 verdict는 누락·구조 후보가 있으면
`GAP_CANDIDATE`, 그것 없이 `UNKNOWN`만 있으면 `UNKNOWN`, 문제가 없으면 `CLEAR`다.
두 `summary`는 각각 1~2문장, 500자 이내로 작성한다. target별 판정·코드 근거·긴 설명을
나열하지 말고 건수와 핵심 결론만 적는다. 상세 내용은 `issues`에만 둔다.

## 6. 결정적 근거 생성과 제출

초안을 `draft-result.json`에 저장하고 helper로 최종 제출 파일을 만든다.

```bash
node .claude/commands/sync_specode.mjs prepare \
  ".claude/tmp/spec-sync-<고유값>/draft-result.json" \
  ".claude/tmp/spec-sync-<고유값>/final-result.json"
```

helper는 지정 행의 실제 원문을 읽어 snippet·hash·credential 마스킹을 만들고, 분석 시작 때의
모든 소스 hash가 현재와 같은지 검사한다. `분석 중 소스가 변경되었습니다`가 나오면 해당 파일과
영향 target만 다시 읽고 판정한 뒤 source scope hash를 새로 고정한다. 전체 파일을 무조건 다시
읽지 않는다.

검증이 끝나면 큰 JSON을 MCP 인자로 다시 전달하지 말고 파일을 직접 전송한다.

```bash
node .claude/commands/sync_specode.mjs submit \
  "<manifest.json의 syncRunId>" \
  ".claude/tmp/spec-sync-<고유값>/final-result.json"
```

성공 후 실행 ID, 두 verdict, 문제 수와 웹 경로를 알려준다.

`/projects/{projectId}/spec-reconciliations/{runId}`

마지막으로 이 실행의 작업 폴더만 정리한다.

```bash
node .claude/commands/sync_specode.mjs cleanup ".claude/tmp/spec-sync-<고유값>"
```

웹 검토자가 문제 항목별로 적용·거부·보류한다. 명령과 helper는 설계를 직접 수정하지 않는다.
