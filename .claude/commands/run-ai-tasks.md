# /run-ai-tasks — SPECODE AI 태스크 처리

SPECODE 서버의 PENDING AI 태스크를 가져와 Claude 가 직접 처리하고 결과를 서버에 저장한다.

## 인자 — 3종류

| 인자     | 의미                                | 서버 쿼리                         |
| -------- | ----------------------------------- | --------------------------------- |
| `SPEC`   | **개발(IMPLEMENT) 제외** 전체 유형  | `excludeTaskType=IMPLEMENT`       |
| `IMP`    | **개발(IMPLEMENT) 만**               | `taskType=IMPLEMENT`              |
| `STATUS` | **점검만** — 본문 미조회, 큐 카운트·키 정보만 출력 후 종료 | `statusOnly=true` |

- 대소문자 무관
- 인자는 반드시 1개. 0개·2개 이상·다른 값이면 **사용법 안내만 출력하고 종료**(서버 호출 금지)
- `SPEC` 는 taskType 을 나열하지 않고 "구현만 제외" 방식이라, 향후 taskType 이 추가돼도 자동으로 포함된다
- 🛡 **IMPLEMENT 안전 가드**: 구현 태스크는 인자가 정확히 `IMP` 일 때만 조회된다
- 🔍 **STATUS 모드**: 키가 의도대로 동작 중인지, 본인 큐가 몇 건 있는지 빠르게 확인. 태스크 처리 안 함.

---

## 실행 절차

### 0단계: 인자 검증

`$ARGUMENTS` 를 공백으로 토큰 분리 → 전부 대문자 변환 → 토큰 1개이고 값이 `SPEC` / `IMP` / `STATUS` 중 하나인지 확인.

부적합하면 아래 **사용법 안내**만 출력하고 종료.

```
⚠️ 사용법: /run-ai-tasks <SPEC|IMP|STATUS>

  SPEC    개발(IMPLEMENT) 제외한 모든 AI 태스크 처리
  IMP     개발(IMPLEMENT) 태스크만 처리
  STATUS  점검만 — 키 정보 + 큐 카운트만 표시 후 종료 (태스크 처리 안 함)

예시:
  /run-ai-tasks SPEC
  /run-ai-tasks IMP
  /run-ai-tasks STATUS
```

### 1단계: 환경변수 로드

`.env.local` 을 Read 로 읽어 값 파악.
- `SPECODE_URL` — 기본값 `http://localhost:3000` (파일에 없으면 기본값 사용)
- `SPECODE_MCP_KEY` — **필수**. 개인 워커 키 (`spk_` 시작, 용도='WORKER').

`SPECODE_MCP_KEY` 가 없거나 `spk_` 로 시작하지 않으면 아래 출력 후 종료 (서버 호출 금지):

```
⚠️ SPECODE_MCP_KEY 환경변수가 설정되지 않았거나 형식이 잘못되었습니다.

발급 방법:
  1. SPECODE 화면 접속 → 우상단 프로필 → 설정 → MCP 키 관리
  2. "+ 키 생성" 클릭
  3. 사용 용도: "워커 (run-ai-tasks)" 선택
  4. 프로젝트 선택 후 발급
  5. 발급된 spk_xxxxxx... 원문을 .env.local 에 박기:
     SPECODE_MCP_KEY=spk_xxxxxxxxxxxxx...
  6. dev 서버 재시작
```

**참고**: 과거에 사용하던 `WORKER_API_KEY` 환경변수는 더 이상 사용하지 않습니다 (4차 PR 에서 폐기).
혼선 방지 차원에서 `.env.local` 에서 줄을 제거하거나 주석 처리하세요.

### 2단계: 쿼리 파라미터 구성

| 인자     | 쿼리                                            |
| -------- | ----------------------------------------------- |
| `SPEC`   | `limit=10&excludeTaskType=IMPLEMENT`            |
| `IMP`    | `limit=10&taskType=IMPLEMENT`                   |
| `STATUS` | `statusOnly=true`                               |

🛡 최종 가드: 쿼리에 `taskType=IMPLEMENT` 가 들어가면 인자가 `IMP` 인지 재확인. 아니면 즉시 중단하고 사용법 안내로 폴백.

### 3단계: PENDING 태스크 조회

```bash
curl -s "{SPECODE_URL}/api/worker/tasks?{QUERY}" \
  -H "X-Mcp-Key: {SPECODE_MCP_KEY}"
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
ℹ️ 처리할 태스크가 없습니다 (인자: {SPEC|IMP})
```

### 4단계: 각 태스크 순서대로 처리

`data.tasks` 배열 순회.

#### 4-1. 태스크 시작 (PENDING → IN_PROGRESS)

```bash
curl -s -X PATCH "{SPECODE_URL}/api/worker/tasks/{taskId}/start" \
  -H "X-Mcp-Key: {SPECODE_MCP_KEY}"
```

다른 사용자의 태스크 ID 로 호출하면 403 `FORBIDDEN_TASK_OWNERSHIP`. 정상 흐름이라면 발생하지 않음 (3단계 조회 결과에서 본인 태스크만 받기 때문).

#### 4-2. 프롬프트 파일 로드

`task.refType` + `task.taskType` 으로 전용 프롬프트 파일 시도.
- 경로: `.claude/prompts/{refType}-{taskType}.md` (예: `FUNCTION-DESIGN.md`)
- 없으면 4-3 기본 지침 사용

#### 4-2b. 첨부 이미지 로드 (task.attachments 가 비어있지 않을 때만)

`task.attachments` 배열을 순회하며 각 첨부의 `downloadUrl` 로 파일을 받아 Claude 멀티모달 컨텍스트에 주입한다.
**워커는 서버와 다른 머신에서 동작할 수 있으므로 항상 HTTP 다운로드 경로만 사용한다** (로컬 파일 경로 가정 금지).

```bash
curl -s "{SPECODE_URL}{task.attachments[i].downloadUrl}" \
  -H "X-Mcp-Key: {SPECODE_MCP_KEY}" \
  -o "d:/tmp/specode_task_{taskId}_{fileId}.{ext}"
```
→ 이어서 `Read(file_path=d:/tmp/specode_task_{taskId}_{fileId}.{ext})`
이미지 파일은 Claude가 자동으로 시각 콘텐츠로 변환해 컨텍스트에 삽입한다 — base64 인코딩 불필요.

**주의**:
- 이미지를 로드한 뒤 4-3 분석 프롬프트에 "첨부된 이미지 {N}개를 반드시 참고하여 분석할 것"을 명시 추가
- 다운로드 또는 Read 실패 시 해당 태스크는 FAILED 로 결과 전송(4-4 분기)

#### 4-3. 내용 분석 (직접 수행)

`task.reqCn` + 4-2 프롬프트로 분석. 프롬프트 파일이 있으면 해당 출력 형식을 **반드시** 따른다. 없을 때의 기본 지침:

- **DESIGN**   상세설계 — 데이터 흐름, 처리 로직, 예외, 관련 테이블/API
- **INSPECT**  요구사항 검토 — 완성도·명확성·일관성·실용성
- **IMPACT**   영향도 분석 — 영향받는 기능·데이터·화면·테스트
- **IMPLEMENT** 실제 구현 진행
- **MOCKUP**   ASCII 박스 레이아웃 *(폐기 예정)*
- **CUSTOM**   `task.reqCn` 그대로 처리

결과는 마크다운으로 작성.

#### 4-4. 결과 저장 및 전달

1. Write 로 저장: `d:/tmp/specode_result_{taskId}.md`
2. `task_complete.py` 로 전송:
   ```bash
   python .claude/commands/task_complete.py {taskId} DONE d:/tmp/specode_result_{taskId}.md
   ```
   실패 시 `FAILED` 로 전송.

### 5단계: 임시 파일 정리

```bash
rm -f d:/tmp/specode_result_*.md d:/tmp/specode_task_*
```

`specode_task_*` 는 4-2b 에서 `downloadUrl` 로 내려받은 첨부 이미지 임시 파일이다.

### 6단계: 결과 요약

```
✅ 처리 완료 (인자: {SPEC|IMP})
   성공 {n} / 실패 {m} / 전체 {total}
```

---

## 주의사항 (체크리스트)

- [ ] 인자 없거나 `SPEC`/`IMP` 아니면 서버 호출 금지 — 사용법만 출력
- [ ] 🛡 `taskType=IMPLEMENT` 쿼리는 인자가 `IMP` 일 때만 생성
- [ ] 🔑 `SPECODE_MCP_KEY` 미설정 시 사용법만 출력하고 종료 (서버 호출 금지)
- [ ] 🔑 첫 응답 받은 직후 `data.meta` 기반 신원 안내 출력 (사용자 신원 확인용)
- [ ] curl 은 조회·시작에만 사용, 결과 전송은 반드시 `task_complete.py` (한글 UTF-8 보장)
- [ ] 한 태스크 실패해도 다음 태스크 계속 처리
- [ ] 🖼 `task.attachments.length > 0` 태스크는 4-2b 를 반드시 수행 (첨부 이미지 무시 금지)
- [ ] 이미지 Read 또는 다운로드 실패 시 해당 태스크는 FAILED 로 전송
- [ ] 5단계에서 `specode_task_*` 임시 파일 정리 (첨부 다운로드가 있었던 경우)
