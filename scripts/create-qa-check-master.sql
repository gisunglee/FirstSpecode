-- ────────────────────────────────────────────────────────────────────────
-- tb_qa_check_master — 공통 점검 마스터 (재사용 풀)
--
-- 정책:
--   prjct_id IS NULL → 시스템 공통 (모든 프로젝트에 자동 노출)
--   prjct_id = UUID  → 프로젝트 전용 (해당 프로젝트만)
--
-- 멱등성: CREATE TABLE IF NOT EXISTS / INSERT 는 prjct_id IS NULL 항목이
--          0건일 때만 수행 (재실행해도 시스템 시드 중복 안 생김)
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tb_qa_check_master" (
  "check_id"       TEXT         NOT NULL,
  "prjct_id"       TEXT,
  "ctgry_code"     TEXT         NOT NULL,
  "scenario_cn"    TEXT         NOT NULL,
  "expected_cn"    TEXT,
  "sort_ordr"      INTEGER      NOT NULL DEFAULT 0,
  "use_yn"         CHAR(1)      NOT NULL DEFAULT 'Y',
  "creat_mber_id"  TEXT,
  "creat_dt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mdfr_mber_id"   TEXT,
  "mdfcn_dt"       TIMESTAMP(3),
  CONSTRAINT "tb_qa_check_master_pkey" PRIMARY KEY ("check_id")
);

CREATE INDEX IF NOT EXISTS "tb_qa_check_master_idx"
  ON "tb_qa_check_master"("prjct_id", "use_yn", "ctgry_code", "sort_ordr");

-- 프로젝트 전용 항목만 CASCADE — 시스템 공통(prjct_id NULL) 은 영향 없음
ALTER TABLE "tb_qa_check_master"
  DROP CONSTRAINT IF EXISTS "tb_qa_check_master_prjct_fk";
ALTER TABLE "tb_qa_check_master"
  ADD CONSTRAINT "tb_qa_check_master_prjct_fk"
  FOREIGN KEY ("prjct_id") REFERENCES "tb_pj_project"("prjct_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────
-- 시스템 공통 시드 (prjct_id IS NULL) — 캡처 양식의 표준 체크리스트 15개
-- 카테고리: INIT_SCREEN | QUERY | INPUT_QUERY | INPUT
--
-- 이미 시스템 시드가 있으면 INSERT 스킵 (재실행 안전)
-- ────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  seed_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO seed_count FROM tb_qa_check_master WHERE prjct_id IS NULL;
  IF seed_count > 0 THEN
    RAISE NOTICE '시스템 공통 시드 % 건 이미 존재 — 시드 INSERT 스킵', seed_count;
    RETURN;
  END IF;

  INSERT INTO tb_qa_check_master (check_id, prjct_id, ctgry_code, scenario_cn, expected_cn, sort_ordr) VALUES
    -- 초기화면
    (gen_random_uuid()::text, NULL, 'INIT_SCREEN', '메뉴버튼 클릭 시 해당화면이 정상적으로 load 되는가?',                           '메뉴 클릭 후 화면이 즉시 표시됨', 1),
    (gen_random_uuid()::text, NULL, 'INIT_SCREEN', '메뉴명과 화면 상단의 화면명이 일치하는가?',                                       '메뉴명과 타이틀 일치',           2),
    (gen_random_uuid()::text, NULL, 'INIT_SCREEN', '사용자 권한에 따라 화면 UI 가 적절히 활성/비활성화되고 동작하는가?',           '권한별 버튼·필드 노출 일치',     3),
    (gen_random_uuid()::text, NULL, 'INIT_SCREEN', '화면 구성요소의 글씨체/크기, 대소문자, 위치 등이 표준을 준수하는가?',         '표준 가이드 준수',               4),
    (gen_random_uuid()::text, NULL, 'INIT_SCREEN', '화면 UI 상에 오타가 없는가?',                                                  '오탈자 없음',                    5),
    (gen_random_uuid()::text, NULL, 'INIT_SCREEN', '화면에 삽입된 이미지들이 정상적으로 표시되는가?',                              '이미지 정상 로드',              6),
    (gen_random_uuid()::text, NULL, 'INIT_SCREEN', '화면 상에서 상하좌우 스크롤이 제대로 동작하는가?',                             '스크롤 정상',                    7),
    -- 조회
    (gen_random_uuid()::text, NULL, 'QUERY',       '숫자는 우측, 문자는 좌측(필요에 따라 가운데) 정렬되는가?',                     '정렬 규칙 준수',                 8),
    (gen_random_uuid()::text, NULL, 'QUERY',       '숫자는 콤마(,)를 사용하여 우측에서 좌측으로 3자리씩 구분하고 있는가?',          '천 단위 콤마 표시',              9),
    (gen_random_uuid()::text, NULL, 'QUERY',       '전화번호, 주민등록번호, 사업자번호, 카드번호 조회(출력) 시 -으로 구분하여 출력하였는가?', '하이픈 포맷 출력',              10),
    -- 입력 및 조회
    (gen_random_uuid()::text, NULL, 'INPUT_QUERY', '삭제 또는 변경 시 삭제여부 또는 변경여부에 대한 확인메시지가 반드시 나타나는가?', '확인 메시지 노출',              11),
    (gen_random_uuid()::text, NULL, 'INPUT_QUERY', '기능 처리 시 메시지는 적절하게 작성되었는가?',                                 '메시지 정확',                   12),
    (gen_random_uuid()::text, NULL, 'INPUT_QUERY', '키보드의 디폴트 키는 적절하게 설정되었는가? (예: 조회조건 입력 후 Enter Key 클릭 시 조회)', 'Enter/Tab 등 키 동작',           13),
    (gen_random_uuid()::text, NULL, 'INPUT_QUERY', '입력불가 필드는 disable 처리 및 다른 Color로 표시되는가?',                     'disable 시각 구분',             14),
    -- 입력
    (gen_random_uuid()::text, NULL, 'INPUT',       '필수입력 텍스트 필드와 일반 입력 텍스트 필드를 육안으로 구별가능토록 표시되는가?', '필수 필드 표시',                15);

  RAISE NOTICE '시스템 공통 시드 15건 INSERT 완료';
END $$;
