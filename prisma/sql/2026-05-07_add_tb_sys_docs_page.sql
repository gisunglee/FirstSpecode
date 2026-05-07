-- ================================================================
-- 시스템 문서 페이지 테이블 신규 — tb_sys_docs_page (Docs Hub 2단계)
--   작성일 : 2026-05-07
--   범위   : 도움창고 > DOCS 의 좌측 트리 2단계 (페이지 = 실제 문서).
--            본문은 Markdown 으로 저장 (Toast UI Editor 작성).
--            라우팅: /docs/[sect_slug]/[page_slug]
--
--   설계 메모:
--     - sect_id FK ON DELETE RESTRICT — 페이지가 있는 섹션은 물리 삭제 차단.
--       (운영 워크플로우는 섹션 use_yn=N 으로 숨김 처리 권장)
--     - (sect_id, page_slug) 조합이 use_yn='Y' 범위에서 유니크 —
--       다른 섹션은 같은 page_slug 사용 가능 (예: /docs/guide/install ≠ /docs/api/install)
--     - page_sttus_code: DRAFT (작성중) | PUBLISHED (공개) | ARCHIVED (보관)
--       사용자 트리에는 PUBLISHED + use_yn='Y' 만 노출.
--     - badge_code: NEW | BETA | DEPRECATED | NULL — 트리 옆 배지로 표시.
--
--   실행 방법:
--     1) tb_sys_docs_section 테이블이 먼저 존재해야 함 (FK 의존)
--     2) 본 파일 psql 실행
--     3) prisma/schema.prisma 에 TbSysDocsPage 모델 반영
--     4) npx prisma db push → npx prisma generate
--
--   롤백 시 본 파일 하단 [ROLLBACK] 섹션 참조.
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tb_sys_docs_page (
  page_id          VARCHAR(36)  NOT NULL,
  -- 소속 섹션 — tb_sys_docs_section.sect_id 참조
  sect_id          VARCHAR(36)  NOT NULL,
  -- URL slug (섹션 내 유니크)
  page_slug        VARCHAR(50)  NOT NULL,
  -- 페이지 제목 (브라우저 탭, 본문 H1)
  page_sj          VARCHAR(200) NOT NULL DEFAULT '',
  -- 한 줄 요약 — 트리/검색 결과 카드의 부가 설명용 (NULL 가능)
  page_excerpt     VARCHAR(500) NULL,
  -- 본문 — Markdown 원문 (단일 진실 공급원). 렌더링은 클라이언트에서.
  page_cn          TEXT         NULL,
  -- 발행 상태: DRAFT | PUBLISHED | ARCHIVED
  -- 사용자 뷰어는 PUBLISHED + use_yn='Y' 만 노출
  page_sttus_code  VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
  -- 배지: NEW | BETA | DEPRECATED | NULL — 트리/페이지 헤더에 표시
  badge_code       VARCHAR(20)  NULL,
  sort_ordr        INTEGER      NOT NULL DEFAULT 0,
  -- 사용여부 — Y=목록 노출 / N=숨김(논리삭제). 물리 삭제는 별도.
  use_yn           CHAR(1)      NOT NULL DEFAULT 'Y',
  creat_mber_id    VARCHAR(36)  NULL,
  creat_dt         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mdfr_mber_id     VARCHAR(36)  NULL,
  mdfcn_dt         TIMESTAMP(3) NULL,
  CONSTRAINT tb_sys_docs_page_pkey PRIMARY KEY (page_id),
  -- 페이지가 매달린 섹션은 물리 삭제 금지 — 데이터 안전
  CONSTRAINT tb_sys_docs_page_sect_fk
    FOREIGN KEY (sect_id) REFERENCES tb_sys_docs_section (sect_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE  tb_sys_docs_page                  IS '시스템 문서 페이지 (Docs Hub 2단계 — 실제 문서)';
COMMENT ON COLUMN tb_sys_docs_page.page_id          IS 'PK UUID';
COMMENT ON COLUMN tb_sys_docs_page.sect_id          IS '섹션 FK (tb_sys_docs_section.sect_id)';
COMMENT ON COLUMN tb_sys_docs_page.page_slug        IS 'URL slug — 섹션 내 유니크 (use_yn=Y 범위)';
COMMENT ON COLUMN tb_sys_docs_page.page_sj          IS '페이지 제목';
COMMENT ON COLUMN tb_sys_docs_page.page_excerpt     IS '한 줄 요약 (트리/검색 결과 카드 부가 텍스트)';
COMMENT ON COLUMN tb_sys_docs_page.page_cn          IS 'Markdown 본문 (단일 진실 공급원)';
COMMENT ON COLUMN tb_sys_docs_page.page_sttus_code  IS '발행 상태 — DRAFT|PUBLISHED|ARCHIVED. 뷰어는 PUBLISHED 만';
COMMENT ON COLUMN tb_sys_docs_page.badge_code       IS '표시 배지 — NEW|BETA|DEPRECATED|NULL';
COMMENT ON COLUMN tb_sys_docs_page.sort_ordr        IS '섹션 내 표시 순서 (작을수록 위)';
COMMENT ON COLUMN tb_sys_docs_page.use_yn           IS '사용여부 — Y=목록 노출, N=숨김 (논리삭제)';
COMMENT ON COLUMN tb_sys_docs_page.creat_mber_id    IS '작성자 회원 ID (시스템 시드는 NULL 허용)';
COMMENT ON COLUMN tb_sys_docs_page.mdfr_mber_id     IS '최종 수정자 회원 ID (NULL=미수정)';

-- 섹션 안 슬러그 유일성 (N 상태 슬러그 보관 허용)
CREATE UNIQUE INDEX IF NOT EXISTS tb_sys_docs_page_slug_uk
  ON tb_sys_docs_page (sect_id, page_slug)
  WHERE use_yn = 'Y';

-- 트리 렌더링 핫패스 — 한 섹션의 페이지를 sort_ordr 순으로
CREATE INDEX IF NOT EXISTS tb_sys_docs_page_sect_idx
  ON tb_sys_docs_page (sect_id, use_yn, sort_ordr);

-- 발행 페이지 검색·최근 변경 정렬용
CREATE INDEX IF NOT EXISTS tb_sys_docs_page_sttus_idx
  ON tb_sys_docs_page (page_sttus_code, mdfcn_dt DESC, creat_dt DESC);

COMMIT;


-- ================================================================
-- [ROLLBACK] — 데이터 손실 주의 (FK 의존 순서: page → section)
-- ================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS tb_sys_docs_page;
-- COMMIT;
