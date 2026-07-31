# /run-ai-tasks — SPECODE AI 태스크 처리

SPECODE 서버의 PENDING AI 태스크를 가져와 Claude 가 직접 처리하고 결과를 서버에 저장한다.

## 인자 — 4종류

| 인자              | 의미                                | 서버 쿼리                         |
| ----------------- | ----------------------------------- | --------------------------------- |
| `SPEC`            | **개발(IMPLEMENT) 제외** 전체 유형  | `excludeTaskType=IMPLEMENT`       |
| `IMP`             | **개발(IMPLEMENT) 만**               | `taskType=IMPLEMENT`              |
| `TASK <taskId>`   | **특정 태스크 1건만** 지정 — FIFO 순서 무시 | `taskId={taskId}`         |
| `STATUS`          | **점검만** — 본문 미조회, 큐 카운트·키 정보만 출력 후 종료 | `statusOnly=true` |

- 대소문자 무관 (단, `TASK` 뒤의 taskId 값 자체는 원문 그대로 사용 — UUID 대소문자 보존)
- `SPEC`/`IMP`/`STATUS` 는 인자 1개, `TASK`는 인자 2개(`TASK` + taskId). 그 외 개수·다른 값이면 **사용법 안내만 출력하고 종료**(서버 호출 금지)
- `SPEC` 는 taskType 을 나열하지 않고 "구현만 제외" 방식이라, 향후 taskType 이 추가돼도 자동으로 포함된다
- 🛡 **IMPLEMENT 안전 가드**: 구현 태스크는 인자가 정확히 `IMP` 또는 `TASK <구현 태스크 id>` 일 때만 조회된다
- 🔍 **STATUS 모드**: 키가 의도대로 동작 중인지, 본인 큐가 몇 건 있는지 빠르게 확인. 태스크 처리 안 함.
- 🎯 **TASK 모드**: AI 태스크 상세 팝업 상단에 표시되는 태스크 ID(UUID)를 그대로 지정. 순서가 중요한 구현 태스크를 급하게 하나만 먼저 돌리고 싶을 때, 또는 요청 순서를 잘못 넣었을 때 사용. 지정한 태스크가 본인 소유가 아니거나 PENDING 이 아니면(이미 처리됨 등) 빈 결과로 조용히 종료된다.

---

## 실행 절차

### 0단계: 인자 검증

`$ARGUMENTS` 를 공백으로 토큰 분리.

- 토큰 1개 + 값(대문자 변환)이 `SPEC` / `IMP` / `STATUS` 중 하나 → 해당 모드로 진행
- 토큰 2개 + 첫 토큰(대문자 변환)이 `TASK` + 두 번째 토큰이 비어있지 않음 → **TASK 모드**, 두 번째 토큰을 `taskId` 로 사용 (원문 그대로, 대소문자 변환 금지 — UUID)
- 그 외(0개·3개 이상·다른 값) → 아래 **사용법 안내**만 출력하고 종료(서버 호출 금지)

```
⚠️ 사용법: /run-ai-tasks <SPEC|IMP|STATUS|TASK taskId>

  SPEC        개발(IMPLEMENT) 제외한 모든 AI 태스크 처리
  IMP         개발(IMPLEMENT) 태스크만 처리
  TASK <id>   특정 태스크 1건만 지정 실행 (순서 무시, 본인 소유만)
  STATUS      점검만 — 키 정보 + 큐 카운트만 표시 후 종료 (태스크 처리 안 함)

예시:
  /run-ai-tasks SPEC
  /run-ai-tasks IMP
  /run-ai-tasks TASK 6bbb9baf-2318-4a58-ade8-803cfd5476ef
  /run-ai-tasks STATUS
```

### 1단계: 환경변수 로드

`.env.local` 을 Read 로 읽어 값 파악.
- `SPECODE_URL` — 기본값 `http://localhost:3000` (파일에 없으면 기본값 사용)
- `SPECODE_WORKER_KEY` — **필수**. 개인 워커 키 (`spk_` 시작, 용도='WORKER').

`SPECODE_WORKER_KEY` 가 없거나 `spk_` 로 시작하지 않으면 아래 출력 후 종료 (서버 호출 금지):

```
⚠️ SPECODE_WORKER_KEY 환경변수가 설정되지 않았거나 형식이 잘못되었습니다.

발급 방법:
  1. SPECODE 화면 접속 → 우상단 프로필 → 설정 → MCP 키 관리
  2. "+ 키 생성" 클릭
  3. 사용 용도: "워커 (run-ai-tasks)" 선택
  4. 프로젝트 선택 후 발급
  5. 발급된 spk_xxxxxx... 원문을 .env.local 에 박기:
     SPECODE_WORKER_KEY=spk_xxxxxxxxxxxxx...
  6. dev 서버 재시작
```

**참고**: 과거에 사용하던 `WORKER_API_KEY` 환경변수는 더 이상 사용하지 않습니다 (4차 PR 에서 폐기).
혼선 방지 차원에서 `.env.local` 에서 줄을 제거하거나 주석 처리하세요.

### 2단계: 쿼리 파라미터 구성

| 인자          | 쿼리                                            |
| ------------- | ----------------------------------------------- |
| `SPEC`        | `limit=10&excludeTaskType=IMPLEMENT`            |
| `IMP`         | `limit=1&taskType=IMPLEMENT`                    |
| `TASK <id>`   | `taskId={taskId}` (limit·taskType 등 다른 필터 없음) |
| `STATUS`      | `statusOnly=true`                               |

🛡 최종 가드: 쿼리에 `taskType=IMPLEMENT` 가 들어가면 인자가 `IMP` 인지 재확인. 아니면 즉시 중단하고 사용법 안내로 폴백. (`TASK` 모드는 `taskType` 을 쓰지 않으므로 이 가드 대상 아님 — 서버가 어차피 본인 소유 PENDING 건만 돌려줌)

`IMP`를 한 번에 1건만 가져오는 이유: 구현 변경 receipt가 사람의 검토를 기다리면 source
baseline이 아직 전진하지 않는다. 다음 구현까지 연속 실행하면 두 작업의 변경 범위가 섞일
수 있으므로, 1건 완료 후 스펙 반영함의 미결 접수를 먼저 처리한다. 스펙 편차가 0건이어도
로컬 증거는 담당자가 확인해야 하므로 receipt가 자동으로 baseline을 전진시키지 않는다.

### 3단계: PENDING 태스크 조회

```bash
curl -s "{SPECODE_URL}/api/worker/tasks?{QUERY}" \
  -H "X-Mcp-Key: {SPECODE_WORKER_KEY}"
```

**응답 받은 직후 반드시 신원 안내 출력** — 사용자가 어떤 컨텍스트로 동작 중인지 즉시 인지하도록.
응답의 `data.meta` 정보를 그대로 사용:

```
🔑 워커 인증 정보
   사용자:    {meta.mberName} ({meta.email})
   프로젝트:  {meta.prjctName}
   키 이름:   "{meta.keyName}"
   마지막 사용: {meta.lastUsedAt}

📋 PENDING 큐: {data.count}건
```

서버측 가드가 응답 401/403 으로 다음 시나리오를 차단합니다 — 출력 시 그대로 표시:
- `INVALID_MCP_KEY` (401) → 키 폐기·미존재. 재발급 필요
- `WRONG_KEY_PURPOSE` (403) → Claude Code MCP 키를 박은 경우. WORKER 용 키로 재발급
- `WORKER_REQUIRES_PROJECT_SCOPE` (403) → 전역('ALL') 키로 시도. 프로젝트 scope 키로 재발급
- `FORBIDDEN_MEMBERSHIP` (403) → 키 소유자가 그 프로젝트의 ACTIVE 멤버 아님

**STATUS 인자인 경우** (자가 점검 모드): 위 신원 안내 + `data.meta.pending` 카운트만 출력 후 즉시 종료. 4단계 이후 진행 안 함.

```
🔍 자가 점검 결과 (본인 PENDING 큐)
   - 전체:   {meta.pending.total} 건
   - 유형별:
       SPEC(IMPLEMENT 외): {합계}
       IMP(IMPLEMENT):     {합계}

   * 의심 시(모르는 사용 흔적) → SPECODE > 설정 > MCP 키 에서 폐기 후 재발급
```

응답의 `data.tasks` 가 비어있으면 아래 출력 후 종료.

```
ℹ️ 처리할 태스크가 없습니다 (인자: {SPEC|IMP|TASK <id>})
```

`TASK` 모드에서 비어있는 경우 원인 안내 한 줄 추가:

```
   * 지정한 taskId 가 PENDING 상태가 아니거나(이미 처리됨 등) 본인 소유가 아닐 수 있습니다.
```

### 4단계: 각 태스크 순서대로 처리

사전 준비: `.claude/tmp` 디렉터리가 없으면 생성 (`mkdir -p .claude/tmp`).
첨부 다운로드·결과 저장이 이 폴더를 사용하며, 프로젝트 루트 기준 상대경로라
D 드라이브 유무나 OS와 무관하게 항상 존재를 보장할 수 있다.

Node.js 실행 가능 여부를 `node --version`으로 확인한다. 실패하면 태스크 시작 전
중단하고 Node.js 설치를 안내한다. Claude Code가 동작하는 개발 환경이면 일반적으로
이미 설치되어 있다.

`data.tasks` 배열 순회.

#### 4-1. IMPLEMENT 작업 직전 source snapshot

`task.taskType === "IMPLEMENT"`일 때만 실행한다.

```bash
node .claude/commands/source_snapshot.mjs capture \
  --output ".claude/tmp/specode_source_{taskId}_before.json.gz"
```

이 스냅샷은 Git commit 여부와 관계없이 현재 텍스트 소스의 경로·hash·내용을 로컬에
보관한다. `.env`, 키/인증서, `.git`, `node_modules`, 빌드 결과물은 도구가 제외한다.
캡처 실패 시 태스크 시작 API를 호출하지 말고 PENDING 상태로 둔 채 사용자에게 보고한다.

#### 4-1b. 태스크 시작 (PENDING → IN_PROGRESS)

source snapshot이 필요 없는 태스크거나 IMPLEMENT snapshot이 성공한 다음 호출한다.

```bash
curl -s -X PATCH "{SPECODE_URL}/api/worker/tasks/{taskId}/start" \
  -H "X-Mcp-Key: {SPECODE_WORKER_KEY}"
```

다른 사용자의 태스크 ID 로 호출하면 403 `FORBIDDEN_TASK_OWNERSHIP`. 정상 흐름이라면 발생하지 않음 (3단계 조회 결과에서 본인 태스크만 받기 때문).

#### 4-2. 프롬프트 준비

`task.reqCn` 은 서버측에서 DB 프롬프트 템플릿(`tb_ai_prompt_template`)이 이미
`<시스템프롬프트>` 태그로 합성된 **완성형 프롬프트**다. 워커는 추가 합성 없이 그대로 사용한다.

> 프롬프트 수정은 SPECODE 화면 → "프롬프트 관리" 메뉴에서 진행한다.
> 과거 `.claude/prompts/{refType}-{taskType}.md` 로컬 파일 로드 로직은 폐기됨 — 이중 시스템프롬프트로 인한 출력 형식 충돌을 막기 위함.

#### 4-2b. 첨부 이미지 로드 (task.attachments 가 비어있지 않을 때만)

`task.attachments` 배열을 순회하며 각 첨부의 `downloadUrl` 로 파일을 받아 Claude 멀티모달 컨텍스트에 주입한다.
**워커는 서버와 다른 머신에서 동작할 수 있으므로 항상 HTTP 다운로드 경로만 사용한다** (로컬 파일 경로 가정 금지).

```bash
curl -s "{SPECODE_URL}{task.attachments[i].downloadUrl}" \
  -H "X-Mcp-Key: {SPECODE_WORKER_KEY}" \
  -o ".claude/tmp/specode_task_{taskId}_{fileId}.{ext}"
```
→ 이어서 `Read(file_path=.claude/tmp/specode_task_{taskId}_{fileId}.{ext})`
이미지 파일은 Claude가 자동으로 시각 콘텐츠로 변환해 컨텍스트에 삽입한다 — base64 인코딩 불필요.

**주의**:
- 이미지는 Read 시 자동으로 멀티모달 컨텍스트에 주입된다 — 텍스트로 별도 안내 추가 불필요
- 다운로드 또는 Read 실패 시 해당 태스크는 FAILED 로 결과 전송(4-4 분기)

#### 4-3. 내용 분석 (직접 수행)

`task.reqCn` 을 그대로 Claude 분석에 전달한다.
서버측 시스템프롬프트가 출력 형식·등급 기준·절대 규칙을 모두 정의하고 있으므로, 워커는 추가 지침을 덧붙이지 않는다.

예외 분기:
- **IMPLEMENT** — 단위업무 개발: `req_cn` 의 지시에 따라 실제 코드 작성·수정 진행.
  `task.implementationSnapshots`는 구현요청 당시 단위업무·화면·영역·기능 설명 원문과
  hash다. 구현 후 스펙 편차 후보를 만들 때만 사용하고, 현재 SPECODE 값을 새로 추측하지 않는다.
- **CUSTOM**    — `task.reqCn` 을 그대로 처리
- **CUSTOM + refType=SPEC_RECONCILIATION** — 서버가 전달한 증거·설계 컨텍스트를
  분석하되 `task.reqCn`에 명시된 JSON 구조만 출력한다. 코드 fence나 앞뒤 설명을
  붙이지 않는다. 완료 API가 대상 소속·허용 필드·before 원문/hash를 다시 검증한 뒤
  receipt 후보로 저장하므로 형식이 다르면 분석 실패로 남는다.
- **CUSTOM + refType=SPEC_RECONCILIATION_ROUTER** — 변경 파일을 설계 scope에만
  연결한다. proposal을 만들지 않고 `task.reqCn`의 assignments JSON만 반환한다.
- **CUSTOM + refType=SPEC_RECONCILIATION_BATCH** — 해당 배치의 제한된 Diff와 설계
  대상만 비교한다. `task.reqCn`의 proposals JSON만 반환한다.

결과는 마크다운으로 작성. 첨부 이미지가 있다면 4-2b 에서 이미 멀티모달 컨텍스트에 주입되어 있다.

#### 4-3b. IMPLEMENT 작업 직후 source Diff와 스펙 편차 제출

`task.taskType === "IMPLEMENT"`일 때만 다음을 순서대로 수행한다.

1. 작업 직후 snapshot과 태스크 단위 Diff를 만든다.

   ```bash
   node .claude/commands/source_snapshot.mjs capture \
     --output ".claude/tmp/specode_source_{taskId}_after.json.gz"

   node .claude/commands/source_snapshot.mjs compare \
     ".claude/tmp/specode_source_{taskId}_before.json.gz" \
     ".claude/tmp/specode_source_{taskId}_after.json.gz" \
     --output ".claude/tmp/specode_source_{taskId}_diff.json"
   ```

2. `specode_source_{taskId}_diff.json`의 전체 변경 증거를 넣어
   `.claude/tmp/specode_receipt_{taskId}.json`을 만든다. 이 시점에는 전체를 한 번에
   분석하거나 proposal을 직접 만들지 않는다. 서버가 구현요청 당시 snapshot만 대상으로
   작은 분석 배치를 만들고, 결과를 검증·병합한다.

   JSON 형식:

   ```json
   {
     "repoKey": "diff.json의 repoKey",
     "branchName": "diff.json의 branchName",
     "checkpointType": "SOURCE_MANIFEST",
     "baseCheckpoint": "diff.json의 baseCheckpoint",
     "headCheckpoint": "diff.json의 headCheckpoint",
     "headStable": true,
     "evidenceTrust": "LOCAL_AGENT_ATTESTED",
     "evidenceVerify": "ATTESTED",
     "diffHash": "diff.json의 diffHash",
     "sourceEvidence": {
       "snapshotTool": "source_snapshot.mjs/v2",
       "changedFiles": ["diff.changes의 모든 path"],
       "files": [
         {
           "path": "diff.changes[].path",
           "status": "diff.changes[].status",
           "patch": "diff.changes[].patch"
         }
       ],
       "securityFiltered": true
     },
     "analysisScope": {
       "changedPaths": ["diff.changes의 모든 path"],
       "includeProjectIndex": false,
       "autoBatch": true
     },
     "summary": "구현 결과 자동 비교 대기",
     "analysisVersion": "implementation/auto-batch-v1",
     "proposals": []
   }
   ```

   `sourceEvidence.files`에는 변경을 하나도 버리지 않고 전부 넣는다. 구현요청 receipt의
   설계 대상은 서버가 `implementationSnapshots`에서 제한하므로 현재 스펙을 새로 읽어
   섞지 않는다. `diff.changedFileCount === 0`이면 `analysisScope`를 생략한다. 이 경우에는
   자동 배치를 만들지 않고 사람이 무변경 증거만 확인한다.

3. 태스크 완료 전 receipt를 먼저 제출한다.

   ```bash
   node .claude/commands/submit_implementation_receipt.mjs \
     {taskId} ".claude/tmp/specode_receipt_{taskId}.json"
   ```

   응답의 `batchAnalysis.batches`가 자동 비교의 최초 작업 목록이다. receipt는
   `ANALYZING`으로 검토함에 남고, 배치가 모두 끝나면 `NEEDS_REVIEW`가 된다.

   제출 실패 시 `task_complete.mjs`를 호출하지 않는다. 태스크와 로컬 증거 파일을
   IN_PROGRESS 상태로 남기고 오류를 보고한다. receipt 제출 성공 후에만 4-4로 진행한다.

#### 4-4. 결과 저장 및 전달

1. Write 로 저장: `.claude/tmp/specode_result_{taskId}.md`
2. `task_complete.mjs` 로 전송:
   ```bash
   node .claude/commands/task_complete.mjs {taskId} DONE .claude/tmp/specode_result_{taskId}.md
   ```
   실패 시 `FAILED` 로 전송.

#### 4-5. 새로 생긴 정합성 배치 연속 처리

`SPEC` 모드는 최초 배열을 한 번 처리하고 끝내지 않는다. Router 완료 시 같은 receipt의
분석 배치가 새로 생성되므로 남은 최대 처리 건수 안에서 PENDING 큐를 다시 조회한다.

`IMP` 모드는 구현 태스크 완료 뒤, 방금 제출한 receipt의
`SPEC_RECONCILIATION_ROUTER`/`SPEC_RECONCILIATION_BATCH` 태스크만 같은 방식으로 처리한다.
다른 receipt의 SPEC 태스크까지 확장하지 않는다. `reqSnapshotData.receiptId`로 소속을
확인한다.

- 조회 → start → `reqCn` 그대로 실행 → JSON complete → 재조회 순서
- 한 배치 실패 시 나머지는 계속 처리
- 한 명령에서 최대 100개 또는 설정된 한도까지만 처리
- 남은 태스크가 있으면 review URL과 남은 수를 보고
- 모든 배치 완료 시 서버가 자동 병합; 다른 제안은 `BATCH_CONFLICT`로 남김

### 5단계: 임시 파일 정리

```bash
rm -f .claude/tmp/specode_result_*.md \
      .claude/tmp/specode_task_* \
      .claude/tmp/specode_source_* \
      .claude/tmp/specode_receipt_*.json
```

`specode_task_*` 는 4-2b 에서 `downloadUrl` 로 내려받은 첨부 이미지 임시 파일이다.

### 6단계: 결과 요약

```
✅ 처리 완료 (인자: {SPEC|IMP|TASK <id>})
   성공 {n} / 실패 {m} / 전체 {total}
```

---

## 주의사항 (체크리스트)

- [ ] 인자가 `SPEC`/`IMP`/`STATUS`(1개) 또는 `TASK <id>`(2개) 형식이 아니면 서버 호출 금지 — 사용법만 출력
- [ ] 🛡 `taskType=IMPLEMENT` 쿼리는 인자가 `IMP` 일 때만 생성
- [ ] 🎯 `TASK` 모드는 `taskId` 만 쿼리에 싣고 다른 필터(limit/taskType 등) 추가 금지
- [ ] 🔑 `SPECODE_WORKER_KEY` 미설정 시 사용법만 출력하고 종료 (서버 호출 금지)
- [ ] 🔑 첫 응답 받은 직후 `data.meta` 기반 신원 안내 출력 (사용자 신원 확인용)
- [ ] 태스크 시작 전 `node --version` 확인
- [ ] 🧠 `task.reqCn` 은 서버에서 시스템프롬프트가 합성된 완성형 — 워커가 추가 합성 금지
- [ ] IMPLEMENT는 소스 수정 전/후 `source_snapshot.mjs`를 실행해 커밋 없는 변경도 태스크 단위로 분리
- [ ] IMPLEMENT의 스펙 후보는 `implementationSnapshots`의 원문/hash를 그대로 기준으로 사용
- [ ] 근거 없는 추측은 source fact에 쓰지 않고 inference/confidence로 분리
- [ ] IMPLEMENT는 receipt 제출 성공 후에만 `task_complete.mjs ... DONE` 호출
- [ ] curl 은 조회·시작에만 사용, 결과 전송은 반드시 `task_complete.mjs` (한글 UTF-8 보장)
- [ ] 한 태스크 실패해도 다음 태스크 계속 처리
- [ ] 🖼 `task.attachments.length > 0` 태스크는 4-2b 를 반드시 수행 (첨부 이미지 무시 금지)
- [ ] 이미지 Read 또는 다운로드 실패 시 해당 태스크는 FAILED 로 전송
- [ ] 5단계에서 `specode_task_*` 임시 파일 정리 (첨부 다운로드가 있었던 경우)
