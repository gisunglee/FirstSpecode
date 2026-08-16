# /run-ai-tasks — SPECODE AI 태스크 처리

SPECODE 서버에서 현재 사용자의 PENDING AI 태스크를 가져와 순서대로 처리하고 결과를 저장한다.
구현-설계 동기화는 이 명령과 분리되어 있으며, 필요할 때 `/sync-specode UW-XXXXX`를 실행한다.

## 인자

| 인자 | 의미 | 서버 쿼리 |
| --- | --- | --- |
| `SPEC` | 개발(IMPLEMENT) 제외 전체 | `limit=10&excludeTaskType=IMPLEMENT` |
| `IMP` | 개발(IMPLEMENT)만 | `limit=1&taskType=IMPLEMENT` |
| `TASK <taskId>` | 특정 태스크 한 건 | `taskId={taskId}` |
| `STATUS` | 신원과 큐 카운트만 확인 | `statusOnly=true` |

`$ARGUMENTS`가 위 형식과 다르면 서버를 호출하지 말고 사용법만 안내한다. 구현 태스크는 정확히
`IMP` 또는 해당 ID를 지정한 `TASK`에서만 실행한다.

## 1. 환경 확인

`.env.local`에서 다음 값을 읽는다.

- `SPECODE_URL`: 없으면 `http://localhost:3000`
- `SPECODE_WORKER_KEY`: 필수, `spk_`로 시작하는 프로젝트 범위 WORKER 키

키가 없거나 형식이 다르면 SPECODE의 설정 > MCP 키 관리에서 워커 키를 발급하라고 안내하고
종료한다. 키 원문을 출력하지 않는다.

## 2. 태스크 조회

```bash
curl -s "{SPECODE_URL}/api/worker/tasks?{QUERY}" \
  -H "X-Mcp-Key: {SPECODE_WORKER_KEY}"
```

응답 직후 `data.meta`의 사용자, 프로젝트, 키 이름과 PENDING 수를 보여준다. `STATUS`면 여기서
종료한다. 태스크가 없으면 처리할 작업이 없다고 알린다.

## 3. 태스크 처리

`.claude/tmp`가 없으면 만들고, 응답의 `data.tasks`를 순서대로 처리한다.

### 3-1. 시작

```bash
curl -s -X PATCH "{SPECODE_URL}/api/worker/tasks/{taskId}/start" \
  -H "X-Mcp-Key: {SPECODE_WORKER_KEY}"
```

서버는 PENDING → IN_PROGRESS를 원자적으로 바꾼다. 409면 다른 워커가 먼저 시작한 것이므로
다음 태스크로 넘어간다.

### 3-2. 분석 또는 구현

`task.reqCn`은 서버에서 시스템 프롬프트가 이미 합성된 완성형 프롬프트다. 추가 시스템 규칙을
붙이지 않고 그대로 수행한다.

- `IMPLEMENT`: 지시된 소스를 실제로 수정하고 안전한 검사까지 실행한다.
- 그 외: 요구한 분석·문서·설계 결과를 만든다.
- 첨부가 있으면 각 `downloadUrl`을 WORKER 키로 내려받아 Read로 확인한다.
- 근거가 없으면 추측하지 말고 결과에 불확실성을 명시한다.

구현 태스크가 끝났다고 이 명령이 설계를 자동 수정하거나 Git 기준선을 만들지는 않는다. 개발자가
현재 소스를 설계와 비교하려면 별도로 `/sync-specode UW-XXXXX`를 실행한다.

### 3-3. 결과 저장

결과를 `.claude/tmp/specode_result_{taskId}.md`에 저장한 뒤 다음 helper로 전송한다.

```bash
node .claude/commands/task_complete.mjs \
  {taskId} DONE ".claude/tmp/specode_result_{taskId}.md"
```

처리 자체가 실패하면 원인을 파일에 저장하고 `FAILED`로 전송한다. 한 태스크 실패가 다음 태스크를
막지 않게 한다.

## 4. 임시 파일 정리와 요약

현재 실행에서 만든 결과 파일과 내려받은 첨부만 삭제한다. 다른 세션의 파일을 넓은 glob으로
삭제하지 않는다. 마지막에 성공·실패·전체 건수를 요약한다.

## 체크리스트

- 인자가 잘못됐으면 서버 호출 금지
- WORKER 키 원문 출력 금지
- 응답 직후 사용자·프로젝트 표시
- `reqCn`에 별도 시스템 프롬프트 합성 금지
- IMPLEMENT는 실제 소스 수정과 검사를 완료한 뒤 DONE
- 동기화는 `/sync-specode UW-XXXXX`에서 별도 수행
- 결과 전송은 `task_complete.mjs` 사용
- 첨부 다운로드 실패 시 해당 태스크 FAILED
- 한 태스크 실패 후 다음 태스크 계속
