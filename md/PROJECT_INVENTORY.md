---
문서 검증일:       2026-07-31
검증 기준 커밋:    ba17b1b865084639d1773204f0c870171e017269 (2026-07-30)
문서 역할:         변동이 잦은 현행 인벤토리(화면·API·DB·MCP 목록)를 모아둔 문서.
                   철학/정보구조/개념 설명은 `md/PROJECT_OVERVIEW.md` 참조.
---

# SPECODE — 인벤토리 (현행 화면 · API · DB · MCP)

> 이 문서는 코드가 바뀔 때마다 함께 갱신해야 하는 "지금 이 순간의 목록"이다. 개념/사상은
> 다루지 않는다 → `md/PROJECT_OVERVIEW.md` 참조. 각 절 하단에 단일 진실 소스(원본 파일)를
> 명시했다 — 이 문서와 원본이 다르면 원본을 따른다.

---

## 1. 화면/메뉴 전체 구조 `[CURRENT]`

레이아웃: `GNB(상단) + LNB(좌측 2-Pane: 아이콘 레일 + 서브패널) + Main + StatusBar(하단)`.

**GNB(상단바)**: 로고(→`/dashboard`) · 프로젝트 셀렉터(드롭다운) · 브레드크럼 · 사용자
식별칩(이름·역할) · 테마 토글 버튼(light↔dark만 순환) · "내 담당" 전역 필터 토글 · 전역
검색(Ctrl+K) · 프로필 드롭다운(프로필 설정 `/settings/profile`, MCP 키 관리
`/settings/profile?tab=api-keys`, 시스템 관리 `/admin`[SUPER_ADMIN만], 로그아웃).
테마 타입 자체는 `light`/`dark`/`dark-purple` 3종이 존재하지만(`src/types/layout.ts`),
`dark-purple`을 지정하는 별도 UI 진입점은 이번 검증에서 확인하지 못함(미확인).

**LNB(좌측 메뉴)**: 그룹 단위로 접혀 있으며 URL과 자동 매칭되어 활성 그룹/항목이 강조됨.
아래 경로는 프로젝트 종속 메뉴의 경우 `/projects/{id}/...` 형태다(`{id}` = 현재 선택
프로젝트).

| 그룹 | 메뉴명 | Path | 비고 |
|---|---|---|---|
| **대시보드** | 대시보드 | `/dashboard` | 개인 홈 지정 가능 |
| | My Task | `/my-task` | 개인 홈 지정 가능 |
| | MY 보드 | `/my-work` | 개인 홈 지정 가능 |
| | PM 현황 | `/pm-board` | 개인 홈 지정 가능 |
| | PM 진단 | `/pm` | 개인 홈 지정 가능 |
| **일정** | WBS 일정 | `/wbs` | 단위업무/화면/기능 3종 간트 |
| | 캘린더 | `/calendar` | 개인 홈 지정 가능 |
| | 업무일지 | `/work-logs` | 개인 오늘의 할일/기록 |
| | 업무 리포트 | `/work-report` | 업무일지를 문서형으로 보는 개인용 뷰 |
| | 리더 리포트 | `/leader-report` | PM 전용(weeklyReport.manage 권한 필요), 팀원 업무일지 AI 취합 |
| **프로젝트** | 프로젝트 목록 | `/projects` | 지원세션(SUPER_ADMIN) 시 숨김 |
| | 프로젝트 설정 | `/projects/{id}/settings` | OWNER/ADMIN만 |
| | 프로젝트 멤버 | `/projects/{id}/members` | 멤버관리 권한자만 |
| **분석** | 과업 | `/projects/{id}/tasks` | |
| | 요구사항 | `/projects/{id}/requirements` | |
| | 사용자스토리 | `/projects/{id}/user-stories` | |
| | 요구분석 일괄 편집 | `/projects/{id}/planning` | |
| | 기획실 | `/projects/{id}/plan-studio` | AI 기획 워크스페이스 |
| **설계** | 단위업무 | `/projects/{id}/unit-works` | |
| | 화면 | `/projects/{id}/screens` | |
| | 영역 | `/projects/{id}/areas` | Excalidraw 와이어프레임 |
| | 기능 | `/projects/{id}/functions` | 컬럼 매핑 포함 |
| | 스펙 반영함 | `/projects/{id}/spec-reconciliations` | 구현 편차·후속 source 변경 검토 |
| | DB 테이블 | `/projects/{id}/db-tables` | |
| **테스트** | 단위 테스트 명세서 | `/projects/{id}/test-specs?kind=UNIT` | |
| | 통합 테스트 명세서 | `/projects/{id}/test-specs?kind=INTEGRATION` | |
| **공통 설계** | 표준 가이드 | `/projects/{id}/standard-guides` | |
| | 공통코드 | `/projects/{id}/common-codes` | |
| | 기준 정보 | `/projects/{id}/standard-info` | |
| **AI 작업실** | AI 태스크 | `/projects/{id}/ai-tasks` | |
| | 기획 가져오기 | `/projects/{id}/planning/ai-import` | |
| | 설계 가져오기 | `/projects/{id}/design-import` | |
| **스펙설정** | 설계 양식 | `/projects/{id}/design-templates` | |
| | 프롬프트 관리 | `/projects/{id}/prompt-templates` | |
| | 환경설정 | `/projects/{id}/configs` | OWNER/ADMIN만 |
| **도움창고** | DOCS | `/docs` | 시스템 공식 문서(프로젝트 무관) |
| | 문서실 | `/projects/{id}/document-library` | 요구사항명세서 등 일괄 다운로드 |
| | 리뷰 요청 | `/projects/{id}/reviews` | |
| | 메모 | `/projects/{id}/memos` | |
| **데이터 조회** | 그래프 뷰 | `/projects/{id}/graph` | |
| | 설계 변경 이력 | `/projects/{id}/design-changes` | |
| **시스템 관리**(SUPER_ADMIN 전용) | 대시보드 | `/admin` | |
| | 사용자 | `/admin/users` | |
| | 프로젝트 | `/admin/projects` | |
| | 환경설정 템플릿 | `/admin/config-templates` | |
| | 설계 양식 | `/admin/design-templates` | DEFAULT 양식, 전체 프로젝트 영향 |
| | 프롬프트 관리 | `/admin/prompt-templates` | |
| | 문서 관리 | `/admin/docs` | Docs Hub(`/docs`)의 관리자 화면 |
| | 감사 로그 | `/admin/audit` | |
| | 정보 삭제 | `/admin/cleanup` | 소프트삭제 프로젝트 영구삭제 |

**LNB에 없는 보조 페이지**: `/icon-lab`(아이콘 미리보기), `/intro`, `/intro/about`(랜딩
페이지). **주의**: `/projects/{id}/impl-request`는 페이지가 아니다 — 구현요청은 상세
화면에서 띄우는 팝업(`ImplRequestPopup`)이며 API로만 존재한다(§3, `PROJECT_OVERVIEW.md`
§4 참조).

> 단일 진실 소스: `src/components/layout/LNB.tsx`, `GNB.tsx`, `src/store/appStore.ts`,
> `src/types/layout.ts`

---

## 2. 인증/온보딩 경로 `[CURRENT]`
레이아웃 밖, `(auth)` 라우트 그룹.

| 목적 | Path |
|---|---|
| 로그인 | `/auth/login` |
| 계정 잠금 안내/해제 | `/auth/login/locked`, `/auth/login/unlock` |
| 비밀번호 재설정 요청/처리/오류 | `/auth/password/request`, `/auth/password/reset`, `/auth/password/invalid` |
| 회원가입/인증메일/완료 | `/auth/register`, `/auth/register/verify`, `/auth/register/complete` |
| 소셜 로그인 콜백/연동 | `/auth/social/callback`, `/auth/social/link` |
| 초대 수락 | `/invite/accept` |

> 단일 진실 소스: `src/app/(auth)/**/page.tsx`

---

## 3. API 구조 `[CURRENT]`

원칙: `src/app/api/` = 서버 전용(DB 접근/비즈니스 로직), `src/app/(main)/**`·`(auth)/**` =
클라이언트 UI 전용. Next.js 16이라 **route params는 Promise** — `await params` 필수.

### 3-1. 최상위 API 그룹
| 그룹 | 대표 경로 | 역할 |
|---|---|---|
| `api/auth/*` | `/api/auth/login`, `/register`, `/verify`, `/token/refresh`, `/social/*`, `/mcp-keys/*` | 인증/JWT/소셜연동/MCP 키 발급 |
| `api/member/*` | `/api/member/profile`, `/me`, `/removal-notices`, `/social/link` | 회원 프로필/설정 |
| `api/invitations/*` | `/api/invitations/[token]`, `/accept` | 프로젝트 초대 수락 |
| `api/projects/*` | `/api/projects`, `/my`, `/trash`, `/export` | 프로젝트 CRUD/목록 |
| `api/projects/[id]/*` | 아래 3-2 참조 | **프로젝트 종속 리소스 대부분** |
| `api/admin/*` | `/api/admin/users`, `/projects`, `/audit`, `/batch/*`, `/cleanup/*`, `/docs/*`, `/support-session/*` | SUPER_ADMIN 전용 |
| `api/docs/*` | `/api/docs/tree`, `/[section]/[page]` | Docs Hub 공개 조회(사용자 뷰어) |
| `api/worker/*` | `/api/worker/tasks`, `/[taskId]/start`, `/complete` | 외부 AI 워커가 AI 태스크를 pull/complete하는 채널 |
| `api/mcp` | `/api/mcp` | **HTTP MCP 엔드포인트** — MCP 클라이언트가 붙는 단일 채널 |

### 3-2. `api/projects/[id]/*` 주요 서브리소스
```
tasks / requirements / user-stories / planning          ← 분석 단계
plan-studios                                              ← 기획실
unit-works / screens / areas / functions / db-tables      ← 설계 단계 계층
col-mappings, col-mapping-groups                           ← 기능-컬럼 매핑
ai-tasks                                                    ← AI 태스크 큐 (요청/재시도/취소/거절/결과파일)
impl-request/{build,preview,pre-impl,submit}                ← 구현요청 팝업 전용 API (페이지 아님)
spec-syncs                                                  ← 현재 UW 설계와 현재 소스 비교 실행·결과·결정
design-changes, design-history                               ← 설계 변경 이력(자동 추적)
reviews                                                       ← 리뷰 요청/코멘트
members, invitations                                          ← 멤버/초대
milestones, holidays, calendar, wbs                            ← 일정
work-logs, weekly-reports                                       ← 업무일지/주간보고
memos, issues                                                    ← 메모/이슈
standard-guides, standard-info, code-groups                      ← 공통 설계 자산
design-templates, prompt-templates, configs                       ← 프로젝트 도구 메타 설정
artifacts/*, documents/release/*                                    ← 산출물(docx/xlsx) 생성
graph, search, status-summary, pm-*, dashboard/*                     ← 조회/집계 전용 API
test-specs                                                             ← 테스트 명세서
```

> 단일 진실 소스: `src/app/api/**/route.ts` 전체 디렉터리 구조.

---

## 4. 현재 DB 핵심 테이블 `[CURRENT]`

**단일 진실 소스는 `prisma/schema.prisma`다.** 모델 수는 기능 추가에 따라 바뀌므로 아래 목록과 스키마를 함께 확인한다.
접두어별로 그룹화한 정리본이며, 각 테이블의 상세 컬럼은 스키마 파일에서 직접 확인할 것.
`.claude/database/a.TableScript.md`는 컬럼 레벨 설명이 상세하지만 일부 테이블(예:
`tb_wr_*`, `tb_qa_*` 등)이 누락되어 있어 갱신이 늦을 수 있다 — 표에 없는 테이블을 찾을 땐
반드시 `prisma/schema.prisma`로 재확인한다.

| 그룹 | 테이블 |
|---|---|
| 공통/보안/회원 (`tb_cm_`) | `tb_cm_member`, `tb_cm_member_session`, `tb_cm_email_verification`, `tb_cm_refresh_token`, `tb_cm_login_attempt`, `tb_cm_account_lock`, `tb_cm_password_reset_token`, `tb_cm_social_account`, `tb_cm_mcp_key`, `tb_cm_attach_file`, `tb_cm_progress`(설계/구현 진척률, 다형참조), `tb_cm_standard_info`, `tb_cm_code_group`/`tb_cm_code`, `tb_cm_rate_limit`(인증 엔드포인트 남용 방어 카운터), `tb_cm_batch_job`/`tb_cm_batch_job_item` |
| 시스템 전역 (`tb_sys_`, SUPER_ADMIN 자산) | `tb_sys_admin_support_session`, `tb_sys_admin_audit`, `tb_sys_config_template`, `tb_sys_docs_section`/`tb_sys_docs_page`(Docs Hub), `tb_sys_attach_file` |
| 프로젝트 (`tb_pj_`) | `tb_pj_project`, `tb_pj_project_settings`, `tb_pj_project_invitation`, `tb_pj_project_member`, `tb_pj_project_config`, `tb_pj_project_api_key`, `tb_pj_settings_history`, `tb_pj_member_removal_notice`, `tb_pj_milestone`, `tb_pj_holiday` |
| 요구사항/분석 (`tb_rq_`) | `tb_rq_task`, `tb_rq_requirement`, `tb_rq_user_story`, `tb_rq_acceptance_criteria`, `tb_rq_requirement_history` |
| 설계/기획실 (`tb_ds_`) | `tb_ds_design_change`, `tb_ds_document_release`(산출물 발행 이력), `tb_ds_unit_work`, `tb_ds_screen`, `tb_ds_area`, `tb_ds_function`, `tb_ds_db_table`/`tb_ds_db_table_column`/`tb_ds_db_table_revision`, `tb_ds_col_mapping_group`/`tb_ds_col_mapping`, `tb_ds_plan_studio`/`tb_ds_plan_studio_artf`/`tb_ds_plan_studio_ctxt`, `tb_ds_memo`, `tb_ds_review_request`/`tb_ds_review_comment` |
| AI (`tb_ai_`) | `tb_ai_task`, `tb_ai_prompt_template`, `tb_ai_design_template` |
| 업무일지/리포트 (`tb_wr_`) | `tb_wr_work_log`, `tb_wr_work_log_item`, `tb_wr_weekly_report`, `tb_wr_issue` |
| 테스트/품질 (`tb_qa_`) | `tb_qa_check_master`, `tb_qa_test_spec`, `tb_qa_test_spec_uw`, `tb_qa_test_spec_screen`, `tb_qa_test_case`, `tb_qa_test_round`, `tb_qa_test_result`, `tb_qa_defect`, `tb_qa_evidence` |
| 표준 가이드 (`tb_sg_`) | `tb_sg_std_guide` |
| 특수목적 (`tb_sp_`) | `tb_sp_diff_test_master`/`tb_sp_diff_test_node`(diff 실험), `tb_sp_impl_snapshot`(구현요청 스펙 스냅샷), `tb_sp_sync_run`/`tb_sp_sync_item`(UW-00036 구현-설계 동기화) |

### 폐기된 테이블 `[DEPRECATED]`
- **`tb_rq_baseline_snapshot`** — 과거 요구사항 "베이스라인 확정" 기능에서 사용되던
  테이블. 2026-05-12 `ddl/20260512-drop-baseline.sql`로 DROP되어 `prisma/schema.prisma`에
  더 이상 모델이 없다. 관련 기능은 "정의서 발행"(`tb_ds_document_release`)으로 통합됨.
  **현재 핵심 테이블 목록에 포함하지 말 것.**

---

## 5. MCP 도구 및 관련 경로 `[CURRENT]`

채널은 **HTTP MCP 하나**(`/api/mcp`, 등록: `src/lib/mcp/register-tools.ts`) — 과거 stdio
로컬 `mcp-server/` 프로세스는 폐기됨 `[DEPRECATED]`. API route의 **인터페이스**(URL/
파라미터/필수여부/허용값)를 바꾸면 반드시 이 파일도 같이 수정한다(`.claude/CLAUDE.md`
MCP 동기화 규칙).

### 5-1. 도구 카테고리 (`register-tools.ts`가 단일 진실 소스)
| 카테고리 | 도구 |
|---|---|
| 프로젝트 | `list_projects`, `get_project`, `list_members` |
| 기획-과업 | `list_tasks`, `get_task`, `create_task`, `update_task` |
| 기획-요구사항 | `list_requirements`, `get_requirement`, `create_requirement`, `update_requirement` |
| 기획-스토리 | `list_user_stories`, `get_user_story`, `create_user_story`, `update_user_story` |
| 기획-트리 | `get_planning_tree` |
| 설계-단위업무 | `list_unit_works`, `get_unit_work`, `create_unit_work`, `update_unit_work` |
| 설계-화면 | `list_screens`, `get_screen`, `create_screen`, `update_screen` |
| 설계-영역 | `list_areas`, `get_area`, `create_area`, `update_area` |
| 설계-기능 | `list_functions`, `get_function`, `create_function`, `update_function` |
| 설계-트리 | `get_design_tree` (배치 조회 — 단위업무 ID 1~20개 필수, "전체 조회" 미지원) |
| DB | `list_db_tables`, `get_db_table`, `get_db_table_usage`, `get_db_column_usage` |
| 스펙 정합성 | `get_source_baselines`, `get_reconciliation_context`, `submit_implementation_receipt`, `submit_maintenance_change`, `submit_provider_verified_change`, `list_spec_reconciliations`, `get_spec_reconciliation`, `queue_reconciliation_analysis`, `retry_reconciliation_batch`, `confirm_reconciliation_resolution`, `check_reconciliation_gate` |
| 워커 배포 | `get_worker_command_files` |

### 5-2. 의도적으로 제공하지 않는 것 `[POLICY]`
- **DELETE 미지원**: MCP에서는 어떤 엔티티도 삭제할 수 없다. AI가 한 번의 잘못된 호출로
  cascade 삭제를 일으키지 못하도록 `delete_*` 도구를 일괄 제거했다. 삭제는 UI(웹)
  채널에서만 가능하며 API DELETE 라우트 자체는 유지된다.
- **대시보드 summary 미등록**: `/api/projects/[id]/dashboard/manage-summary`,
  `/me-summary`는 화면 첫 페인트용 집계 응답이라 AI가 써도 의미가 없고 응답 구조가 UI와
  강결합되어 있어 등록하지 않는다.
- **산출물 발행(`/documents/release/*`) 미등록**: 발행은 사람이 버전·사유를 입력해야 하는
  행위이고 발행 이력 삭제는 destructive해서, AI의 실수로 협의 결과물을 잃지 않도록 MCP에
  노출하지 않는다.

### 5-3. 계층 관계 (도구 설계상 전제)
```
기획: 과업(Task) → 요구사항(Requirement) → 사용자스토리(UserStory)
설계: 단위업무(UnitWork) → 화면(Screen) → 영역(Area) → 기능(Function)
연결: 요구사항 ↔ 단위업무 (reqId로 연결)
```

> 단일 진실 소스: `src/lib/mcp/register-tools.ts`

---

## 6. SPECODE 제품 개발 UW/PRD 목록 `[CURRENT]`

**주의**: 이 표의 "UW-XXXXX"는 SPECODE **제품 자체**를 개발하기 위한 내부 PRD 식별자다.
사용자가 자기 프로젝트에서 만드는 `UnitWork`(§2 트리의 데이터, `tb_ds_unit_work`)와는
적용 대상이 다르다 — 자세한 구분은 `PROJECT_OVERVIEW.md` §3 참조.

원본: `.claude/biz/A.단위업무.md` (전체 36개 단위업무 및 화면 매핑). PRD 본문은
`/md/prd/UW-XXXXX_단위업무명.md` (예: `UW-00035_시스템공통레이아웃.md`) — **개발 착수 전
필독**.

| 대분류 | UW 범위 | 핵심 내용 |
|---|---|---|
| 인증/회원 | UW-00001~00007 | 회원가입, 로그인, 소셜로그인, JWT, 비밀번호재설정, 프로필, 탈퇴 |
| 프로젝트/멤버 | UW-00008~00013 | 프로젝트 생성/설정, 멤버초대/역할/제거 |
| 요구사항/기획 | UW-00014~00019 | 과업/요구사항/유저스토리 CRUD, 이력관리, 기획트리, 단위업무 CRUD |
| 설계 | UW-00020~00026 | 화면/영역/기능 CRUD, AI 태스크 관리, 설계트리, 워크스페이스 AI, 피드백 알림 |
| AI/표준가이드 | UW-00027~00034 | 일괄설계(BulkDesign), 요구사항 허브, 설계변경이력, 표준가이드 CRUD/분류/검토/검색 |
| 공통 | UW-00035 | 시스템 공통 레이아웃(GNB/LNB/StatusBar) |
| 스펙 정합성 | UW-00036 | 구현 편차·후속 source 변경 수집, 사람 검토, 스펙/소스 현행화 |

**참고**: 위 목록은 "UW PRD 스코프"이며 실제 코드의 메뉴 명칭(§1)과 1:1 대응하지 않는
경우가 있다(예: WBS/캘린더/업무일지/리더리포트/PM보드 등은 이후 개편으로 추가된 화면 —
UW 문서 없이 구현/운영 중). UW-24~29·31~34는 PRD가 폐기(freeze)된 스코프이므로 "PRD
누락"으로 보고하지 말 것.

> 단일 진실 소스: `.claude/biz/A.단위업무.md`, `/md/prd/UW-XXXXX_*.md`
