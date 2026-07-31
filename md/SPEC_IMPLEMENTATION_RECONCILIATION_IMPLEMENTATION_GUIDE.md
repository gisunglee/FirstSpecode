# SPECODE 구현 변경 정합성 — 구현·운영 안내서

> 작성일: 2026-07-31  
> 구현 단위업무: UW-00036  
> 상태: 전체 구현 및 로컬 검증 완료

---

## 1. 이 문서의 목적

이 문서는 설계안이 아니라 **현재 구현된 기능의 인수인계 문서**다.

다음 내용을 빠르게 확인하기 위해 사용한다.

- 무엇을 구현했는가
- 개발자는 어떤 명령을 사용하는가
- SPECODE에서는 어떤 순서로 검토하고 반영하는가
- source baseline과 receipt가 어떻게 움직이는가
- 관련 소스가 어디에 있는가
- 배포·운영 전에 무엇을 확인해야 하는가

상세 설계 근거는 다음 문서를 본다.

- `md/SPEC_IMPLEMENTATION_RECONCILIATION_PLAN.md`
- `md/SPEC_IMPLEMENTATION_RECONCILIATION_SUMMARY.md`
- `md/prd/UW-00036_구현 변경 스펙 정합성 관리.md`

---

## 2. 구현 결과 한 줄 요약

```text
소스 변경을 증거와 함께 receipt로 제출한다.
→ SPECODE가 영향받은 설계 후보를 보여준다.
→ 사람이 항목별 조치를 결정한다.
→ 승인된 내용만 스펙에 반영한다.
→ 모든 조치가 끝나면 source baseline을 다음 변경 기준점으로 전진한다.
```

소스 변경이 스펙을 자동으로 덮어쓰지는 않는다.

AI는 다음 세 가지를 분리해서 제시한다.

1. 확인된 소스 사실
2. 스펙에 미칠 것으로 추론한 영향
3. 스펙 변경 제안

사람이 최종 조치를 선택한 후에만 스펙 또는 정합성 상태가 변경된다.

---

## 3. 현재 지원하는 변경 유형

### 3.1 유형 A — 최초 구현 중 스펙과 다르게 구현됨

기존 구현요청 작업 흐름 안에서 처리한다.

```text
/run-ai-tasks IMP 실행
→ 구현요청 당시 스펙 snapshot 확인
→ 작업 전 source snapshot 생성
→ Claude Code가 소스 구현
→ 작업 후 source snapshot 생성
→ 실제 Diff와 최초 스펙 비교
→ implementation receipt 제출
→ SPECODE 웹 검토함에서 사용자 판단
```

핵심은 **최초에 전달한 설계**와 **실제로 끝난 구현**의 차이를 제출하는 것이다.

구현이 설계와 완전히 같으면 별도 스펙 변경 후보를 만들 필요가 없다.

구현이 설계보다 구체화되었거나 설계와 달라졌으면 해당 부분만 proposal로 제출한다.

### 3.2 유형 B — 구현 완료 후 개발자가 다시 수정함

별도 동기화 명령으로 처리한다.

```text
/sync-specode UW-XXXXX 실행
→ UW와 하위 화면·영역·기능 컨텍스트 조회
→ 마지막 source baseline 확인
→ baseline 이후 변경 소스 수집
→ 변경과 현재 스펙 비교
→ maintenance receipt 제출
→ SPECODE 웹 검토함에서 사용자 판단
```

핵심은 **과거 전체 소스**가 아니라 **마지막 정합성 확정점 이후 변경**만 비교하는 것이다.

### 3.3 자동 수집 — GitHub/GitLab PR·MR

저장소 연결과 webhook을 설정하면 다음 흐름으로 처리한다.

```text
PR/MR webhook 수신
→ webhook 서명 검증
→ provider API에서 Diff 재조회
→ provider 검증 receipt 생성
→ AI 분석 작업 등록
→ SPECODE 웹 검토함에 표시
```

클라이언트가 보낸 Diff를 그대로 신뢰하지 않고 provider에서 다시 조회한다.

---

## 4. Git commit 유무에 따른 처리

### 4.1 commit이 있는 Git 변경

- checkpoint 유형: `GIT_COMMIT`
- base: 현재 source baseline commit
- head: 변경 완료 commit
- base가 head의 조상인지 검증한다.
- receipt가 닫히면 baseline commit을 head로 전진한다.

### 4.2 commit하지 않은 Git 작업

- checkpoint: `WORKTREE:{manifestHash}`
- receipt 상태: `DRAFT`
- Diff와 스펙 변경 후보는 확인할 수 있다.
- 불안정한 작업 트리이므로 baseline은 전진하지 않는다.
- commit 후 같은 제출 키로 최종 제출하면 DRAFT를 확정 제출로 전환한다.

즉, commit하지 않아도 차이는 찾을 수 있지만 **정합성 기준점 확정은 commit 후** 수행한다.

### 4.3 비-Git 프로젝트

- checkpoint 유형: `SOURCE_MANIFEST`
- 파일 경로, SHA-256, 실제 변경 내용을 content-addressed gzip snapshot으로 저장한다.
- 이전 manifest와 현재 manifest를 비교해 변경 파일과 내용을 찾는다.
- receipt가 닫히면 manifest hash를 다음 baseline으로 저장한다.

---

## 5. 전체 처리 프로세스

```mermaid
flowchart TD
    A[소스 변경] --> B{변경 입구}
    B -->|최초 구현| C[/run-ai-tasks IMP]
    B -->|후속 수정| D[/sync-specode UW-XXXXX]
    B -->|PR/MR| E[GitHub/GitLab webhook]

    C --> F[변경 증거와 proposal 생성]
    D --> F
    E --> G[Provider에서 Diff 재검증]
    G --> F

    F --> H[Receipt 생성]
    H --> I[AI 분석 또는 제출 결과 저장]
    I --> J[SPECODE 스펙 정합성 검토함]
    J --> K{항목별 사용자 결정}

    K -->|스펙 반영| L[Hash 검증 후 스펙 적용]
    K -->|소스 수정| M[보완 소스 증거 제출]
    K -->|영향 없음| N[스펙 변경 없이 해결]
    K -->|예외 수용| O[근거와 만료일 기록]
    K -->|모델 보완| P[설계 변경 과제로 연결]
    K -->|보류| Q[Receipt 미해결 유지]

    L --> R{모든 항목 해결?}
    M --> R
    N --> R
    O --> R
    P --> R

    R -->|아니오| J
    R -->|예| S[최종 증거 검증]
    S --> T[Receipt CLOSED]
    T --> U[Source baseline 전진]
```

---

## 6. 웹에서 사용자가 하는 일

### 6.1 목록

경로:

```text
/projects/{projectId}/spec-reconciliations
```

목록에서 다음을 확인한다.

- 변경 유형: 최초 구현 또는 후속 수정
- 저장소와 브랜치
- base/head checkpoint
- 증거 신뢰등급
- AI 분석 상태
- 위험도별 항목 수
- 미해결 항목 수

### 6.2 상세

경로:

```text
/projects/{projectId}/spec-reconciliations/{receiptId}
```

상세에서 다음을 처리한다.

- source evidence 확인
- 변경 Diff 확인
- 사용자가 지정한 영향 대상과 AI가 보완한 후보 구분
- 확인된 사실·추론·제안 확인
- 현재 스펙과 제안 스펙 비교
- 3-way merge 가능 여부 확인
- 항목별 결정
- 제한적 일괄 적용
- 최종 검증 및 receipt 종료
- 적용된 스펙 rollback

### 6.3 사용자가 선택하는 결정

| 결정 | 처리 결과 |
|:---|:---|
| `APPLY_SPEC` | 허용된 스펙 필드에 제안을 적용한다. |
| `FIX_SOURCE` | 스펙은 유지하고 소스 보완 완료 증거를 기다린다. |
| `NO_SPEC_CHANGE` | 스펙 영향이 없는 변경으로 확정한다. |
| `ACCEPT_EXCEPTION` | 예외 사유와 만료일을 기록하고 현재 차이를 수용한다. |
| `MODEL_GAP` | 현재 설계 구조로 표현할 수 없는 변경으로 기록한다. |
| `DEFERRED` | 판단을 보류하고 receipt를 열린 상태로 유지한다. |

`FIX_SOURCE`는 선택만 했다고 끝나지 않는다.

수정된 소스 사실과 해결 근거를 다시 제출하고 사용자가 확인해야 해결된다.

---

## 7. 스펙 자동 적용 범위

자동 적용은 다음 네 설명 필드로 제한했다.

| 설계 계층 | 적용 필드 |
|:---|:---|
| 단위업무 | `unit_work_dc` |
| 화면 | `scrn_dc` |
| 영역 | `area_dc` |
| 기능 | `func_dc` |

ID, 권한, 테이블 구조, API 계약처럼 영향 범위가 큰 구조 변경은 자동 치환하지 않는다.

적용 시 다음 순서로 처리한다.

```text
receipt 생성 당시 before_hash 확인
→ 현재 스펙 hash 확인
→ 동일하면 proposed_value 적용
→ 현재 스펙도 별도로 변경됐으면 3-way merge 가능성 계산
→ 자동 병합이 안전하지 않으면 STALE_SPEC
→ 적용과 설계 변경 이력을 한 DB transaction으로 저장
```

따라서 단순한 텍스트 100% 검색·치환 방식이 아니다.

대상 테이블, 대상 ID, 허용 필드, 변경 전 hash를 모두 검증한 뒤 적용한다.

---

## 8. Receipt와 baseline 규칙

### 8.1 Receipt

receipt는 한 번의 구현 변경 패키지다.

다음을 묶어서 저장한다.

- 변경 유형
- 저장소·브랜치
- base/head checkpoint
- source evidence
- 증거 신뢰등급과 검증 결과
- 사용자가 지정한 설계 범위
- AI 분석 결과
- 항목별 결정과 적용 결과

### 8.2 Source baseline

source baseline은 프로젝트·저장소·브랜치별 마지막 정합성 확정점이다.

```text
(project, repository, branch) → last reconciled checkpoint
```

receipt별 값을 기준점처럼 사용하지 않는다.

### 8.3 Baseline 전진 조건

다음 조건이 모두 충족되어야 한다.

- receipt의 AI 분석이 완료됨
- 모든 중요 항목이 실제로 해결됨
- 증거 검증이 통과했거나 권한자가 override함
- DRAFT가 아님
- receipt가 시작한 baseline version이 아직 최신임

전진은 낙관적 잠금을 사용한다.

같은 baseline에서 두 receipt가 동시에 시작되면 먼저 닫힌 receipt만 전진한다.
뒤 receipt는 `STALE_SOURCE_BASELINE`으로 중단하고 최신 기준으로 다시 분석한다.

---

## 9. 증거 신뢰등급

| 등급 | 의미 |
|:---|:---|
| `PROVIDER_VERIFIED` | SPECODE 서버가 GitHub/GitLab에서 직접 다시 조회한 증거 |
| `LOCAL_AGENT_ATTESTED` | 로컬 명령이 생성하고 제출한 증거 |
| `USER_UPLOADED` | 사용자가 직접 업로드한 증거 |

신뢰등급은 자동으로 상향할 수 없다.

사용자가 provider 검증 증거라고 주장해도 서버가 provider에서 확인하지 않았으면
`PROVIDER_VERIFIED`로 저장하지 않는다.

로컬 snapshot은 다음을 적용한다.

- 환경 파일과 일반적인 secret 파일 제외
- token·secret 패턴 redaction
- tracked 파일과 untracked 파일 포함
- 파일 수와 evidence 크기 제한
- Diff hash 생성

---

## 10. DB 구성

### 핵심 테이블

| Prisma 모델 | 역할 |
|:---|:---|
| `TbSpSourceRepository` | GitHub/GitLab 저장소 연결과 암호화 credential |
| `TbSpSourceBaseline` | 저장소·브랜치별 마지막 정합성 확정점 |
| `TbSpImplReceipt` | 한 번의 변경 패키지와 전체 검토 상태 |
| `TbSpReconcileItem` | 설계 대상별 사실·추론·제안·결정 |
| `TbSpSpecSourceLink` | 확정된 설계와 파일·심볼의 연결지도 |

기존 `TbSpImplSnapshot`은 유형 A에서 구현요청 당시 스펙을 확인하는 데 재사용한다.

### DDL

```text
prisma/sql/2026-07-31_create_spec_reconciliation.sql
prisma/sql/2026-07-31_expand_spec_reconciliation.sql
```

현재 실행 명령:

```bash
npm run db:migrate:spec-reconciliation
```

### 프로젝트 기본 정책

| 설정 키 | 기본값 | 용도 |
|:---|:---|:---|
| `SPEC_RECONCILE_GATE_POLICY` | `WARN` | 미해결 변경이 있을 때 경고 또는 차단 |
| `SPEC_RECONCILE_DIFF_RETENTION_DAYS` | `90` | 원본 patch/content 보관기간 |
| `SPEC_RECONCILE_BLOCK_RISKS` | `HIGH,CRITICAL` | gate에서 차단할 위험도 |

보관기간이 지난 CLOSED receipt는 dry-run으로 대상을 먼저 확인하고 `ConfirmDialog`에서
복구 불가능한 정리를 다시 승인한 후 receipt·item·batch JSON의 원본 patch/content만 정리한다.
미리보기 token과 실제 정리 시점의 대상이 다르면 삭제하지 않고 재미리보기를 요구한다.

경로, hash, checkpoint, 판단과 적용 이력은 유지한다.

---

## 11. API 구성

### 제출과 기준점

```text
/api/projects/{id}/source-baselines
/api/projects/{id}/source-baselines/{baselineId}/initialize
/api/projects/{id}/source-repositories
/api/projects/{id}/impl-receipts
/api/projects/{id}/impl-receipts/provider
/api/projects/{id}/impl-receipts/{receiptId}/analyze
```

### 검토와 적용

```text
/api/projects/{id}/spec-reconciliations
/api/projects/{id}/spec-reconciliations/{receiptId}
/api/projects/{id}/spec-reconciliations/{receiptId}/items/{itemId}/decision
/api/projects/{id}/spec-reconciliations/{receiptId}/items/{itemId}/apply
/api/projects/{id}/spec-reconciliations/{receiptId}/items/{itemId}/reanalyze
/api/projects/{id}/spec-reconciliations/{receiptId}/items/{itemId}/confirm-resolution
/api/projects/{id}/spec-reconciliations/{receiptId}/items/{itemId}/rollback
/api/projects/{id}/spec-reconciliations/{receiptId}/apply
/api/projects/{id}/spec-reconciliations/{receiptId}/verify
```

### 운영

```text
/api/projects/{id}/spec-reconciliations/gate
/api/projects/{id}/spec-reconciliations/unresolved-target
/api/projects/{id}/spec-reconciliations/prune-evidence
/api/integrations/source-repositories/{provider}/webhook
```

### Worker 전용

```text
/api/worker/tasks/{taskId}/implementation-receipt
/api/worker/spec-reconciliations/baseline
/api/worker/spec-reconciliations/context
/api/worker/spec-reconciliations/maintenance
```

---

## 12. MCP 도구

HTTP MCP에 다음 도구를 추가했다.

```text
get_source_baselines
get_reconciliation_context
submit_implementation_receipt
submit_maintenance_change
submit_provider_verified_change
list_spec_reconciliations
get_spec_reconciliation
queue_reconciliation_analysis
confirm_reconciliation_resolution
check_reconciliation_gate
```

MCP는 수집·제출·조회·재분석·소스 해결 확인·gate 확인을 담당한다.

스펙 적용, rollback, 증거 삭제는 사람의 명시적인 웹 액션으로 제한했다.

---

## 13. 로컬 명령 구성

| 파일 | 역할 |
|:---|:---|
| `.claude/commands/run-ai-tasks.md` | 유형 A 구현 작업과 receipt 제출 절차 |
| `.claude/commands/sync-specode.md` | 유형 B 동기화 명령 정의 |
| `.claude/commands/source_snapshot.mjs` | Git/비-Git source snapshot과 Diff 생성 |
| `.claude/commands/prepare_specode_sync.mjs` | baseline과 변경 증거 준비 |
| `.claude/commands/submit_implementation_receipt.mjs` | 유형 A receipt 제출 |
| `.claude/commands/submit_maintenance_receipt.mjs` | 유형 B receipt 제출 |

개발자가 사용하는 대표 요청은 다음 두 개다.

```text
/run-ai-tasks IMP
/sync-specode UW-XXXXX
```

---

## 14. 핵심 서버 소스

### 공통 도메인

```text
src/lib/spec-reconciliation/contracts.ts
src/lib/spec-reconciliation/targetRegistry.ts
src/lib/spec-reconciliation/createReceipt.ts
src/lib/spec-reconciliation/context.ts
src/lib/spec-reconciliation/analysisPrompt.ts
src/lib/spec-reconciliation/applyAnalysisResult.ts
src/lib/spec-reconciliation/applySpecItem.ts
src/lib/spec-reconciliation/threeWayMerge.ts
src/lib/spec-reconciliation/closeReceipt.ts
src/lib/spec-reconciliation/sourceLinks.ts
src/lib/spec-reconciliation/sourceProvider.ts
```

역할:

- 공개 입력 계약과 허용 코드 통일
- 네 계층 허용 필드 제한
- receipt 생성과 baseline 검증
- AI 분석 컨텍스트 구성
- 스펙 hash 검증과 적용
- 3-way merge
- receipt 종료와 baseline 원자적 전진
- 설계·소스 연결지도 축적
- GitHub/GitLab provider 재검증

### 웹 화면

```text
src/app/(main)/projects/[id]/spec-reconciliations/page.tsx
src/app/(main)/projects/[id]/spec-reconciliations/[receiptId]/page.tsx
src/app/(main)/projects/[id]/spec-reconciliations/_components/
src/components/spec-reconciliation/UnresolvedSpecBadge.tsx
```

### 상세 화면 배지 연결

```text
src/app/(main)/projects/[id]/unit-works/[unitWorkId]/page.tsx
src/app/(main)/projects/[id]/screens/[screenId]/page.tsx
src/app/(main)/projects/[id]/areas/[areaId]/page.tsx
src/app/(main)/projects/[id]/functions/[functionId]/page.tsx
```

### MCP·권한·메뉴

```text
src/lib/mcp/register-tools.ts
src/lib/mcp/workerCommandFiles.ts
src/lib/permissions.ts
src/lib/permissions.md
src/components/layout/LNB.tsx
```

### DB

```text
prisma/schema.prisma
prisma/sql/2026-07-31_create_spec_reconciliation.sql
prisma/sql/2026-07-31_expand_spec_reconciliation.sql
.claude/database/a.TableScript.md
```

### UI 스타일

```text
.claude/design/components.css
src/styles/components.css
```

---

## 15. 권한

| 작업 | 권한 |
|:---|:---|
| 조회 | VIEWER 이상 |
| 변경 제출 | MEMBER 이상 |
| 일반 검토 | 담당자 또는 PM·PL·OWNER·ADMIN |
| 스펙 적용 | PM·PL·OWNER·ADMIN |
| 증거 override·보관 정리 | OWNER·ADMIN |
| Provider 연결 | OWNER·ADMIN |

실제 권한 키:

```text
specReconcile.read
specReconcile.submit
specReconcile.review
specReconcile.apply
specReconcile.override
specReconcile.connectProvider
```

---

## 16. 충돌·실패 처리

### 스펙이 검토 중 변경됨

`before_hash`와 현재 스펙이 다르면 바로 덮어쓰지 않는다.

- 서로 다른 줄의 변경이면 3-way merge 후보를 보여준다.
- 같은 부분이 충돌하면 `STALE_SPEC`으로 차단한다.
- 최신 스펙 기준으로 재분석한다.

### Source baseline이 먼저 전진함

동시에 시작한 다른 receipt가 먼저 닫혔으면 현재 receipt를 닫지 않는다.

- `STALE_SOURCE_BASELINE`
- 최신 baseline부터 다시 Diff를 만든다.

### Force-push 또는 잘못된 commit 계보

base가 head의 조상이 아니면 provider 제출을 거부한다.

### AI 분석 실패

- receipt를 `ANALYSIS_FAILED`로 표시한다.
- 실패 상태에서는 최종 확정을 차단한다.
- 재분석을 요청할 수 있다.

### 적용 취소

닫힌 receipt를 다시 열지 않는다.

- 적용 당시 값이 그대로인지 확인한다.
- 역변경 설계 이력을 만든다.
- 원래 불일치를 다시 노출하는 자식 receipt를 생성한다.

---

## 17. 검증 결과와 재실행 명령

구현 완료 시 다음 검증을 통과했다.

- Prisma 스키마 검증
- 정합성 DDL 실행
- 실제 DB transaction rollback 시나리오
- source baseline 낙관적 잠금 시나리오
- 3-way merge 단위 테스트
- Git/비-Git source snapshot과 secret redaction 테스트
- TypeScript 타입체크
- Next.js production build
- `git diff --check`

재실행:

```bash
npm run db:migrate:spec-reconciliation
npm run test:spec-reconciliation
npm run test:spec-reconciliation:db
npm run typecheck
npm run build
```

테스트 소스:

```text
scripts/spec-reconciliation-domain.test.ts
scripts/spec-reconciliation-batch.test.ts
scripts/test-source-snapshot.mjs
scripts/test-spec-reconciliation-db.mjs
tsconfig.spec-reconciliation-tests.json
```

---

## 18. 배포·운영 전 확인

### 필수

1. 운영 DB에 정합성 DDL을 실행한다.
2. Prisma Client가 현재 schema 기준으로 생성됐는지 확인한다.
3. `API_KEY_SECRET`을 운영용 값으로 설정한다.
4. AI worker가 CUSTOM 정합성 분석 task를 처리할 수 있는지 확인한다.
5. 프로젝트별 gate·보관 정책을 확인한다.

### GitHub/GitLab을 사용할 때

1. OWNER 또는 ADMIN이 저장소를 연결한다.
2. 최소 조회 권한 token을 입력한다.
3. webhook secret을 16자 이상으로 설정한다.
4. provider webhook URL을 등록한다.
5. 실제 PR/MR 한 건으로 서명 검증과 Diff 재조회를 smoke test한다.

외부 provider의 실제 호출은 계정과 token이 필요하므로 로컬 자동 테스트 범위에는
포함하지 않았다.

---

## 19. 현재 운영 방식 요약

```text
개발자는 변경을 제출한다.
SPECODE는 변경을 receipt로 보관한다.
AI는 사실·추론·제안을 분리한다.
사람은 항목별 조치를 결정한다.
승인된 설명 필드만 안전하게 적용한다.
모든 조치가 끝난 receipt만 닫는다.
닫을 때 source baseline을 다음 기준점으로 전진한다.
다음 동기화는 그 기준점 이후 변경만 다시 본다.
```

이 방식으로 최초 구현 편차와 후속 개발자 수정이 같은 검토함에 도착하지만,
각각의 비교 기준과 수집 경로는 섞이지 않는다.

---

## 20. 자동 비교 배치 구현

### 실행 구조

receipt는 변경 묶음과 baseline 경쟁 단위다. 배치는 AI 컨텍스트 단위다. 따라서 큰 UW도
receipt를 여러 개 만들지 않는다.

1. 제출자는 전체 `sourceEvidence.files[].patch`와 `analysisScope`를 보낸다.
2. `batchPlanner`가 구현요청 snapshot 또는 현재 4계층 설계를 읽는다.
3. 확정된 source link가 있으면 먼저 scope를 정한다.
4. 연결되지 않은 파일이 여러 scope 후보를 가지면 router 태스크를 하나 만든다.
5. router 결과를 검증한 뒤 제한된 분석 배치와 AI 태스크를 만든다.
6. Worker 완료 API가 각 결과의 대상, before 원문, hash를 다시 검증한다.
7. 마지막 배치가 끝나면 receipt 행을 잠그고 결과를 한 번 병합한다.

### 품질 예산

| 항목 | 배치 상한 |
|:-----|----------:|
| 파일 | 30개 |
| 파일 patch segment | 60,000자 |
| Diff 합계 | 80,000자 |
| 설계 대상 | 100개 |
| 설계 원문 합계 | 120,000자 |
| receipt 변경 경로 | 5,000개 |

초과분은 다음 배치로 넘긴다. 경로를 찾지 못한 파일은 `UNMAPPED`, 공통 파일은 `SHARED`로
남는다. 프로젝트 단위 분석이 500 UW를 넘으면 조용히 자르지 않고 UW ID 입력을 요구한다.

### 상태와 복구

```text
PENDING → ANALYZING → COMPLETED
                    ↘ FAILED → 재시도 → PENDING
```

- receipt: `ANALYZING` → `NEEDS_REVIEW`
- 일부 실패: `ANALYSIS_PARTIAL_FAILED`
- 배치 제안 충돌: `BATCH_CONFLICT`
- 실패 배치만 새 AI task를 연결해 재시도한다.
- 전체 재계획은 이전 배치를 `SUPERSEDED`로 보존하고 새 run key로 실행한다.
- 마지막 배치 동시 완료는 receipt `FOR UPDATE`로 직렬화한다.
- 병합 충돌도 사람 선택 전에는 일반 결정을 막는다.

### 관련 소스

```text
src/lib/spec-reconciliation/batchContracts.ts
src/lib/spec-reconciliation/batchPartitioner.ts
src/lib/spec-reconciliation/batchPlanner.ts
src/lib/spec-reconciliation/batchResults.ts
src/app/api/projects/[id]/impl-receipts/[receiptId]/analyze/route.ts
src/app/api/projects/[id]/spec-reconciliations/[receiptId]/batches/[batchId]/retry/route.ts
src/app/api/projects/[id]/spec-reconciliations/[receiptId]/items/[itemId]/resolve-batch-conflict/route.ts
src/app/(main)/projects/[id]/spec-reconciliations/_components/BatchProgressPanel.tsx
```

테스트에는 파일 수 분할, 큰 patch 무손실 segment, 공통 대상 분할, UNMAPPED 보존,
새 batch 테이블 FK와 transaction rollback 시나리오가 포함된다.
