-- ================================================================
-- 표준 가이드 테이블 신규 — tb_sg_std_guide (UW-00030)
--   작성일 : 2026-04-23
--   범위   : 프로젝트별 AI 제약사항/규칙 문서 저장
--   참고   : 향후 MCP tool 노출과 /run-ai-task 프롬프트 자동 주입의 소스.
--            Prisma 모델: TbSgStdGuide (prisma/schema.prisma)
--            카테고리 enum: src/constants/codes.ts GuideCategory
--
-- 실행 방법:
--   1) 이 파일 전체를 DB 클라이언트(또는 psql)로 실행
--   2) 실행 후 `npx prisma generate` 로 클라이언트 재생성
--   3) 애플리케이션 재기동
--
-- 롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tb_sg_std_guide (
  guide_id          VARCHAR(36)  NOT NULL,
  prjct_id          VARCHAR(36)  NOT NULL,
  -- UI|DATA|AUTH|API|COMMON|SECURITY|FILE|ERROR|BATCH|REPORT
  guide_ctgry_code  VARCHAR(20)  NOT NULL,
  guide_sj          VARCHAR(200) NOT NULL DEFAULT '',
  guide_cn          TEXT         NULL,
  -- 사용여부 — Y=사용중(AI 참조) / N=미사용(보관만, AI 전달 안 함)
  -- 삭제는 물리 DELETE로 처리. use_yn은 비즈니스 "사용중/미사용" 속성 전용
  use_yn            CHAR(1)      NOT NULL DEFAULT 'Y',
  creat_mber_id     VARCHAR(36)  NOT NULL,
  creat_dt          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mdfr_mber_id      VARCHAR(36)  NULL,
  mdfcn_dt          TIMESTAMP(3) NULL,
  CONSTRAINT tb_sg_std_guide_pkey PRIMARY KEY (guide_id)
);

COMMENT ON TABLE  tb_sg_std_guide                  IS '표준 가이드 문서 (AI 제약사항/규칙)';
COMMENT ON COLUMN tb_sg_std_guide.guide_id         IS 'PK UUID';
COMMENT ON COLUMN tb_sg_std_guide.prjct_id         IS '프로젝트 ID (tb_pj_project.prjct_id)';
COMMENT ON COLUMN tb_sg_std_guide.guide_ctgry_code IS '카테고리: UI|DATA|AUTH|API|COMMON|SECURITY|FILE|ERROR|BATCH|REPORT';
COMMENT ON COLUMN tb_sg_std_guide.guide_sj         IS '제목';
COMMENT ON COLUMN tb_sg_std_guide.guide_cn         IS '본문 (마크다운)';
COMMENT ON COLUMN tb_sg_std_guide.use_yn           IS '사용여부 — Y=사용중(AI 참조), N=미사용(보관만). 삭제는 물리 DELETE로 처리';
COMMENT ON COLUMN tb_sg_std_guide.creat_mber_id    IS '작성자 회원 ID';
COMMENT ON COLUMN tb_sg_std_guide.mdfr_mber_id     IS '최종 수정자 회원 ID (NULL=미수정)';

-- 목록 정렬 및 필터용 인덱스
CREATE INDEX IF NOT EXISTS tb_sg_std_guide_prjct_dt_idx
  ON tb_sg_std_guide (prjct_id, use_yn, mdfcn_dt DESC, creat_dt DESC);

-- 카테고리 탭 필터용 인덱스
CREATE INDEX IF NOT EXISTS tb_sg_std_guide_ctgry_idx
  ON tb_sg_std_guide (prjct_id, guide_ctgry_code, use_yn);

COMMIT;


-- ================================================================
-- [ROLLBACK] — 테이블 제거 (데이터 손실 주의)
-- ================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS tb_sg_std_guide;
-- COMMIT;
