# /run-ai-tasks — SPECODE AI 태스크 처리

SPECODE 서버에서 PENDING 상태인 AI 태스크를 가져와 Claude가 직접 처리하고 결과를 서버에 저장한다.

## 핵심 규칙 요약

- **인자는 1개 또는 2개**: `<유형> [범위]`  (대소문자 무관)
- 인자 1(**유형**): 무엇을 할 것인가 — taskType 그룹(ANA/DSG/IMP/SPEC) 또는 단일 taskType
- 인자 2(**범위**): 어디에 적용할 것인가 — refType (선택)
- 🛡 **IMPLEMENT 안전 가드**: 구현 태스크(`IMPLEMENT`)는 인자 1이 `IMP` 또는 `IMPLEMENT` 일 때만 조회된다. `SPEC`·`ANA`·`DSG`·범위 단독 어떤 경우에도 섞이지 않는다.

---

## 인자 사전 (두 차원)

### ① 유형 (taskType 축) — 인자 1

무엇을 할 것인가. **필수**.

| 유형 (그룹)   | 확장되는 taskType                | 설명              |
| ------------- | -------------------------------- | ----------------- |
| `ANA`         | `INSPECT`, `IMPACT`              | 분석 계열         |
| `DSG`         | `DESIGN`                         | 설계 계열         |
| `IMP`         | `IMPLEMENT`                      | 구현 계열 (🛡 가드) |
| `SPEC`        | `INSPECT`, `IMPACT`, `DESIGN`    | 분석 + 설계       |

| 유형 (단일)   | 그대로 전달           | 비고                                |
| ------------- | --------------------- | ----------------------------------- |
| `INSPECT`     | taskType=INSPECT      |                                     |
| `IMPACT`      | taskType=IMPACT       |                                     |
| `DESIGN`      | taskType=DESIGN       |                                     |
| `IMPLEMENT`   | taskType=IMPLEMENT    | 🛡 IMP 가드 통과                     |
| `MOCKUP`      | taskType=MOCKUP       | *(폐기 예정 — 신규 요청 지양)*      |
| `CUSTOM`      | taskType=CUSTOM       | 자유 요청                           |

### ② 범위 (refType 축) — 인자 2

어디에 적용할 것인가. **선택** — 생략 시 해당 유형의 모든 refType 대상.

| 범위              | refType 파라미터 값 |
| ----------------- | ------------------- |
| `FUNCTION`        | FUNCTION            |
| `AREA`            | AREA                |
| `SCREEN`          | SCREEN              |
| `UNIT_WORK`       | UNIT_WORK           |
| `PLAN_STUDIO_ARTF`| PLAN_STUDIO_ARTF    |

> ⚠️ **범위만 단독 호출은 허용하지 않는다.** 유형을 생략하면 IMPLEMENT 가 섞여 들어올 위험이 있어 IMP 가드를 우회하게 됨. 반드시 `<유형> [범위]` 순서로 써야 한다.

---

## 사용 예시

```
/run-ai-tasks SPEC               ← 분석+설계 모든 대상
/run-ai-tasks SPEC FUNCTION      ← 분석+설계 중 기능만
/run-ai-tasks ANA AREA           ← INSPECT/IMPACT 중 영역만
/run-ai-tasks DSG SCREEN         ← DESIGN 중 화면만
/run-ai-tasks IMP                ← 모든 구현 (IMP 명시됨)
/run-ai-tasks IMP FUNCTION       ← 기능 구현만
/run-ai-tasks DESIGN             ← DESIGN 단독
/run-ai-tasks DESIGN FUNCTION    ← DESIGN 중 기능만
```

잘못된 예:
```
/run-ai-tasks                    ← 인자 없음 → 사용법 안내만 출력
/run-ai-tasks FUNCTION           ← 범위 단독 → 거부, 사용법 안내
/run-ai-tasks ABC                ← 정의되지 않은 값 → 거부, 사용법 안내
/run-ai-tasks DESIGN IMP         ← 유형 2개 → 거부
/run-ai-tasks IMP SPEC           ← 유형 2개 → 거부
```

---

## 실행 지시사항

### 0단계: 인자 검증

`$ARGUMENTS` 를 공백 단위로 토큰 분리 후 **전부 대문자로** 변환.

- **토큰 0개**: 사용법 안내 출력 후 종료. 서버 호출 금지.
- **토큰 3개 이상**: 사용법 안내 출력 후 종료.
- **토큰 1개**(`T1`):
  - `T1` 이 위 **유형 사전**(그룹 4개 + 단일 6개)에 있으면 OK
  - `T1` 이 **범위 사전**에만 있으면 거부 (IMPLEMENT 혼입 방지)
  - 둘 다 해당 없으면 거부
- **토큰 2개**(`T1 T2`):
  - `T1` 은 **유형 사전** 중 하나여야 한다
  - `T2` 는 **범위 사전** 중 하나여야 한다
  - 위반 시 거부

거부 시에는 항상 아래 **사용법 안내**를 출력한다.

#### 사용법 안내 템플릿

```
⚠️ 처리할 범위를 지정해 주세요.

사용법: /run-ai-tasks <유형> [범위]

─ 유형 (taskType · 필수) ─
  그룹:
    ANA   분석 계열     (INSPECT, IMPACT)
    DSG   설계 계열     (DESIGN)
    IMP   구현 계열     (IMPLEMENT)   ← 구현은 여기서만 실행됩니다
    SPEC  분석 + 설계   (INSPECT, IMPACT, DESIGN)
  단일:
    INSPECT | IMPACT | DESIGN | IMPLEMENT | MOCKUP | CUSTOM

─ 범위 (refType · 선택) ─
    FUNCTION | AREA | SCREEN | UNIT_WORK | PLAN_STUDIO_ARTF
  ※ 범위만 단독으로 쓸 수 없습니다. 유형과 함께 쓰세요.

예시:
  /run-ai-tasks SPEC            ← 분석+설계 모든 대상
  /run-ai-tasks SPEC FUNCTION   ← 분석+설계 중 기능만
  /run-ai-tasks IMP FUNCTION    ← 기능 구현만
  /run-ai-tasks DESIGN AREA     ← 영역 설계만
```

---

### 1단계: 환경변수 로드

`.env.local` 파일을 Read 도구로 읽어 `SPECODE_URL`과 `WORKER_API_KEY` 값을 파악한다.
- `SPECODE_URL` 기본값: `http://localhost:3000`
- `WORKER_API_KEY` 기본값: `dev-worker-key`

---

### 2단계: 인자를 쿼리 파라미터로 변환

0단계에서 검증된 `T1`(유형) / `T2`(범위·옵션) 로부터 쿼리 파라미터를 만든다.

**T1 → `taskType` 쿼리값 매핑 (그룹은 쉼표 복수값)**

| T1          | 전달되는 `taskType`             |
| ----------- | ------------------------------- |
| `ANA`       | `INSPECT,IMPACT`                |
| `DSG`       | `DESIGN`                        |
| `IMP`       | `IMPLEMENT`                     |
| `SPEC`      | `INSPECT,IMPACT,DESIGN`         |
| 단일 값     | 그 값 그대로                    |

**T2 → `refType` 쿼리값 매핑** — 있으면 그대로 추가, 없으면 생략.

**🛡 IMP 가드 최종 확인**: 2단계 결과로 만든 `taskType` 목록에 `IMPLEMENT` 가 포함된다면 `T1` 은 반드시 `IMP` 혹은 `IMPLEMENT` 여야 한다. 아니면 즉시 중단하고 사용법 안내로 폴백한다 (이중 안전장치).

최종 URL 예:
```
/api/worker/tasks?limit=10&taskType=INSPECT,IMPACT,DESIGN&refType=FUNCTION
```

---

### 3단계: PENDING 태스크 조회

```bash
curl -s "{SPECODE_URL}/api/worker/tasks?limit=10&{QUERY}" \
  -H "X-Worker-Key: {WORKER_API_KEY}"
```

응답의 `data.tasks` 배열을 확인한다. 비어있으면 "처리할 태스크가 없습니다 (유형: {T1}, 범위: {T2 or '전체'})" 출력 후 종료.

---

### 4단계: 각 태스크 순서대로 처리

`data.tasks` 배열의 각 항목에 대해 아래를 반복한다.

#### 4-1. 태스크 시작 (PENDING → IN_PROGRESS)

```bash
curl -s -X PATCH "{SPECODE_URL}/api/worker/tasks/{taskId}/start" \
  -H "X-Worker-Key: {WORKER_API_KEY}"
```

#### 4-2. 프롬프트 파일 로드

`task.refType`과 `task.taskType`으로 전용 프롬프트 파일을 Read:

- **경로**: `.claude/prompts/{refType}-{taskType}.md`
  - 예) `FUNCTION-DESIGN.md`, `AREA-INSPECT.md`
- 파일이 없으면 4-3의 기본 지침 사용

#### 4-3. 내용 분석 (직접 수행)

`task.reqCn` + 4-2 프롬프트로 분석. 프롬프트 파일 있으면 그 출력 형식을 **반드시** 따름. 없으면 기본 지침:

- **DESIGN**: 상세설계 생성 — 데이터 흐름, 처리 로직, 예외, 관련 테이블/API
- **INSPECT**: 요구사항 검토 — 완성도·명확성·일관성·실용성
- **IMPACT**: 영향도 분석 — 영향받는 기능·데이터·화면·테스트
- **IMPLEMENT**: 구현 진행 — 기능 명세 기반 실제 구현
- **MOCKUP**: ASCII 박스 레이아웃 *(폐기 예정)*
- **CUSTOM**: `task.reqCn` 그대로 처리

분석 결과를 마크다운으로 작성.

#### 4-4. 결과 저장 및 전달

1. **Write 도구**로 저장: `d:/tmp/specode_result_{taskId}.md`

2. **task_complete.py**로 전송:
```bash
python .claude/commands/task_complete.py {taskId} DONE d:/tmp/specode_result_{taskId}.md
```
실패 시 `FAILED` 로 전송.

---

### 5단계: 임시 파일 정리

```bash
rm -f d:/tmp/specode_result_*.md
```

---

### 6단계: 결과 요약

전체 처리 건수, 성공/실패 수를 출력. **처리한 인자(`T1`, `T2`)도 함께 표시**해 범위를 명확히 한다.

예:
```
✅ 처리 완료 (유형: SPEC, 범위: FUNCTION)
   성공 5 / 실패 1 / 전체 6
```

---

## 주의사항 (체크리스트)

- [ ] 인자 없으면 서버 호출 금지 — 사용법만 출력
- [ ] 정의되지 않은 토큰도 서버 호출 금지
- [ ] 범위(refType) 단독 호출 금지 — 반드시 유형과 함께
- [ ] 🛡 IMPLEMENT 가 결과에 들어간다면 T1 이 `IMP`/`IMPLEMENT` 인지 재확인
- [ ] curl 은 조회·시작에만 사용
- [ ] 결과 전송은 반드시 `task_complete.py` (한글 UTF-8 보장)
- [ ] 한 태스크 실패해도 다음 계속 처리
