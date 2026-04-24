-- ================================================================
-- 설계 양식 테이블 신규 — tb_ai_design_template
--   작성일 : 2026-04-24
--   범위   : 5계층(REQUIREMENT/UNIT_WORK/SCREEN/AREA/FUNCTION) 설계 설명의
--            "예시"(example_cn) + "템플릿"(template_cn) 마크다운을 DB로 관리.
--            기존 상세 페이지에 상수로 박혀 있던 양식을 DB화해
--            운영자가 양식을 바꿀 때 빌드·배포 없이 반영할 수 있도록 한다.
--   참고   : 프롬프트 템플릿(tb_ai_prompt_template)과 동일한 스코프 체계
--             - prjct_id = NULL  → 시스템 공통(모든 프로젝트에서 사용)
--             - prjct_id = UUID  → 해당 프로젝트 전용(공통을 override)
--
--   실행 방법:
--     1) 이 파일 전체를 DB 클라이언트(psql 등)로 실행
--     2) `npx prisma generate` 로 클라이언트 재생성
--     3) 애플리케이션 재기동
--     4) 이어서 seed 파일(2026-04-24_seed_tb_ai_design_template.sql) 실행
--
--   롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tb_ai_design_template (
  dsgn_tmpl_id   VARCHAR(36)  NOT NULL,
  prjct_id       VARCHAR(36)  NULL,                   -- NULL = 시스템 공통
  -- 대상 계층: REQUIREMENT | UNIT_WORK | SCREEN | AREA | FUNCTION
  -- 설계 양식은 반드시 특정 계층에 종속되므로 NOT NULL
  ref_ty_code    VARCHAR(20)  NOT NULL,
  tmpl_nm        VARCHAR(200) NOT NULL,
  tmpl_dc        TEXT         NULL,                   -- 관리 UI 표시용 짧은 설명
  -- 예시 본문(마크다운) — 상세 페이지의 "예시" 버튼 팝업에 렌더
  example_cn     TEXT         NULL,
  -- 템플릿 본문(마크다운) — "템플릿 삽입" 버튼으로 에디터에 주입
  -- 플레이스홀더 {{displayId}}, {{name}}는 클라이언트에서 치환
  template_cn    TEXT         NULL,
  use_yn         CHAR(1)      NOT NULL DEFAULT 'Y',
  -- 시스템 기본 양식(seed) 표시. 'Y'면 편집·삭제 금지
  default_yn     CHAR(1)      NOT NULL DEFAULT 'N',
  sort_ordr      INTEGER      NOT NULL DEFAULT 0,
  creat_mber_id  VARCHAR(36)  NULL,
  creat_dt       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mdfcn_dt       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tb_ai_design_template_pkey PRIMARY KEY (dsgn_tmpl_id)
);

COMMENT ON TABLE  tb_ai_design_template               IS '설계 양식 (예시+템플릿 마크다운)';
COMMENT ON COLUMN tb_ai_design_template.dsgn_tmpl_id  IS 'PK UUID';
COMMENT ON COLUMN tb_ai_design_template.prjct_id      IS '프로젝트 ID (NULL=시스템 공통, 모든 프로젝트에서 공유)';
COMMENT ON COLUMN tb_ai_design_template.ref_ty_code   IS '대상 계층: REQUIREMENT|UNIT_WORK|SCREEN|AREA|FUNCTION';
COMMENT ON COLUMN tb_ai_design_template.tmpl_nm       IS '템플릿 이름';
COMMENT ON COLUMN tb_ai_design_template.tmpl_dc       IS '템플릿 짧은 설명';
COMMENT ON COLUMN tb_ai_design_template.example_cn    IS '예시 본문(마크다운) — "예시" 버튼 팝업 표시';
COMMENT ON COLUMN tb_ai_design_template.template_cn   IS '템플릿 본문(마크다운) — {{displayId}}/{{name}} 플레이스홀더 지원';
COMMENT ON COLUMN tb_ai_design_template.use_yn        IS '사용여부 Y/N';
COMMENT ON COLUMN tb_ai_design_template.default_yn    IS '시스템 기본(Y=편집/삭제 불가)';
COMMENT ON COLUMN tb_ai_design_template.sort_ordr     IS '정렬 우선순위 (작을수록 먼저)';

-- 상세 페이지 resolve 쿼리의 핫패스 — ref_ty_code + 스코프로 빠르게 조회
CREATE INDEX IF NOT EXISTS idx_ai_dsgn_tmpl_scope
  ON tb_ai_design_template (ref_ty_code, use_yn, prjct_id, default_yn, sort_ordr);

-- 관리 목록 정렬용 — 프로젝트·계층 단위 정렬 조회
CREATE INDEX IF NOT EXISTS idx_ai_dsgn_tmpl_prjct
  ON tb_ai_design_template (prjct_id, ref_ty_code, sort_ordr);

COMMIT;


-- ================================================================
-- [ROLLBACK] — 테이블 제거 (카운터/양식 데이터 손실)
-- ================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS tb_ai_design_template;
-- COMMIT;
