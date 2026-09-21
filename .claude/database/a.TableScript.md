# 🗄️ System Database Schema

> **💡 AI 인지 가이드 (공통 규칙)**
> - 데이터 타입 축약: `v`=varchar, `t`=text, `ts`=timestamp, `i`=int/serial, `b`=bpchar, `num`=numeric
> - 제약 조건 약어: `PK`=Primary Key, `FK`=Foreign Key, `NN`=Not Null
> - 공통 Audit 컬럼(`creat_dt`, `mdfcn_dt`, `creat_mber_id`, `mdfcn_mber_id`)은 대부분의 테이블에 존재하며 특별한 로직이 없는 한 생략함.

## 1. AI 및 태스크 관리 (AI & Task)
* **`tb_ai_prompt_template`** (AI 프롬프트 템플릿)
  * `tmpl_id` (v36, PK): 템플릿 UUID
  * `prjct_id` (v36): 프로젝트 ID (NULL=시스템 기본)
  * `tmpl_nm` (v200, NN): 템플릿 명
  * `task_ty_code` (v20, NN): 태스크 유형 (INSPECT/DESIGN 등)
  * `sys_prompt_cn` (t): 시스템 프롬프트 내용
  * `use_yn` (b1, NN): 사용 여부 (기본 Y)
* **`tb_ai_task`** (AI 태스크)
  * `ai_task_id` (t, PK): 태스크 ID
  * `prjct_id` (t, NN) / `ref_ty_code` (t, NN) / `ref_id` (t, NN): 참조 정보
  * `task_sttus_code` (t, NN): 상태 (PENDING 등)
  * `req_cn` (t) / `result_cn` (t): 요청 및 결과 내용
  * `req_snapshot_data` (jsonb): 요청 당시 스냅샷

## 2. 공통 및 회원 관리 (Common & Member)
* **`tb_cm_member`** (회원)
  * `mber_id` (t, PK): 회원 ID
  * `email_addr` (t, Unique): 이메일
  * `mber_sttus_code` (t, NN): 상태 (UNVERIFIED 등)
  * `plan_code` (t, 기본 `FREE`) / `plan_expire_dt` (ts): 실효 플랜의 **미러**. 결제 구독(`tb_bl_subscription`)이 살아 있으면
    구독 서비스가 `BASIC`/NULL 로, 종료·강등 시 `FREE`/NULL 로 써 준다. 구독 없는 회원은 관리자 수동 부여값(4단계 PATCH).
    살아 있는 구독이 있는 회원의 수동 변경은 409. 판정: `src/lib/permissions.ts resolveEffectivePlan`
* **`tb_cm_member_session`** (회원 세션)
  * `sesn_id` (t, PK) / `mber_id` (t, FK) / `device_info_cn` (t)
* 인증/보안 관련 테이블: `tb_cm_account_lock`, `tb_cm_email_verification`, `tb_cm_login_attempt`, `tb_cm_password_reset_token`, `tb_cm_refresh_token`, `tb_cm_social_account` (모두 `mber_id` FK 포함)
* **`tb_cm_code`** & **`tb_cm_code_group`** (공통 코드)
  * 그룹: `grp_code_id` (PK) / `grp_code` (v100) / `grp_code_nm` (v100)
  * 코드: `cm_code_id` (PK) / `cm_code` (v100) / `code_nm` (v100) / `grp_code_id` (FK)
* **`tb_cm_attach_file`** (첨부 파일)
  * `attach_file_id` (t, PK) / `ref_tbl_nm` (t) / `ref_id` (t): 다형 참조 구조
* **`tb_cm_progress`** (진척 현황 — 현재 `tb_ds_function`에서만 사용)
  * `progrs_id` (v36, PK) / `ref_tbl_nm` (v50) / `ref_id` (v36, Unique)
  * `design_rt`, `impl_rt` (i, 0~100): 슬라이더로 직접 입력, 화면/단위업무는 이 값들의 평균 롤업
  * `test_rt` (i, 0~100): 2026-07-28 3차 개편으로 UI/API 어디서도 읽거나 쓰지 않음 — 자동테스트
    연동 전까지 컬럼만 스키마에 남겨둠(값은 과거 데이터 그대로 고정, 항상 0 취급하면 됨)
  * `analy_rt`는 2026-07-28에 컬럼 자체가 제거됨 — 분석 진척은 `tb_rq_requirement.progrs_rt`로 이동
* **`tb_cm_standard_info`** (기준 정보 — 시스템 운영의 기준값 lookup)
  * `std_info_id` (t, PK) / `std_info_code` (v6) / `std_bgng_de` (v8)
  * 명명 이력: 2026-05-05 reference_info / ref_* → standard_info / std_* 통일

## 3. 프로젝트 관리 (Project)
* **`tb_pj_project`** (프로젝트)
  * `prjct_id` (t, PK) / `prjct_nm` (t, NN) / `client_nm` (t)
  * `owner_mber_id` (t, NOT NULL, 인덱스 `tb_pj_project_owner_idx`): 프로젝트 소유자 — 2026-09-19 추가 (1단계 nullable 추가 → 배포 → step2 NOT NULL 전환, 둘 다 운영 적용 완료).
    "소유자는 항상 1명"의 단일 기준. `tb_pj_project_member.role_code='OWNER'` 멤버와 항상 같은 사람이며
    양도(역할 API의 OWNER 지정, transfer-and-leave)에서 두 곳을 한 트랜잭션으로 함께 갱신한다.
    회원 탈퇴 시 소유 프로젝트 판정, 플랜 상한(프로젝트 수·좌석), 결제 주체 판정은 모두 이 컬럼만 본다.
    `creat_mber_id` 는 생성자 감사용으로만 남김(양도해도 바뀌지 않음) — 소유 판정에 쓰지 말 것.
    FK 없음(creat_mber_id 와 동일한 문자열 참조; 회원은 논리 삭제만 함). 마이그레이션: `prisma/sql/2026-09-19_add_project_owner.sql` → 배포 → `..._step2.sql`
  * 회원 탈퇴 시 소유 프로젝트는 2026-09-19부터 즉시 물리 삭제가 아니라 프로젝트 삭제와 같은
    보관 삭제(`del_yn='Y'` + `hard_del_dt`)를 탄다 — 공통 로직 `src/lib/projectLifecycle.ts`
* **`tb_pj_project_member`** (프로젝트 멤버)
  * `prjct_mber_id` (t, PK) / `prjct_id` (t, FK) / `mber_id` (t, FK)
  * `role_code` (t, 기본 MEMBER): OWNER / ADMIN / MEMBER / VIEWER.
    OWNER 는 프로젝트당 정확히 1명(2026-09-19부터) — 과거의 "복수 OWNER + 마지막 OWNER 보호" 모델은 폐기.
    OWNER 를 다른 역할로 내리는 API 요청은 거부되며, 소유자를 바꾸는 길은 양도만 있다.
  * `lock_yn` (b1, NOT NULL, 기본 `N`) / `lock_dt` (ts): 결제 잠금 — 2026-09-20 추가 (`prisma/sql/2026-09-20_create_billing.sql`).
    소유자가 강등(해지 확정·결제 실패 소진)되면 소유 프로젝트 전부 `Y`. 조회·MCP 읽기는 되고 쓰기 권한만
    `requirePermission` 에서 403 `PROJECT_LOCKED` (멤버 제거·역할 변경·삭제·양도는 잠금 해소 수단이라 예외).
    해제 3경로: 재결제 성공(전부) / 소유자 "활성화"(상한 이하인 프로젝트만) / 강등 직후 소유 프로젝트 1개뿐이면 자동.
    소유권 이전·복구 시 새 소유자 플랜 기준 상한 초과면 `Y` 로 넘어간다. 로직: `src/lib/billing/lock.ts`
* 프로젝트 설정/권한 관련: `tb_pj_project_settings`, `tb_pj_settings_history`, `tb_pj_project_api_key`, `tb_pj_project_invitation`, `tb_pj_member_removal_notice`
  * `tb_pj_project_settings.plan_code` 는 **삭제됨** (2026-09-20 운영 적용, `prisma/sql/2026-09-20_drop_project_settings_plan_code.sql`).
    플랜은 `tb_cm_member.plan_code` 에만 있다.
  * `tb_pj_project_settings.artifact_scope_code` (v10, NOT NULL, 기본 `ALL`): 산출물 출력 범위
    `ALL`(전체 출력 — 이전 사업분 포함, 항목마다 구분 표기) / `SCOPED`(이번 사업분 + 상위 계층만).
    2026-09-12 추가. 프로젝트당 한 번 지정해 모든 산출물 출력에 적용된다.
    목록·트리 같은 작업 화면에는 적용하지 않는다 — 작업 중에는 이전 사업분도 보여야 한다.

## 4. 요구사항 관리 (Requirements)
* **`tb_rq_task`** (과업/Task)
  * `task_id` (t, PK) / `task_display_id` (t, NN) / `task_nm` (t, NN)
  * `creat_mber_id`, `mdfcn_mber_id` (t): 생성자/최종 수정자 — 생성 후 30분 보정 권한과 감사 추적에 사용
* **`tb_rq_requirement`** (요구사항)
  * `req_id` (t, PK) / `task_id` (t, FK) / `req_display_id` (t, NN)
  * `priort_code` (t) / `analy_cn`, `spec_cn` (t): 분석 및 스펙
  * `anls_bgng_de`, `anls_end_de` (v, yyyy-MM-dd 문자열), `anls_efrt_val` (v): 분석 일정/공수 —
    설계=단위업무, 구현=화면·기능처럼 분석은 요구사항 레벨에서 직접 관리(2026-07-17/28 추가)
  * `progrs_rt` (i, 0~100): 분석 진척률(담당자 슬라이더 입력) — 예전 `tb_cm_progress.analy_rt` 대체
  * `creat_mber_id`, `mdfcn_mber_id` (t): 생성자/최종 수정자
  * `mdfcn_src_code` (v10): 최종 수정 경로 `WEB | MCP | SYNC` (2026-09-12 추가) —
    MCP 키 소유자와 웹 로그인 사용자가 동일인이라 `mdfcn_mber_id` 만으로는 두 경로를
    구분할 수 없어 분리. 기본값 없음(과거 수정분은 NULL = 모름). 설계 5계층에만 존재.
    쓰기는 `src/lib/mdfcnSource.ts` 의 `buildMdfcnAudit()` 경유 — `mdfcn_dt` 를 갱신하는
    모든 경로가 이 컬럼도 함께 갱신해야 한다(하나만 갱신하면 이전 출처가 남아 오표시)
  * `scope_sttus_code` (v10, NOT NULL, 기본 `NEW`): 사업 범위 구분
    `NEW`(이번 사업 신규) / `MODIFIED`(이전 사업분을 이번에 수정) / `EXISTING`(이전 사업 그대로,
    맥락 제공용) / `DEPRECATED`(이번 사업에서 폐기) — 2026-09-12 추가, 설계 5계층에만 존재.
    고도화(2차 이상) 사업에서 한 프로젝트에 이전/이번 사업 결과물이 섞이는 것을 가르는 값.
    기본값이 `NEW` 인 이유는 `tb_ds_db_table.tbl_sttus_code`(기본 `EXISTING`)와 반대다 —
    그쪽은 AS-IS 스키마를 통째로 쓸어담는 도구이고, 설계 5계층은 평소 등록분이 이번 사업
    산출물인 것이 정상이기 때문. AS-IS 등록 경로에서만 `EXISTING` 을 명시해 넣는다.
    자동 판정 없음(`mdfcn_dt` 로는 오타 수정과 사업 범위 수정이 구분되지 않는다).
    상수·판정은 `src/lib/scopeStatus.ts`. 변경 권한은 MANAGER(OWNER/ADMIN, PM/PL) 한정 —
    `specContentFieldPolicy.ts` 의 어느 allow-list 에도 넣지 않는 방식으로 강제한다.
    용도: (1) 산출물 출력 필터(`tb_pj_project_settings.artifact_scope_code`)
          (2) 공수·진척·지연·누락 집계에서 `EXISTING` 제외(출력 설정과 무관하게 항상)
* **`tb_rq_user_story`** (유저 스토리)
  * `story_id` (t, PK) / `req_id` (t, FK) / `persona_cn`, `scenario_cn` (t)
  * `creat_mber_id`, `mdfcn_mber_id` (t): 생성자/최종 수정자
* **`tb_rq_acceptance_criteria`** (인수 기준)
  * `ac_id` (t, PK) / `story_id` (t, FK) / `given_cn`, `when_cn`, `then_cn` (t)
* **`tb_rq_baseline_snapshot`** (베이스라인 스냅샷) & **`tb_rq_requirement_history`** (이력)

## 5. 설계 및 기획실 (Design & Plan Studio)
* **`tb_ds_plan_studio`** (기획실 워크스페이스)
  * `plan_studio_id` (t, PK) / `prjct_id` (t, FK)
  * `plan_studio_display_id` (t, NN, Unique)
  * `plan_studio_div_code` (t, NN): 기획구분 (IA/JOURNEY/MOCKUP 등)
  * `plan_cn` (t): 기획 본문 (마크다운)
  * `coment_cn` (t): AI 지시사항
* **`tb_ds_plan_studio_artf`** (기획실 산출물 이력)
  * `artf_id` (t, PK) / `plan_studio_id` (t, FK) / `ver_no` (i)
  * `artf_fmt_code` (t, MD/MERMAID 등) / `artf_cn` (t): 산출물 본문
  * `good_design_yn` (b1): 대표 지정 건 (Unique)
* **`tb_ds_plan_studio_ctxt`** (다형적 컨텍스트 참조)
  * `ctxt_id` (t, PK) / `plan_studio_id` (t, FK)
  * `ctxt_ty_code` (t) / `ref_id` (t): 참조 대상 분리
* **`tb_ds_unit_work`** (단위 업무)
  * `unit_work_id` (t, PK) / `req_id` (t, FK) / `unit_work_nm` (t)
  * `plan_dsgn_bgng_de`, `plan_dsgn_end_de`, `plan_dsgn_efrt_val` (v): PM이 잡는 계획 설계
    일정/공수 — 하위 화면·기능의 실제 진행과 무관한 목표치. 2026-07-28 2차 개편으로
    단위업무가 설계 일정/공수를 갖는 유일한 레벨이 됨(화면이 5~15개+인 경우 화면별로
    따로 잡기엔 부담이라 여기로 통일)
  * `dsgn_doc_sttus_code` (v, BEFORE/DOING/DONE): 단위업무 설계서 작성 상태
  * 실적 진행률(%)은 컬럼이 없음 — 항상 하위 화면→기능(`tb_cm_progress`) 롤업으로 계산
    (`src/lib/pm/progressRollup.ts`)
  * `creat_mber_id`, `mdfcn_mber_id` (t): 생성자/최종 수정자
  * `mdfcn_src_code` (v10): 최종 수정 경로 `WEB | MCP | SYNC` — `tb_rq_requirement` 참고
  * `scope_sttus_code` (v10, 기본 `NEW`): 사업 범위 구분 — `tb_rq_requirement` 참고
* **`tb_ds_screen`** & **`tb_ds_area`** & **`tb_ds_function`** (화면/영역/기능 계층)
  * 화면(`tb_ds_screen`): `scrn_id` (PK) / `unit_work_id` (FK)
    * `creat_mber_id`, `mdfcn_mber_id` (t): 생성자/최종 수정자
    * `mdfcn_src_code` (v10): 최종 수정 경로 `WEB | MCP | SYNC` — `tb_rq_requirement` 참고
    * `scope_sttus_code` (v10, 기본 `NEW`): 사업 범위 구분 — `tb_rq_requirement` 참고
    * `actl_impl_bgng_de`, `actl_impl_end_de` (v): 담당 개발자가 커밋하는 실질 구현 일정 —
      화면이 유일하게 갖는 일정 축(설계 일정은 없음, 단위업무의 `plan_dsgn_*`를 상속 표시만 함)
    * `dsgn_doc_sttus_code` (v): 화면정의서 작성 상태
    * 공수(effort) 컬럼 없음 — 설계공수는 단위업무, 구현공수는 기능 소관
  * 영역(`tb_ds_area`): `area_id` (PK) / `scrn_id` (FK) / `excaldw_data` (jsonb)
    * `creat_mber_id`, `mdfcn_mber_id` (t): 생성자/최종 수정자
    * `mdfcn_src_code` (v10): 최종 수정 경로 `WEB | MCP | SYNC` — `tb_rq_requirement` 참고
    * `scope_sttus_code` (v10, 기본 `NEW`): 사업 범위 구분 — `tb_rq_requirement` 참고
    * `dsgn_doc_sttus_code` (v): 영역 와이어프레임 작성 상태. 일정/공수/진척률 컬럼 없음
  * 기능(`tb_ds_function`): `func_id` (PK) / `area_id` (FK)
    * `creat_mber_id`, `mdfcn_mber_id` (t): 생성자/최종 수정자
    * `mdfcn_src_code` (v10): 최종 수정 경로 `WEB | MCP | SYNC` — `tb_rq_requirement` 참고
    * `scope_sttus_code` (v10, 기본 `NEW`): 사업 범위 구분 — `tb_rq_requirement` 참고
    * `impl_efrt_val` (v): 구현 공수(2026-07-28 리네임, 예전 `efrt_val`). 날짜 컬럼 없음 —
      구현 일정은 소속 화면(`actl_impl_*`)을 그대로 상속해서 표시
    * `dsgn_doc_sttus_code` (v): 기능정의서 작성 상태
    * 설계/구현 진척률(%)은 `tb_cm_progress`(`design_rt`/`impl_rt`)에 저장 — 화면·단위업무는
      이 값의 평균 롤업. 테스트 진척률(`test_rt`)은 2026-07-28 3차 개편으로 UI에서 완전히 뺌
* **`tb_ds_memo`** (메모보드 — 프로젝트 내 자유 메모, 엔티티 연결 선택)
  * `memo_id` (t, PK) / `prjct_id` (t, FK NN)
  * `memo_sj` (t, NN, 기본 '') / `memo_cn` (t, nullable): 제목/본문(WEB 타입)
  * `memo_ty_code` (v10, NN, 기본 WEB): `WEB`(리치텍스트) | `EXCEL`(Fortune-sheet) — 작성 시 확정, 이후 불변
  * `sheet_data` (jsonb, nullable): EXCEL 타입 워크북 데이터 — `memo_ty_code='EXCEL'`일 때만 값 존재
  * `visblty_code` (v20, NN, 기본 PRIVATE): `PRIVATE`(나만보기) | `TEAM_READ`(전체조회, 작성자만 수정) | `TEAM_EDIT`(전체수정, 프로젝트 멤버 누구나 수정)
    * 2026-08-19: 기존 `share_yn`(Y/N) 폐지·대체. 동시수정 충돌은 처리하지 않음(나중 저장이 덮어씀)
  * `memo_purps_code` (v20, NN, 기본 GENERAL): `GENERAL`(일반) | `MEETING`(회의록)
    * 2026-08-31 추가. 회의록을 별도 게시판/테이블로 만들지 않고 메모를 용도로만 구분하기
      위한 필드 — LNB "회의록" 메뉴는 `/memos?purpose=MEETING`으로 이 값을 필터링해 진입한다
      (참석자·액션아이템 등 구조화된 집계가 필요 없다고 합의되어 자유서식 그대로 재사용)
  * `ref_ty_code` (t, nullable) / `ref_id` (t, nullable): 다형 참조 — `REQUIREMENT`(요구사항) / `TASK`(과업) / `UNIT_WORK`(단위업무) / `SCREEN`(화면) / `AREA`(영역) / `FUNCTION`(기능). 둘 다 NULL = 전역 메모
  * `view_cnt` (i) / `creat_mber_id` (t, NN, 작성자) / `mdfr_mber_id` (t)
  * 인덱스: `(prjct_id, creat_dt DESC)`, `(prjct_id, ref_ty_code, ref_id)`
* **`tb_ds_db_table`** & **`tb_ds_db_table_column`** (데이터 모델 설계)
  * 테이블: `tbl_id` (t, PK) / `tbl_physcl_nm` (t) / `tbl_lgcl_nm` (t)
  * 컬럼: `col_id` (t, PK) / `tbl_id` (t, FK) / `col_physcl_nm` (t) / `data_ty_nm` (t)
* 리뷰 시스템: **`tb_ds_review_request`**, **`tb_ds_review_comment`**
* 설계 변경/매핑: **`tb_ds_design_change`**, **`tb_ds_col_mapping`**

## 6. 표준 가이드 (Standard Guide)
* **`tb_sg_std_guide`** (표준 가이드 문서 — UW-00030)
  * `guide_id` (v36, PK): 가이드 UUID
  * `prjct_id` (v36, NN): 프로젝트 ID
  * `guide_ctgry_code` (v20, NN): 카테고리 (UI/DATA/AUTH/API/COMMON/SECURITY/FILE/ERROR/BATCH/REPORT)
  * `guide_sj` (v200, NN): 제목
  * `guide_cn` (t): 본문 (마크다운)
  * `use_yn` (b1, NN): Y=활성, N=소프트 삭제 (기본 Y)
  * 인덱스: (prjct_id, use_yn, mdfcn_dt DESC, creat_dt DESC), (prjct_id, guide_ctgry_code, use_yn)

## 7. 시스템 문서 (Docs Hub) — `sys_docs`
* **`tb_sys_docs_section`** (시스템 문서 섹션 — Docs Hub 1단계 트리)
  * `sect_id` (v36, PK): 섹션 UUID
  * `sect_slug` (v50, NN): URL slug — partial unique (use_yn='Y' 범위)
  * `sect_nm` (v200, NN): 섹션 표시명
  * `sect_icon_code` (v50): 트리 아이콘 키 (menuIcons.tsx i_*)
  * `sort_ordr` (i, NN): 표시 순서
  * `use_yn` (b1, NN): Y=공개, N=숨김 (기본 Y)
  * 인덱스: (use_yn, sort_ordr)
  * 비고: SUPER_ADMIN 전용. prjct_id 없음 — 시스템 자산.
* **`tb_sys_docs_page`** (시스템 문서 페이지 — Docs Hub 2단계, 실제 문서)
  * `page_id` (v36, PK): 페이지 UUID
  * `sect_id` (v36, FK NN): 섹션 참조 (ON DELETE RESTRICT)
  * `page_slug` (v50, NN): URL slug — (sect_id, page_slug) partial unique
  * `page_sj` (v200, NN): 페이지 제목
  * `page_excerpt` (v500): 한 줄 요약
  * `page_cn` (t): Markdown 본문 (단일 진실)
  * `page_sttus_code` (v20, NN): DRAFT|PUBLISHED|ARCHIVED (기본 DRAFT)
  * `badge_code` (v20): NEW|BETA|DEPRECATED|NULL
  * 인덱스: (sect_id, use_yn, sort_ordr), (page_sttus_code, mdfcn_dt DESC, creat_dt DESC)
  * 라우팅: `/docs/[sect_slug]/[page_slug]`
* **`tb_sys_attach_file`** (시스템 첨부파일 — SUPER_ADMIN 업로드)
  * `attach_id` (v36, PK)
  * `ref_tbl_nm` (v50, NN) / `ref_id` (v36, NN): 다형 참조 (예: tb_sys_docs_page)
  * `attach_div_code` (v20, NN): INLINE(본문 이미지) | ATTACH(별첨 다운로드)
  * `orgnl_file_nm`, `stor_file_nm`, `file_path_nm`, `file_sz`(bigint), `file_extsn_nm`, `mime_ty`
  * 인덱스: (ref_tbl_nm, ref_id, use_yn, sort_ordr), (use_yn, creat_dt DESC)
  * 비고: `tb_cm_attach_file` 와 분리 — 권한 경계/lifecycle/정책이 다름

## 8. 특수 목적 (Diff Test)
* **`tb_sp_diff_test_master`** & **`tb_sp_diff_test_node`**
  * `diff_prompt_md` (t), `diff_summary_json` (jsonb), `chg_mode_code` 등 프롬프트 변경점 추적 용도

## 9. 구현-설계 동기화 (UW-00036)

이 기능은 Git 기준선이나 Diff 이력을 저장하지 않는다. 지정 UW의 실행 시점 설계 snapshot과
로컬 에이전트가 확인한 현재 소스를 비교하고, 결과를 비동기 웹 검토용으로만 보관한다.

* **`tb_sp_sync_run`** (동기화 실행 헤더)
  * `sync_run_id` (t, PK), `prjct_id` (t, FK CASCADE)
  * `unit_work_id` (t, nullable FK SET NULL), UW 표시 ID·이름 snapshot
  * `sync_mode_code`: `CHECK | DEEP_SYNC`
  * `sync_sttus_code`: `RUNNING | NEEDS_INPUT | NEEDS_REVIEW | COMPLETED | FAILED | CANCELLED`
  * `design_snapshot_data`, `design_snapshot_hash`: 실행 시점 의미 설계와 canonical SHA-256
  * `source_scope_data`: 로컬에서 확정한 관련 파일·심볼과 분석 시작 시점 원문 SHA-256
  * `analysis_summary_data`: 점검 대상·정상·문제·결정 대기 건수와 두 축 요약
  * 두 독립 verdict: 구현 정합성 `PASS | FAIL | UNKNOWN`, 설계 커버리지
    `CLEAR | GAP_CANDIDATE | UNKNOWN`
  * `client_submission_key`: 같은 로컬 요청의 네트워크 재시도 중복 방지
* **`tb_sp_sync_item`** (문제 항목별 분석·사람 결정 — 정상 항목은 저장하지 않음)
  * `sync_item_id` (t, PK), `sync_run_id` (t, FK CASCADE)
  * `finding_ty_code`: `IMPLEMENTATION | DESIGN_COVERAGE`
  * 구현 결과와 커버리지 결과는 서로 다른 축으로 저장
  * evidence는 저장소 상대 path, symbol, line, redacted snippet과 hash만 보관
  * AI는 `proposed_value_cn`만 제안하고 `before_value_cn/before_hash`는 서버가 run snapshot에서 파생
  * 자동 적용 대상은 네 설명 필드만 허용:
    `UNIT_WORK.unit_work_dc`, `SCREEN.scrn_dc`, `AREA.area_dc`, `FUNCTION.func_dc`
  * `item_sttus_code`: `INFORMATIONAL | PENDING | APPLIED | REJECTED | DEFERRED | DESIGN_CHANGED`
    (`INFORMATIONAL`은 전환 전 결과 호환용이며 신규 실행은 문제를 `PENDING`으로만 생성)
  * APPLY는 대상 행 잠금과 exact hash 재검사를 통과한 경우에만 수행하고
    `tb_ds_design_change`와 연결한다.

제거된 V1 테이블:
`tb_sp_source_repository`, `tb_sp_source_baseline`, `tb_sp_impl_receipt`,
`tb_sp_reconcile_batch`, `tb_sp_reconcile_item`, `tb_sp_spec_source_link`.

`tb_sp_impl_snapshot`은 구현요청 당시 설계 snapshot 기능이 계속 사용하므로 유지한다.

DDL: `prisma/sql/2026-08-17_create_spec_sync_v2.sql`

## 10. 결제·구독 (Billing) — `tb_bl_*`

정책 문서 `.claude/biz/B.결제정책.md` §3 2단계 (2026-09-20). DDL `prisma/sql/2026-09-20_create_billing.sql`.
PG 는 게이트웨이 인터페이스(`src/lib/billing/gateway.ts`) 뒤에 있고, 현재 구현은 Mock(`PAYMENT_GATEWAY=mock`).
상품 코드를 두어 SPECODE 전용으로 짜지 않았다 — 표준화닷컴 상품은 `src/lib/billing/constants.ts PRODUCTS` 한 줄 추가.

* **`tb_bl_subscription`** (구독 — 결제자 1인 × 상품 1개 = 1행, 상태만 변경·행 재사용)
  * `sbscrptn_id` (t, PK) / `mber_id` (t, NN, FK → tb_cm_member) / `prdct_code` (v30, NN): `SPECODE_BASIC`
  * UNIQUE `(mber_id, prdct_code)` — 재구독 시 같은 행을 되살린다 (단가는 재구독 시점 판매가로 갱신)
  * `sbscrptn_sttus_code` (v20, NN): `ACTIVE` | `PAST_DUE`(재시도 중, 혜택 유지) | `CANCEL_SCHEDULED`(기간 말 해지 예정) | `CANCELED` | `EXPIRED`(재시도 소진 강등).
    "살아 있는" 상태 = 앞의 셋. 좌석 상한·관리자 409 판정은 이 셋만 본다
  * `seat_cnt` (i, NN): 구매 좌석. 편집 멤버(OWNER/ADMIN/MEMBER, 소유 활성 프로젝트 전체 distinct) 수 ≤ seat_cnt 불변식
  * `pending_seat_cnt` (i): 축소 예약 — 다음 결제 시 적용. 예약 중에는 예약값이 초대 상한 (`seats.getSeatLimit`)
  * `unit_price` (i, NN): 계약 좌석 단가(부가세 포함). 가격 인상 시 기존 구독 유지용
  * `billing_key` (t): PG 빌링키 — `src/lib/encrypt.ts` AES 암호화 저장. 종료(CANCELED/EXPIRED)·탈퇴 시 NULL
  * `card_co_nm` (v50) / `card_no_masked` (v30): 표시용 카드 정보
  * `pg_provdr_code` (v10, NN): `MOCK` | `TOSS` · `pg_customer_key` (v100, NN): 회원별 고정 해시 (`gateway.buildCustomerKey`)
  * `crrnt_perd_bgng_dt` / `crrnt_perd_end_dt` / `next_bill_dt` (ts): 결제 주기. 갱신 시 새 주기 시작 = 이전 종료(연속).
    다음 결제일은 매월 같은 날(KST), 없는 날은 말일 — 기준일(anchor)은 마지막 INITIAL 결제의 KST 일자
  * `prentc_dt` (ts): 이번 주기 "결제 7일 전 안내" 발송 시각. 갱신 시 NULL 리셋 — 배치 중복 발송 방지 (설계 표에 없던 운영 컬럼)
  * `fail_cnt` (i, NN 기본 0) / `last_fail_dt` (ts): 연속 실패. 초기 실패 1 + 3일 간격 재시도 3회 소진(fail_cnt 4) → EXPIRED
  * `cancel_reqst_dt` / `ended_dt` (ts)
  * `ended_rsn_code` (v30, 2026-09-21): 종료 사유 `USER_CANCEL` | `PAYMENT_RETRY_EXHAUSTED` | `ADMIN_TERMINATE` | `MEMBER_WITHDRAWAL` | `REFUND_WITHDRAWAL`. 상태의 보조 정보, 재구독 시 NULL. 이전 종료 건은 NULL
  * `billing_op_token` (v36) / `billing_op_started_dt` (ts) (2026-09-21): 결제 작업 토큰. PG 청구를 시작한 요청이 보유, 결제 결과는 토큰 일치 시만 반영, 살아 있는 동안(2분) 다른 변경은 409. `src/lib/billing/subscription.ts beginBillingOperation`
  * 인덱스 `(sbscrptn_sttus_code, next_bill_dt)` — 일일 배치 스캔
* **`tb_bl_payment`** (결제 이력 — 영수증·환불 판정 근거)
  * `pymnt_id` (t, PK) / `sbscrptn_id` (t, **NULL 허용**, FK → tb_bl_subscription) / `mber_id` (t, NN)
    · NULL = 첫 결제(INITIAL) 실패로 구독 행을 만들지 않은 경우. 조회는 항상 `mber_id` 기준
  * `pymnt_ty_code` (v20, NN): `INITIAL` | `RECURRING` | `SEAT_ADD` | `REFUND`
  * `amt` (i, NN, 원) / `seat_cnt` (i, NN): SEAT_ADD 는 추가 좌석 수 · `perd_bgng_dt`/`perd_end_dt`: 덮는 기간(SEAT_ADD 는 결제 시점~주기 종료)
  * `pymnt_sttus_code` (v20, NN): `PAID` | `FAILED` | `PARTIALLY_REFUNDED`(누적 환불 < 원 금액) | `REFUNDED`(전액 환불된 원 결제 또는 환불 행)
  * `orig_pymnt_id` (t, 자기 참조 FK `tb_bl_payment_orig_fk`, 인덱스, 2026-09-21): REFUND 행이 가리키는 원 결제. 누적 환불액·잔액 계산 근거
  * `refund_rsn_code` (v20, 2026-09-21): 환불 유형 `WITHDRAWAL`(청약철회: 전액·구독 종료) | `ADJUSTMENT`(운영 보정: 전액/부분·구독 유지). REFUND 행에만
  * `pg_cancel_key` (v200, 2026-09-21): PG 취소 트랜잭션 키(토스 cancels[].transactionKey). Mock 은 NULL
  * `pg_provdr_code` (v10) / `pg_pymnt_key` (v200) / `pg_order_id` (v64, **UNIQUE**, 시도마다 새 발급 `SPC-yyyymmddHHmmss-XXXXXXXX`)
  * `receipt_url` (t) / `fail_rsn_cn` (t): `PG코드: 메시지` / `apprv_dt` (ts)
  * 인덱스 `(mber_id, creat_dt DESC)`
  * 환불 판정 3플래그(정책 §1-7)는 컬럼이 아니라 계산: 마지막 INITIAL PAID 의 `apprv_dt` 이후 프로젝트 `creat_dt`·멤버 `join_dt`·첨부 `creat_dt` — `src/lib/billing/paidUsage.ts`
* **`tb_bl_pg_event`** (PG 웹훅 원문)
  * `event_id` (t, PK) / `pg_provdr_code` (v10) / `pg_event_id` (v200): UNIQUE `(pg_provdr_code, pg_event_id)` 로 재전송 멱등
  * `event_ty_code` (v60) / `payload` (jsonb) / `prcs_sttus_code` (v20, 기본 `RECEIVED`): `RECEIVED` | `PROCESSED` | `IGNORED` | `FAILED` / `prcs_dt` / `prcs_rsn_cn`
  * v1 은 청구를 동기 API 로 반영하므로 웹훅은 기록만(`IGNORED`). 토스 어댑터 시 이벤트별 처리 추가

배치: `POST /api/admin/batch/run/billing-daily` (`job_ty_code=BILLING_DAILY`, `src/lib/billing/daily.ts`) — 하루 1회
① CANCEL_SCHEDULED 기간 종료 → CANCELED ② ACTIVE 결제일 → RECURRING ③ PAST_DUE 3일 간격 재시도 ④ 결제 7일 전 안내.
DDL 2차: `prisma/sql/2026-09-21_billing_admin_ops.sql` (nullable 6컬럼 추가만, `npm run db:migrate:billing-admin-ops`).
관리자 운영: `/admin/billing` — 조회 `src/lib/billing/admin-queries.ts`, 액션 `admin-actions.ts`(즉시 재결제·결제일 연기·강제 종료·환불 기록·잠금 해제 대행, 감사 `tb_sys_admin_audit` 와 같은 트랜잭션).
검증: `npm run test:billing:db` (임시 스키마에서 전체 흐름 스모크 19단계, 동시성 포함, 운영 데이터 무영향).

