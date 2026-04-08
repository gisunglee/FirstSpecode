-- ============================================================
-- [SPECODE ERD v3 핵심 구조 요약 (Blueprint)]
-- * 최상위 도메인: 모든 주요 데이터는 tb_pj_project(프로젝트)에 종속됨 (1:N)
-- 
-- 1. [cm] 공통 (회원/인증/공통코드)
--    tb_cm_member(회원) 중심으로 인증, 토큰, 세션, 첨부파일 관리
--    tb_cm_code_group(공통코드 그룹) -> tb_cm_code(공통코드) : 시스템 공통코드 관리
-- 
-- 2. [pj] 프로젝트 (공간/권한)
--    tb_pj_project(프로젝트) -> tb_pj_project_member(멤버), 설정, 초대, API키
-- 
-- 3. [rq] 기획/요구 (요구사항 계층 구조)
--    tb_rq_task(과업) -> tb_rq_requirement(요구사항) -> tb_rq_user_story(스토리) -> tb_rq_acceptance_criteria(인수기준)
--    * 부가: 기준선 스냅샷, 요구사항 변경 이력
-- 
-- 4. [ds] 설계 (화면 설계 & DB 설계 계층 구조)
--    [UI 설계] tb_ds_unit_work(단위업무) -> tb_ds_screen(화면) -> tb_ds_area(영역) -> tb_ds_function(기능)
--    [DB 설계] tb_ds_db_table(DB테이블) -> tb_ds_table_column(테이블컬럼)
--    [UI-DB 맵핑] tb_ds_function(기능) + tb_ds_table_column(컬럼) => tb_ds_function_column_mapping 매핑
--    * 부가: 설계 변경 이력, 테이블 컬럼 변경 이력
-- 
-- 5. [ai] AI (자동화)
--    tb_ai_task(AI태스크) -> 영역(AREA) 또는 기능(FUNCTION) 등을 다형성(ref_ty_code, ref_id)으로 참조
-- ============================================================


-- [SPECODE ERD v3 AI-Optimized DDL (Hybrid Format)]
-- * 전역 생략 컬럼 (AI 기본 인지): creat_dt, mdfcn_dt, sort_ordr
-- * 모든 PK는 VARCHAR(36) UUID

-- ==========================================
-- [cm] 공통 (9개)
-- ==========================================
CREATE TABLE tb_cm_member ( -- 회원
    mber_id VARCHAR(36) PRIMARY KEY, -- 회원 아이디
    email_addr VARCHAR(320) UNIQUE, -- 이메일 주소
    pswd_hash VARCHAR(256), -- 비밀번호 해시
    mber_nm VARCHAR(100), -- 회원 명
    profl_img_url VARCHAR(500), -- 프로필 이미지 URL
    mber_sttus_code VARCHAR(20) DEFAULT 'UNVERIFIED', -- 회원 상태 (UNVERIFIED/ACTIVE/WITHDRAWN)
    join_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 가입 일시
    wthdrw_dt TIMESTAMP -- 탈퇴 일시
);

CREATE TABLE tb_cm_email_verification ( -- 이메일 인증
    vrfctn_id VARCHAR(36) PRIMARY KEY, -- 인증 아이디
    mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 회원 아이디
    email_addr VARCHAR(320) NOT NULL, -- 이메일 주소
    vrfctn_token_val VARCHAR(256) NOT NULL, -- 인증 토큰 값
    vrfctn_ty_code VARCHAR(20) NOT NULL, -- 인증 유형 (REGISTER/EMAIL_CHANGE)
    vrfctn_sttus_code VARCHAR(20) DEFAULT 'PENDING', -- 인증 상태 (PENDING/VERIFIED/EXPIRED)
    expiry_dt TIMESTAMP NOT NULL, -- 만료 일시
    vrfctn_dt TIMESTAMP -- 인증 일시
);

CREATE TABLE tb_cm_login_attempt ( -- 로그인 시도
    attempt_id VARCHAR(36) PRIMARY KEY, -- 시도 아이디
    mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 회원 아이디
    attempt_ip_addr VARCHAR(45) NOT NULL, -- 시도 IP 주소
    succes_yn CHAR(1) DEFAULT 'N', -- 성공 여부 (Y/N)
    fail_rsn_cn VARCHAR(200), -- 실패 사유 내용
    attempt_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- 시도 일시
);

CREATE TABLE tb_cm_account_lock ( -- 계정 잠금
    lock_id VARCHAR(36) PRIMARY KEY, -- 잠금 아이디
    mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 회원 아이디
    lock_rsn_cn VARCHAR(200) NOT NULL, -- 잠금 사유 내용
    fail_cnt INTEGER DEFAULT 5, -- 실패 횟수
    lock_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 잠금 일시
    lock_expiry_dt TIMESTAMP NOT NULL, -- 잠금 만료 일시
    unlock_token_val VARCHAR(256), -- 해제 토큰 값
    unlock_dt TIMESTAMP, -- 해제 일시
    lock_sttus_code VARCHAR(20) DEFAULT 'LOCKED' -- 잠금 상태 (LOCKED/UNLOCK_PENDING/UNLOCKED)
);

CREATE TABLE tb_cm_social_account ( -- 소셜 계정
    social_acnt_id VARCHAR(36) PRIMARY KEY, -- 소셜 계정 아이디
    mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 회원 아이디
    provdr_code VARCHAR(20) NOT NULL, -- 제공자 코드 (GOOGLE/GITHUB)
    provdr_user_id VARCHAR(256) NOT NULL, -- 제공자 사용자 아이디
    provdr_email_addr VARCHAR(320), -- 제공자 이메일 주소
    link_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 연동 일시
    UNIQUE (provdr_code, provdr_user_id)
);

CREATE TABLE tb_cm_refresh_token ( -- 리프레시 토큰
    token_id VARCHAR(36) PRIMARY KEY, -- 토큰 아이디
    mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 회원 아이디
    token_hash_val VARCHAR(256) NOT NULL, -- 토큰 해시 값
    device_info_cn VARCHAR(500), -- 기기 정보 내용
    auto_login_yn CHAR(1) DEFAULT 'N', -- 자동 로그인 여부 (Y/N)
    issu_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 발급 일시
    expiry_dt TIMESTAMP NOT NULL, -- 만료 일시
    revoke_dt TIMESTAMP -- 폐기 일시
);

CREATE TABLE tb_cm_password_reset_token ( -- 비밀번호 재설정 토큰
    reset_token_id VARCHAR(36) PRIMARY KEY, -- 재설정 토큰 아이디
    mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 회원 아이디
    token_val VARCHAR(256) NOT NULL, -- 토큰 값
    token_sttus_code VARCHAR(20) DEFAULT 'PENDING', -- 토큰 상태 (PENDING/USED/EXPIRED)
    expiry_dt TIMESTAMP NOT NULL, -- 만료 일시
    use_dt TIMESTAMP -- 사용 일시
);

CREATE TABLE tb_cm_member_session ( -- 회원 세션
    sesn_id VARCHAR(36) PRIMARY KEY, -- 세션 아이디
    mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 회원 아이디
    device_info_cn VARCHAR(500), -- 기기 정보 내용
    ip_addr VARCHAR(45), -- IP 주소
    last_acces_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 마지막 접속 일시
    invald_dt TIMESTAMP -- 무효화 일시
);

CREATE TABLE tb_cm_attach_file ( -- 공통 첨부파일
    attach_file_id VARCHAR(36) PRIMARY KEY, -- 첨부파일 아이디
    prjct_id VARCHAR(36) NOT NULL, -- 프로젝트 아이디
    ref_tbl_nm VARCHAR(50) NOT NULL, -- 참조 테이블 명
    ref_id VARCHAR(36) NOT NULL, -- 참조 아이디
    file_ty_code VARCHAR(20) DEFAULT 'FILE', -- 파일 유형 (IMAGE/FILE)
    orgnl_file_nm VARCHAR(300) NOT NULL, -- 원본 파일 명
    stor_file_nm VARCHAR(300) NOT NULL, -- 저장 파일 명
    file_path_nm VARCHAR(500) NOT NULL, -- 파일 경로 명
    file_sz BIGINT NOT NULL, -- 파일 크기
    file_extsn_nm VARCHAR(20), -- 파일 확장자 명
    upload_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- 업로드 일시
);

-- ==========================================
-- [pj] 프로젝트 (7개)
-- ==========================================
CREATE TABLE tb_pj_project ( -- 프로젝트
    prjct_id VARCHAR(36) PRIMARY KEY, -- 프로젝트 아이디
    prjct_nm VARCHAR(200) NOT NULL, -- 프로젝트 명
    prjct_dc TEXT, -- 프로젝트 설명
    client_nm VARCHAR(200), -- 고객사 명
    bgng_de DATE, -- 시작 일자
    end_de DATE, -- 종료 일자
    creat_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id) -- 생성 회원 아이디
);

CREATE TABLE tb_pj_project_member ( -- 프로젝트 멤버
    prjct_mber_id VARCHAR(36) PRIMARY KEY, -- 프로젝트 멤버 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 회원 아이디
    role_code VARCHAR(20) DEFAULT 'MEMBER', -- 역할 (OWNER/ADMIN/PM/DESIGNER/DEVELOPER/VIEWER)
    join_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 가입 일시
    last_acces_dt TIMESTAMP, -- 마지막 접속 일시
    mber_sttus_code VARCHAR(20) DEFAULT 'ACTIVE', -- 회원 상태 (ACTIVE/REMOVED/LEFT)
    sttus_chg_dt TIMESTAMP, -- 상태 변경 일시
    UNIQUE (prjct_id, mber_id)
);

CREATE TABLE tb_pj_project_invitation ( -- 프로젝트 초대
    invt_id VARCHAR(36) PRIMARY KEY, -- 초대 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    email_addr VARCHAR(320) NOT NULL, -- 이메일 주소
    role_code VARCHAR(20) DEFAULT 'MEMBER', -- 역할 코드
    invt_token_val VARCHAR(256) NOT NULL, -- 초대 토큰 값
    invtr_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 초대자 회원 아이디
    invt_sttus_code VARCHAR(20) DEFAULT 'PENDING', -- 초대 상태 (PENDING/ACCEPTED/EXPIRED/CANCELLED)
    invt_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 초대 일시
    expiry_dt TIMESTAMP NOT NULL, -- 만료 일시
    accept_dt TIMESTAMP, -- 수락 일시
    cancel_dt TIMESTAMP -- 취소 일시
);

CREATE TABLE tb_pj_project_api_key ( -- 프로젝트 API 키
    api_key_id VARCHAR(36) PRIMARY KEY, -- API 키 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    provdr_nm VARCHAR(50) NOT NULL, -- 제공자 명
    encpt_key_val TEXT NOT NULL, -- 암호화 키 값
    mask_key_val VARCHAR(50) NOT NULL -- 마스킹 키 값
);

CREATE TABLE tb_pj_project_settings ( -- 프로젝트 설정
    seting_id VARCHAR(36) PRIMARY KEY, -- 설정 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id) UNIQUE, -- 프로젝트 아이디
    ai_call_mthd_code VARCHAR(20) DEFAULT 'DIRECT', -- AI 호출 방식 (DIRECT/QUEUE)
    plan_code VARCHAR(20) DEFAULT 'FREE' -- 요금제 (FREE/PRO/ENTERPRISE)
);

CREATE TABLE tb_pj_settings_history ( -- 설정 변경 이력
    hist_id VARCHAR(36) PRIMARY KEY, -- 이력 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    chg_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 변경 회원 아이디
    chg_item_nm VARCHAR(100) NOT NULL, -- 변경 항목 명
    bfr_val_cn TEXT, -- 변경전 값 내용
    aftr_val_cn TEXT, -- 변경후 값 내용
    chg_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- 변경 일시
);

CREATE TABLE tb_pj_member_removal_notice ( -- 회원 제거 안내
    notice_id VARCHAR(36) PRIMARY KEY, -- 안내 아이디
    mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 회원 아이디
    prjct_id VARCHAR(36) NOT NULL, -- 프로젝트 아이디
    prjct_nm VARCHAR(200) NOT NULL, -- 프로젝트 명
    cnfrm_yn CHAR(1) DEFAULT 'N', -- 확인 여부 (Y/N)
    remov_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 제거 일시
    cnfrm_dt TIMESTAMP -- 확인 일시
);

-- ==========================================
-- [rq] 기획/요구 (7개)
-- ==========================================
CREATE TABLE tb_rq_task ( -- 과업
    task_id VARCHAR(36) PRIMARY KEY, -- 과업 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    task_display_id VARCHAR(20) NOT NULL, -- 과업 표시 아이디 (SFR-00001)
    task_nm VARCHAR(200) NOT NULL, -- 과업 명
    ctgry_code VARCHAR(20) DEFAULT 'NEW_DEV', -- 카테고리 (NEW_DEV/IMPROVE/MAINTAIN)
    defn_cn TEXT, -- 정의 내용
    dtl_cn TEXT, -- 세부 내용
    output_info_cn TEXT, -- 산출물 정보 내용
    rfp_page_no VARCHAR(20), -- RFP 페이지 번호
    UNIQUE (prjct_id, task_display_id)
);

CREATE TABLE tb_rq_requirement ( -- 요구사항
    req_id VARCHAR(36) PRIMARY KEY, -- 요구사항 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    task_id VARCHAR(36) REFERENCES tb_rq_task(task_id), -- 과업 아이디
    req_display_id VARCHAR(20) NOT NULL, -- 요구사항 표시 아이디 (REQ-00001)
    req_nm VARCHAR(300) NOT NULL, -- 요구사항 명
    priort_code VARCHAR(10) DEFAULT 'MEDIUM', -- 우선순위 (HIGH/MEDIUM/LOW)
    src_code VARCHAR(20) DEFAULT 'RFP', -- 출처 (RFP/MEETING 등)
    req_sttus_code VARCHAR(20) DEFAULT 'REGISTERED', -- 상태 (REGISTERED/ANALYZING 등)
    rfp_page_no VARCHAR(20), -- RFP 페이지 번호
    orgnl_cn TEXT, -- 원문 내용
    curncy_cn TEXT, -- 현행화 내용
    analy_cn TEXT, -- 분석 내용
    spec_cn TEXT, -- 명세 내용
    asign_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 담당 회원 아이디
    bgng_de DATE, -- 시작 일자
    end_de DATE, -- 종료 일자
    UNIQUE (prjct_id, req_display_id)
);

CREATE TABLE tb_rq_requirement_history ( -- 요구사항 변경 이력
    req_hist_id VARCHAR(36) PRIMARY KEY, -- 요구사항 이력 아이디
    req_id VARCHAR(36) REFERENCES tb_rq_requirement(req_id), -- 요구사항 아이디
    vrsn_no VARCHAR(10) NOT NULL, -- 버전 번호
    vrsn_ty_code VARCHAR(20) DEFAULT 'INTERNAL', -- 버전 유형 (INTERNAL/CONFIRMED)
    orgnl_cn TEXT, -- 원문 내용
    curncy_cn TEXT, -- 현행화 내용
    spec_cn TEXT, -- 명세 내용
    vrsn_coment_cn TEXT, -- 버전 코멘트 내용
    chg_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id) -- 변경 회원 아이디
);

CREATE TABLE tb_rq_baseline_snapshot ( -- 기준선 스냅샷
    basln_id VARCHAR(36) PRIMARY KEY, -- 기준선 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    basln_nm VARCHAR(200) NOT NULL, -- 기준선 명
    coment_cn TEXT, -- 코멘트 내용
    req_cnt INTEGER DEFAULT 0, -- 요구사항 수
    snapshot_data JSONB NOT NULL, -- 스냅샷 데이터
    cnfrm_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 확정 회원 아이디
    cnfrm_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- 확정 일시
);

CREATE TABLE tb_rq_user_story ( -- 사용자스토리
    story_id VARCHAR(36) PRIMARY KEY, -- 스토리 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    req_id VARCHAR(36) REFERENCES tb_rq_requirement(req_id), -- 요구사항 아이디
    story_display_id VARCHAR(20) NOT NULL, -- 스토리 표시 아이디 (STR-00001)
    story_nm VARCHAR(300) NOT NULL, -- 스토리 명
    persona_cn VARCHAR(500) NOT NULL, -- 페르소나 내용
    scenario_cn TEXT NOT NULL, -- 시나리오 내용
    UNIQUE (prjct_id, story_display_id)
);

CREATE TABLE tb_rq_acceptance_criteria ( -- 인수기준
    ac_id VARCHAR(36) PRIMARY KEY, -- 인수기준 아이디
    story_id VARCHAR(36) REFERENCES tb_rq_user_story(story_id), -- 스토리 아이디
    given_cn TEXT NOT NULL, -- Given 조건 내용
    when_cn TEXT NOT NULL, -- When 행동 내용
    then_cn TEXT NOT NULL -- Then 결과 내용
);

-- ==========================================
-- [ds] 설계 (10개)
-- ==========================================
CREATE TABLE tb_ds_unit_work ( -- 단위업무
    unit_work_id VARCHAR(36) PRIMARY KEY, -- 단위업무 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    req_id VARCHAR(36) REFERENCES tb_rq_requirement(req_id), -- 요구사항 아이디
    unit_work_display_id VARCHAR(20) NOT NULL, -- 단위업무 표시 아이디 (UW-00001)
    unit_work_nm VARCHAR(300) NOT NULL, -- 단위업무 명
    unit_work_dc TEXT, -- 단위업무 설명
    asign_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 담당 회원 아이디
    bgng_de DATE, -- 시작 일자
    end_de DATE, -- 종료 일자
    progrs_rt INTEGER DEFAULT 0 CHECK (progrs_rt BETWEEN 0 AND 100), -- 진척 율
    UNIQUE (prjct_id, unit_work_display_id)
);

CREATE TABLE tb_ds_screen ( -- 화면
    scrn_id VARCHAR(36) PRIMARY KEY, -- 화면 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    unit_work_id VARCHAR(36) REFERENCES tb_ds_unit_work(unit_work_id), -- 단위업무 아이디
    scrn_display_id VARCHAR(20) NOT NULL, -- 화면 표시 아이디 (PID-00001)
    scrn_nm VARCHAR(200) NOT NULL, -- 화면 명
    scrn_dc TEXT, -- 화면 설명
    dsply_code VARCHAR(50), -- 표시 코드 (라우팅용)
    scrn_ty_code VARCHAR(20) DEFAULT 'LIST', -- 화면 유형 (LIST/DETAIL/POPUP/TAB)
    ctgry_l_nm VARCHAR(100), -- 카테고리 대 명
    ctgry_m_nm VARCHAR(100), -- 카테고리 중 명
    ctgry_s_nm VARCHAR(100), -- 카테고리 소 명
    asign_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 담당 회원 아이디
    bgng_de DATE, -- 시작 일자
    end_de DATE, -- 종료 일자
    UNIQUE (prjct_id, scrn_display_id)
);

CREATE TABLE tb_ds_area ( -- 영역
    area_id VARCHAR(36) PRIMARY KEY, -- 영역 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    scrn_id VARCHAR(36) REFERENCES tb_ds_screen(scrn_id), -- 화면 아이디
    area_display_id VARCHAR(20) NOT NULL, -- 영역 표시 아이디 (AID-00001)
    area_nm VARCHAR(200) NOT NULL, -- 영역 명
    area_ty_code VARCHAR(20) DEFAULT 'FORM', -- 영역 유형 (SEARCH/GRID/FORM 등)
    area_dc TEXT, -- 영역 설명
    excaldw_data JSONB, -- Excalidraw 데이터
    UNIQUE (prjct_id, area_display_id)
);

CREATE TABLE tb_ds_function ( -- 기능
    func_id VARCHAR(36) PRIMARY KEY, -- 기능 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    area_id VARCHAR(36) REFERENCES tb_ds_area(area_id), -- 영역 아이디
    func_display_id VARCHAR(20) NOT NULL, -- 기능 표시 아이디 (FID-00001)
    func_nm VARCHAR(300) NOT NULL, -- 기능 명
    func_ty_code VARCHAR(20) DEFAULT 'ETC', -- 기능 유형 (SEARCH/SAVE/DELETE 등)
    spec_cn TEXT, -- 명세 내용
    asign_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 담당 회원 아이디
    impl_bgng_de DATE, -- 구현 시작 일자
    impl_end_de DATE, -- 구현 종료 일자
    cmplx_code VARCHAR(10), -- 복잡도 코드
    efrt_val VARCHAR(20), -- 공수 값
    func_sttus_code VARCHAR(20) DEFAULT 'NOT_STARTED', -- 기능 상태
    UNIQUE (prjct_id, func_display_id)
);

CREATE TABLE tb_ds_db_table ( -- DB 테이블
    tbl_id VARCHAR(36) PRIMARY KEY, -- 테이블 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    schema_nm VARCHAR(100), -- 스키마 명
    tbl_physcl_nm VARCHAR(100) NOT NULL, -- 테이블 물리 명
    tbl_logic_nm VARCHAR(200) NOT NULL, -- 테이블 논리 명
    tbl_dc TEXT -- 테이블 설명
);

CREATE TABLE tb_ds_table_column ( -- 테이블 컬럼
    col_id VARCHAR(36) PRIMARY KEY, -- 컬럼 아이디
    tbl_id VARCHAR(36) REFERENCES tb_ds_db_table(tbl_id), -- 테이블 아이디
    col_physcl_nm VARCHAR(100) NOT NULL, -- 컬럼 물리 명
    col_logic_nm VARCHAR(200) NOT NULL, -- 컬럼 논리 명
    data_ty_nm VARCHAR(50) NOT NULL, -- 데이터 타입 명
    data_len INTEGER, -- 데이터 길이
    null_yn CHAR(1) DEFAULT 'Y', -- NULL 허용 여부
    pk_yn CHAR(1) DEFAULT 'N', -- PK 여부
    deflt_val_cn VARCHAR(200), -- 기본 값 내용
    col_dc TEXT -- 컬럼 설명
);

CREATE TABLE tb_ds_table_column_history ( -- 테이블 컬럼 변경 이력
    col_hist_id VARCHAR(36) PRIMARY KEY, -- 컬럼 이력 아이디
    tbl_id VARCHAR(36) REFERENCES tb_ds_db_table(tbl_id), -- 테이블 아이디
    col_id VARCHAR(36) NOT NULL, -- 컬럼 아이디
    chg_ty_code VARCHAR(10) NOT NULL, -- 변경 유형 (INSERT/UPDATE/DELETE)
    col_physcl_nm VARCHAR(100) NOT NULL, -- 컬럼 물리 명
    col_logic_nm VARCHAR(200) NOT NULL, -- 컬럼 논리 명
    data_ty_nm VARCHAR(50) NOT NULL, -- 데이터 타입 명
    bfr_val_cn JSONB, -- 변경전 값 내용
    aftr_val_cn JSONB, -- 변경후 값 내용
    chg_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 변경 회원 아이디
    chg_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- 변경 일시
);

CREATE TABLE tb_ds_function_column_mapping ( -- 기능 컬럼 매핑
    mapping_id VARCHAR(36) PRIMARY KEY, -- 매핑 아이디
    func_id VARCHAR(36) REFERENCES tb_ds_function(func_id), -- 기능 아이디
    col_id VARCHAR(36) REFERENCES tb_ds_table_column(col_id), -- 컬럼 아이디
    dsply_item_nm VARCHAR(200), -- 표시 항목 명
    use_purps_cn VARCHAR(200) NOT NULL -- 사용 용도 내용
);

CREATE TABLE tb_ds_design_change ( -- 설계 변경 이력
    chg_id VARCHAR(36) PRIMARY KEY, -- 변경 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    ref_tbl_nm VARCHAR(50) NOT NULL, -- 참조 테이블 명
    ref_id VARCHAR(36) NOT NULL, -- 참조 아이디
    chg_rsn_cn TEXT, -- 변경 사유 내용
    snapshot_data JSONB NOT NULL, -- 스냅샷 데이터
    ai_req_yn CHAR(1) DEFAULT 'N', -- AI 요청 반영 여부
    ai_task_id VARCHAR(36), -- AI 태스크 아이디
    chg_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 변경 회원 아이디
    chg_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- 변경 일시
);

-- ==========================================
-- [ai] AI (1개)
-- ==========================================
CREATE TABLE tb_ai_task ( -- AI 태스크
    ai_task_id VARCHAR(36) PRIMARY KEY, -- AI 태스크 아이디
    prjct_id VARCHAR(36) REFERENCES tb_pj_project(prjct_id), -- 프로젝트 아이디
    ref_ty_code VARCHAR(20) NOT NULL, -- 참조 유형 (AREA/FUNCTION)
    ref_id VARCHAR(36) NOT NULL, -- 참조 아이디
    task_ty_code VARCHAR(20) NOT NULL, -- 태스크 유형 (INSPECT/DESIGN/IMPLEMENT 등)
    req_cn TEXT, -- 요청 내용
    coment_cn TEXT, -- 코멘트 내용
    result_cn TEXT, -- 결과 내용
    task_sttus_code VARCHAR(20) DEFAULT 'PENDING', -- 태스크 상태 (PENDING/DONE/FAILED/TIMEOUT 등)
    reject_rsn_cn TEXT, -- 반려 사유 내용
    req_snapshot_data JSONB, -- 요청 스냅샷 데이터
    parent_task_id VARCHAR(36) REFERENCES tb_ai_task(ai_task_id), -- 원본 태스크 아이디
    retry_cnt INTEGER DEFAULT 3, -- 잔여 재시도 횟수
    exec_avlbl_dt TIMESTAMP, -- 실행 가능 일시
    req_mber_id VARCHAR(36) REFERENCES tb_cm_member(mber_id), -- 요청 회원 아이디
    req_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 요청 일시
    compl_dt TIMESTAMP, -- 완료 일시
    apply_dt TIMESTAMP -- 반영 일시
);

-- ============================================================
-- 10. tb_cm_code_group — 공통코드 그룹
-- ============================================================
CREATE TABLE tb_cm_code_group (
    grp_code VARCHAR(100) PRIMARY KEY, -- 그룹 코드 (PK)
    grp_code_nm VARCHAR(100) NOT NULL UNIQUE, -- 그룹 코드명 (유니크)
    grp_code_dc VARCHAR(4000), -- 그룹 코드 설명
    use_yn CHAR(1) DEFAULT 'Y', -- 사용 여부
    creat_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 생성 일시
    mdfcn_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- 수정 일시
);

-- ============================================================
-- 11. tb_cm_code — 공통코드
-- ============================================================
CREATE TABLE tb_cm_code (
    cm_code_id SERIAL PRIMARY KEY, -- 코드 ID (PK, 자동 증가)
    cm_code VARCHAR(100) NOT NULL UNIQUE, -- 코드 (영문/숫자/_/:/- 허용, 유니크)
    grp_code VARCHAR(100) NOT NULL REFERENCES tb_cm_code_group(grp_code) ON DELETE CASCADE, -- 그룹 코드 (FK)
    code_nm VARCHAR(100) NOT NULL, -- 코드명
    code_dc VARCHAR(4000), -- 코드 설명
    use_yn CHAR(1) DEFAULT 'Y', -- 사용 여부
    sort_ordr INTEGER DEFAULT 0, -- 정렬 순서
    creat_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 생성 일시
    mdfcn_dt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 수정 일시
    UNIQUE(grp_code, code_nm) -- 같은 그룹 내 코드명 중복 방지
);