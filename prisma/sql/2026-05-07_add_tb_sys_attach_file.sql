-- ================================================================
-- 시스템 첨부파일 테이블 신규 — tb_sys_attach_file
--   작성일 : 2026-05-07
--   범위   : SUPER_ADMIN 이 시스템 자산(Docs 본문 이미지, 다운로드 파일,
--            추후 자료실 zip 등)을 업로드할 때 사용하는 첨부 저장소.
--
--   왜 tb_cm_attach_file 과 분리했나?
--     - tb_cm_attach_file = 프로젝트 멤버 업로드 (영역/요구사항/AI 태스크 등)
--       프로젝트 lifecycle 종속 (CASCADE). 멤버 권한.
--     - tb_sys_attach_file = SUPER_ADMIN 업로드. 시스템 lifetime 전체 보존.
--       별도 권한 경계 / 별도 정리 정책 / 별도 용량 정책.
--     섞이면 권한 분기·cascade 가 매 쿼리마다 복잡해지므로 처음부터 분리.
--
--   다형 참조 구조:
--     ref_tbl_nm = 'tb_sys_docs_page'  → 현재 사용 (Docs 인라인/별첨)
--     ref_tbl_nm = 'tb_sys_resource'   → 자료실(추후 추가)
--     ref_tbl_nm = ...                  → 시스템 자산이면 모두 여기
--
--   첨부 구분:
--     attach_div_code = 'INLINE' → Markdown 본문에 삽입된 이미지 등
--     attach_div_code = 'ATTACH' → 페이지 하단 별첨 다운로드 파일
--
--   실행 방법:
--     1) psql 로 본 파일 실행
--     2) prisma/schema.prisma 에 TbSysAttachFile 모델 반영
--     3) npx prisma db push → npx prisma generate
--
--   롤백 시 본 파일 하단 [ROLLBACK] 섹션 참조.
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tb_sys_attach_file (
  attach_id        VARCHAR(36)  NOT NULL,
  -- 다형 참조 — 어느 시스템 테이블의 어느 행에 매달린 첨부인지
  ref_tbl_nm       VARCHAR(50)  NOT NULL,
  ref_id           VARCHAR(36)  NOT NULL,
  -- 첨부 용도 — INLINE (본문 삽입 이미지) | ATTACH (별첨 다운로드)
  -- 같은 페이지에 두 종류가 공존할 수 있으므로 명시적 구분 필요
  attach_div_code  VARCHAR(20)  NOT NULL DEFAULT 'ATTACH',
  -- 원본 파일명 (사용자가 업로드한 그대로의 표시용)
  orgnl_file_nm    VARCHAR(500) NOT NULL,
  -- 저장 파일명 (UUID 기반 충돌 방지) — 디스크/오브젝트 스토리지 키
  stor_file_nm     VARCHAR(500) NOT NULL,
  file_path_nm     VARCHAR(1000) NOT NULL,
  -- 파일 크기 (바이트). 미래의 대용량 zip 대비 BIGINT.
  file_sz          BIGINT       NOT NULL,
  file_extsn_nm    VARCHAR(20)  NOT NULL,
  -- MIME 타입 — 확장자 위장 방지를 위한 더블체크용
  mime_ty          VARCHAR(100) NOT NULL DEFAULT '',
  sort_ordr        INTEGER      NOT NULL DEFAULT 0,
  -- 사용여부 — Y=노출 / N=숨김. 물리 파일 정리는 별도 배치(cleanup).
  use_yn           CHAR(1)      NOT NULL DEFAULT 'Y',
  creat_mber_id    VARCHAR(36)  NULL,
  creat_dt         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mdfr_mber_id     VARCHAR(36)  NULL,
  mdfcn_dt         TIMESTAMP(3) NULL,
  CONSTRAINT tb_sys_attach_file_pkey PRIMARY KEY (attach_id)
);

COMMENT ON TABLE  tb_sys_attach_file                IS '시스템 첨부파일 (SUPER_ADMIN 업로드 — Docs 등)';
COMMENT ON COLUMN tb_sys_attach_file.attach_id      IS 'PK UUID';
COMMENT ON COLUMN tb_sys_attach_file.ref_tbl_nm     IS '다형 참조 테이블명 (예: tb_sys_docs_page)';
COMMENT ON COLUMN tb_sys_attach_file.ref_id         IS '참조 대상 ID (해당 테이블의 PK)';
COMMENT ON COLUMN tb_sys_attach_file.attach_div_code IS '첨부 용도 — INLINE(본문 이미지) | ATTACH(별첨 다운로드)';
COMMENT ON COLUMN tb_sys_attach_file.orgnl_file_nm  IS '원본 파일명 (사용자 표시용)';
COMMENT ON COLUMN tb_sys_attach_file.stor_file_nm   IS '저장 파일명 (UUID 등 충돌 방지 키)';
COMMENT ON COLUMN tb_sys_attach_file.file_path_nm   IS '저장 경로 또는 외부 URL';
COMMENT ON COLUMN tb_sys_attach_file.file_sz        IS '파일 크기 (바이트)';
COMMENT ON COLUMN tb_sys_attach_file.file_extsn_nm  IS '확장자 (소문자, 점 제외)';
COMMENT ON COLUMN tb_sys_attach_file.mime_ty        IS 'MIME 타입 — 확장자 위장 방지 더블체크';
COMMENT ON COLUMN tb_sys_attach_file.sort_ordr      IS '같은 ref 내 표시 순서 (별첨 목록)';
COMMENT ON COLUMN tb_sys_attach_file.use_yn         IS '사용여부 — Y=노출, N=숨김 (논리삭제)';

-- 페이지별 첨부 목록 핫패스
CREATE INDEX IF NOT EXISTS tb_sys_attach_file_ref_idx
  ON tb_sys_attach_file (ref_tbl_nm, ref_id, use_yn, sort_ordr);

-- 관리자 전체 첨부 조회 (최근 업로드 순)
CREATE INDEX IF NOT EXISTS tb_sys_attach_file_use_idx
  ON tb_sys_attach_file (use_yn, creat_dt DESC);

COMMIT;


-- ================================================================
-- [ROLLBACK] — 데이터 손실 주의 (디스크 파일은 별도 정리 필요)
-- ================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS tb_sys_attach_file;
-- COMMIT;
