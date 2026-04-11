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
* **`tb_cm_progress`** (진척 현황)
  * `progrs_id` (v36, PK) / `ref_tbl_nm` (v50) / `ref_id` (v36, Unique)
  * `analy_rt`, `design_rt`, `impl_rt`, `test_rt` (i, 0~100)
* **`tb_cm_reference_info`** (참조 정보)
  * `ref_info_id` (t, PK) / `ref_info_code` (v6) / `ref_bgng_de` (v8)

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
* **`tb_rq_requirement`** (요구사항)
  * `req_id` (t, PK) / `task_id` (t, FK) / `req_display_id` (t, NN)
  * `priort_code` (t) / `analy_cn`, `spec_cn` (t): 분석 및 스펙
* **`tb_rq_user_story`** (유저 스토리)
  * `story_id` (t, PK) / `req_id` (t, FK) / `persona_cn`, `scenario_cn` (t)
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
* **`tb_ds_screen`** & **`tb_ds_area`** & **`tb_ds_function`** (화면/영역/기능 계층)
  * 화면(`tb_ds_screen`): `scrn_id` (PK) / `unit_work_id` (FK)
  * 영역(`tb_ds_area`): `area_id` (PK) / `scrn_id` (FK) / `excaldw_data` (jsonb)
  * 기능(`tb_ds_function`): `func_id` (PK) / `area_id` (FK) / `impl_bgng_de`, `impl_end_de` (t)
* **`tb_ds_db_table`** & **`tb_ds_db_table_column`** (데이터 모델 설계)
  * 테이블: `tbl_id` (t, PK) / `tbl_physcl_nm` (t) / `tbl_lgcl_nm` (t)
  * 컬럼: `col_id` (t, PK) / `tbl_id` (t, FK) / `col_physcl_nm` (t) / `data_ty_nm` (t)
* 리뷰 시스템: **`tb_ds_review_request`**, **`tb_ds_review_comment`**
* 설계 변경/매핑: **`tb_ds_design_change`**, **`tb_ds_col_mapping`**

## 6. 특수 목적 (Diff Test)
* **`tb_sp_diff_test_master`** & **`tb_sp_diff_test_node`**
  * `diff_prompt_md` (t), `diff_summary_json` (jsonb), `chg_mode_code` 등 프롬프트 변경점 추적 용도