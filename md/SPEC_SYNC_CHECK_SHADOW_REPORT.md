# CHECK Shadow 기준 답안

> 작성일: 2026-08-17
> 상태: V2 구현 전 실제 저장소 5개 UW의 사람 검토용 기준 답안 작성 완료 · Claude Code 실행 비교 전
> 주의: 아래 UW-00036 판정은 V1 철거 전 시점의 기준값이며 현재 구현 상태를 뜻하지 않는다.

이 문서는 모델 결과를 정답으로 만드는 문서가 아니다. 먼저 설계와 실제 소스를 직접 읽어
찾은 기대 판정을 고정하고, 이후 Claude Code의 CHECK 결과가 이를 놓치거나 과장하는지 비교한다.

## UW-00001 이메일 회원가입

- 소스 범위:
  - `src/app/(auth)/auth/register/page.tsx`
  - `src/app/api/auth/register/route.ts`
  - `src/app/api/auth/email/check/route.ts`
  - `src/app/api/auth/email/resend/route.ts`
  - `src/app/api/auth/verify/route.ts`
- 구현 정합성 기대: 핵심 가입·검증·메일 인증 흐름은 `MATCH`.
- 중요 설계 누락 후보:
  - 가입 API의 IP 기준 시간당 5회 rate limit
    (`src/app/api/auth/register/route.ts:28-57`)
  - 이메일 local-part를 회원명으로 자동 저장
    (`src/app/api/auth/register/route.ts:87-96`)
- 기대 요약: `implementation=PASS`와 `designCoverage=GAP_CANDIDATE`가 동시에 가능해야 한다.

## UW-00014 과업 CRUD

- 소스 범위:
  - `src/app/api/projects/[id]/tasks/route.ts`
  - `src/app/api/projects/[id]/tasks/[taskId]/route.ts`
  - `src/app/api/projects/[id]/tasks/[taskId]/copy/route.ts`
  - `src/app/api/projects/[id]/tasks/sort/route.ts`
  - `src/app/(main)/projects/[id]/tasks/**`
- 구현 정합성 기대: 과업 복사는 `MISMATCH`.
- 근거:
  - 설계는 요구사항·사용자 스토리·인수기준 전체 복사를 요구한다.
  - 구현은 사용자 스토리의 `story_nm/persona_cn/scenario_cn/sort_ordr`와 인수기준의
    `given_cn/when_cn/then_cn/sort_ordr`를 복사하지 않는다.
  - 구현 근거는 `copy/route.ts:108-127`, 실제 필드는 `prisma/schema.prisma:907-937`이다.
- 기대 요약: 존재하는 API만 보고 MATCH로 판정하면 실패다.

## UW-00020 화면 CRUD

- 소스 범위:
  - `src/app/api/projects/[id]/screens/route.ts`
  - `src/app/api/projects/[id]/screens/[screenId]/route.ts`
  - `src/app/api/projects/[id]/screens/sort/route.ts`
  - `src/app/(main)/projects/[id]/screens/**`
- 구현 정합성 기대: 화면 삭제의 두 방식과 변경 이력은 `MATCH`.
- 근거:
  - 하위 삭제는 `screens/[screenId]/route.ts:335-357`.
  - 화면만 삭제하고 영역을 미분류로 유지하는 흐름은 같은 파일 `359-381`.
- 기대 요약: 실제 구현 근거가 있는 정상 항목을 억지 누락으로 만들지 않아야 한다.

## UW-00023 AI 태스크 관리

- 소스 범위:
  - `src/app/api/projects/[id]/ai-tasks/**`
  - `src/app/api/worker/tasks/**`
  - `src/app/(main)/projects/[id]/ai-tasks/page.tsx`
- 구현 정합성 기대: 재요청 초기 상태와 retry count는 `MISMATCH`.
- 근거:
  - 설계는 새 태스크 `retry_cnt=3`, `IN_PROGRESS` 시작으로 적혀 있다.
  - 구현은 기존 값에 1을 더하고 `PENDING`으로 생성한다
    (`ai-tasks/[taskId]/retry/route.ts:86-88`).
- 기대 요약: 설계와 소스가 다르다는 사실을 찾되 어느 쪽이 옳은지는 사람에게 맡겨야 한다.

## UW-00036 구현 변경 스펙 정합성 관리

- 소스 범위:
  - `src/lib/spec-reconciliation/**`
  - `src/app/api/**/spec-reconciliations/**`
  - `src/app/(main)/projects/[id]/spec-reconciliations/**`
  - `.claude/commands/sync-specode.md`
- 구현 정합성 기대: 현재 V1은 새 PRD에 대해 다수 `MISMATCH/NOT_IMPLEMENTED`.
- 대표 근거:
  - 현재 목록 화면은 `SourceBaselinePanel`과 `STALE_BASELINE`을 사용한다
    (`spec-reconciliations/page.tsx:14,35,43,86`).
  - 새 설계는 CHECK/DEEP_SYNC 두 축과 baseline 제거를 요구한다.
- 기대 요약: 파일이 많이 존재한다는 이유로 새 설계가 구현됐다고 판단하면 실패다.

## CHECK 통과 판정

Claude Code 실행 결과가 다음을 모두 만족해야 CHECK 모델 게이트를 통과한다.

1. UW-00014와 UW-00023의 명확한 MISMATCH를 놓치지 않는다.
2. UW-00001에서 구현 PASS와 중요 설계 누락 후보를 분리한다.
3. UW-00020의 확인된 정상 흐름을 근거 없이 실패 처리하지 않는다.
4. UW-00036의 V1 존재를 새 V2 구현 완료로 오판하지 않는다.
5. 모든 인용 path·line·snippet이 실제 파일과 일치한다.
