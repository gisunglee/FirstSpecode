-- public.tb_ai_prompt_template definition

-- Drop table

-- DROP TABLE public.tb_ai_prompt_template;

CREATE TABLE public.tb_ai_prompt_template (
	tmpl_id varchar(36) NOT NULL, -- 템플릿 아이디 (UUID)
	prjct_id varchar(36) NULL, -- 프로젝트 아이디 (NULL: 시스템 기본 템플릿)
	tmpl_nm varchar(200) NOT NULL, -- 템플릿 명 (예: 설계 구현 요청, 영향도 분석)
	task_ty_code varchar(20) NOT NULL, -- 태스크 유형 코드 (INSPECT/DESIGN/IMPLEMENT/MOCKUP/IMPACT/CUSTOM)
	ref_ty_code varchar(20) NULL, -- 참조 유형 코드 (AREA/FUNCTION/NULL=범용)
	sys_prompt_cn text NULL, -- 시스템 프롬프트 내용 (AI 역할·규칙 지시)
	tmpl_dc text NULL, -- 템플릿 설명 (언제 쓰는지 안내)
	use_yn bpchar(1) DEFAULT 'Y'::bpchar NOT NULL, -- 사용 여부 (Y/N)
	sort_ordr int4 DEFAULT 0 NOT NULL,
	creat_mber_id varchar(36) NULL,
	creat_dt timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfcn_dt timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	use_cnt int4 DEFAULT 0 NOT NULL,
	default_yn bpchar(1) DEFAULT 'N'::bpchar NOT NULL,
	CONSTRAINT pk_ai_prompt_template PRIMARY KEY (tmpl_id)
);
CREATE INDEX idx_ai_tmpl_prjct ON public.tb_ai_prompt_template USING btree (prjct_id, task_ty_code, use_yn);
COMMENT ON TABLE public.tb_ai_prompt_template IS 'AI 프롬프트 템플릿';

-- Column comments

COMMENT ON COLUMN public.tb_ai_prompt_template.tmpl_id IS '템플릿 아이디 (UUID)';
COMMENT ON COLUMN public.tb_ai_prompt_template.prjct_id IS '프로젝트 아이디 (NULL: 시스템 기본 템플릿)';
COMMENT ON COLUMN public.tb_ai_prompt_template.tmpl_nm IS '템플릿 명 (예: 설계 구현 요청, 영향도 분석)';
COMMENT ON COLUMN public.tb_ai_prompt_template.task_ty_code IS '태스크 유형 코드 (INSPECT/DESIGN/IMPLEMENT/MOCKUP/IMPACT/CUSTOM)';
COMMENT ON COLUMN public.tb_ai_prompt_template.ref_ty_code IS '참조 유형 코드 (AREA/FUNCTION/NULL=범용)';
COMMENT ON COLUMN public.tb_ai_prompt_template.sys_prompt_cn IS '시스템 프롬프트 내용 (AI 역할·규칙 지시)';
COMMENT ON COLUMN public.tb_ai_prompt_template.tmpl_dc IS '템플릿 설명 (언제 쓰는지 안내)';
COMMENT ON COLUMN public.tb_ai_prompt_template.use_yn IS '사용 여부 (Y/N)';

-- Permissions

ALTER TABLE public.tb_ai_prompt_template OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ai_prompt_template TO postgres;


-- public.tb_ai_task definition

-- Drop table

-- DROP TABLE public.tb_ai_task;

CREATE TABLE public.tb_ai_task (
	ai_task_id text NOT NULL, -- 태스트 아이디
	prjct_id text NOT NULL, -- 프로젝트 아이디
	ref_ty_code text NOT NULL, -- 참조 유형 코드
	ref_id text NOT NULL, -- 참조 아이디
	task_ty_code text NOT NULL, -- 태스크 타입 코드
	req_cn text NULL, -- 요청 내용
	coment_cn text NULL, -- 코멘트 내용
	result_cn text NULL, -- 결과 내용
	task_sttus_code text DEFAULT 'PENDING'::text NOT NULL, -- 태스크 상태 코드
	reject_rsn_cn text NULL, -- 반려 사유 내용
	req_snapshot_data jsonb NULL, -- 요청 스냅샷 데이터
	parent_task_id text NULL, -- 부모 태스크 아이디
	retry_cnt int4 DEFAULT 0 NOT NULL, -- 재요청 횟수
	exec_avlbl_dt timestamp(3) NULL, -- 실행 가능 일시
	req_mber_id text NULL, -- 요청 담당자 아이디
	req_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 요청 일시
	compl_dt timestamp(3) NULL, -- 완료 일시
	apply_dt timestamp(3) NULL, -- 적용 일시
	CONSTRAINT tb_ai_task_pkey PRIMARY KEY (ai_task_id)
);

-- Column comments

COMMENT ON COLUMN public.tb_ai_task.ai_task_id IS '태스트 아이디';
COMMENT ON COLUMN public.tb_ai_task.prjct_id IS '프로젝트 아이디';
COMMENT ON COLUMN public.tb_ai_task.ref_ty_code IS '참조 유형 코드';
COMMENT ON COLUMN public.tb_ai_task.ref_id IS '참조 아이디';
COMMENT ON COLUMN public.tb_ai_task.task_ty_code IS '태스크 타입 코드';
COMMENT ON COLUMN public.tb_ai_task.req_cn IS '요청 내용';
COMMENT ON COLUMN public.tb_ai_task.coment_cn IS '코멘트 내용';
COMMENT ON COLUMN public.tb_ai_task.result_cn IS '결과 내용';
COMMENT ON COLUMN public.tb_ai_task.task_sttus_code IS '태스크 상태 코드';
COMMENT ON COLUMN public.tb_ai_task.reject_rsn_cn IS '반려 사유 내용';
COMMENT ON COLUMN public.tb_ai_task.req_snapshot_data IS '요청 스냅샷 데이터';
COMMENT ON COLUMN public.tb_ai_task.parent_task_id IS '부모 태스크 아이디';
COMMENT ON COLUMN public.tb_ai_task.retry_cnt IS '재요청 횟수';
COMMENT ON COLUMN public.tb_ai_task.exec_avlbl_dt IS '실행 가능 일시';
COMMENT ON COLUMN public.tb_ai_task.req_mber_id IS '요청 담당자 아이디';
COMMENT ON COLUMN public.tb_ai_task.req_dt IS '요청 일시';
COMMENT ON COLUMN public.tb_ai_task.compl_dt IS '완료 일시';
COMMENT ON COLUMN public.tb_ai_task.apply_dt IS '적용 일시';

-- Permissions

ALTER TABLE public.tb_ai_task OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ai_task TO postgres;


-- public.tb_cm_attach_file definition

-- Drop table

-- DROP TABLE public.tb_cm_attach_file;

CREATE TABLE public.tb_cm_attach_file (
	attach_file_id text NOT NULL, -- 첨부 파일 아이디
	prjct_id text NOT NULL, -- 프로젝트 아이디
	ref_tbl_nm text NOT NULL, -- 참조 테이블 명
	ref_id text NOT NULL, -- 참조 아이디
	file_ty_code text DEFAULT 'FILE'::text NOT NULL, -- 파일 타입 코드
	orgnl_file_nm text NOT NULL, -- 원본 파일 명
	stor_file_nm text NOT NULL, -- 저장 파일 명
	file_path_nm text NOT NULL, -- 파일 경로 명
	file_sz int4 NOT NULL, -- 파일 사이즈
	file_extsn_nm text NOT NULL, -- 파일 확장자 명
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 등록 일시
	req_ref_yn text NULL, -- 요청 참조 여부
	CONSTRAINT tb_cm_attach_file_pkey PRIMARY KEY (attach_file_id)
);

-- Column comments

COMMENT ON COLUMN public.tb_cm_attach_file.attach_file_id IS '첨부 파일 아이디';
COMMENT ON COLUMN public.tb_cm_attach_file.prjct_id IS '프로젝트 아이디';
COMMENT ON COLUMN public.tb_cm_attach_file.ref_tbl_nm IS '참조 테이블 명';
COMMENT ON COLUMN public.tb_cm_attach_file.ref_id IS '참조 아이디';
COMMENT ON COLUMN public.tb_cm_attach_file.file_ty_code IS '파일 타입 코드';
COMMENT ON COLUMN public.tb_cm_attach_file.orgnl_file_nm IS '원본 파일 명';
COMMENT ON COLUMN public.tb_cm_attach_file.stor_file_nm IS '저장 파일 명';
COMMENT ON COLUMN public.tb_cm_attach_file.file_path_nm IS '파일 경로 명';
COMMENT ON COLUMN public.tb_cm_attach_file.file_sz IS '파일 사이즈';
COMMENT ON COLUMN public.tb_cm_attach_file.file_extsn_nm IS '파일 확장자 명';
COMMENT ON COLUMN public.tb_cm_attach_file.creat_dt IS '등록 일시';
COMMENT ON COLUMN public.tb_cm_attach_file.req_ref_yn IS '요청 참조 여부';

-- Permissions

ALTER TABLE public.tb_cm_attach_file OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_attach_file TO postgres;


-- public.tb_cm_code_group definition

-- Drop table

-- DROP TABLE public.tb_cm_code_group;

CREATE TABLE public.tb_cm_code_group (
	grp_code varchar(100) NOT NULL,
	grp_code_nm varchar(100) NOT NULL,
	grp_code_dc varchar(4000) NULL,
	use_yn bpchar(1) DEFAULT 'Y'::bpchar NOT NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfcn_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	grp_code_id serial4 NOT NULL,
	prjct_id varchar(36) NOT NULL,
	CONSTRAINT tb_cm_code_group_pkey PRIMARY KEY (grp_code_id),
	CONSTRAINT tb_cm_code_group_prjct_id_grp_code_key UNIQUE (prjct_id, grp_code),
	CONSTRAINT tb_cm_code_group_prjct_id_grp_code_nm_key UNIQUE (prjct_id, grp_code_nm)
);
CREATE INDEX tb_cm_code_group_prjct_id_idx ON public.tb_cm_code_group USING btree (prjct_id);

-- Permissions

ALTER TABLE public.tb_cm_code_group OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_code_group TO postgres;


-- public.tb_cm_member definition

-- Drop table

-- DROP TABLE public.tb_cm_member;

CREATE TABLE public.tb_cm_member (
	mber_id text NOT NULL, -- 회원 아이디
	email_addr text NULL, -- 이메일 주소
	pswd_hash text NULL, -- 비밀번호 해시
	mber_nm text NULL, -- 회원 명
	profl_img_url text NULL, -- 프로필 이미지 url
	mber_sttus_code text DEFAULT 'UNVERIFIED'::text NOT NULL, -- 회원 상태 코드
	join_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 가입 일시
	mdfcn_dt timestamp(3) NULL, -- 수정 일시
	wthdrw_dt timestamp(3) NULL, -- 탈퇴 일시
	plan_code varchar(20) DEFAULT 'FREE'::character varying NOT NULL, -- 계정 플랜 (FREE/PRO/TEAM/ENTERPRISE)
	plan_expire_dt timestamp(3) NULL, -- 유료 플랜 만료일 (NULL=무료/무제한)
	asignee_view_mode varchar(10) DEFAULT 'all'::character varying NOT NULL, -- 전역 담당자 필터 모드: all | me
	CONSTRAINT tb_cm_member_pkey PRIMARY KEY (mber_id)
);
CREATE UNIQUE INDEX tb_cm_member_email_addr_key ON public.tb_cm_member USING btree (email_addr);

-- Column comments

COMMENT ON COLUMN public.tb_cm_member.mber_id IS '회원 아이디';
COMMENT ON COLUMN public.tb_cm_member.email_addr IS '이메일 주소';
COMMENT ON COLUMN public.tb_cm_member.pswd_hash IS '비밀번호 해시';
COMMENT ON COLUMN public.tb_cm_member.mber_nm IS '회원 명';
COMMENT ON COLUMN public.tb_cm_member.profl_img_url IS '프로필 이미지 url';
COMMENT ON COLUMN public.tb_cm_member.mber_sttus_code IS '회원 상태 코드';
COMMENT ON COLUMN public.tb_cm_member.join_dt IS '가입 일시';
COMMENT ON COLUMN public.tb_cm_member.mdfcn_dt IS '수정 일시';
COMMENT ON COLUMN public.tb_cm_member.wthdrw_dt IS '탈퇴 일시';
COMMENT ON COLUMN public.tb_cm_member.plan_code IS '계정 플랜 (FREE/PRO/TEAM/ENTERPRISE)';
COMMENT ON COLUMN public.tb_cm_member.plan_expire_dt IS '유료 플랜 만료일 (NULL=무료/무제한)';
COMMENT ON COLUMN public.tb_cm_member.asignee_view_mode IS '전역 담당자 필터 모드: all | me';

-- Permissions

ALTER TABLE public.tb_cm_member OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_member TO postgres;


-- public.tb_cm_progress definition

-- Drop table

-- DROP TABLE public.tb_cm_progress;

CREATE TABLE public.tb_cm_progress (
	progrs_id varchar(36) NOT NULL,
	prjct_id varchar(36) NOT NULL,
	ref_tbl_nm varchar(50) NOT NULL, -- 참조 테이블 명 (tb_rq_task, tb_rq_requirement, tb_ds_unit_work, tb_ds_screen)
	ref_id varchar(36) NOT NULL, -- 참조 아이디
	analy_rt int4 DEFAULT 0 NOT NULL, -- 분석 율 (0~100, PM 직접 입력)
	design_rt int4 DEFAULT 0 NOT NULL, -- 설계 율 (0~100, 자동 계산 또는 직접 입력)
	impl_rt int4 DEFAULT 0 NOT NULL, -- 구현 율 (0~100, 자동 계산 또는 직접 입력)
	test_rt int4 DEFAULT 0 NOT NULL, -- 테스트 율 (0~100, PM 직접 입력)
	mdfcn_mber_id varchar(36) NULL, -- 수정 회원 아이디 (마지막 수정자)
	mdfcn_dt timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT ck_cm_progress_analy CHECK (((analy_rt >= 0) AND (analy_rt <= 100))),
	CONSTRAINT ck_cm_progress_design CHECK (((design_rt >= 0) AND (design_rt <= 100))),
	CONSTRAINT ck_cm_progress_impl CHECK (((impl_rt >= 0) AND (impl_rt <= 100))),
	CONSTRAINT ck_cm_progress_test CHECK (((test_rt >= 0) AND (test_rt <= 100))),
	CONSTRAINT pk_cm_progress PRIMARY KEY (progrs_id),
	CONSTRAINT uk_cm_progress_ref UNIQUE (ref_tbl_nm, ref_id)
);
COMMENT ON TABLE public.tb_cm_progress IS '진척 현황';

-- Column comments

COMMENT ON COLUMN public.tb_cm_progress.ref_tbl_nm IS '참조 테이블 명 (tb_rq_task, tb_rq_requirement, tb_ds_unit_work, tb_ds_screen)';
COMMENT ON COLUMN public.tb_cm_progress.ref_id IS '참조 아이디';
COMMENT ON COLUMN public.tb_cm_progress.analy_rt IS '분석 율 (0~100, PM 직접 입력)';
COMMENT ON COLUMN public.tb_cm_progress.design_rt IS '설계 율 (0~100, 자동 계산 또는 직접 입력)';
COMMENT ON COLUMN public.tb_cm_progress.impl_rt IS '구현 율 (0~100, 자동 계산 또는 직접 입력)';
COMMENT ON COLUMN public.tb_cm_progress.test_rt IS '테스트 율 (0~100, PM 직접 입력)';
COMMENT ON COLUMN public.tb_cm_progress.mdfcn_mber_id IS '수정 회원 아이디 (마지막 수정자)';

-- Permissions

ALTER TABLE public.tb_cm_progress OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_progress TO postgres;


-- public.tb_cm_rate_limit definition

-- Drop table

-- DROP TABLE public.tb_cm_rate_limit;

CREATE TABLE public.tb_cm_rate_limit (
	rate_key_val varchar(200) NOT NULL, -- 키: "<ENDPOINT>_<DIMENSION>:<value>" 형식 (예: LOGIN_IP:1.2.3.4)
	window_start_dt timestamp(3) NOT NULL, -- 현재 고정 윈도우 시작 시각
	req_cnt int4 DEFAULT 0 NOT NULL, -- 해당 윈도우 내 누적 요청 수
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 최초 생성 시각
	updt_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 마지막 갱신 시각
	CONSTRAINT tb_cm_rate_limit_pkey PRIMARY KEY (rate_key_val)
);
CREATE INDEX tb_cm_rate_limit_window_idx ON public.tb_cm_rate_limit USING btree (window_start_dt);
COMMENT ON TABLE public.tb_cm_rate_limit IS 'Rate Limit 카운터 (인증 엔드포인트 남용 방어)';

-- Column comments

COMMENT ON COLUMN public.tb_cm_rate_limit.rate_key_val IS '키: "<ENDPOINT>_<DIMENSION>:<value>" 형식 (예: LOGIN_IP:1.2.3.4)';
COMMENT ON COLUMN public.tb_cm_rate_limit.window_start_dt IS '현재 고정 윈도우 시작 시각';
COMMENT ON COLUMN public.tb_cm_rate_limit.req_cnt IS '해당 윈도우 내 누적 요청 수';
COMMENT ON COLUMN public.tb_cm_rate_limit.creat_dt IS '최초 생성 시각';
COMMENT ON COLUMN public.tb_cm_rate_limit.updt_dt IS '마지막 갱신 시각';

-- Permissions

ALTER TABLE public.tb_cm_rate_limit OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_rate_limit TO postgres;


-- public.tb_cm_reference_info definition

-- Drop table

-- DROP TABLE public.tb_cm_reference_info;

CREATE TABLE public.tb_cm_reference_info (
	ref_info_id text NOT NULL,
	ref_info_code varchar(6) NOT NULL,
	ref_bgng_de varchar(8) NOT NULL,
	ref_end_de varchar(8) NULL,
	ref_info_nm varchar(200) NOT NULL,
	bus_div_code varchar(6) NOT NULL,
	ref_data_ty_code varchar(6) NOT NULL,
	main_ref_val varchar(30) NULL,
	sub_ref_val varchar(30) NULL,
	ref_info_dc text NULL,
	use_yn bpchar(1) DEFAULT 'Y'::bpchar NOT NULL,
	del_yn bpchar(1) DEFAULT 'N'::bpchar NOT NULL,
	creat_mber_id text NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfcn_mber_id text NULL,
	mdfcn_dt timestamp(3) NULL,
	CONSTRAINT tb_cm_reference_info_pkey PRIMARY KEY (ref_info_id)
);
CREATE UNIQUE INDEX tb_cm_reference_info_ref_info_code_ref_bgng_de_key ON public.tb_cm_reference_info USING btree (ref_info_code, ref_bgng_de);

-- Permissions

ALTER TABLE public.tb_cm_reference_info OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_reference_info TO postgres;


-- public.tb_ds_col_mapping definition

-- Drop table

-- DROP TABLE public.tb_ds_col_mapping;

CREATE TABLE public.tb_ds_col_mapping (
	mapping_id varchar(36) NOT NULL, -- 매핑 아이디
	ref_ty_code varchar(20) NOT NULL, -- 참조 유형 코드
	ref_id varchar(36) NOT NULL, -- 참조 아이디
	col_id varchar(36) NULL, -- 컬럼 아이디
	io_se_code varchar(10) NULL, -- io 구분 코드
	ui_ty_code varchar(20) NULL, -- ui 유형 코드
	use_purps_cn varchar(200) NULL, -- 사용 목적 내용
	col_dc text NULL, -- 컬럼 설명
	sort_ordr int4 DEFAULT 0 NULL, -- 정렬 순서
	creat_dt timestamp DEFAULT CURRENT_TIMESTAMP NULL, -- 생성 일시
	CONSTRAINT tb_ds_col_mapping_pkey PRIMARY KEY (mapping_id)
);

-- Column comments

COMMENT ON COLUMN public.tb_ds_col_mapping.mapping_id IS '매핑 아이디';
COMMENT ON COLUMN public.tb_ds_col_mapping.ref_ty_code IS '참조 유형 코드';
COMMENT ON COLUMN public.tb_ds_col_mapping.ref_id IS '참조 아이디';
COMMENT ON COLUMN public.tb_ds_col_mapping.col_id IS '컬럼 아이디';
COMMENT ON COLUMN public.tb_ds_col_mapping.io_se_code IS 'io 구분 코드';
COMMENT ON COLUMN public.tb_ds_col_mapping.ui_ty_code IS 'ui 유형 코드';
COMMENT ON COLUMN public.tb_ds_col_mapping.use_purps_cn IS '사용 목적 내용';
COMMENT ON COLUMN public.tb_ds_col_mapping.col_dc IS '컬럼 설명';
COMMENT ON COLUMN public.tb_ds_col_mapping.sort_ordr IS '정렬 순서';
COMMENT ON COLUMN public.tb_ds_col_mapping.creat_dt IS '생성 일시';

-- Permissions

ALTER TABLE public.tb_ds_col_mapping OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_col_mapping TO postgres;


-- public.tb_ds_db_table definition

-- Drop table

-- DROP TABLE public.tb_ds_db_table;

CREATE TABLE public.tb_ds_db_table (
	tbl_id text NOT NULL, -- 테이블 아이디
	prjct_id text NOT NULL, -- 프로젝트 아이디
	tbl_physcl_nm text NOT NULL, -- 테이블 물리 명
	tbl_lgcl_nm text NULL, -- 테이블 논리 명
	tbl_dc text NULL, -- 테이블 설명
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 등록 일시
	mdfcn_dt timestamp(3) NULL, -- 수정 일시
	mdfcn_mber_id text NULL, -- 수정 회원 아이디
	asign_mber_id varchar(36) NULL, -- 담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정
	CONSTRAINT tb_ds_db_table_pkey PRIMARY KEY (tbl_id)
);

-- Column comments

COMMENT ON COLUMN public.tb_ds_db_table.tbl_id IS '테이블 아이디';
COMMENT ON COLUMN public.tb_ds_db_table.prjct_id IS '프로젝트 아이디';
COMMENT ON COLUMN public.tb_ds_db_table.tbl_physcl_nm IS '테이블 물리 명';
COMMENT ON COLUMN public.tb_ds_db_table.tbl_lgcl_nm IS '테이블 논리 명';
COMMENT ON COLUMN public.tb_ds_db_table.tbl_dc IS '테이블 설명';
COMMENT ON COLUMN public.tb_ds_db_table.creat_dt IS '등록 일시';
COMMENT ON COLUMN public.tb_ds_db_table.mdfcn_dt IS '수정 일시';
COMMENT ON COLUMN public.tb_ds_db_table.mdfcn_mber_id IS '수정 회원 아이디';
COMMENT ON COLUMN public.tb_ds_db_table.asign_mber_id IS '담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정';

-- Permissions

ALTER TABLE public.tb_ds_db_table OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_db_table TO postgres;


-- public.tb_ds_db_table_revision definition

-- Drop table

-- DROP TABLE public.tb_ds_db_table_revision;

CREATE TABLE public.tb_ds_db_table_revision (
	rev_id text NOT NULL,
	prjct_id text NOT NULL,
	tbl_id text NOT NULL,
	rev_no int4 NOT NULL,
	chg_type_code text NOT NULL,
	chg_summary text NULL,
	snapshot_data jsonb NOT NULL,
	chg_mber_id text NULL,
	chg_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT tb_ds_db_table_revision_pkey PRIMARY KEY (rev_id)
);
CREATE INDEX idx_db_tbl_rev_prjct ON public.tb_ds_db_table_revision USING btree (prjct_id, chg_dt DESC);
CREATE INDEX idx_db_tbl_rev_tbl ON public.tb_ds_db_table_revision USING btree (tbl_id, chg_dt DESC);

-- Permissions

ALTER TABLE public.tb_ds_db_table_revision OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_db_table_revision TO postgres;


-- public.tb_ds_design_change definition

-- Drop table

-- DROP TABLE public.tb_ds_design_change;

CREATE TABLE public.tb_ds_design_change (
	chg_id text NOT NULL,
	prjct_id text NOT NULL,
	ref_tbl_nm text NOT NULL,
	ref_id text NOT NULL,
	chg_rsn_cn text NULL,
	snapshot_data jsonb NOT NULL,
	ai_req_yn text DEFAULT 'N'::text NOT NULL,
	ai_task_id text NULL,
	chg_mber_id text NULL,
	chg_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	chg_type_code text DEFAULT 'UPDATE'::character varying NOT NULL,
	CONSTRAINT tb_ds_design_change_pkey PRIMARY KEY (chg_id)
);

-- Permissions

ALTER TABLE public.tb_ds_design_change OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_design_change TO postgres;


-- public.tb_ds_memo definition

-- Drop table

-- DROP TABLE public.tb_ds_memo;

CREATE TABLE public.tb_ds_memo (
	memo_id text NOT NULL, -- 메모 아이디
	prjct_id text NOT NULL, -- 프로젝트 아이디
	memo_sj text DEFAULT ''::text NOT NULL, -- 메모 제목
	memo_cn text NULL, -- 메모 내용
	share_yn bpchar(1) DEFAULT 'N'::bpchar NOT NULL, -- 공유 여부
	ref_ty_code text NULL, -- 참조 유형 코드
	ref_id text NULL, -- 참조 아이디
	view_cnt int4 DEFAULT 0 NOT NULL, -- 조회 수
	creat_mber_id text NOT NULL, -- 생성 회원 아이디
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 생성 일시
	mdfr_mber_id text NULL, -- 수정 회원 아이디
	mdfcn_dt timestamp(3) NULL, -- 수정 일시
	CONSTRAINT tb_ds_memo_pkey PRIMARY KEY (memo_id)
);
CREATE INDEX tb_ds_memo_prjct_dt_idx ON public.tb_ds_memo USING btree (prjct_id, creat_dt DESC);
CREATE INDEX tb_ds_memo_ref_idx ON public.tb_ds_memo USING btree (prjct_id, ref_ty_code, ref_id);

-- Column comments

COMMENT ON COLUMN public.tb_ds_memo.memo_id IS '메모 아이디';
COMMENT ON COLUMN public.tb_ds_memo.prjct_id IS '프로젝트 아이디';
COMMENT ON COLUMN public.tb_ds_memo.memo_sj IS '메모 제목';
COMMENT ON COLUMN public.tb_ds_memo.memo_cn IS '메모 내용';
COMMENT ON COLUMN public.tb_ds_memo.share_yn IS '공유 여부';
COMMENT ON COLUMN public.tb_ds_memo.ref_ty_code IS '참조 유형 코드';
COMMENT ON COLUMN public.tb_ds_memo.ref_id IS '참조 아이디';
COMMENT ON COLUMN public.tb_ds_memo.view_cnt IS '조회 수';
COMMENT ON COLUMN public.tb_ds_memo.creat_mber_id IS '생성 회원 아이디';
COMMENT ON COLUMN public.tb_ds_memo.creat_dt IS '생성 일시';
COMMENT ON COLUMN public.tb_ds_memo.mdfr_mber_id IS '수정 회원 아이디';
COMMENT ON COLUMN public.tb_ds_memo.mdfcn_dt IS '수정 일시';

-- Permissions

ALTER TABLE public.tb_ds_memo OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_memo TO postgres;


-- public.tb_ds_review_comment definition

-- Drop table

-- DROP TABLE public.tb_ds_review_comment;

CREATE TABLE public.tb_ds_review_comment (
	coment_id varchar(36) NOT NULL, -- 코멘트 아이디
	review_id varchar(36) NOT NULL, -- 리뷰 아이디
	coment_cn text NOT NULL, -- 코멘트 내용 (HTML, 웹에디터, Ctrl+V 이미지 포함)
	write_mber_id varchar(36) NOT NULL, -- 작성 회원 아이디 (요청자·검토자 모두 가능)
	creat_dt timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 생성 일시
	mdfcn_dt timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 수정 일시
	CONSTRAINT pk_ds_review_comment PRIMARY KEY (coment_id)
);
CREATE INDEX idx_ds_review_coment ON public.tb_ds_review_comment USING btree (review_id, creat_dt);
COMMENT ON TABLE public.tb_ds_review_comment IS '리뷰 코멘트';

-- Column comments

COMMENT ON COLUMN public.tb_ds_review_comment.coment_id IS '코멘트 아이디';
COMMENT ON COLUMN public.tb_ds_review_comment.review_id IS '리뷰 아이디';
COMMENT ON COLUMN public.tb_ds_review_comment.coment_cn IS '코멘트 내용 (HTML, 웹에디터, Ctrl+V 이미지 포함)';
COMMENT ON COLUMN public.tb_ds_review_comment.write_mber_id IS '작성 회원 아이디 (요청자·검토자 모두 가능)';
COMMENT ON COLUMN public.tb_ds_review_comment.creat_dt IS '생성 일시';
COMMENT ON COLUMN public.tb_ds_review_comment.mdfcn_dt IS '수정 일시';

-- Permissions

ALTER TABLE public.tb_ds_review_comment OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_review_comment TO postgres;


-- public.tb_ds_review_request definition

-- Drop table

-- DROP TABLE public.tb_ds_review_request;

CREATE TABLE public.tb_ds_review_request (
	review_id varchar(36) NOT NULL, -- 리뷰 아이디
	prjct_id varchar(36) NOT NULL, -- 프로젝트 아이디
	ref_tbl_nm varchar(50) NOT NULL, -- 참조 테이블 명 (tb_ds_area, tb_ds_function 등)
	ref_id varchar(36) NOT NULL, -- 참조 아이디
	review_title_nm varchar(300) NOT NULL, -- 리뷰 제목 명
	review_cn text NOT NULL, -- 리뷰 요청 내용 (HTML, 웹에디터, Ctrl+V 이미지 포함)
	result_cn text NULL, -- 검토 결과 내용 (HTML, 검토자 작성, 피드백 없으면 NULL)
	req_mber_id varchar(36) NOT NULL, -- 요청 회원 아이디 (요청자)
	revwr_mber_id varchar(36) NOT NULL, -- 검토자 회원 아이디 (리더/특정인)
	review_sttus_code varchar(30) DEFAULT 'REQUESTED'::character varying NOT NULL, -- 리뷰 상태 코드 (REQUESTED/REVIEWING/COMPLETED_NO_COMMENT/COMPLETED_WITH_COMMENT/ACCEPTED/DISMISSED)
	creat_dt timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 생성 일시
	compl_dt timestamp NULL, -- 검토 완료 일시 (COMPLETED 시점)
	mdfcn_dt timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 수정 일시
	stsf_scr int4 NULL, -- 답변 만족도 점수 (1~5)
	fdbk_code varchar(20) NULL, -- 피드백 코드 (GOOD: 굿!, WELL: 잘함, NEEDS_IMPROVEMENT: 보완 필요)
	CONSTRAINT pk_ds_review_request PRIMARY KEY (review_id)
);
CREATE INDEX idx_ds_review_prjct ON public.tb_ds_review_request USING btree (prjct_id, creat_dt DESC);
CREATE INDEX idx_ds_review_ref ON public.tb_ds_review_request USING btree (ref_tbl_nm, ref_id);
CREATE INDEX idx_ds_review_req_mber ON public.tb_ds_review_request USING btree (req_mber_id, review_sttus_code);
CREATE INDEX idx_ds_review_revwr ON public.tb_ds_review_request USING btree (revwr_mber_id, review_sttus_code);
COMMENT ON TABLE public.tb_ds_review_request IS '리뷰 요청';

-- Column comments

COMMENT ON COLUMN public.tb_ds_review_request.review_id IS '리뷰 아이디';
COMMENT ON COLUMN public.tb_ds_review_request.prjct_id IS '프로젝트 아이디';
COMMENT ON COLUMN public.tb_ds_review_request.ref_tbl_nm IS '참조 테이블 명 (tb_ds_area, tb_ds_function 등)';
COMMENT ON COLUMN public.tb_ds_review_request.ref_id IS '참조 아이디';
COMMENT ON COLUMN public.tb_ds_review_request.review_title_nm IS '리뷰 제목 명';
COMMENT ON COLUMN public.tb_ds_review_request.review_cn IS '리뷰 요청 내용 (HTML, 웹에디터, Ctrl+V 이미지 포함)';
COMMENT ON COLUMN public.tb_ds_review_request.result_cn IS '검토 결과 내용 (HTML, 검토자 작성, 피드백 없으면 NULL)';
COMMENT ON COLUMN public.tb_ds_review_request.req_mber_id IS '요청 회원 아이디 (요청자)';
COMMENT ON COLUMN public.tb_ds_review_request.revwr_mber_id IS '검토자 회원 아이디 (리더/특정인)';
COMMENT ON COLUMN public.tb_ds_review_request.review_sttus_code IS '리뷰 상태 코드 (REQUESTED/REVIEWING/COMPLETED_NO_COMMENT/COMPLETED_WITH_COMMENT/ACCEPTED/DISMISSED)';
COMMENT ON COLUMN public.tb_ds_review_request.creat_dt IS '생성 일시';
COMMENT ON COLUMN public.tb_ds_review_request.compl_dt IS '검토 완료 일시 (COMPLETED 시점)';
COMMENT ON COLUMN public.tb_ds_review_request.mdfcn_dt IS '수정 일시';
COMMENT ON COLUMN public.tb_ds_review_request.stsf_scr IS '답변 만족도 점수 (1~5)';
COMMENT ON COLUMN public.tb_ds_review_request.fdbk_code IS '피드백 코드 (GOOD: 굿!, WELL: 잘함, NEEDS_IMPROVEMENT: 보완 필요)';

-- Permissions

ALTER TABLE public.tb_ds_review_request OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_review_request TO postgres;


-- public.tb_pj_project definition

-- Drop table

-- DROP TABLE public.tb_pj_project;

CREATE TABLE public.tb_pj_project (
	prjct_id text NOT NULL,
	prjct_nm text NOT NULL,
	prjct_dc text NULL,
	client_nm text NULL,
	bgng_de timestamp(3) NULL,
	end_de timestamp(3) NULL,
	creat_mber_id text NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfcn_dt timestamp(3) NULL,
	CONSTRAINT tb_pj_project_pkey PRIMARY KEY (prjct_id)
);

-- Permissions

ALTER TABLE public.tb_pj_project OWNER TO postgres;
GRANT ALL ON TABLE public.tb_pj_project TO postgres;


-- public.tb_pj_project_config definition

-- Drop table

-- DROP TABLE public.tb_pj_project_config;

CREATE TABLE public.tb_pj_project_config (
	config_id text NOT NULL,
	prjct_id text NOT NULL,
	config_group text DEFAULT 'GENERAL'::text NOT NULL,
	config_key text NOT NULL,
	config_value text DEFAULT ''::text NOT NULL,
	config_label text DEFAULT ''::text NOT NULL,
	config_dc text NULL,
	value_type text DEFAULT 'TEXT'::text NOT NULL,
	default_value text DEFAULT ''::text NOT NULL,
	select_options jsonb NULL,
	sort_ordr int4 DEFAULT 0 NOT NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfcn_dt timestamp(3) NULL,
	CONSTRAINT tb_pj_project_config_pkey PRIMARY KEY (config_id)
);
CREATE INDEX tb_pj_project_config_grp_idx ON public.tb_pj_project_config USING btree (prjct_id, config_group);
CREATE UNIQUE INDEX tb_pj_project_config_uk ON public.tb_pj_project_config USING btree (prjct_id, config_key);

-- Permissions

ALTER TABLE public.tb_pj_project_config OWNER TO postgres;
GRANT ALL ON TABLE public.tb_pj_project_config TO postgres;


-- public.tb_rq_baseline_snapshot definition

-- Drop table

-- DROP TABLE public.tb_rq_baseline_snapshot;

CREATE TABLE public.tb_rq_baseline_snapshot (
	basln_id text NOT NULL,
	prjct_id text NOT NULL,
	basln_nm text NOT NULL,
	coment_cn text NULL,
	req_cnt int4 DEFAULT 0 NOT NULL,
	snapshot_data jsonb NOT NULL,
	cnfrm_mber_id text NULL,
	cnfrm_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT tb_rq_baseline_snapshot_pkey PRIMARY KEY (basln_id)
);

-- Permissions

ALTER TABLE public.tb_rq_baseline_snapshot OWNER TO postgres;
GRANT ALL ON TABLE public.tb_rq_baseline_snapshot TO postgres;


-- public.tb_rq_requirement_history definition

-- Drop table

-- DROP TABLE public.tb_rq_requirement_history;

CREATE TABLE public.tb_rq_requirement_history (
	req_hist_id text NOT NULL,
	req_id text NOT NULL,
	vrsn_no text NOT NULL,
	orgnl_cn text NULL,
	curncy_cn text NULL,
	vrsn_coment_cn text NULL,
	chg_mber_id text NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT tb_rq_requirement_history_pkey PRIMARY KEY (req_hist_id)
);

-- Permissions

ALTER TABLE public.tb_rq_requirement_history OWNER TO postgres;
GRANT ALL ON TABLE public.tb_rq_requirement_history TO postgres;


-- public.tb_rq_task definition

-- Drop table

-- DROP TABLE public.tb_rq_task;

CREATE TABLE public.tb_rq_task (
	task_id text NOT NULL,
	prjct_id text NOT NULL,
	task_display_id text NOT NULL,
	task_nm text NOT NULL,
	ctgry_code text DEFAULT 'NEW_DEV'::text NOT NULL,
	defn_cn text NULL,
	dtl_cn text NULL,
	output_info_cn text NULL,
	rfp_page_no text NULL,
	sort_ordr int4 DEFAULT 0 NOT NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfcn_dt timestamp(3) NULL,
	asign_mber_id varchar(36) NULL, -- 담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정
	CONSTRAINT tb_rq_task_pkey PRIMARY KEY (task_id)
);

-- Column comments

COMMENT ON COLUMN public.tb_rq_task.asign_mber_id IS '담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정';

-- Permissions

ALTER TABLE public.tb_rq_task OWNER TO postgres;
GRANT ALL ON TABLE public.tb_rq_task TO postgres;


-- public.tb_sg_std_guide definition

-- Drop table

-- DROP TABLE public.tb_sg_std_guide;

CREATE TABLE public.tb_sg_std_guide (
	guide_id varchar(36) NOT NULL, -- PK UUID
	prjct_id varchar(36) NOT NULL, -- 프로젝트 ID (tb_pj_project.prjct_id)
	guide_ctgry_code varchar(20) NOT NULL, -- 카테고리: UI|DATA|AUTH|API|COMMON|SECURITY|FILE|ERROR|BATCH|REPORT
	guide_sj varchar(200) DEFAULT ''::character varying NOT NULL, -- 제목
	guide_cn text NULL, -- 본문 (마크다운)
	use_yn bpchar(1) DEFAULT 'Y'::bpchar NOT NULL, -- Y=활성, N=소프트 삭제
	creat_mber_id varchar(36) NOT NULL, -- 작성자 회원 ID
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfr_mber_id varchar(36) NULL, -- 최종 수정자 회원 ID (NULL=미수정)
	mdfcn_dt timestamp(3) NULL,
	CONSTRAINT tb_sg_std_guide_pkey PRIMARY KEY (guide_id)
);
CREATE INDEX tb_sg_std_guide_ctgry_idx ON public.tb_sg_std_guide USING btree (prjct_id, guide_ctgry_code, use_yn);
CREATE INDEX tb_sg_std_guide_prjct_dt_idx ON public.tb_sg_std_guide USING btree (prjct_id, use_yn, mdfcn_dt DESC, creat_dt DESC);
COMMENT ON TABLE public.tb_sg_std_guide IS '표준 가이드 문서 (AI 제약사항/규칙)';

-- Column comments

COMMENT ON COLUMN public.tb_sg_std_guide.guide_id IS 'PK UUID';
COMMENT ON COLUMN public.tb_sg_std_guide.prjct_id IS '프로젝트 ID (tb_pj_project.prjct_id)';
COMMENT ON COLUMN public.tb_sg_std_guide.guide_ctgry_code IS '카테고리: UI|DATA|AUTH|API|COMMON|SECURITY|FILE|ERROR|BATCH|REPORT';
COMMENT ON COLUMN public.tb_sg_std_guide.guide_sj IS '제목';
COMMENT ON COLUMN public.tb_sg_std_guide.guide_cn IS '본문 (마크다운)';
COMMENT ON COLUMN public.tb_sg_std_guide.use_yn IS 'Y=활성, N=소프트 삭제';
COMMENT ON COLUMN public.tb_sg_std_guide.creat_mber_id IS '작성자 회원 ID';
COMMENT ON COLUMN public.tb_sg_std_guide.mdfr_mber_id IS '최종 수정자 회원 ID (NULL=미수정)';

-- Permissions

ALTER TABLE public.tb_sg_std_guide OWNER TO postgres;
GRANT ALL ON TABLE public.tb_sg_std_guide TO postgres;


-- public.tb_cm_account_lock definition

-- Drop table

-- DROP TABLE public.tb_cm_account_lock;

CREATE TABLE public.tb_cm_account_lock (
	lock_id text NOT NULL,
	mber_id text NOT NULL,
	lock_rsn_cn text NULL,
	fail_cnt int4 DEFAULT 0 NOT NULL,
	lock_expiry_dt timestamp(3) NULL,
	unlock_token_val text NULL,
	unlock_token_expiry_dt timestamp(3) NULL,
	lock_sttus_code text DEFAULT 'LOCKED'::text NOT NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	unlocked_dt timestamp(3) NULL,
	CONSTRAINT tb_cm_account_lock_pkey PRIMARY KEY (lock_id),
	CONSTRAINT tb_cm_account_lock_mber_id_fkey FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX tb_cm_account_lock_unlock_token_val_key ON public.tb_cm_account_lock USING btree (unlock_token_val);

-- Permissions

ALTER TABLE public.tb_cm_account_lock OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_account_lock TO postgres;


-- public.tb_cm_api_key definition

-- Drop table

-- DROP TABLE public.tb_cm_api_key;

CREATE TABLE public.tb_cm_api_key (
	api_key_id text NOT NULL,
	mber_id text NOT NULL,
	key_hash text NOT NULL,
	key_prefix varchar(12) NOT NULL,
	key_nm varchar(100) NOT NULL,
	last_used_dt timestamp(3) NULL,
	revoke_dt timestamp(3) NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT tb_cm_api_key_pkey PRIMARY KEY (api_key_id),
	CONSTRAINT tb_cm_api_key_mber_id_fkey FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_api_key_mber ON public.tb_cm_api_key USING btree (mber_id);
CREATE UNIQUE INDEX tb_cm_api_key_key_hash_key ON public.tb_cm_api_key USING btree (key_hash);

-- Permissions

ALTER TABLE public.tb_cm_api_key OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_api_key TO postgres;


-- public.tb_cm_code definition

-- Drop table

-- DROP TABLE public.tb_cm_code;

CREATE TABLE public.tb_cm_code (
	code_nm varchar(100) NOT NULL,
	code_dc varchar(4000) NULL,
	use_yn bpchar(1) DEFAULT 'Y'::bpchar NOT NULL,
	sort_ordr int4 DEFAULT 0 NOT NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfcn_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	cm_code varchar(100) NOT NULL,
	cm_code_id serial4 NOT NULL,
	prjct_id varchar(36) NOT NULL,
	grp_code_id int4 NOT NULL,
	CONSTRAINT tb_cm_code_grp_code_id_cm_code_key UNIQUE (grp_code_id, cm_code),
	CONSTRAINT tb_cm_code_pkey PRIMARY KEY (cm_code_id),
	CONSTRAINT tb_cm_code_grp_code_id_fkey FOREIGN KEY (grp_code_id) REFERENCES public.tb_cm_code_group(grp_code_id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX tb_cm_code_grp_code_id_idx ON public.tb_cm_code USING btree (grp_code_id);
CREATE INDEX tb_cm_code_prjct_id_idx ON public.tb_cm_code USING btree (prjct_id);

-- Permissions

ALTER TABLE public.tb_cm_code OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_code TO postgres;


-- public.tb_cm_email_verification definition

-- Drop table

-- DROP TABLE public.tb_cm_email_verification;

CREATE TABLE public.tb_cm_email_verification (
	vrfctn_id text NOT NULL,
	mber_id text NOT NULL,
	email_addr text NOT NULL,
	vrfctn_token_val text NOT NULL,
	vrfctn_ty_code text DEFAULT 'REGISTER'::text NOT NULL,
	vrfctn_sttus_code text DEFAULT 'PENDING'::text NOT NULL,
	expiry_dt timestamp(3) NOT NULL,
	vrfctn_dt timestamp(3) NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT tb_cm_email_verification_pkey PRIMARY KEY (vrfctn_id),
	CONSTRAINT tb_cm_email_verification_mber_id_fkey FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX tb_cm_email_verification_vrfctn_token_val_key ON public.tb_cm_email_verification USING btree (vrfctn_token_val);

-- Permissions

ALTER TABLE public.tb_cm_email_verification OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_email_verification TO postgres;


-- public.tb_cm_login_attempt definition

-- Drop table

-- DROP TABLE public.tb_cm_login_attempt;

CREATE TABLE public.tb_cm_login_attempt (
	attempt_id text NOT NULL,
	mber_id text NOT NULL,
	attempt_ip_addr text NULL,
	succes_yn text DEFAULT 'N'::text NOT NULL,
	fail_rsn_cn text NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT tb_cm_login_attempt_pkey PRIMARY KEY (attempt_id),
	CONSTRAINT tb_cm_login_attempt_mber_id_fkey FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Permissions

ALTER TABLE public.tb_cm_login_attempt OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_login_attempt TO postgres;


-- public.tb_cm_member_session definition

-- Drop table

-- DROP TABLE public.tb_cm_member_session;

CREATE TABLE public.tb_cm_member_session (
	sesn_id text NOT NULL,
	mber_id text NOT NULL,
	device_info_cn text NULL,
	ip_addr text NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	last_acces_dt timestamp(3) NULL,
	invald_dt timestamp(3) NULL,
	CONSTRAINT tb_cm_member_session_pkey PRIMARY KEY (sesn_id),
	CONSTRAINT tb_cm_member_session_mber_id_fkey FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Permissions

ALTER TABLE public.tb_cm_member_session OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_member_session TO postgres;


-- public.tb_cm_password_reset_token definition

-- Drop table

-- DROP TABLE public.tb_cm_password_reset_token;

CREATE TABLE public.tb_cm_password_reset_token (
	reset_token_id text NOT NULL,
	mber_id text NOT NULL,
	token_val text NOT NULL,
	token_sttus_code text DEFAULT 'PENDING'::text NOT NULL,
	expiry_dt timestamp(3) NOT NULL,
	use_dt timestamp(3) NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT tb_cm_password_reset_token_pkey PRIMARY KEY (reset_token_id),
	CONSTRAINT tb_cm_password_reset_token_mber_id_fkey FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX tb_cm_password_reset_token_token_val_key ON public.tb_cm_password_reset_token USING btree (token_val);

-- Permissions

ALTER TABLE public.tb_cm_password_reset_token OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_password_reset_token TO postgres;


-- public.tb_cm_refresh_token definition

-- Drop table

-- DROP TABLE public.tb_cm_refresh_token;

CREATE TABLE public.tb_cm_refresh_token (
	token_id text NOT NULL,
	mber_id text NOT NULL,
	token_hash_val text NOT NULL,
	auto_login_yn text DEFAULT 'N'::text NOT NULL,
	expiry_dt timestamp(3) NOT NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	revoked_dt timestamp(3) NULL,
	sesn_id text NULL,
	CONSTRAINT tb_cm_refresh_token_pkey PRIMARY KEY (token_id),
	CONSTRAINT tb_cm_refresh_token_mber_id_fkey FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX tb_cm_refresh_token_token_hash_val_key ON public.tb_cm_refresh_token USING btree (token_hash_val);

-- Permissions

ALTER TABLE public.tb_cm_refresh_token OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_refresh_token TO postgres;


-- public.tb_cm_social_account definition

-- Drop table

-- DROP TABLE public.tb_cm_social_account;

CREATE TABLE public.tb_cm_social_account (
	social_acnt_id text NOT NULL, -- 소셜 계정 아이디
	mber_id text NOT NULL, -- 회원 아이디
	provdr_code text NOT NULL, -- 제공자 코드
	provdr_user_id text NOT NULL, -- 제공자 사용자 아이디
	provdr_email_addr text NULL, -- 제공자 이메일 주소
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 생성 일시
	CONSTRAINT tb_cm_social_account_pkey PRIMARY KEY (social_acnt_id),
	CONSTRAINT tb_cm_social_account_mber_id_fkey FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX tb_cm_social_account_provdr_code_provdr_user_id_key ON public.tb_cm_social_account USING btree (provdr_code, provdr_user_id);

-- Column comments

COMMENT ON COLUMN public.tb_cm_social_account.social_acnt_id IS '소셜 계정 아이디';
COMMENT ON COLUMN public.tb_cm_social_account.mber_id IS '회원 아이디';
COMMENT ON COLUMN public.tb_cm_social_account.provdr_code IS '제공자 코드';
COMMENT ON COLUMN public.tb_cm_social_account.provdr_user_id IS '제공자 사용자 아이디';
COMMENT ON COLUMN public.tb_cm_social_account.provdr_email_addr IS '제공자 이메일 주소';
COMMENT ON COLUMN public.tb_cm_social_account.creat_dt IS '생성 일시';

-- Permissions

ALTER TABLE public.tb_cm_social_account OWNER TO postgres;
GRANT ALL ON TABLE public.tb_cm_social_account TO postgres;


-- public.tb_ds_db_table_column definition

-- Drop table

-- DROP TABLE public.tb_ds_db_table_column;

CREATE TABLE public.tb_ds_db_table_column (
	col_id text NOT NULL, -- 컬럼 아이디
	tbl_id text NOT NULL, -- 테이블 아이디
	col_physcl_nm text NOT NULL, -- 컬럼 물리명
	col_lgcl_nm text NULL, -- 컬럼 논리명
	data_ty_nm text NULL, -- 데이터 타입 명
	col_dc text NULL, -- 컬럼 설명
	sort_ordr int4 DEFAULT 0 NOT NULL, -- 정렬 순서
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 생성 일시
	mdfcn_dt timestamp(3) NULL,
	mdfcn_mber_id text NULL,
	ref_grp_code varchar(100) NULL,
	CONSTRAINT tb_ds_db_table_column_pkey PRIMARY KEY (col_id),
	CONSTRAINT tb_ds_db_table_column_tbl_id_fkey FOREIGN KEY (tbl_id) REFERENCES public.tb_ds_db_table(tbl_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Column comments

COMMENT ON COLUMN public.tb_ds_db_table_column.col_id IS '컬럼 아이디';
COMMENT ON COLUMN public.tb_ds_db_table_column.tbl_id IS '테이블 아이디';
COMMENT ON COLUMN public.tb_ds_db_table_column.col_physcl_nm IS '컬럼 물리명';
COMMENT ON COLUMN public.tb_ds_db_table_column.col_lgcl_nm IS '컬럼 논리명';
COMMENT ON COLUMN public.tb_ds_db_table_column.data_ty_nm IS '데이터 타입 명';
COMMENT ON COLUMN public.tb_ds_db_table_column.col_dc IS '컬럼 설명';
COMMENT ON COLUMN public.tb_ds_db_table_column.sort_ordr IS '정렬 순서';
COMMENT ON COLUMN public.tb_ds_db_table_column.creat_dt IS '생성 일시';

-- Permissions

ALTER TABLE public.tb_ds_db_table_column OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_db_table_column TO postgres;


-- public.tb_ds_plan_studio definition

-- Drop table

-- DROP TABLE public.tb_ds_plan_studio;

CREATE TABLE public.tb_ds_plan_studio (
	plan_studio_id text NOT NULL, -- 기획실 ID (PK)
	prjct_id text NOT NULL, -- 소속 프로젝트 ID
	plan_studio_display_id text NOT NULL, -- 사용자 표시용 ID (예: PB-00001), 프로젝트 내 유일
	plan_studio_nm text DEFAULT ''::text NOT NULL, -- 기획실명 (사용자가 생성 팝업에서 입력한 컨테이너 이름)
	creat_mber_id text NULL, -- 등록자 회원 ID
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 등록 일시
	mdfcn_dt timestamp(3) NULL, -- 수정 일시
	coment_cn text NULL, -- 코멘트 내용
	plan_cn text NULL, -- 기획 내용
	plan_studio_div_code text DEFAULT 'IA'::text NOT NULL, -- 기획 실 구분 코드
	sort_ordr int4 DEFAULT 0 NOT NULL, -- 정렬 순서
	CONSTRAINT tb_ds_plan_studio_pkey PRIMARY KEY (plan_studio_id),
	CONSTRAINT tb_ds_plan_studio_prjct_fk FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX tb_ds_plan_studio_display_id_uk ON public.tb_ds_plan_studio USING btree (prjct_id, plan_studio_display_id);
CREATE INDEX tb_ds_plan_studio_div_code_idx ON public.tb_ds_plan_studio USING btree (prjct_id, plan_studio_div_code);
CREATE INDEX tb_ds_plan_studio_prjct_idx ON public.tb_ds_plan_studio USING btree (prjct_id, sort_ordr);
COMMENT ON TABLE public.tb_ds_plan_studio IS '기획실 - 산출물(기획)들을 묶는 단순 컨테이너 (폴더 역할)';

-- Column comments

COMMENT ON COLUMN public.tb_ds_plan_studio.plan_studio_id IS '기획실 ID (PK)';
COMMENT ON COLUMN public.tb_ds_plan_studio.prjct_id IS '소속 프로젝트 ID';
COMMENT ON COLUMN public.tb_ds_plan_studio.plan_studio_display_id IS '사용자 표시용 ID (예: PB-00001), 프로젝트 내 유일';
COMMENT ON COLUMN public.tb_ds_plan_studio.plan_studio_nm IS '기획실명 (사용자가 생성 팝업에서 입력한 컨테이너 이름)';
COMMENT ON COLUMN public.tb_ds_plan_studio.creat_mber_id IS '등록자 회원 ID';
COMMENT ON COLUMN public.tb_ds_plan_studio.creat_dt IS '등록 일시';
COMMENT ON COLUMN public.tb_ds_plan_studio.mdfcn_dt IS '수정 일시';
COMMENT ON COLUMN public.tb_ds_plan_studio.coment_cn IS '코멘트 내용';
COMMENT ON COLUMN public.tb_ds_plan_studio.plan_cn IS '기획 내용';
COMMENT ON COLUMN public.tb_ds_plan_studio.plan_studio_div_code IS '기획 실 구분 코드';
COMMENT ON COLUMN public.tb_ds_plan_studio.sort_ordr IS '정렬 순서';

-- Permissions

ALTER TABLE public.tb_ds_plan_studio OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_plan_studio TO postgres;


-- public.tb_ds_plan_studio_artf definition

-- Drop table

-- DROP TABLE public.tb_ds_plan_studio_artf;

CREATE TABLE public.tb_ds_plan_studio_artf (
	artf_id text NOT NULL, -- 산출물 ID (PK)
	plan_studio_id text NOT NULL, -- 소속 기획실 ID
	artf_nm text DEFAULT ''::text NOT NULL, -- 기획명 (예: 시스템 정보 구조도, 전체 프로세스) - 사용자 화면의 "기획명" 입력 필드
	artf_div_code text DEFAULT 'IA'::text NOT NULL, -- 기획구분코드 (IA:정보구조도, JOURNEY:사용자여정, FLOW:화면흐름, MOCKUP:목업, ERD:데이터모델, PROCESS:업무프로세스)
	artf_fmt_code text DEFAULT 'MD'::text NOT NULL, -- 산출물 형식코드 (MD:마크다운, MERMAID:머메이드, HTML) - 택 1
	artf_idea_cn text NULL, -- 상세 아이디어 내용 (마크다운, AI 호출 시 1순위 참조)
	coment_cn text NULL, -- AI 지시사항 (사용자가 AI에게 요청하는 구체 지시문)
	artf_cn text NULL, -- 산출물 본문 (AI가 생성한 또는 사용자가 수동 작성한 결과물)
	good_design_yn bpchar(1) DEFAULT 'N'::bpchar NOT NULL, -- 좋은 설계 여부 (Y/N) - 사용자가 대표작으로 지정한 산출물 표시
	ai_task_id text NULL, -- 이 산출물을 생성한 AI 태스크 ID (수동 작성 시 NULL, FK 미설정)
	creat_mber_id text NULL, -- 등록자 회원 ID
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 등록 일시
	mdfr_mber_id text NULL, -- 수정자 회원 ID
	mdfcn_dt timestamp(3) NULL, -- 수정 일시
	ver_no int4 DEFAULT 1 NOT NULL,
	CONSTRAINT tb_ds_plan_studio_artf_pkey PRIMARY KEY (artf_id),
	CONSTRAINT tb_ds_plan_studio_artf_plan_studio_fk FOREIGN KEY (plan_studio_id) REFERENCES public.tb_ds_plan_studio(plan_studio_id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX tb_ds_plan_studio_artf_ai_task_idx ON public.tb_ds_plan_studio_artf USING btree (ai_task_id);
CREATE INDEX tb_ds_plan_studio_artf_good_design_idx ON public.tb_ds_plan_studio_artf USING btree (plan_studio_id) WHERE (good_design_yn = 'Y'::bpchar);
CREATE INDEX tb_ds_plan_studio_artf_ps_idx ON public.tb_ds_plan_studio_artf USING btree (plan_studio_id, artf_fmt_code, ver_no DESC);
COMMENT ON TABLE public.tb_ds_plan_studio_artf IS '기획 산출물 - 실제 작업 단위. 요구사항/다른 산출물을 컨텍스트로 묶어 AI로 다양한 형식의 결과물을 생성하는 핵심 테이블';

-- Column comments

COMMENT ON COLUMN public.tb_ds_plan_studio_artf.artf_id IS '산출물 ID (PK)';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.plan_studio_id IS '소속 기획실 ID';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.artf_nm IS '기획명 (예: 시스템 정보 구조도, 전체 프로세스) - 사용자 화면의 "기획명" 입력 필드';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.artf_div_code IS '기획구분코드 (IA:정보구조도, JOURNEY:사용자여정, FLOW:화면흐름, MOCKUP:목업, ERD:데이터모델, PROCESS:업무프로세스)';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.artf_fmt_code IS '산출물 형식코드 (MD:마크다운, MERMAID:머메이드, HTML) - 택 1';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.artf_idea_cn IS '상세 아이디어 내용 (마크다운, AI 호출 시 1순위 참조)';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.coment_cn IS 'AI 지시사항 (사용자가 AI에게 요청하는 구체 지시문)';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.artf_cn IS '산출물 본문 (AI가 생성한 또는 사용자가 수동 작성한 결과물)';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.good_design_yn IS '좋은 설계 여부 (Y/N) - 사용자가 대표작으로 지정한 산출물 표시';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.ai_task_id IS '이 산출물을 생성한 AI 태스크 ID (수동 작성 시 NULL, FK 미설정)';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.creat_mber_id IS '등록자 회원 ID';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.creat_dt IS '등록 일시';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.mdfr_mber_id IS '수정자 회원 ID';
COMMENT ON COLUMN public.tb_ds_plan_studio_artf.mdfcn_dt IS '수정 일시';

-- Permissions

ALTER TABLE public.tb_ds_plan_studio_artf OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_plan_studio_artf TO postgres;


-- public.tb_ds_plan_studio_ctxt definition

-- Drop table

-- DROP TABLE public.tb_ds_plan_studio_ctxt;

CREATE TABLE public.tb_ds_plan_studio_ctxt (
	ctxt_id text NOT NULL, -- 컨텍스트 매핑 ID (PK)
	artf_id text NOT NULL, -- 소속 산출물 ID (이 컨텍스트를 사용하는 기획)
	ctxt_ty_code text NOT NULL, -- 컨텍스트 유형코드 (REQ:요구사항, ARTF:다른 산출물 자기참조, UNIT:단위업무, SCREEN:화면설계)
	ref_id text NOT NULL, -- 참조 대상 ID (ctxt_ty_code에 따라 가리키는 테이블이 달라지는 다형 참조, FK 강제 불가)
	sort_ordr int4 DEFAULT 0 NOT NULL, -- 정렬 순서 (AI 프롬프트 빌드 시 컨텍스트 직조 순서)
	creat_mber_id text NULL, -- 등록자 회원 ID
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 등록 일시
	CONSTRAINT tb_ds_plan_studio_ctxt_no_self_ref CHECK ((NOT ((ctxt_ty_code = 'ARTF'::text) AND (ref_id = artf_id)))),
	CONSTRAINT tb_ds_plan_studio_ctxt_pkey PRIMARY KEY (ctxt_id),
	CONSTRAINT tb_ds_plan_studio_ctxt_artf_fk FOREIGN KEY (artf_id) REFERENCES public.tb_ds_plan_studio_artf(artf_id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX tb_ds_plan_studio_ctxt_ref_idx ON public.tb_ds_plan_studio_ctxt USING btree (ctxt_ty_code, ref_id);
CREATE UNIQUE INDEX tb_ds_plan_studio_ctxt_uk ON public.tb_ds_plan_studio_ctxt USING btree (artf_id, ctxt_ty_code, ref_id);
COMMENT ON TABLE public.tb_ds_plan_studio_ctxt IS '기획 산출물 컨텍스트 매핑 - 다형 참조 (요구사항/다른 산출물/단위업무/화면설계 등)';

-- Column comments

COMMENT ON COLUMN public.tb_ds_plan_studio_ctxt.ctxt_id IS '컨텍스트 매핑 ID (PK)';
COMMENT ON COLUMN public.tb_ds_plan_studio_ctxt.artf_id IS '소속 산출물 ID (이 컨텍스트를 사용하는 기획)';
COMMENT ON COLUMN public.tb_ds_plan_studio_ctxt.ctxt_ty_code IS '컨텍스트 유형코드 (REQ:요구사항, ARTF:다른 산출물 자기참조, UNIT:단위업무, SCREEN:화면설계)';
COMMENT ON COLUMN public.tb_ds_plan_studio_ctxt.ref_id IS '참조 대상 ID (ctxt_ty_code에 따라 가리키는 테이블이 달라지는 다형 참조, FK 강제 불가)';
COMMENT ON COLUMN public.tb_ds_plan_studio_ctxt.sort_ordr IS '정렬 순서 (AI 프롬프트 빌드 시 컨텍스트 직조 순서)';
COMMENT ON COLUMN public.tb_ds_plan_studio_ctxt.creat_mber_id IS '등록자 회원 ID';
COMMENT ON COLUMN public.tb_ds_plan_studio_ctxt.creat_dt IS '등록 일시';

-- Permissions

ALTER TABLE public.tb_ds_plan_studio_ctxt OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_plan_studio_ctxt TO postgres;


-- public.tb_pj_member_removal_notice definition

-- Drop table

-- DROP TABLE public.tb_pj_member_removal_notice;

CREATE TABLE public.tb_pj_member_removal_notice (
	notice_id text NOT NULL,
	mber_id text NOT NULL,
	prjct_id text NOT NULL,
	prjct_nm text NOT NULL,
	cnfrm_yn text DEFAULT 'N'::text NOT NULL,
	cnfrm_dt timestamp(3) NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT tb_pj_member_removal_notice_pkey PRIMARY KEY (notice_id),
	CONSTRAINT tb_pj_member_removal_notice_mber_id_fkey FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Permissions

ALTER TABLE public.tb_pj_member_removal_notice OWNER TO postgres;
GRANT ALL ON TABLE public.tb_pj_member_removal_notice TO postgres;


-- public.tb_pj_project_api_key definition

-- Drop table

-- DROP TABLE public.tb_pj_project_api_key;

CREATE TABLE public.tb_pj_project_api_key (
	api_key_id text NOT NULL,
	prjct_id text NOT NULL,
	provdr_nm text NOT NULL,
	encpt_key_val text NOT NULL,
	mask_key_val text NOT NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfcn_dt timestamp(3) NULL,
	CONSTRAINT tb_pj_project_api_key_pkey PRIMARY KEY (api_key_id),
	CONSTRAINT tb_pj_project_api_key_prjct_id_fkey FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Permissions

ALTER TABLE public.tb_pj_project_api_key OWNER TO postgres;
GRANT ALL ON TABLE public.tb_pj_project_api_key TO postgres;


-- public.tb_pj_project_invitation definition

-- Drop table

-- DROP TABLE public.tb_pj_project_invitation;

CREATE TABLE public.tb_pj_project_invitation (
	invt_id text NOT NULL,
	prjct_id text NOT NULL,
	email_addr text NOT NULL,
	role_code text DEFAULT 'MEMBER'::text NOT NULL,
	invt_token_val text NOT NULL,
	invtr_mber_id text NULL,
	invt_sttus_code text DEFAULT 'PENDING'::text NOT NULL,
	invt_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	expiry_dt timestamp(3) NOT NULL,
	accept_dt timestamp(3) NULL,
	cancel_dt timestamp(3) NULL,
	job_title_code varchar(20) DEFAULT 'ETC'::character varying NOT NULL, -- 초대 시 지정 직무
	CONSTRAINT tb_pj_project_invitation_pkey PRIMARY KEY (invt_id),
	CONSTRAINT tb_pj_project_invitation_prjct_id_fkey FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX tb_pj_project_invitation_invt_token_val_key ON public.tb_pj_project_invitation USING btree (invt_token_val);

-- Column comments

COMMENT ON COLUMN public.tb_pj_project_invitation.job_title_code IS '초대 시 지정 직무';

-- Permissions

ALTER TABLE public.tb_pj_project_invitation OWNER TO postgres;
GRANT ALL ON TABLE public.tb_pj_project_invitation TO postgres;


-- public.tb_pj_project_member definition

-- Drop table

-- DROP TABLE public.tb_pj_project_member;

CREATE TABLE public.tb_pj_project_member (
	prjct_mber_id text NOT NULL,
	prjct_id text NOT NULL,
	mber_id text NOT NULL,
	role_code text DEFAULT 'MEMBER'::text NOT NULL, -- 프로젝트 역할 (OWNER/ADMIN/MEMBER/VIEWER)
	join_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	last_acces_dt timestamp(3) NULL,
	mber_sttus_code text DEFAULT 'ACTIVE'::text NOT NULL,
	sttus_chg_dt timestamp(3) NULL,
	job_title_code varchar(20) DEFAULT 'ETC'::character varying NOT NULL, -- 직무 (PM/PL/DBA/DEV/DESIGNER/QA/ETC)
	CONSTRAINT tb_pj_project_member_pkey PRIMARY KEY (prjct_mber_id),
	CONSTRAINT tb_pj_project_member_mber_id_fkey FOREIGN KEY (mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT tb_pj_project_member_prjct_id_fkey FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX tb_pj_project_member_prjct_id_mber_id_key ON public.tb_pj_project_member USING btree (prjct_id, mber_id);

-- Column comments

COMMENT ON COLUMN public.tb_pj_project_member.role_code IS '프로젝트 역할 (OWNER/ADMIN/MEMBER/VIEWER)';
COMMENT ON COLUMN public.tb_pj_project_member.job_title_code IS '직무 (PM/PL/DBA/DEV/DESIGNER/QA/ETC)';

-- Permissions

ALTER TABLE public.tb_pj_project_member OWNER TO postgres;
GRANT ALL ON TABLE public.tb_pj_project_member TO postgres;


-- public.tb_pj_project_settings definition

-- Drop table

-- DROP TABLE public.tb_pj_project_settings;

CREATE TABLE public.tb_pj_project_settings (
	seting_id text NOT NULL,
	prjct_id text NOT NULL,
	ai_call_mthd_code text DEFAULT 'DIRECT'::text NOT NULL,
	plan_code text DEFAULT 'FREE'::text NOT NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfcn_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT tb_pj_project_settings_pkey PRIMARY KEY (seting_id),
	CONSTRAINT tb_pj_project_settings_prjct_id_fkey FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX tb_pj_project_settings_prjct_id_key ON public.tb_pj_project_settings USING btree (prjct_id);

-- Permissions

ALTER TABLE public.tb_pj_project_settings OWNER TO postgres;
GRANT ALL ON TABLE public.tb_pj_project_settings TO postgres;


-- public.tb_pj_settings_history definition

-- Drop table

-- DROP TABLE public.tb_pj_settings_history;

CREATE TABLE public.tb_pj_settings_history (
	hist_id text NOT NULL,
	prjct_id text NOT NULL,
	chg_mber_id text NOT NULL,
	chg_item_nm text NOT NULL,
	bfr_val_cn text NULL,
	aftr_val_cn text NULL,
	chg_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT tb_pj_settings_history_pkey PRIMARY KEY (hist_id),
	CONSTRAINT tb_pj_settings_history_chg_mber_id_fkey FOREIGN KEY (chg_mber_id) REFERENCES public.tb_cm_member(mber_id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT tb_pj_settings_history_prjct_id_fkey FOREIGN KEY (prjct_id) REFERENCES public.tb_pj_project(prjct_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Permissions

ALTER TABLE public.tb_pj_settings_history OWNER TO postgres;
GRANT ALL ON TABLE public.tb_pj_settings_history TO postgres;


-- public.tb_rq_requirement definition

-- Drop table

-- DROP TABLE public.tb_rq_requirement;

CREATE TABLE public.tb_rq_requirement (
	req_id text NOT NULL,
	prjct_id text NOT NULL,
	task_id text NULL,
	req_display_id text NOT NULL,
	req_nm text DEFAULT ''::text NOT NULL,
	priort_code text DEFAULT 'MEDIUM'::text NOT NULL,
	src_code text DEFAULT 'RFP'::text NOT NULL,
	rfp_page_no text NULL,
	orgnl_cn text NULL,
	curncy_cn text NULL,
	analy_cn text NULL,
	spec_cn text NULL,
	sort_ordr int4 DEFAULT 0 NOT NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfcn_dt timestamp(3) NULL,
	asign_mber_id varchar(36) NULL, -- 담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정
	CONSTRAINT tb_rq_requirement_pkey PRIMARY KEY (req_id),
	CONSTRAINT tb_rq_requirement_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tb_rq_task(task_id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Column comments

COMMENT ON COLUMN public.tb_rq_requirement.asign_mber_id IS '담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정';

-- Permissions

ALTER TABLE public.tb_rq_requirement OWNER TO postgres;
GRANT ALL ON TABLE public.tb_rq_requirement TO postgres;


-- public.tb_rq_user_story definition

-- Drop table

-- DROP TABLE public.tb_rq_user_story;

CREATE TABLE public.tb_rq_user_story (
	story_id text NOT NULL,
	req_id text NOT NULL,
	story_display_id text NOT NULL,
	story_nm text DEFAULT ''::text NOT NULL,
	persona_cn text NULL,
	scenario_cn text NULL,
	sort_ordr int4 DEFAULT 0 NOT NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	mdfcn_dt timestamp(3) NULL,
	CONSTRAINT tb_rq_user_story_pkey PRIMARY KEY (story_id),
	CONSTRAINT tb_rq_user_story_req_id_fkey FOREIGN KEY (req_id) REFERENCES public.tb_rq_requirement(req_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Permissions

ALTER TABLE public.tb_rq_user_story OWNER TO postgres;
GRANT ALL ON TABLE public.tb_rq_user_story TO postgres;


-- public.tb_sp_diff_test_master definition

-- Drop table

-- DROP TABLE public.tb_sp_diff_test_master;

CREATE TABLE public.tb_sp_diff_test_master (
	master_id uuid DEFAULT gen_random_uuid() NOT NULL,
	test_sn bigserial NOT NULL,
	sj_nm varchar(200) NULL,
	memo_cn text NULL,
	base_master_id uuid NULL,
	chg_node_cnt int4 DEFAULT 0 NULL,
	diff_prompt_md text NULL, -- 생성된 PRD_CHANGE.md 전문
	diff_summary_json jsonb NULL,
	creat_dt timestamp DEFAULT now() NOT NULL,
	creat_user_id varchar(50) NULL,
	CONSTRAINT tb_sp_diff_test_master_pkey PRIMARY KEY (master_id),
	CONSTRAINT fk_diff_test_master_base FOREIGN KEY (base_master_id) REFERENCES public.tb_sp_diff_test_master(master_id)
);
CREATE INDEX idx_diff_test_master_creat_dt ON public.tb_sp_diff_test_master USING btree (creat_dt DESC);
CREATE INDEX idx_diff_test_master_test_sn ON public.tb_sp_diff_test_master USING btree (test_sn DESC);
COMMENT ON TABLE public.tb_sp_diff_test_master IS 'Diff Prompt 테스트 마스터';

-- Column comments

COMMENT ON COLUMN public.tb_sp_diff_test_master.diff_prompt_md IS '생성된 PRD_CHANGE.md 전문';

-- Permissions

ALTER TABLE public.tb_sp_diff_test_master OWNER TO postgres;
GRANT ALL ON TABLE public.tb_sp_diff_test_master TO postgres;


-- public.tb_sp_diff_test_node definition

-- Drop table

-- DROP TABLE public.tb_sp_diff_test_node;

CREATE TABLE public.tb_sp_diff_test_node (
	node_pk uuid DEFAULT gen_random_uuid() NOT NULL,
	master_id uuid NOT NULL,
	node_type_code varchar(10) NOT NULL,
	node_seq int2 NOT NULL,
	raw_md_cn text NOT NULL,
	parsed_json jsonb NULL,
	content_hash bpchar(64) NOT NULL,
	is_changed_yn bpchar(1) DEFAULT 'N'::bpchar NULL,
	chg_mode_code varchar(10) NULL,
	chg_line_ratio numeric(5, 4) NULL,
	added_line_cnt int4 DEFAULT 0 NULL,
	removed_line_cnt int4 DEFAULT 0 NULL,
	kept_line_cnt int4 DEFAULT 0 NULL,
	creat_dt timestamp DEFAULT now() NOT NULL,
	CONSTRAINT chk_chg_mode CHECK ((((chg_mode_code)::text = ANY ((ARRAY['NO_CHANGE'::character varying, 'DIFF'::character varying, 'FULL'::character varying, 'REPLACE'::character varying])::text[])) OR (chg_mode_code IS NULL))),
	CONSTRAINT chk_node_type CHECK (((node_type_code)::text = ANY ((ARRAY['UW'::character varying, 'PID'::character varying, 'AR'::character varying, 'FID'::character varying])::text[]))),
	CONSTRAINT tb_sp_diff_test_node_pkey PRIMARY KEY (node_pk),
	CONSTRAINT uk_diff_test_node UNIQUE (master_id, node_type_code),
	CONSTRAINT fk_diff_test_node_master FOREIGN KEY (master_id) REFERENCES public.tb_sp_diff_test_master(master_id) ON DELETE CASCADE
);
CREATE INDEX idx_diff_test_node_hash ON public.tb_sp_diff_test_node USING btree (content_hash);
CREATE INDEX idx_diff_test_node_master ON public.tb_sp_diff_test_node USING btree (master_id, node_seq);
COMMENT ON TABLE public.tb_sp_diff_test_node IS 'Diff Prompt 테스트 노드 스냅샷';

-- Permissions

ALTER TABLE public.tb_sp_diff_test_node OWNER TO postgres;
GRANT ALL ON TABLE public.tb_sp_diff_test_node TO postgres;


-- public.tb_sp_impl_snapshot definition

-- Drop table

-- DROP TABLE public.tb_sp_impl_snapshot;

CREATE TABLE public.tb_sp_impl_snapshot (
	snapshot_id uuid DEFAULT gen_random_uuid() NOT NULL,
	ai_task_id text NOT NULL,
	ref_tbl_nm varchar(50) NOT NULL,
	ref_id varchar(36) NOT NULL,
	content_hash bpchar(64) NOT NULL,
	raw_cn text NOT NULL,
	creat_dt timestamp DEFAULT now() NULL,
	CONSTRAINT tb_sp_impl_snapshot_pkey PRIMARY KEY (snapshot_id),
	CONSTRAINT fk_impl_snapshot_task FOREIGN KEY (ai_task_id) REFERENCES public.tb_ai_task(ai_task_id) ON DELETE CASCADE
);
CREATE INDEX idx_impl_snapshot_ref ON public.tb_sp_impl_snapshot USING btree (ref_tbl_nm, ref_id, creat_dt DESC);

-- Permissions

ALTER TABLE public.tb_sp_impl_snapshot OWNER TO postgres;
GRANT ALL ON TABLE public.tb_sp_impl_snapshot TO postgres;


-- public.tb_ds_unit_work definition

-- Drop table

-- DROP TABLE public.tb_ds_unit_work;

CREATE TABLE public.tb_ds_unit_work (
	unit_work_id text NOT NULL, -- 단위 업무 아이디
	prjct_id text NOT NULL, -- 프로젝트 아이디
	req_id text NOT NULL, -- 요구사항 아이디
	unit_work_display_id text NOT NULL, -- 단위 업무 표시 아이디
	unit_work_nm text DEFAULT ''::text NOT NULL, -- 단위 업무 명
	unit_work_dc text NULL, -- 단위 업무 설명
	asign_mber_id text NULL, -- 담당자 회원 명
	bgng_de text NULL, -- 시작 일자
	end_de text NULL, -- 종료 일자
	progrs_rt int4 DEFAULT 0 NOT NULL, -- 진행 률
	sort_ordr int4 DEFAULT 0 NOT NULL, -- 정렬 순서
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 생성 일시
	mdfcn_dt timestamp(3) NULL, -- 수정 일시
	coment_cn text NULL, -- 코멘트 내용
	CONSTRAINT tb_ds_unit_work_pkey PRIMARY KEY (unit_work_id),
	CONSTRAINT tb_ds_unit_work_req_id_fkey FOREIGN KEY (req_id) REFERENCES public.tb_rq_requirement(req_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Column comments

COMMENT ON COLUMN public.tb_ds_unit_work.unit_work_id IS '단위 업무 아이디';
COMMENT ON COLUMN public.tb_ds_unit_work.prjct_id IS '프로젝트 아이디';
COMMENT ON COLUMN public.tb_ds_unit_work.req_id IS '요구사항 아이디';
COMMENT ON COLUMN public.tb_ds_unit_work.unit_work_display_id IS '단위 업무 표시 아이디';
COMMENT ON COLUMN public.tb_ds_unit_work.unit_work_nm IS '단위 업무 명';
COMMENT ON COLUMN public.tb_ds_unit_work.unit_work_dc IS '단위 업무 설명';
COMMENT ON COLUMN public.tb_ds_unit_work.asign_mber_id IS '담당자 회원 명';
COMMENT ON COLUMN public.tb_ds_unit_work.bgng_de IS '시작 일자';
COMMENT ON COLUMN public.tb_ds_unit_work.end_de IS '종료 일자';
COMMENT ON COLUMN public.tb_ds_unit_work.progrs_rt IS '진행 률';
COMMENT ON COLUMN public.tb_ds_unit_work.sort_ordr IS '정렬 순서';
COMMENT ON COLUMN public.tb_ds_unit_work.creat_dt IS '생성 일시';
COMMENT ON COLUMN public.tb_ds_unit_work.mdfcn_dt IS '수정 일시';
COMMENT ON COLUMN public.tb_ds_unit_work.coment_cn IS '코멘트 내용';

-- Permissions

ALTER TABLE public.tb_ds_unit_work OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_unit_work TO postgres;


-- public.tb_rq_acceptance_criteria definition

-- Drop table

-- DROP TABLE public.tb_rq_acceptance_criteria;

CREATE TABLE public.tb_rq_acceptance_criteria (
	ac_id text NOT NULL,
	story_id text NOT NULL,
	given_cn text NULL,
	when_cn text NULL,
	then_cn text NULL,
	sort_ordr int4 DEFAULT 0 NOT NULL,
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT tb_rq_acceptance_criteria_pkey PRIMARY KEY (ac_id),
	CONSTRAINT tb_rq_acceptance_criteria_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.tb_rq_user_story(story_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Permissions

ALTER TABLE public.tb_rq_acceptance_criteria OWNER TO postgres;
GRANT ALL ON TABLE public.tb_rq_acceptance_criteria TO postgres;


-- public.tb_ds_screen definition

-- Drop table

-- DROP TABLE public.tb_ds_screen;

CREATE TABLE public.tb_ds_screen (
	scrn_id text NOT NULL, -- 화면 아이디
	prjct_id text NOT NULL, -- 프로젝트 아이디
	unit_work_id text NULL, -- 단위 업무 아이디
	scrn_display_id text NOT NULL, -- 화면 표시 아이디
	scrn_nm text DEFAULT ''::text NOT NULL, -- 화면 명
	scrn_dc text NULL, -- 화면 설명
	scrn_ty_code text DEFAULT 'LIST'::text NOT NULL, -- 화면 유형 코드
	url_path text NULL, -- url 경로
	sort_ordr int4 DEFAULT 0 NOT NULL, -- 정렬 순서
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 생성 일시
	mdfcn_dt timestamp(3) NULL, -- 수정 일시
	ctgry_l_nm text NULL, -- 대분류 명
	ctgry_m_nm text NULL, -- 중분류 명
	ctgry_s_nm text NULL, -- 소분류 명
	dsply_code text NULL, -- 표시 코드
	layer_data_dc text NULL, -- 레이아웃 데이터 설명
	coment_cn text NULL, -- 코멘트 내용
	asign_mber_id varchar(36) NULL, -- 담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정
	CONSTRAINT tb_ds_screen_pkey PRIMARY KEY (scrn_id),
	CONSTRAINT tb_ds_screen_unit_work_id_fkey FOREIGN KEY (unit_work_id) REFERENCES public.tb_ds_unit_work(unit_work_id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Column comments

COMMENT ON COLUMN public.tb_ds_screen.scrn_id IS '화면 아이디';
COMMENT ON COLUMN public.tb_ds_screen.prjct_id IS '프로젝트 아이디';
COMMENT ON COLUMN public.tb_ds_screen.unit_work_id IS '단위 업무 아이디';
COMMENT ON COLUMN public.tb_ds_screen.scrn_display_id IS '화면 표시 아이디';
COMMENT ON COLUMN public.tb_ds_screen.scrn_nm IS '화면 명';
COMMENT ON COLUMN public.tb_ds_screen.scrn_dc IS '화면 설명';
COMMENT ON COLUMN public.tb_ds_screen.scrn_ty_code IS '화면 유형 코드';
COMMENT ON COLUMN public.tb_ds_screen.url_path IS 'url 경로';
COMMENT ON COLUMN public.tb_ds_screen.sort_ordr IS '정렬 순서';
COMMENT ON COLUMN public.tb_ds_screen.creat_dt IS '생성 일시';
COMMENT ON COLUMN public.tb_ds_screen.mdfcn_dt IS '수정 일시';
COMMENT ON COLUMN public.tb_ds_screen.ctgry_l_nm IS '대분류 명';
COMMENT ON COLUMN public.tb_ds_screen.ctgry_m_nm IS '중분류 명';
COMMENT ON COLUMN public.tb_ds_screen.ctgry_s_nm IS '소분류 명';
COMMENT ON COLUMN public.tb_ds_screen.dsply_code IS '표시 코드';
COMMENT ON COLUMN public.tb_ds_screen.layer_data_dc IS '레이아웃 데이터 설명';
COMMENT ON COLUMN public.tb_ds_screen.coment_cn IS '코멘트 내용';
COMMENT ON COLUMN public.tb_ds_screen.asign_mber_id IS '담당자 회원 ID (tb_cm_member.mber_id) — FK 미설정, NULL=미지정';

-- Permissions

ALTER TABLE public.tb_ds_screen OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_screen TO postgres;


-- public.tb_ds_area definition

-- Drop table

-- DROP TABLE public.tb_ds_area;

CREATE TABLE public.tb_ds_area (
	area_id text NOT NULL, -- 영역 아이디
	prjct_id text NOT NULL, -- 프로젝트 아이디
	scrn_id text NULL, -- 화면 아이디
	area_display_id text NOT NULL, -- 영역 표시 코드
	area_nm text DEFAULT ''::text NOT NULL, -- 영역 명
	area_dc text NULL, -- 영역 설명
	area_ty_code text DEFAULT 'GRID'::text NOT NULL, -- 영역 유형 코드
	sort_ordr int4 DEFAULT 0 NOT NULL, -- 정렬 순서
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 생성 일자
	mdfcn_dt timestamp(3) NULL, -- 수정 일자
	excaldw_data jsonb NULL, -- Excalidraw 데이터
	layer_data_dc text NULL, -- 레이아웃 설명
	coment_cn text STORAGE PLAIN NULL, -- 코멘트 내용
	CONSTRAINT tb_ds_area_pkey PRIMARY KEY (area_id),
	CONSTRAINT tb_ds_area_scrn_id_fkey FOREIGN KEY (scrn_id) REFERENCES public.tb_ds_screen(scrn_id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Column comments

COMMENT ON COLUMN public.tb_ds_area.area_id IS '영역 아이디';
COMMENT ON COLUMN public.tb_ds_area.prjct_id IS '프로젝트 아이디';
COMMENT ON COLUMN public.tb_ds_area.scrn_id IS '화면 아이디';
COMMENT ON COLUMN public.tb_ds_area.area_display_id IS '영역 표시 코드';
COMMENT ON COLUMN public.tb_ds_area.area_nm IS '영역 명';
COMMENT ON COLUMN public.tb_ds_area.area_dc IS '영역 설명';
COMMENT ON COLUMN public.tb_ds_area.area_ty_code IS '영역 유형 코드';
COMMENT ON COLUMN public.tb_ds_area.sort_ordr IS '정렬 순서';
COMMENT ON COLUMN public.tb_ds_area.creat_dt IS '생성 일자';
COMMENT ON COLUMN public.tb_ds_area.mdfcn_dt IS '수정 일자';
COMMENT ON COLUMN public.tb_ds_area.excaldw_data IS 'Excalidraw 데이터';
COMMENT ON COLUMN public.tb_ds_area.layer_data_dc IS '레이아웃 설명';
COMMENT ON COLUMN public.tb_ds_area.coment_cn IS '코멘트 내용';

-- Permissions

ALTER TABLE public.tb_ds_area OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_area TO postgres;


-- public.tb_ds_function definition

-- Drop table

-- DROP TABLE public.tb_ds_function;

CREATE TABLE public.tb_ds_function (
	func_id text NOT NULL, -- 기능 아이디
	prjct_id text NOT NULL, -- 프로젝트 아이디
	area_id text NULL, -- 영역 아이디
	func_display_id text NOT NULL, -- 기능 표시 아이디
	func_nm text DEFAULT ''::text NOT NULL, -- 기능 명
	func_dc text NULL, -- 기능 설명
	priort_code text DEFAULT 'MEDIUM'::text NOT NULL, -- 우선순위 코드
	sort_ordr int4 DEFAULT 0 NOT NULL, -- 정렬 순서
	creat_dt timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL, -- 생성 일시
	mdfcn_dt timestamp(3) NULL, -- 수정 일시
	asign_mber_id text NULL, -- 담당 회원 아이디
	cmplx_code text DEFAULT 'MEDIUM'::text NOT NULL, -- 복잡도 코드
	efrt_val text NULL, -- 예상 공수
	func_ty_code text DEFAULT 'OTHER'::text NOT NULL, -- 기능 유형 코드
	impl_bgng_de text NULL, -- 구현 시작 일자
	impl_end_de text NULL, -- 구현 종료 일자
	coment_cn text NULL, -- 코멘트
	CONSTRAINT tb_ds_function_pkey PRIMARY KEY (func_id),
	CONSTRAINT tb_ds_function_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.tb_ds_area(area_id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Column comments

COMMENT ON COLUMN public.tb_ds_function.func_id IS '기능 아이디';
COMMENT ON COLUMN public.tb_ds_function.prjct_id IS '프로젝트 아이디';
COMMENT ON COLUMN public.tb_ds_function.area_id IS '영역 아이디';
COMMENT ON COLUMN public.tb_ds_function.func_display_id IS '기능 표시 아이디';
COMMENT ON COLUMN public.tb_ds_function.func_nm IS '기능 명';
COMMENT ON COLUMN public.tb_ds_function.func_dc IS '기능 설명';
COMMENT ON COLUMN public.tb_ds_function.priort_code IS '우선순위 코드';
COMMENT ON COLUMN public.tb_ds_function.sort_ordr IS '정렬 순서';
COMMENT ON COLUMN public.tb_ds_function.creat_dt IS '생성 일시';
COMMENT ON COLUMN public.tb_ds_function.mdfcn_dt IS '수정 일시';
COMMENT ON COLUMN public.tb_ds_function.asign_mber_id IS '담당 회원 아이디';
COMMENT ON COLUMN public.tb_ds_function.cmplx_code IS '복잡도 코드';
COMMENT ON COLUMN public.tb_ds_function.efrt_val IS '예상 공수';
COMMENT ON COLUMN public.tb_ds_function.func_ty_code IS '기능 유형 코드';
COMMENT ON COLUMN public.tb_ds_function.impl_bgng_de IS '구현 시작 일자';
COMMENT ON COLUMN public.tb_ds_function.impl_end_de IS '구현 종료 일자';
COMMENT ON COLUMN public.tb_ds_function.coment_cn IS '코멘트';

-- Permissions

ALTER TABLE public.tb_ds_function OWNER TO postgres;
GRANT ALL ON TABLE public.tb_ds_function TO postgres;