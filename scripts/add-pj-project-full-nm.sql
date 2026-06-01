-- tb_pj_project 에 프로젝트 정식 명칭(Full Name) 컬럼 추가
-- 적용일: 2026-05-30
-- 단순 정보 보관용 (현재 출력·검증·역할 없음). 기존 데이터는 모두 NULL.
ALTER TABLE tb_pj_project
  ADD COLUMN prjct_full_nm VARCHAR(100);
