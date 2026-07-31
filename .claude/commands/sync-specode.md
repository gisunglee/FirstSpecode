---
description: 구현 완료 후 직접 수정된 소스를 SPECODE 스펙 반영함에 제출
argument-hint: "[UW-XXXXX]"
allowed-tools: Bash, Read, Write, Grep, Glob
---

# /sync-specode — 후속 소스 변경을 SPECODE와 동기화

사용법:

```text
/sync-specode
/sync-specode UW-00036
```

인자의 UW ID는 선택이다. 지정하면 그 단위업무 하위 화면·영역·기능을 우선 비교한다.
생략하면 확정된 스펙-소스 연결지도와 프로젝트 설계 인덱스로 영향 대상을 찾는다.

## 1. 분석 입력 준비

프로젝트 루트에서 실행한다.

```bash
node .claude/commands/prepare_specode_sync.mjs $ARGUMENTS
```

실패하면 임의의 base를 만들지 않는다. 특히 `SOURCE_BASELINE_REQUIRED`이면 SPECODE 웹에서
최초 source baseline을 승인하도록 안내하고 종료한다. ancestry 오류는 force-push 또는
branch 분기 문제이므로 자동 무시하지 않는다.

## 2. 변경 없음 처리

`.claude/tmp/specode_sync_input.json`을 읽는다.
`diff.changedFileCount === 0`이면 “마지막 확정점 이후 변경 없음”을 보고하고 종료한다.
receipt를 만들지 않는다.

## 3. 자동 비교 receipt JSON 작성

이 명령에서 변경 전체를 한 번에 AI 분석하지 않는다. Diff 원문과 분석 범위만 제출하면
SPECODE 서버가 연결지도를 우선 적용하고, 필요한 경우 router를 거쳐 화면·영역 단위의
작은 AI 배치로 나눈다. 각 배치 결과는 서버가 검증·병합한다.

`.claude/tmp/specode_sync_input.json`을 읽어
`.claude/tmp/specode_maintenance_receipt.json`을 만든다.

`.claude/tmp/specode_maintenance_receipt.json`에 다음 구조로 저장한다.

```json
{
  "clientSubmissionKey": "sync-{diff.diffHash 전체}",
  "repoKey": "diff.repoKey",
  "repoProvider": "LOCAL",
  "branchName": "diff.branchName",
  "checkpointType": "diff.checkpointType",
  "baseCheckpoint": "diff.baseCheckpoint",
  "headCheckpoint": "diff.headCheckpoint",
  "headStable": true,
  "evidenceTrust": "LOCAL_AGENT_ATTESTED",
  "evidenceVerify": "ATTESTED",
  "ancestryVerified": true,
  "diffHash": "diff.diffHash",
  "evidenceVerifyData": {
    "tool": "source_snapshot.mjs/v2",
    "localRepository": true
  },
  "sourceEvidence": {
    "changedFiles": ["diff.changes의 전체 path"],
    "files": [
      {
        "path": "src/...",
        "status": "MODIFIED",
        "patch": "diff.changes[].patch 원문"
      }
    ],
    "securityFiltered": true
  },
  "manifest": {
    "changedFileCount": 1
  },
  "analysisScope": {
    "unitWorkRef": "인자가 있으면 UW-XXXXX, 없으면 필드 생략",
    "changedPaths": ["diff.changes의 전체 path"],
    "includeProjectIndex": true,
    "autoBatch": true
  },
  "selectedTargets": [],
  "summary": "자동 비교 대기",
  "analysisVersion": "sync-specode/auto-batch-v1",
  "proposals": []
}
```

- `headStable`, `ancestryVerified`는 diff 값을 그대로 사용한다.
- SOURCE_MANIFEST에서는 ancestryVerified를 생략한다.
- `sourceEvidence.files`에는 `diff.changes`를 하나도 버리지 않고 전부 넣는다.
- UW 인자가 있으면 `analysisScope.unitWorkRef`에 넣고 `includeProjectIndex=false`로 둔다.
- UW 인자가 없으면 `unitWorkRef`를 생략하고 `includeProjectIndex=true`로 둔다.
- 이 단계에서 proposal을 직접 만들지 않는다. `proposals=[]`가 자동 배치 요청 신호다.
- Git 작업 트리가 미커밋 상태면 `headStable=false`이며 receipt는 DRAFT가 된다.

## 4. 제출

```bash
node .claude/commands/submit_maintenance_receipt.mjs \
  ".claude/tmp/specode_maintenance_receipt.json"
```

성공 응답의 reviewUrl을 사용자에게 보여준다.

- 응답의 `batchAnalysis.batches`가 최초 AI 작업 목록이다.
- `ANALYZING`: 아래 5단계로 AI 배치를 끝까지 처리한다.
- `NEEDS_REVIEW`: 자동 병합이 끝났으며 웹에서 후보별 결정을 하면 된다.
- `DRAFT`: 미커밋 변경 분석은 저장됐지만 baseline은 전진하지 않는다. 커밋 후 같은
  `/sync-specode`를 다시 실행하면 같은 diffHash receipt가 최종 checkpoint로 갱신된다.
- 제출 실패 시 JSON과 분석 입력을 삭제하지 말고 오류를 그대로 보고한다.

## 5. 이 receipt의 AI 배치 끝까지 처리

제출 응답의 `receiptId`를 기억한다. 다음 Worker API를 반복 조회한다.

```text
GET /api/worker/tasks?limit=100&refType=SPEC_RECONCILIATION_ROUTER,SPEC_RECONCILIATION_BATCH
```

응답 중 `reqSnapshotData.receiptId`가 방금 만든 receiptId인 태스크만 처리한다.

1. 각 태스크를 start 한다.
2. `task.reqCn`을 추가 지침 없이 그대로 수행한다.
3. 결과는 코드 fence 없는 JSON 원문으로 complete 한다.
4. router 완료 직후 분석 배치가 새로 생기므로 같은 조회를 다시 한다.
5. 해당 receipt의 PENDING 태스크가 0건이 될 때까지 반복한다.
6. 최대 100건을 처리했는데도 남으면 중단하고 reviewUrl과 남은 수를 보고한다.

한 배치가 실패해도 다른 배치는 계속한다. 실패 배치는 웹의 `재시도` 버튼으로 다시 큐에
넣는다. 모든 배치가 완료되면 서버가 같은 대상의 동일 제안을 중복 제거하고 receipt 항목으로
병합한다. 다른 제안끼리는 임의 선택하지 않고 `BATCH_CONFLICT`로 사람에게 보여준다.

## 6. 완료 보고

- reviewUrl
- 배치 완료/실패 수
- 병합된 proposal 수와 충돌 수
- 미커밋 DRAFT 여부

proposal이 0건이어도 “스펙 영향 없음”을 자동 확정하지 않는다. 사용자가 웹에서 증거를
확인하고 정합성 확정을 눌러야 source baseline이 전진한다.
