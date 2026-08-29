# SPECODE 구현-설계 동기화 V2 구현 로그

> 시작일: 2026-08-17
> 목표: CHECK 우선 검증, V2 구현, DEEP_SYNC 별도 검증, V1 완전 제거

## 운영 규칙

- 각 점검 라운드는 발견사항, 수정, 재검증 결과를 남긴다.
- 같은 근본 결함이 3회 반복되면 원인을 기록하고 기능 확장을 멈춘다.
- 계획과 다른 기능이 늘어나면 사용자 목적과 직접 연결되는지 다시 확인한다.
- 테스트 통과만으로 완료하지 않고 PRD·API·DB·UI·명령·삭제 목록을 각각 증명한다.

## 라운드 0 — 구현 전 감사

상태: 계약 검증 완료 · 실제 Claude Code 비교 전

확인한 사실:

1. V1은 provider, baseline, receipt, batch, Diff, source link가 도메인 전체에 결합돼 있다.
2. 기존 `targetRegistry.ts`는 프로젝트 소유권 조회는 하지만 적용 직전 행 잠금과 UW 계층
   검증을 제공하지 않아 V2 동시 승인 코드로 그대로 재사용할 수 없다.
3. 기존 `hashOf()`는 공백을 정규화하므로 exact optimistic concurrency hash로 사용할 수 없다.
4. 공통 Worker 인증, 권한 검사, `tb_ds_design_change`는 V2에서도 그대로 필요하다.
5. Claude CLI는 현재 개발 환경 PATH에서 확인되지 않았다. CHECK Shadow 계약과 fixture를 먼저
   만들 수 있지만 실제 Claude Code 모델 실행 결과의 사람 승인은 별도 증거가 필요하다.

반영한 결정:

- CHECK Shadow 게이트와 DEEP_SYNC 활성화 게이트를 분리한다.
- INFORMATIONAL 항목의 decision API 호출을 409로 차단한다. PENDING 항목은 수정안이 없어도
  거부·보류할 수 있고, APPLY에만 수정안을 필수로 한다.
- V1 정합성 도메인 코드는 직접 재사용하지 않고 공통 인프라만 재사용한다.

구현 및 검증:

- `src/lib/spec-sync/contracts.ts`: 두 축 결과와 모드별 제한 계약
- `src/lib/spec-sync/hash.ts`: exact/canonical hash 분리
- `src/lib/spec-sync/prompts.ts`: 당시 discovery/CHECK/DEEP_SYNC 프롬프트 분리
  (첫 실사용 뒤 중복 context를 없애기 위해 라운드 8에서 삭제)
- `src/lib/spec-sync/resultValidator.ts`: snapshot target 검증과 AS-IS 서버 파생
- `scripts/spec-sync-contract.test.ts`: 계약 테스트 10개
- `npm run test:spec-sync`: 10/10 통과
- SPECODE 제품 내부 UW 5건의 계약 회귀 기대 판정은
  `md/SPEC_SYNC_CHECK_SHADOW_REPORT.md`에 기록

게이트 판정:

- 프로그램 계약 게이트: 통과
- 실제 Claude Code 모델 결과 게이트: 미실행(현재 환경에 Claude CLI 없음)
- DEEP_SYNC 게이트: 코어 구현 뒤 별도 진행

중단 조건:

- 관련 소스 범위를 확정할 수 없는데도 MATCH를 만드는 흐름이 반복됨
- CHECK가 구현 세부사항을 설계 누락으로 대량 노출함
- V1 baseline/receipt 조건이 V2 코드에 다시 유입됨
- 동시 승인 또는 프로젝트/UW 격리 실패가 반복됨

## 라운드 1 — 결과 계약·근거 검증

상태: 통과

발견 및 수정:

1. AI가 snapshot 밖 target을 만들거나 다른 target의 proposal을 붙일 수 있는 경로를 차단했다.
2. 구현 target 전체가 정확히 한 번 판정되지 않으면 제출을 거부한다.
3. 항목과 전체 verdict의 모순, CHECK의 일반 GAP 남발, 빈 proposal을 거부한다.
4. `UNKNOWN`에는 적용 가능한 proposal을 만들 수 없도록 보강했다.
5. evidence는 확정 sourceScope 안의 경로·line·snippet·hash를 요구하고 로컬 검증기가 실제 파일과
   대조한다. credential은 결정적 마스킹 외에는 제출하지 않는다.

재검증: 계약 테스트 15개와 로컬 evidence fixture 통과.

## 라운드 2 — 권한·동시성·적용 안전성

상태: 통과

발견 및 수정:

1. 실행 결과는 실행 요청자만 제출할 수 있게 했고, 멱등 키를 다른 UW/모드에 재사용하지 못하게 했다.
2. `FAILED/NEEDS_INPUT/ANALYZED` 동시 제출이 완료 상태를 되돌리지 못하도록 조건부 상태 전이를
   적용했다.
3. 같은 run의 여러 항목을 동시에 결정해도 마지막 실행 상태가 틀어지지 않도록 run 행을 먼저
   잠근 뒤 item을 잠근다.
4. 화면·영역·기능 적용 때 대상뿐 아니라 UW까지의 부모 계층을 함께 잠그고 프로젝트/UW 소속을
   재검증한다.
5. 검토 권한과 실제 적용 권한을 API와 UI에서 분리하고 `INFORMATIONAL` 결정을 차단했다.
6. exact `before_hash`가 다르면 overwrite나 merge 없이 `DESIGN_CHANGED`와 세 값을 반환한다.

재검증: 타입 검사 통과. DB 경쟁 조건은 라운드 5의 실제 DB smoke test로 확인했다.

## 라운드 3 — V1 잔재·구조·UI

상태: 통과

발견 및 수정:

1. provider, webhook, baseline, receipt, batch, Diff, source link 코드·API·MCP·명령을 제거했다.
2. V1 전용 컴포넌트와 CSS를 제거하고 상세 route parameter도 `receiptId`에서 `runId`로 바꿨다.
3. 681줄 서비스와 503줄 상세 화면을 책임별 파일로 분리했다. 새 핵심 소스는 모두 300줄 이하다.
4. 화면은 두 판정 축, redacted snippet, 분석 당시/현재/제안 값과 항목별 결정을 표시한다.
5. CHECK/DEEP_SYNC 프롬프트와 `/sync-specode UW-XXXXX [--deep]` 흐름을 분리했다.

재검증: V1 런타임 참조 0건, obsolete CSS 참조 0건, typecheck와 production build 통과.

## 라운드 4 — DB·운영 게이트

상태: 통과

발견 및 수정:

1. V1 테이블 6개와 V1 AI task는 모두 0건임을 읽기 전용으로 확인했다.
2. 최초 점검에서 놓쳤던 V1 전용 설정을 찾았다. 프로젝트 설정 27건과 시스템 template 3건이며,
   전환 SQL과 사후 점검에 제거 조건을 추가했다.
3. V2 DDL의 결과 축·상태·target shape·decision state 제약을 구현 계약과 맞췄다.
4. 당시에는 실제 Claude Code Shadow 승인 전 실행을 막는 별도 게이트를 두었지만, 이후 제거했다.
   현재는 기능 flag 없이 배포·명령 재설치·운영 검증 절차로 통제한다.

검증 결과:

- `npm run typecheck`: 통과
- `npm run test:spec-sync`: 계약·게이트·영속 변환·DDL 정적 테스트 25/25 및 local validator 통과
- `npx dotenv -e .env.local -- prisma validate --schema prisma/schema.prisma`: 통과
- `npm run build`: Next.js 16 production build 통과
- `git diff --check`: 오류 없음

## 라운드 5 — 실제 DB 전환·최종 검증

상태: 통과

적용 및 검증:

1. 사용자 승인 뒤 `2026-08-17_create_spec_sync_v2.sql`을 단일 transaction으로 적용했다.
2. 비어 있던 V1 테이블 6개, V1 프로젝트 설정 27건, 시스템 template 3건을 제거했다.
3. `tb_sp_sync_run`, `tb_sp_sync_item` 생성과 V1 잔존 데이터 0건을 사후 점검했다.
4. 정상 run/item 저장, 잘못된 결과 축·target field·proposal result·decision state 차단을
   실제 DB에서 검증하고, 의도적 rollback 뒤 smoke 데이터가 남지 않음을 확인했다.
5. 계약 테스트 25/25, local validator, typecheck, Next.js production build를 다시 통과했다.

운영 활성화 게이트:

1. 실제 Claude Code CHECK 5~10건을 사람이 승인한 뒤 기본 flag를 켠다.
2. DEEP_SYNC는 별도 3~5건 승인 전까지 계속 OFF다.

## 라운드 6 — 정적 재검토 피드백

상태: 통과

1. 정의되지 않은 `sp-card*` 사용을 디자인 시스템의 `sp-group*` 셸로 교체했다.
2. 항상 로드되는 단위업무 목록의 V1 화면명과 폐기된 배치·병합 설명을 V2 용어로 고쳤다.
3. 실제 구현된 Web 결과 제출 API를 UW-00036 PRD의 API 목록에 추가했다.

## 라운드 7 — Prisma push 드리프트 복구

상태: 통과

1. 기존 컬럼매핑과 V2 모델의 PK 이름·기본값·timestamp 정밀도를 실제 DB 계약과 맞췄다.
2. 실패한 push 뒤 사라진 컬럼매핑 FK 1개와 V2 FK 4개를 고아 데이터 0건 확인 후 복구했다.
3. 격리된 임시 PostgreSQL schema에 전체 `prisma db push`를 실행하고 diff 0을 확인한 뒤 삭제했다.
4. 운영 DB에서도 `npm run db:push`가 변경 없이 정상 종료되고 Prisma diff가 0임을 확인했다.
5. DB 점검 스크립트에 FK 5개 검사를 추가해 같은 부분 적용 실패를 재발 시 탐지하도록 했다.

## 라운드 8 — 첫 실사용 비용·가독성 개선

상태: 통과

첫 `UW-00011` 실행에서 확인한 사실:

1. start 응답이 같은 설계 snapshot을 세 필드에 반복해 context를 불필요하게 키웠다.
2. 정상 `MATCH`까지 31개 상세 항목과 코드 snippet으로 제출해 token·저장량·검토 화면을 키웠다.
3. 분석 중 소스가 바뀌어 파일 재독이 반복됐지만 한 실행의 소스 상태를 고정하는 검사가 없었다.
4. 최종 JSON을 MCP 인자로 다시 전달해 이미 읽은 snippet을 한 번 더 context에 싣고 있었다.

수정:

1. start 응답은 snapshot 한 벌만 반환하고 helper가 manifest·탐색 정보·5~10개 target 묶음으로
   분리한다. 서버와 명령에 중복된 분석 프롬프트도 제거했다.
2. 모든 설계 target은 `evaluatedTargets`로 점검 완료를 증명하되, 상세 `issues`와 DB item은
   불일치·미구현·판단 불가·설계 누락 후보만 생성한다.
3. 관련 파일은 분석 시작 시 SHA-256을 고정하고 제출 직전 다시 계산한다. 바뀐 파일이 있으면
   제출을 막고 해당 판정을 다시 확인한다.
4. AI는 evidence의 path·line만 작성하고 helper가 원문 snippet·redaction·hash를 생성한다.
   helper가 결과 파일을 Worker API로 직접 제출한다.
5. 실행 전에 Worker key의 프로젝트명·ID, UW, 모드를 사용자에게 확인한다.
6. 목록·상세 화면은 `점검 대상 / 정상 / 문제` 수와 문제 카드만 표시하고, 전환 전 정상·정보
   item도 상세 응답에서 숨긴다.

운영 검증 기준:

- 실제 고객 사례는 현재 확인된 `운영시스템 구축(2차) / UW-00011 일정관리`를 사용한다.
- 나머지는 격리된 테스트 복제본에 통제된 변형을 만들어 확인한다. 내부 SPECODE UW 5건의
  기대 답안은 계약 회귀 fixture이지 고객 실사용 5건으로 계산하지 않는다.
- 최초 실행의 약 40만~45만 token과 start/final payload를 기준으로 개선 수치를 기록하고,
  사람이 품질과 비용을 승인한 뒤 운영 사용 범위를 넓힌다.

재검증:

- `npm run test:spec-sync`: 계약·helper·전환 테스트 27/27 및 최종 파일 검증 통과
- `npm run typecheck`: 통과
- `npm run build`: Next.js 16 production build 통과
- `npm run test:spec-sync:db`: V2 구조 점검과 rollback smoke test 통과
- 기존 첫 실행 31개 item은 `MATCH 28 / MISMATCH 3`으로 확인했고, 새 조회 계약에서는
  구현 정상 28건은 수치만, 문제 3건만 상세 표시된다.
