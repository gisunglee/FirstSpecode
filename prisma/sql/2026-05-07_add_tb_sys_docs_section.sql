-- ================================================================
-- 시스템 문서 섹션 테이블 신규 — tb_sys_docs_section (Docs Hub 1단계)
--   작성일 : 2026-05-07
--   범위   : 도움창고 > DOCS 의 좌측 트리 1단계 (섹션 = 카테고리).
--            "시작하기", "핵심 개념", "AI 사용법" 같은 최상위 묶음 단위.
--            아래 단계는 tb_sys_docs_page (페이지) 가 sect_id FK 로 참조.
--
--   설계 메모:
--     - 시스템 자산이므로 prjct_id 컬럼 없음 — SUPER_ADMIN 만 작성/편집.
--     - 트리 깊이 2단계 고정 (section > page). 자기참조 불필요.
--     - sect_slug 는 use_yn='Y' 범위에서 전역 유니크 — 논리삭제된 슬러그는
--       동일 이름으로 재사용 가능 (실수 복원 + 재사용 충돌 방지).
--
--   실행 방법:
--     1) psql 로 본 파일 실행 (테이블 + 인덱스 + 코멘트 일괄)
--     2) prisma/schema.prisma 에 TbSysDocsSection 모델 반영
--     3) npx prisma db push (no-op 확인) → npx prisma generate
--     4) 이어서 tb_sys_docs_page → tb_sys_attach_file 순으로 실행
--     5) 마지막에 seed 파일(2026-05-07_seed_tb_sys_docs_initial.sql) 실행
--
--   롤백이 필요하면 본 파일 하단의 [ROLLBACK] 섹션 참조.
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tb_sys_docs_section (
  sect_id          VARCHAR(36)  NOT NULL,
  -- URL slug — 영문 소문자/숫자/하이픈만 허용 (애플리케이션 레벨 검증)
  -- 예: 'getting-started', 'core-concepts', 'ai-guide'
  sect_slug        VARCHAR(50)  NOT NULL,
  -- 섹션 표시명 — 좌측 트리에 노출되는 사람이 읽는 제목
  sect_nm          VARCHAR(200) NOT NULL DEFAULT '',
  -- 트리 아이콘 키 — menuIcons.tsx 의 i_* 키 또는 NULL (기본 폴더 아이콘)
  sect_icon_code   VARCHAR(50)  NULL,
  sort_ordr        INTEGER      NOT NULL DEFAULT 0,
  -- 사용여부 — Y=공개(트리 노출) / N=숨김(보관용). 실제 삭제는 물리 DELETE.
  use_yn           CHAR(1)      NOT NULL DEFAULT 'Y',
  -- audit — 시스템 시드는 NULL 허용, 운영 화면 생성 시 SUPER_ADMIN ID 기록
  creat_mber_id    VARCHAR(36)  NULL,
  creat_dt         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mdfr_mber_id     VARCHAR(36)  NULL,
  mdfcn_dt         TIMESTAMP(3) NULL,
  CONSTRAINT tb_sys_docs_section_pkey PRIMARY KEY (sect_id)
);

COMMENT ON TABLE  tb_sys_docs_section                IS '시스템 문서 섹션 (Docs Hub 1단계 트리)';
COMMENT ON COLUMN tb_sys_docs_section.sect_id        IS 'PK UUID';
COMMENT ON COLUMN tb_sys_docs_section.sect_slug      IS 'URL slug (영문 소문자/숫자/하이픈) — use_yn=Y 범위에서 전역 유니크';
COMMENT ON COLUMN tb_sys_docs_section.sect_nm        IS '섹션 표시명 (트리 라벨)';
COMMENT ON COLUMN tb_sys_docs_section.sect_icon_code IS '아이콘 키 (menuIcons.tsx i_* 매칭) / NULL=기본 폴더';
COMMENT ON COLUMN tb_sys_docs_section.sort_ordr      IS '표시 순서 (작을수록 위)';
COMMENT ON COLUMN tb_sys_docs_section.use_yn         IS '사용여부 — Y=공개, N=숨김 (논리삭제). 물리 삭제는 별도';
COMMENT ON COLUMN tb_sys_docs_section.creat_mber_id  IS '작성자 회원 ID (시스템 시드는 NULL 허용)';
COMMENT ON COLUMN tb_sys_docs_section.mdfr_mber_id   IS '최종 수정자 회원 ID (NULL=미수정)';

-- 활성 섹션의 슬러그 유일성 — N(숨김) 상태에서는 동일 슬러그 보관 허용
-- (운영 중 슬러그 변경 시 이전 슬러그를 N 으로 보존하는 전략에 대비)
CREATE UNIQUE INDEX IF NOT EXISTS tb_sys_docs_section_slug_uk
  ON tb_sys_docs_section (sect_slug)
  WHERE use_yn = 'Y';

-- 트리 렌더링 핫패스 — 활성 섹션을 sort_ordr 순으로
CREATE INDEX IF NOT EXISTS tb_sys_docs_section_use_idx
  ON tb_sys_docs_section (use_yn, sort_ordr);

COMMIT;


-- ================================================================
-- [ROLLBACK] — 데이터 손실 주의
-- ================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS tb_sys_docs_section;
-- COMMIT;
