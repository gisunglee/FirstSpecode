# /run-ai-tasks — SPECODE AI 태스크 처리

SPECODE 서버에서 PENDING 상태인 AI 태스크를 가져와 Claude가 직접 처리하고 결과를 서버에 저장한다.

## 실행 지시사항

다음 순서를 정확히 따른다.

---

### 0단계: 환경변수 로드

`.env.local` 파일을 Read 도구로 읽어 `SPECODE_URL`과 `WORKER_API_KEY` 값을 파악한다.
- 파일 경로: `.env.local` (프로젝트 루트)
- `SPECODE_URL` 기본값: `http://localhost:3000`
- `WORKER_API_KEY` 기본값: `dev-worker-key`

이후 모든 단계에서 이 값을 사용한다.

---

### 1단계: PENDING 태스크 조회

```bash
curl -s "{SPECODE_URL}/api/worker/tasks?limit=10" \
  -H "X-Worker-Key: {WORKER_API_KEY}"
```

`$ARGUMENTS`가 있으면:
- `DESIGN`, `INSPECT` 등 taskType이면 `&taskType=$ARGUMENTS` 추가
- `FUNCTION`, `AREA` 등 refType이면 `&refType=$ARGUMENTS` 추가

응답의 `data.tasks` 배열을 확인한다. 비어있으면 "처리할 태스크가 없습니다" 출력 후 종료.

---

### 2단계: 각 태스크 순서대로 처리

`data.tasks` 배열의 각 항목에 대해 아래를 반복한다.

#### 2-1. 태스크 시작 (PENDING → IN_PROGRESS)

```bash
curl -s -X PATCH "{SPECODE_URL}/api/worker/tasks/{taskId}/start" \
  -H "X-Worker-Key: {WORKER_API_KEY}"
```

#### 2-2. 프롬프트 파일 로드

`task.refType`과 `task.taskType`으로 전용 프롬프트 파일을 찾아 Read 도구로 읽는다:

- **경로**: `.claude/prompts/{refType}-{taskType}.md`
  - 예) `refType=FUNCTION`, `taskType=DESIGN` → `.claude/prompts/FUNCTION-DESIGN.md`
  - 예) `refType=AREA`, `taskType=INSPECT` → `.claude/prompts/AREA-INSPECT.md`
- 파일이 없으면 아래 2-3의 기본 지침을 사용한다

#### 2-3. 내용 분석 (직접 수행)

`task.reqCn` 내용과 2-2에서 읽은 프롬프트 파일을 합쳐 분석한다.

프롬프트 파일이 있으면 그 출력 형식을 **반드시** 따른다. 없으면 아래 기본 지침:

- **DESIGN**: 상세설계 생성 — 데이터 흐름, 처리 로직, 예외 처리, 관련 테이블/API 포함
- **INSPECT**: 요구사항 검토 — 완성도·명확성·일관성·실용성 관점에서 마크다운 피드백
- **IMPACT**: 영향도 분석 — 영향받는 기능, 데이터, 화면, 테스트 시나리오
- **IMPLEMENT**: 구현 진행 — 기능 명세를 바탕으로 구현
- **MOCKUP**: 화면 설계 — ASCII 박스 스타일 레이아웃 포함
- **CUSTOM**: `task.reqCn`의 요청 내용 그대로 처리

분석 결과를 마크다운으로 작성한다.

#### 2-4. 결과 저장 및 전달

1. **Write 도구**로 결과를 임시 파일에 저장:
   - 경로: `d:/tmp/specode_result_{taskId}.md`
   - 내용: 분석 결과 마크다운 전체

2. **task_complete.py**로 전송:

```bash
python .claude/commands/task_complete.py {taskId} DONE d:/tmp/specode_result_{taskId}.md
```

실패 시:
```bash
python .claude/commands/task_complete.py {taskId} FAILED d:/tmp/specode_result_{taskId}.md
```

---

### 3단계: 임시 파일 정리

```bash
rm -f d:/tmp/specode_result_*.md
```

---

### 4단계: 결과 요약

전체 처리 건수, 성공/실패 수를 출력한다.

---

## 주의사항

- curl은 태스크 조회·시작에만 사용한다
- **결과 전송은 반드시 `task_complete.py`로** — 한글 UTF-8 보장
- 한 태스크 실패해도 다음 태스크는 계속 처리한다
- `python run_ai_tasks.py`로 직접 실행해도 동일하게 동작한다 (단, 속도는 느림)
