-- TbDsArea: 영역 표시 형태 코드 추가
--
-- 배경:
--   "공통이 아닌 종속 팝업"을 별도 화면(Screen)으로 빼지 않고 부모 화면 안의 영역(Area)으로
--   계속 다루기 위함. 같은 영역이라도 INLINE 으로 보이는 것과 LAYER_POPUP 으로 뜨는 것을
--   구분해야 PRD/AI 자동 설계가 사용자 흐름을 정확히 표현할 수 있음.
--
-- 코드 값:
--   INLINE       — 화면에 그대로 박혀 있음 (기본)
--   LAYER_POPUP  — 클릭으로 뜨는 레이어 팝업
--   MODAL        — 배경 차단 모달 다이얼로그
--   DRAWER       — 옆에서 슬라이드되어 나오는 패널
--   TAB_PANEL    — 탭 안의 콘텐츠
--   ACCORDION    — 펼침/접힘 영역
--
-- 표시 시점/트리거 설명은 별도 컬럼을 두지 않고 기존 area_dc(영역 설명)에 자유 텍스트로 작성.

ALTER TABLE tb_ds_area
  ADD COLUMN IF NOT EXISTS display_form_code TEXT NOT NULL DEFAULT 'INLINE';

COMMENT ON COLUMN tb_ds_area.display_form_code IS
  '영역 표시 형태 코드 (INLINE / LAYER_POPUP / MODAL / DRAWER / TAB_PANEL / ACCORDION)';
