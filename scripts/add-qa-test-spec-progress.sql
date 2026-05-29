-- tb_qa_test_spec 에 진척률 컬럼 추가
-- 적용일: 2026-05-29
-- 값: 0 ~ 100 (10 단위 권장). 화면에서 10단계 드롭다운으로 선택.
ALTER TABLE tb_qa_test_spec
  ADD COLUMN prgrs_rt INT NOT NULL DEFAULT 0;
