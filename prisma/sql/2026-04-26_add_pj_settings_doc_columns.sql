-- ================================================================
-- tb_pj_project_settings 에 출력 문서 양식 기본값 컬럼 추가
--
-- 배경:
--   요구사항 docx 출력 기능 1차 도입 시점에 "저작권 문구"와 "기본 문서 버전"이
--   코드 fallback("Copyright ⓒ SPECODE", "v1.0") 로만 채워지고 있었다.
--   프로젝트(발주처)별로 이 두 값을 입력받아 출력에 반영할 수 있도록
--   기존 설정 테이블에 컬럼 2개를 추가한다.
--
-- 컬럼:
--   copyright_holder
--     출력 docx 의 표지 / 바닥글 저작권 문구
--     예) "Copyright ⓒ (주)바른아이오"
--     NULL 허용 — 미설정 시 export 핸들러가 코드 fallback 사용
--
--   doc_version_default
--     출력 docx 표지 / 변경이력 표의 기본 문서 버전
--     예) "v1.0"
--     NULL 허용 — 미설정 시 "v1.0" fallback
--
-- 마이그레이션 안전성:
--   IF NOT EXISTS 로 재실행 안전 (멱등).
--   기존 행은 NULL 상태 유지 — 호출 측이 fallback 처리.
--
-- 후속 작업:
--   - 프로젝트 설정 페이지에 [문서 설정] 탭 추가
--   - 출력 핸들러에서 두 컬럼 조회 + fallback 적용
--
-- 작성일 : 2026-04-26
-- ================================================================

BEGIN;

ALTER TABLE tb_pj_project_settings
  ADD COLUMN IF NOT EXISTS copyright_holder    VARCHAR(255);

ALTER TABLE tb_pj_project_settings
  ADD COLUMN IF NOT EXISTS doc_version_default VARCHAR(50);

COMMIT;

-- ================================================================
-- 검증 쿼리 (참고용 — 실행 후 수동 확인)
-- ================================================================
-- 1) 컬럼 추가 확인:
--    \d+ tb_pj_project_settings
--    → copyright_holder VARCHAR(255), doc_version_default VARCHAR(50) 보여야 함
--
-- 2) 기존 행은 NULL 로 채워짐:
--    SELECT prjct_id, copyright_holder, doc_version_default
--      FROM tb_pj_project_settings;
