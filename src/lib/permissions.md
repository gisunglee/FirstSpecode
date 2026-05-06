# 권한 시스템 — 개발자 레퍼런스

> **업데이트**: 2026-04-21
> **관련 PRD**: `md/prd/UW-00010_역할 관리.md`, `md/prd/UW-00011_역할별 접근 권한 제어.md`

---

## 한 줄 원리

> **역할(4) OR 직무(7)** 중 하나라도 만족하면 허용, 그 위에 **플랜(4)** 조건이 AND 로 추가될 수 있음.

3축 — 보안 게이트는 **역할**, 업무 태그는 **직무**, 결제 잠금은 **플랜**.

---

## 물리 파일 위치

| 파일 | 역할 |
|---|---|
| [`src/lib/permissions.ts`](./permissions.ts) | 권한 매트릭스 `PERMISSIONS` + `hasPermission()` — **단일 진실 소스** |
| [`src/lib/requirePermission.ts`](./requirePermission.ts) | API Route 가드 (`인증 + 멤버십 + 권한` 한 줄) |
| [`src/lib/requireAuth.ts`](./requireAuth.ts) | 순수 인증 헬퍼 (JWT + spk_ API키) |
| [`src/lib/checkRole.ts`](./checkRole.ts) | **[DEPRECATED]** 구 7-role 호환만 유지 |
| [`src/hooks/useMyRole.ts`](../hooks/useMyRole.ts) | 프론트 `usePermissions(projectId)` 훅 |
| [`src/app/api/projects/[id]/my-role/route.ts`](../app/api/projects/[id]/my-role/route.ts) | `{ myRole, myJob, myPlan }` 반환 API |
| `prisma/sql/2026-04-21_add_permissions.sql` | 마이그레이션 SQL (이미 적용됨) |

---

## 값 계약

| 축 | 코드 | 저장 위치 | 값 |
|---|---|---|---|
| **역할** | `RoleCode` | `tb_pj_project_member.role_code` | `OWNER` / `ADMIN` / `MEMBER` / `VIEWER` |
| **직무** | `JobCode`  | `tb_pj_project_member.job_title_code` | `PM` / `PL` / `DBA` / `DEV` / `DESIGNER` / `QA` / `ETC` |
| **플랜** | `PlanCode` | `tb_cm_member.plan_code`              | `FREE` / `PRO` / `TEAM` / `ENTERPRISE` |

멤버당 역할 1개 + 직무 1개. 복수 권한 없음.

---

## 동작 흐름 (4단계)

```
① API 요청 (Authorization: Bearer ...)
     ↓
② requirePermission(req, projectId, "xxx.yyy")
     │  내부:
     │    1) requireAuth()       → JWT/API키 검증
     │    2) findUnique(멤버십)   → role/job 조회 + plan 조회
     │    3) isRoleCode/isJobCode → DB 손상값 가드
     │    4) hasPermission()     → roles.includes(role) || jobs.includes(job)
     │                              && (requiresPlan 있으면 PLAN_RANK 비교)
     ↓
③ 성공: { mberId, email, role, job, plan } 반환
   실패: 401/403 Response 즉시 반환
     ↓
④ 호출부: if (gate instanceof Response) return gate;
```

프론트도 동일 — `usePermissions(projectId).has("xxx.yyy")` 가 같은 `hasPermission` 호출.

---

## 현재 권한 매트릭스 (요약)

| 권한 키 | roles | jobs | plan |
|---|---|---|---|
| `project.read` | OWNER / ADMIN / MEMBER / VIEWER | — | — |
| `project.settings` | OWNER / ADMIN | — | — |
| `project.delete` | OWNER | — | — |
| `member.read` | OWNER / ADMIN / MEMBER / VIEWER | — | — |
| `member.invite` | OWNER / ADMIN | — | — |
| `member.changeRole` | OWNER / ADMIN | — | — |
| `member.changeJob` | OWNER / ADMIN | — | — |
| `content.read` | OWNER / ADMIN / MEMBER / VIEWER | — | — |
| `content.create` / `.update` / `.delete` | OWNER / ADMIN / MEMBER | — | — |
| `db.table.write` | OWNER / ADMIN | **DBA / DEV** | — |
| `db.standard.manage` | OWNER / ADMIN | **DBA** | — |
| `ai.request` | OWNER / ADMIN / MEMBER | — | — |
| `ai.bulkDesign` / `.planStudio` | OWNER / ADMIN / MEMBER | — | **PRO 이상** |
| `config.manage` | OWNER / ADMIN | **PM / PL** | — |
| `apiKey.manage` | OWNER / ADMIN | — | — |
| `code.read` / `code.write` | (read: 전체) / (write: OWNER / ADMIN) | — | — |

**실제 매트릭스는 [`permissions.ts`](./permissions.ts) 의 `PERMISSIONS` 가 유일한 소스.**

---

## 신패턴 적용 현황 (2026-04-21 기준)

### ✅ `requirePermission()` 사용 — 48개 route

| 그룹 | 파일 수 | 적용 권한 |
|---|---|---|
| 멤버 관리 + 초대 | 3 | member.changeRole / changeJob / invite |
| 콘텐츠 CRUD (tasks / requirements / user-stories / unit-works / screens / areas / functions) | 14 | content.* |
| db-tables (CRUD + revisions) | 4 | content.read / db.table.write |
| settings/ai · api-keys · history | 5 | project.settings / apiKey.manage / content.read |
| configs | 2 | content.read / config.manage |
| **code-groups (그룹·코드)** | **4** | code.read / code.write |
| **memos (소유권 로직 유지)** | **2** | content.read / .create / .update / .delete |
| **reviews + comments** | **2** | content.read / content.create |
| **plan-studios (CRUD + artifacts + 검색)** | **7** | content.* / ai.request (generate만) |
| **impl-request (build/preview/pre-impl/submit)** | **4** | ai.request |
| **prompt-templates** | **1** | content.read / content.create |

### 🔶 구 패턴 `checkRole()` 사용 — 41개 route

기능 **정상 동작** 중 (`ROLES.EDIT` 에 MEMBER 포함되어 VIEWER 차단 보장).
**보안 허점 없음**. 단 직무·플랜 규칙은 못 씀 — 필요 시 자연 교체.

주요 잔존 영역: `ai-tasks` 본체 + 액션(retry/cancel/reject) / `areas·functions·requirements/files·ai·excalidraw·inline` / `standard-info` / `baseline` / `planning/bulk-import` / `design/bulk-import` / `phase-progress` / `col-mappings` / `impl-tree` / `*/sort` 11종 / `tasks/[taskId]/copy` / `reviews/[reviewId]` 본체 등

### ⚪ 가드 최소

`requireAuth + membership 체크만` — 대부분 GET(읽기·다운로드). VIEWER 포함 모든 멤버 접근 가능 (의도된 정책).

---

## 사용 예

### 백엔드 API Route
```ts
import { requirePermission } from "@/lib/requirePermission";

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(req, projectId, "content.create");
  if (gate instanceof Response) return gate;  // 401/403
  // gate.mberId, gate.role, gate.job, gate.plan 사용
}
```

### 프론트 컴포넌트
```tsx
import { usePermissions } from "@/hooks/useMyRole";

const { has, myRole, myJob, myPlan } = usePermissions(projectId);
{has("member.invite") && <InviteButton />}
{has("db.table.write") && <EditTableButton />}
```

---

## 3층 방어 원칙

| 층 | 어디서 | 필수? | 이유 |
|---|---|---|---|
| **1. 백엔드 가드** `requirePermission` | 각 API route 최상단 | ✅ **필수** | F12 로 API 직접 호출해도 막아야 함 |
| **2. 메뉴 가드** `has()` | LNB | ✅ 권장 | 보일 필요 없는 메뉴는 숨김 |
| **3. 버튼 가드** `has()` | 파괴·금전 액션 | 선택 | 삭제·초대·결제 버튼만. 전체 다 하면 유지보수 지옥 |

---

## 새 권한 추가 절차

1. [`permissions.ts`](./permissions.ts) `PERMISSIONS` 에 키 추가 (`resource.action`)
2. `roles` / `jobs` / `requiresPlan` 중 필요한 것만 지정
3. 백엔드 route 에 `requirePermission(req, projectId, "new.key")` 호출
4. 프론트에서 `has("new.key")` 사용
5. 끝. (DB 공통코드 seed 불필요 — 이 파일이 유일한 소스)

---

## 안티패턴 (하지 말 것)

- ❌ 프론트만 가드하고 백엔드 안 막기 → 뚫림
- ❌ `role === "OWNER"` 직접 비교 → 매트릭스 우회, 규칙 변경 시 누락
- ❌ 모든 버튼에 `has()` 가드 → 유지보수 지옥
- ❌ 신규 코드에서 `checkRole()` 사용 → deprecated
- ❌ OWNER 0명 상태 허용 → 프로젝트 orphan. 역할 변경 API 에서 `ownerCount` 체크 필수
- ❌ 직무를 권한 주축으로만 쓰기 ("DBA만") → OWNER/ADMIN 도 수정 가능해야 실무에 맞음 → 혼합 규칙

---

## 향후 확장 (지금은 안 함)

- **DBA 승인 워크플로우** — DEV가 DB 수정 시 DBA 승인. 실제 주도 기능 등장 시 결정 (`tb_ds_review_request` 재활용 or 신규 테이블)
- **플랜 결제 연동** — `requiresPlan` 위반 시 업그레이드 유도 UI
- **남은 ~58 route 신패턴 이관** — 기능 수정할 때 자연스럽게 교체 (급하지 않음)
- **공통코드 seed** — 레이블을 DB로 옮기고 싶어질 때 `PROJECT_ROLE` / `JOB_TITLE` / `MEMBER_PLAN` 그룹 추가

---

## 알려진 이슈

- `src/app/api/worker/tasks/route.ts:125` — 기존 타입 에러 (권한 시스템 무관, 별건). 런타임 영향 없음

---

## 변경 이력

- **2026-04-21** — 권한 시스템 초기 구축 + Phase 1-A/B/C 일괄 정비
  - 토대: `permissions.ts`, `requirePermission.ts`, `usePermissions` 훅, my-role API 신설
  - 멤버 관리: 역할(4-role)·직무(7종) UI 인라인 편집
  - 콘텐츠 CRUD 14개 신패턴 이관
  - configs / settings / db-tables 11개 신패턴 이관 (직무 규칙 활성화: `db.table.write` jobs+DBA/DEV, `config.manage` jobs+PM/PL)
  - **VIEWER 쓰기 허점 20개 차단** (code-groups·memos·reviews·plan-studios·impl-request·prompt-templates)
  - DB 마이그레이션: `prisma/sql/2026-04-21_add_permissions.sql` (적용 완료)
