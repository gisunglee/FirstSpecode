# SPECODE 커맨드 조사 및 통일 제안

조사일: 2026-09-28. 현재 저장소의 정적 분석 기준. 고객 설치본, 운영 서버 및 실제 명령 실행은 검증하지 않았다. 이 문서의 새 명령은 제안이며 아직 구현되지 않았다.

## 1. 결론

사용자 진입점을 `/specode` 하나로 통일하고, 하위 명령은 `status`, `run`, `review`, `sync`, `onboard`로 나눈다. 이름뿐 아니라 대상 확인, 입력 검증, 진행 표시, 오류, 결과 요약, 설치를 통일한다. 실제 코드 수정·서버 결과 제출·설계 변경은 서로 다른 동작으로 유지한다.

검토와 동기화를 즉시 하나로 합치지는 않는다. 설계 대조 부분은 공통화할 수 있지만, 검토는 코드/UI 가이드도 평가하고 동기화는 설계 변경 후보를 승인 절차로 보내기 때문에 목적과 결과 계약이 다르다.

## 2. 조사 범위와 현황

조사 범위: `.claude/commands` 전체 7파일, 리뷰 에이전트와 공통 출력 규칙, `.codex/agents`, MCP 설치 배포 코드, 빌드 tracing 설정, 워커 조회 API, 관련 UI 안내·가이드 정책·기존 점검 문서, package.json.

| 사용자 명령 | 입력/모드 | 실제 역할 | 변경 및 결과 |
|---|---|---|---|
| `/run-ai-tasks` | `SPEC` | IMPLEMENT 제외 태스크, 최대 10건 조회 | 태스크 결과 저장. 태스크 종류에 따른 서버 반영 |
| 동일 | `IMP` | IMPLEMENT 태스크, 최대 1건 조회 | 로컬 소스 수정·검사 후 결과 저장 |
| 동일 | `TASK <taskId>` | 특정 PENDING 태스크 실행 | 타입에 따라 구현도 실행 가능 |
| 동일 | `STATUS` | 키 신원·프로젝트·대기 건수 확인 | 조회 전용 |
| `/review-uw` | UW 또는 숫자 | 현재 설계 + 등록된 표준 가이드로 검토 | 즉석 리포트, 서버 저장·자동 수정 없음 |
| `/sync-specode` | UW | CHECK: 설계 대조·중요 누락 후보 | 실행 및 문제·수정안 서버 제출, 적용은 웹 승인 |
| 동일 | UW + `--deep` | DEEP_SYNC: 더 넓은 역설계 | 위와 동일한 승인 경계 |
| `/onboard-asis` | 없음 | 기존 소스를 AS-IS 설계로 등록 | 영역별 합의 후 서버 생성·수정, 미확인 질문 등록 |

총 4개 공개 명령, 8개 주요 사용 형태다. 별도로 `task_complete.mjs`, `sync_specode.mjs`, `spec_sync_local.mjs` 3개 helper가 있다. sync helper의 7개 내부 동작(context/start/hash-scope/prepare/validate/submit/cleanup)은 사용자 메뉴에 노출할 필요가 없다.

MCP 도구와 npm 개발·DB·테스트 스크립트는 별도 계층이다. 이들을 슬래시 명령에 전부 합치면 사용자가 알아야 할 것이 오히려 늘어난다. MCP는 실행 수단, npm은 저장소 운영 수단으로 유지한다.

## 3. 확인한 불일치

### 입력과 대상 선택

- review는 `14`를 `UW-00014`로 정규화하지만 sync는 `UW-XXXXX` 형식을 요구한다.
- run은 대문자 약어/서브명령, sync는 옵션, onboard는 대화식 입력을 사용한다.
- run/sync는 프로젝트 범위 WORKER 키를 사용한다. review/onboard는 MCP `list_projects`로 프로젝트를 고른다. 두 경로의 프로젝트가 같다는 공통 검증이 없다.
- sync는 단일 프로젝트여도 실행 생성 전에 확인을 요구한다. run은 신원 표시 후 실행한다. onboard는 방식·영역·접두어 등을 단계별로 합의한다. 차이의 이유가 공통 정책으로 표현되어 있지 않다.

### 검토 기준과 결과

- review는 표준 가이드까지 평가하지만 sync는 자동 참조하지 않는다(`src/lib/standard-guides/usagePolicy.ts`). 두 결과를 같은 종류의 PASS로 해석하면 안 된다.
- review 공통 규칙은 critical=0이고 major가 3개 이하면 PASS다. 그런데 최종 안내 예시는 PASS에 대해 “머지/배포 가능”을 출력하도록 한다. 일부 관점이 생략되거나 주요 이슈가 남아 있을 수 있으므로 이 문구는 과도하다.
- review의 JSON 파싱 실패는 해당 관점을 제외하고 나머지로 집계한다. 분석 실패와 기준 부재에 의한 건너뜀을 분리해야 한다.
- sync는 실행 상태, 구현 verdict, 설계 커버리지 verdict를 분리하고 소스 hash·근거를 검증한다. review는 점수·심각도 기반이다. 공통 외피는 만들되 도메인 판정을 하나로 압축하면 안 된다.
- `.claude/agents/prd-compliance-reviewer.md`는 서버 설계 입력을 사용하지만 `.codex/agents/prd-compliance-reviewer.toml`은 로컬 PRD 및 `.Codex/biz`, `.Codex/agents/_shared` 파일을 요구한다. 해당 참조 파일들은 현재 `.codex` 파일 목록에 없다. 같은 이름의 에이전트가 다른 기준으로 동작한다.

### 배포와 유지보수

- `workerCommandFiles.ts`는 12개 파일을 배포 목록으로 관리한다. `next.config.ts`의 `/api/mcp` 명시적 tracing 목록에는 5개만 있다. onboard/review와 리뷰 에이전트·공통 문서 7개가 빠져 있다. 실제 배포 장애 여부는 산출물 검증이 필요하지만, 현재 명시 목록의 불일치는 확실하다.
- 배포 결과는 파일 경로·본문·삭제 목록·가이드이며 버전/hash manifest가 없다. 고객 로컬 변경을 구분하는 설치 계약도 없다.
- 사용자 명령 문자열이 설치 안내, AI 태스크 도움말, 동기화 화면, 키 관리, 표준 가이드 정책에 분산되어 있다.
- task_complete와 spec_sync_local에 환경변수 로딩·WORKER 설정·HTTP 처리가 중복되어 있다.
- run만 frontmatter(description/argument-hint/allowed-tools)가 없다.
- 옛 점검 문서에는 Python helper가 남았다고 나오지만 현재 commands 목록에는 없다. 과거 문서의 지적을 현재 결함으로 그대로 옮기면 안 된다.

## 4. 제안하는 사용법

| 현재 | 제안 | 설명 |
|---|---|---|
| 각 커맨드 사용법 확인 | `/specode` 또는 `/specode help` | 가능한 작업과 예시만 표시, 자동 실행 없음 |
| `/run-ai-tasks STATUS` | `/specode status` | 연결·프로젝트·대기열 확인 |
| `/run-ai-tasks SPEC` | `/specode run --type non-implement` | 기존의 “구현 제외 전체” 의미를 정확히 유지 |
| `/run-ai-tasks IMP` | `/specode run --type implement` | 구현 태스크 실행 |
| `/run-ai-tasks TASK <id>` | `/specode run --task <id>` | 특정 태스크 실행, 실제 유형과 영향 표시 |
| `/review-uw UW-00014` | `/specode review UW-00014` | 품질 검토 리포트 |
| `/sync-specode UW-00014` | `/specode sync UW-00014` | CHECK 결과 제출 |
| `/sync-specode UW-00014 --deep` | `/specode sync UW-00014 --deep` | 정밀 분석 결과 제출 |
| `/onboard-asis` | `/specode onboard` | AS-IS 분석·합의·등록 |

`SPEC`를 `design`으로 단순 치환하지 않는다. 현재 SPEC는 설계뿐 아니라 IMPLEMENT 이외의 태스크를 모두 처리한다. 화면에는 친숙한 “분석·문서 등 비개발 작업” 설명을 함께 제공한다.

단독 `run`은 실행하지 않고 유형 선택을 안내한다. `--task`와 `--type`은 상호 배타적으로 검증한다. 기본 조회량은 기존대로 비구현 10건/구현 1건으로 유지하며 무한 큐 소진으로 확대하지 않는다.

모든 UW 입력에서 숫자 축약을 동일하게 정규화한다. 다만 onboard가 만드는 `AS-UW-*` 등 사용자 지정 displayId도 장기적으로 지원할지 결정해야 한다. 지원 시 정규식 완화만 하지 말고 프로젝트 내 정확한 대상 해석 및 UUID 연결까지 함께 바꾼다.

## 5. 공통 실행 계약

모든 명령은 `입력 검증 → 연결/대상 확인 → 필요한 데이터 확보 → 분석/작업 → 결과 검증 → 저장/출력 → 요약` 순서로 표현한다.

1. 대상: 프로젝트 ID·이름, UW/태스크, 작업 종류를 같은 형식으로 표시한다. 두 인증 경로를 함께 쓰면 프로젝트 일치를 검증한다. 프로젝트 선택 옵션이 WORKER 키 범위를 넓혀서는 안 된다.
2. 권한: 사용자 경험을 통일해도 MCP 키와 WORKER 키를 합치지 않는다. 명령별 필요한 기능과 가능한 변경을 정의한다.
3. 확인: 조회/리포트에는 반복 승인을 요구하지 않는다. 코드 수정은 명시적 구현 요청 범위에서 실행한다. sync의 실행 생성 확인과 웹 적용 승인, onboard의 등록 합의는 초기 전환에서 보존한다. 확인 횟수 축소는 대상과 실제 변경안이 명확할 때 별도 정책 변경으로 진행한다.
4. 결과: 공통 필드로 command, project, target, executionStatus, summary, artifacts, nextAction을 둔다. 업무별 상세 결과는 그대로 유지한다.
5. 불완전: FAILED/NEEDS_INPUT/PARTIAL 같은 실행 상태와 PASS/WARN/FAIL 같은 검토 결과를 분리한다. 관점 누락·파싱 실패 시 전체 검토 완료로 안내하지 않는다.
6. 근거: 설계 비교의 대상 해석·설계 읽기·소스 범위 탐색을 공유한다. 결과 재사용은 소스 hash와 설계 snapshot이 일치할 때만 한다.
7. 실패 복구: 결과 생성 실패와 제출 실패를 구분한다. 제출 실패 시 결과 파일을 남겨 재전송할 수 있게 한다. 변경 요청 재시도는 서버 상태/멱등성 확인 없이 자동 반복하지 않는다.

## 6. 구현 구조

- 단일 명령 레지스트리: 이름, 별칭, 인자, 설명, 영향, 필요 인증, workflow 파일, 배포 파일 목록을 관리한다.
- 얇은 `/specode` 라우터: 해당 workflow만 읽도록 분기한다. 네 커맨드 내용을 거대한 단일 프롬프트로 합치지 않는다.
- 공통 runtime: 환경 설정, HTTP 오류, 대상 표시, 임시 파일, 결과 파일 검증을 담당한다. 기존 sync helper의 hash 검증과 경로 제한은 유지한다.
- 개별 workflow: run/review/sync/onboard의 목적·승인·결과 계약을 유지한다.
- 실행 도구별 어댑터: Claude/Codex 정의의 기준 문서는 공유하고 도구 이름·호출 방식만 분리한다. Codex용 호출 방식은 실제 지원 환경에서 검증한 뒤 제공한다.
- UI 도움말·설치 안내·tracing 목록을 동일 레지스트리 또는 manifest에서 파생한다.
- 설치 manifest: bundleVersion, 최소 서버 계약 버전, path/hash를 제공한다. 기존 파일의 로컬 수정 여부를 판별하고 덮어쓰기 전에 diff/백업을 제공한다. hash는 변경 확인 수단이며 자체로 배포자의 신원을 보증하지는 않는다.

## 7. 단계별 도입

### 1차: 동작 보존, 진입점 통일

`/specode` 라우터와 공통 도움말, 엄격한 인자 검증, 공통 결과 요약을 추가한다. 기존 4개 명령은 같은 workflow로 연결하는 호환 wrapper로 남긴다. 배포/tracing 목록을 일치시키고 UI 안내를 새 명령으로 변경한다. 이 단계에서는 DB 변경이나 업무 API 변경이 필수는 아니다.

### 2차: 내부 중복 제거

환경·HTTP·프로젝트 검증 공통화, Claude/Codex 기준 문서 정리, 결과 불완전 상태 및 검토 안내 개선, 버전 manifest와 업데이트 충돌 처리를 구현한다. review/sync의 공통 분석 단계를 추출하되 결과 판정과 저장 계약은 분리한다.

### 3차: 실행 연결

구현 완료 시 review, review 완료 시 sync를 다음 행동으로 제안한다. 자동 연쇄 실행은 명시적 옵션으로만 추가한다. 큐 태스크에 UW 정보가 없으면 추측 연결하지 않는다. 이력·재개 기능을 통합하려면 그때 서버 실행 모델 확장을 별도 설계한다.

## 8. 완료 기준

- 기존 8개 사용 형태가 새 명령으로 동일하게 연결된다.
- 잘못된 인자, 상호 배타 옵션 충돌, 프로젝트 불일치 시 변경 요청을 보내지 않는다.
- 구현 태스크를 조회/비구현 명령으로 실행하지 않는다.
- review는 서버 저장/자동 수정하지 않고, sync는 설계를 직접 적용하지 않는다.
- 부분 검토·파싱 실패를 “머지/배포 가능”으로 안내하지 않는다.
- 패키징 테스트에서 배포 manifest의 모든 파일이 산출물에 존재한다.
- 기존 wrapper와 새 명령이 동일 입력에서 같은 workflow를 선택한다.
- 설치 업데이트가 고객 수정 파일을 조용히 덮어쓰지 않는다.

## 9. 주요 근거 파일

- `.claude/commands/{run-ai-tasks,review-uw,sync-specode,onboard-asis}.md`
- `.claude/commands/{task_complete,sync_specode,spec_sync_local}.mjs`
- `.claude/agents/_shared/{report-format,severity-rules}.md`
- `.claude/agents/prd-compliance-reviewer.md`, `.codex/agents/prd-compliance-reviewer.toml`
- `src/lib/mcp/workerCommandFiles.ts`, `src/lib/mcp/register-tools.ts`, `next.config.ts`
- `src/lib/standard-guides/usagePolicy.ts`
- `src/app/api/worker/tasks/route.ts`
- `src/app/(main)/projects/[id]/ai-tasks/page.tsx`
- `src/app/(main)/projects/[id]/standard-guides/page.tsx`
- `src/app/(main)/projects/[id]/spec-reconciliations/page.tsx`
- `src/components/mcp-keys/McpKeyManager.tsx`

애플리케이션 코드·설정 변경 및 외부 데이터 변경은 하지 않았다. 조사 시작 시 존재하던 tasks/functions 페이지의 사용자 변경은 유지했다.
