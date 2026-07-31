---
문서 검증일:       2026-07-31
검증 기준 커밋:    ba17b1b865084639d1773204f0c870171e017269 (2026-07-30)
문서 역할:         SPECODE의 철학·정보구조·핵심 개념을 설명하는 개념 문서. 변동이 잦은
                   화면/API/DB/MCP 목록은 다루지 않는다 → `md/PROJECT_INVENTORY.md` 참조.
---

# SPECODE — 프로젝트 개요 (AI 온보딩용)

> 이 문서는 SPECODE를 처음 접하는 AI/개발자가 "이 시스템이 왜 존재하고, 핵심 개념이
> 어떻게 연결되는지"를 파악하기 위한 개념 문서다. **화면 경로·API 목록·DB 테이블
> 목록·MCP 도구 목록**처럼 자주 바뀌는 인벤토리 정보는 `md/PROJECT_INVENTORY.md`에
> 있다. 두 문서가 충돌하면 아래 "단일 진실 소스" 표를 따른다.

### 상태 표기 규칙
문서 전체에서 아래 태그로 정보의 성격을 구분한다.
- `[CURRENT]` 현재 소스로 확인된 구현 상태
- `[POLICY]` 프로젝트 규칙(`.claude/**`)에 명시된 방침
- `[VISION]` 아직 구현되지 않은 미래 계획/구상
- `[DEPRECATED]` 과거에 존재했으나 현재는 폐기된 구조
- 표기 없는 서술은 소스 코드로 직접 확인한 `[CURRENT]` 사실이다. 확인하지 못한 내용은
  "미확인"으로 명시하며 추정으로 채우지 않는다.

### 단일 진실 소스 (충돌 시 이쪽을 따른다)
| 영역 | 단일 진실 소스 |
|---|---|
| DB 스키마 | `prisma/schema.prisma` (※ `.claude/database/a.TableScript.md`는 갱신이 늦을 수 있음) |
| 권한 규칙 | `src/lib/permissions.ts` + `src/lib/permissions.md` |
| 메뉴 구조 | `src/components/layout/LNB.tsx` |
| MCP 도구 정의 | `src/lib/mcp/register-tools.ts` |
| 단위업무 화면 개발 규칙 | `.claude/CLAUDE.md`, `.claude/develop/A-NEXTJS-기술규칙.md` |
| 이 프로젝트의 사상 원문 | `.claude/develop/스펙코드란.md` |

---

## 1. SPECODE란 무엇인가 (사상) `[POLICY]` `[VISION]`

**한 줄 요약:** "AI와 구현하기 전에, AI와 설계하라." — 바이브 코딩 시대에 사라지는
설계 정보(프롬프트)를 구조화된 데이터로 축적해서, 고품질 PRD를 뽑아내고 그 PRD로
AI에게 구현을 맡기는 **설계 특화 SaaS 툴**. (원문: `.claude/develop/스펙코드란.md`)

### 배경 문제의식
- **무개념 설계 불안감**: 바이브 코딩으로 빠르게 만들지만, 시스템이 어떻게 만들어졌는지
  아무도 설명할 수 없고 운영 중 수정이 두려워지는 상태가 된다.
- **아까운 프롬프트(설계정보)**: AI와 나눈 대화가 사실상 설계였는데, 시간이 지나면
  그냥 사라진다. 메모장식 MD 파일로는 복잡한 업무를 구조화할 수 없다.
- **무한 프롬프팅**: 분석/설계 없이 구현부터 시작하면 "말하고 기다리고"를 무한 반복하게
  된다. 분석→설계→구현→테스트라는 전통적 순서는 AI 시대에도 바뀌지 않는다.
- **공유되지 않는 설계 정보**: 팀원이 AI와 나눈 디테일한 업무 설명이 팀에 공유되지 않고
  개인 기억 속에서도 휘발된다.

### SPECODE의 답
1. 시스템을 **설계하고**, 그 설계를 AI에게 최적화된 MD/JSON으로 넘겨 **일괄 구현**되게 한다.
2. 설계 정보 등록 방법 3가지: ① 직접 입력(UI), ② Claude Project/Gemini Gems 전용 프롬프트로
   대화 후 JSON 일괄 등록, ③ MCP로 AI가 직접 등록.
3. 설계가 SPECODE 구조에 맞게 축적되면 **PRD(화면/영역/기능 명세)**, **요구사항정의서**,
   **과업대비표**, **요구사항추적표**, **프로그램사양서**, **테이블/컬럼정의서** 등
   공공 SI 사업 산출물을 뽑아준다.

### 주요 타겟
**2~7억 원대 공공 SI 사업.** 개발을 전혀 모르는 일반인 대상이 아니라, 기존 개발자가
AI를 활용해 **더 안전하고 품질 높게** 개발하도록 돕는 도구.

### 비전 `[VISION]`
입력된 설계 정보 기반 AI 자동 검증(빈틈 탐지), 프로젝트 간 설계 재사용, 데이터표준화
연계("표준화 닷컴") 등을 계획 중이며 아직 구현되지 않았다 (원문 작성 시점 2026.07 "오픈 전").

---

## 2. 정보 구조 — 분석에서 설계까지 하나로 연결된 트리 `[CURRENT]`

SPECODE의 핵심 데이터는 분석과 설계가 분리된 두 트리가 아니라, **요구사항을 축으로
분석과 설계가 한 줄로 이어지는 하나의 트리**다. 아래 계층과 화살표는 모두
`prisma/schema.prisma`의 FK 관계로 직접 확인했다.

```
과업(Task)                          tb_rq_task
  └─ 요구사항(Requirement)           tb_rq_requirement   (task_id FK, optional)
       ├─ 사용자스토리(UserStory)     tb_rq_user_story    (req_id FK)
       │    └─ 인수기준(AcceptanceCriteria)  tb_rq_acceptance_criteria (story_id FK)
       └─ 단위업무(UnitWork)          tb_ds_unit_work     (req_id FK, required)
            └─ 화면(Screen)           tb_ds_screen        (unit_work_id FK, optional)
                 └─ 영역(Area)         tb_ds_area          (scrn_id FK, optional)
                      └─ 기능(Function) tb_ds_function      (area_id FK, optional)
                           └─ 컬럼 매핑  tb_ds_col_mapping   (ref_ty_code/ref_id로 기능 등을 다형 참조)
```

- **과업 → 요구사항은 1:N**(`TbRqTask.requirements`) 관계만 현재 구현되어 있다. "여러 과업을
  하나의 요구사항으로 통합"하는 개념은 스키마에 없다(요구사항의 `task_id`는 단일 FK) —
  미구현이므로 이 문서에서 다루지 않는다.
- **단위업무는 설계 단계의 시작 레벨**이며, 요구사항 1건에 종속되어 만들어지는 **실질적인
  업무·개발 단위**다(예: "멀티 게시판"). 화면/영역/기능은 그 아래에서 점점 더 좁은
  범위로 쪼개진다.
  - **영역**은 화면과 의미상 동일하지만 더 작은 단위 — 대시보드처럼 화면이 비대할 때만
    쪼갠다. 간단한 화면은 화면 1개 = 영역 1개로 둔다.
  - **기능**마다 사용/조인되는 **테이블.컬럼**을 매핑해두면(`tb_ds_col_mapping`), AI가
    백엔드/쿼리까지 설계 의도대로 구현하고 컬럼 변경 시 영향받는 화면·기능을 역추적할 수
    있다.
- **기획실(Plan Studio, `tb_ds_plan_studio`)**: 요구사항·사용자스토리를 소스로 AI와 함께
  화면정의(HTML)/업무흐름/ERD/정보구조도 등을 초안 생성하는 워크스페이스. 위 트리와
  별도로 존재하며, 산출물은 버전 이력으로 관리되고 "대표(good_design)" 지정이 가능하다.
- **DB 테이블(`tb_ds_db_table`/`tb_ds_db_table_column`)**: 위 계층과 별도로 프로젝트의
  테이블/컬럼 목록을 직접 관리한다. 기능의 컬럼 매핑은 이 테이블을 참조한다.

### 진척률/일정 모델 (2026-07-28 개편) `[CURRENT]`
레벨별로 관리 주체가 다르다.
- **요구사항**: 분석 일정/공수(`anls_bgng_de`/`anls_end_de`/`anls_efrt_val`) + 분석
  진척률(`progrs_rt`, 담당자 슬라이더 직접 입력).
- **단위업무**: 계획 설계 일정/공수(`plan_dsgn_*`, PM이 잡는 목표치). 실적 진척률 컬럼은
  없음 — 하위 화면→기능 롤업으로 계산(`src/lib/pm/progressRollup.ts`).
- **화면**: 실질 구현 일정(`actl_impl_bgng_de`/`actl_impl_end_de`, 담당 개발자가 커밋).
  공수 컬럼 없음.
- **영역**: 일정/공수/진척률 컬럼 없음(설계서 작성상태만 있음).
- **기능**: 구현 공수(`impl_efrt_val`)만 있음, 날짜 없음(화면 일정을 상속 표시). 설계/구현
  진척률(%)은 `tb_cm_progress`(design_rt/impl_rt)에 저장 — 화면·단위업무는 이 값의 평균
  롤업. 테스트 진척률(`test_rt`)은 2026-07-28부로 UI/API 어디서도 사용 안 함(컬럼만 잔존).

---

## 3. 단위업무(UnitWork) 개념의 두 문맥 — 반드시 구분할 것 `[CURRENT]`

같은 "단위업무"라는 용어가 이 프로젝트 안에서 **적용 대상이 다른 두 문맥**으로 쓰인다.
이름을 임의로 바꾸지 않고 아래처럼 문맥으로 구분한다.

| 구분 | 의미 | 데이터/문서 위치 |
|---|---|---|
| **UnitWork** | SPECODE **사용자**가 자신의 프로젝트 안에서 정의하는 설계·개발 단위 (§2의 트리에 있는 그 단위업무) | `tb_ds_unit_work` (런타임 데이터) |
| **UW-XXXXX** | **SPECODE 제품 자체**를 개발하기 위한 내부 PRD의 단위업무 식별자 (예: UW-00019 "단위업무 CRUD") | `.claude/biz/A.단위업무.md`, `md/prd/UW-XXXXX_*.md` |

두 개념은 "단위업무"라는 같은 용어와 계층 구조를 쓰지만, 하나는 **SPECODE로 만드는
고객 프로젝트의 산출물**이고 다른 하나는 **SPECODE라는 제품 자체의 개발 명세**라는 점에서
적용 대상이 다르다. 또한 `tb_ds_unit_work`의 표시 ID 접두어 기본값도 `"UW"`다
(`src/lib/idPrefix.ts`) — 즉 사용자가 만드는 프로젝트 데이터의 "UW-00001"과 SPECODE
제품 PRD의 "UW-00001"이 형식상 같은 문자열로 보일 수 있는데, 이는 우연한 접두어 일치이며
서로 다른 테이블·문서 체계에 속한다. §2 트리의 UnitWork/화면/영역/기능은 전자, §8(별도
문서인 `PROJECT_INVENTORY.md` §6)의 UW 목록은 후자다.

---

## 4. 구현요청(Implementation Request) — 현재 개념적 흐름과 한계 `[CURRENT]`

설계(§2 트리)가 실제 AI 구현으로 이어지는 유일한 경로다. **페이지가 아니라 상세 화면에서
띄우는 공통 팝업**(`src/components/ui/ImplRequestPopup.tsx`)이며, 4개의 API가 이를
지원한다(`/api/projects/[id]/impl-request/{build,preview,pre-impl,submit}`). 진입 계층은
UNIT_WORK/SCREEN/AREA/FUNCTION 4종을 지원하며, 현재 소스상 단위업무 상세·기능 상세·My
Task 트리에서 호출을 확인했다.

### 현재 구현된 흐름
```
스펙 작성 (§2 트리의 각 레벨 _dc 필드 등)
  → 구현요청서 생성 (build: 선택된 기능 기준 4계층 수집 + 콘텐츠 해시로 이전 스냅샷과
     비교해 레이어별 모드 판정 — 신규/NO_CHANGE/DIFF/FULL/REPLACE — 프롬프트 렌더링, DB 저장 없음)
  → 미리보기 확인 (preview)
  → AI 태스크 등록 (submit: tb_ai_task INSERT)
  → 요청 시점 스펙 스냅샷 저장 (tb_sp_impl_snapshot에 각 레이어의 콘텐츠 해시+원문 저장)
  → 다음 구현요청에서 스펙 변경 Diff 제공 (build가 최신 스냅샷과 현재 내용을 비교)
```
추가로 **선 구현 적용(`pre-impl`)** 기능이 있다: 개발자가 Claude Code 등으로 이미 직접
반영한 변경사항에 대해, AI 태스크를 거치지 않고 선택한 레이어의 스냅샷 기준선만 현재
상태로 갱신할 수 있다(`task_ty_code = "PRE_IMPL"` 더미 태스크로 감사 추적). 이후
구현요청에서 해당 레이어는 NO_CHANGE로 표시된다.

### 명확한 현재 한계 `[CURRENT — 미구현 범위]`
현재 구현요청 스냅샷은 **SPECODE 내부 스펙(각 엔티티 `_dc` 필드 등)의 변경만** 추적한다.
- **로컬 소스 코드와 스펙을 비교**하는 기능은 없다.
- **구현 결과를 스펙에 역반영하고 정합성을 확정**하는 기능은 없다.
- "선 구현 적용"은 스냅샷 기준선을 수동으로 갱신하는 수준이며, 실제 구현 코드를 읽어
  검증하지 않는다.

"스펙 → 구현 → 검증 → 현행화"까지 이어지는 전체 라이프사이클은 **현재 기능이 아니라
향후 별도 기능 기획 대상**이다 `[VISION]`.

---

## 5. 권한 모델 — 핵심 원칙 `[POLICY]`

단일 진실 소스: `src/lib/permissions.ts` (+ 설계 문서 `src/lib/permissions.md`). 구체적인
권한명·역할별 매트릭스는 소스가 자주 바뀌므로 이 문서에 나열하지 않는다.

- **네 가지 축**: 역할(Role, 프로젝트 단위: OWNER/ADMIN/MEMBER/VIEWER), 직무(Job, 프로젝트
  단위 업무 성격: PM/PL/DBA/DEV/DESIGNER/QA/ETC), 시스템 역할(SaaS 전역, DB 직접 UPDATE로만
  설정: SUPER_ADMIN), 플랜(계정 단위 결제: FREE/PRO/TEAM/ENTERPRISE).
- **판정 규칙**: `roles OR jobs` 중 하나만 만족해도 허용 + `requiresPlan`이 있으면 AND.
- **지원 세션 원칙**: SUPER_ADMIN이 남의 프로젝트에 진입한 지원 세션 동안은 권한명이
  `.read`로 끝나는지로 write 여부를 판정해 **읽기 전용을 강제**한다. 그래서 내보내기
  (export)/다운로드처럼 "GET이지만 데이터 유출 경로가 되는" 액션은 반드시 별도 권한명으로
  분리해야 한다(`.claude/CLAUDE.md` §9) — 이 원칙을 어기면 지원 세션 보호막이 뚫린다.

---

## 6. 기술 스택 & 아키텍처 원칙 `[POLICY]`

- **프레임워크**: Next.js 16 App Router. `app/api/` = 서버(DB 접근/비즈니스 로직),
  `app/(main)/`·`(auth)/` = 클라이언트 UI. 절대 혼용 금지.
- **데이터 페칭**: TanStack Query (`queryKey`에 필터 전부 포함, mutation 성공 시
  `invalidateQueries`).
- **DB 접근**: Prisma, `src/lib/prisma.ts` 싱글톤 패턴(dev hot-reload 연결 폭발 방지).
- **상태 관리**: Zustand (`src/store/appStore.ts`) — `currentProjectId`, `theme`,
  `sidebarCollapsed` 등 전역 UI 상태.
- **UI 디자인 시스템**: `sp-` 프리픽스 컴포넌트 클래스, `is-` 프리픽스 상태 클래스, semantic
  토큰(`--color-*`, `--space-*`, `--radius-*`, `--text-*`)만 사용. 토큰/컴포넌트 정의는
  `.claude/design/DS_TOKENS.md`, `DS_COMPONENTS.md`, `tokens.css`, `components.css`.
- **개발 우선순위**(절대 순서 고정): ① 유지보수 > ② 보안 > ③ Next.js 베스트프랙티스.
  주석은 우선순위 밖의 의무(자명해 보여도 "왜"를 남긴다).
- **보안**: 지원 세션 읽기전용 게이트(§5), ID 파라미터는 항상 숫자/형식 검증, 민감정보는
  `process.env`로만, `catch {}` 금지(반드시 로깅/사용자 알림).

---

## 7. 문서 지도 — 어디서 무엇을 찾을지

| 알고 싶은 것 | 문서 |
|---|---|
| 전체 화면/메뉴 경로, 인증 경로 | `md/PROJECT_INVENTORY.md` §1, §2 |
| API 그룹과 주요 서브리소스 | `md/PROJECT_INVENTORY.md` §3 |
| 현재 DB 핵심 테이블 목록 | `md/PROJECT_INVENTORY.md` §4 (단일 진실 소스는 `prisma/schema.prisma`) |
| MCP 도구 목록 | `md/PROJECT_INVENTORY.md` §5 (단일 진실 소스는 `src/lib/mcp/register-tools.ts`) |
| SPECODE 제품 개발 UW/PRD 목록 | `md/PROJECT_INVENTORY.md` §6 |
| UI 작업 규칙 | `.claude/design/DS_TOKENS.md` → `DS_COMPONENTS.md` → `tokens.css` → `components.css` |
| 단위업무 개발 착수 전 PRD | `/md/prd/UW-XXXXX_단위업무명.md` |
| API 인터페이스 변경 시 동기화 대상 | `src/lib/mcp/register-tools.ts` |
| DB 작업 전 필독 | `.claude/database/a.TableScript.md` — 단, §DB 스키마 항목은 `prisma/schema.prisma`가 최종 진실 소스 |
| 이 프로젝트의 사상 원문 | `.claude/develop/스펙코드란.md` |
