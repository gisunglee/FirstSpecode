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
* **`tb_pj_project_member`** (프로젝트 멤버)
  * `prjct_mber_id` (t, PK) / `prjct_id` (t, FK) / `mber_id` (t, FK)
  * `role_code` (t, 기본 MEMBER)
* 프로젝트 설정/권한 관련: `tb_pj_project_settings`, `tb_pj_settings_history`, `tb_pj_project_api_key`, `tb_pj_project_invitation`, `tb_pj_member_removal_notice`

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
* **`tb_ds_screen`** & **`tb_ds_area`** & **`tb_ds_function`** (화면/영역/기능 계층)
  * 화면(`tb_ds_screen`): `scrn_id` (PK) / `unit_work_id` (FK)
    * `creat_mber_id`, `mdfcn_mber_id` (t): 생성자/최종 수정자
    * `actl_impl_bgng_de`, `actl_impl_end_de` (v): 담당 개발자가 커밋하는 실질 구현 일정 —
      화면이 유일하게 갖는 일정 축(설계 일정은 없음, 단위업무의 `plan_dsgn_*`를 상속 표시만 함)
    * `dsgn_doc_sttus_code` (v): 화면정의서 작성 상태
    * 공수(effort) 컬럼 없음 — 설계공수는 단위업무, 구현공수는 기능 소관
  * 영역(`tb_ds_area`): `area_id` (PK) / `scrn_id` (FK) / `excaldw_data` (jsonb)
    * `creat_mber_id`, `mdfcn_mber_id` (t): 생성자/최종 수정자
    * `dsgn_doc_sttus_code` (v): 영역 와이어프레임 작성 상태. 일정/공수/진척률 컬럼 없음
  * 기능(`tb_ds_function`): `func_id` (PK) / `area_id` (FK)
    * `creat_mber_id`, `mdfcn_mber_id` (t): 생성자/최종 수정자
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
  * `source_scope_data`: 로컬에서 확정한 관련 파일·심볼 범위
  * 두 독립 verdict: 구현 정합성 `PASS | FAIL | UNKNOWN`, 설계 커버리지
    `CLEAR | GAP_CANDIDATE | UNKNOWN`
  * `client_submission_key`: 같은 로컬 요청의 네트워크 재시도 중복 방지
* **`tb_sp_sync_item`** (항목별 분석·사람 결정)
  * `sync_item_id` (t, PK), `sync_run_id` (t, FK CASCADE)
  * `finding_ty_code`: `IMPLEMENTATION | DESIGN_COVERAGE`
  * 구현 결과와 커버리지 결과는 서로 다른 축으로 저장
  * evidence는 저장소 상대 path, symbol, line, redacted snippet과 hash만 보관
  * AI는 `proposed_value_cn`만 제안하고 `before_value_cn/before_hash`는 서버가 run snapshot에서 파생
  * 자동 적용 대상은 네 설명 필드만 허용:
    `UNIT_WORK.unit_work_dc`, `SCREEN.scrn_dc`, `AREA.area_dc`, `FUNCTION.func_dc`
  * `item_sttus_code`: `INFORMATIONAL | PENDING | APPLIED | REJECTED | DEFERRED | DESIGN_CHANGED`
  * APPLY는 대상 행 잠금과 exact hash 재검사를 통과한 경우에만 수행하고
    `tb_ds_design_change`와 연결한다.

제거된 V1 테이블:
`tb_sp_source_repository`, `tb_sp_source_baseline`, `tb_sp_impl_receipt`,
`tb_sp_reconcile_batch`, `tb_sp_reconcile_item`, `tb_sp_spec_source_link`.

`tb_sp_impl_snapshot`은 구현요청 당시 설계 snapshot 기능이 계속 사용하므로 유지한다.

DDL: `prisma/sql/2026-08-17_create_spec_sync_v2.sql`
