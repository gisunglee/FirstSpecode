-- ============================================================================
-- 2026-08-19  메모보드 확장 (엔티티 연결 진입점 + 웹/엑셀 작성 타입 + 3단계 공개범위)
--
-- 기존 tb_ds_memo(제목/본문/공유여부/다형참조)를 그대로 확장한다. 신규 테이블을
-- 만들지 않는 이유: 목록/상세 화면, API, 엑셀 내보내기가 이미 이 테이블 기준으로
-- 구현되어 있어 재사용이 더 낫다.
--
--   memo_ty_code : WEB(리치텍스트) | EXCEL(Fortune-sheet) — 작성 시 확정, 이후 불변
--   sheet_data   : EXCEL 타입일 때만 값 존재 (Fortune-sheet 워크북 JSON)
--   visblty_code : 기존 share_yn(Y/N)을 대체 — PRIVATE(나만보기) | TEAM_READ(전체조회,
--                  작성자만 수정) | TEAM_EDIT(전체수정, 프로젝트 멤버 누구나 수정 가능)
-- ============================================================================

BEGIN;

ALTER TABLE public.tb_ds_memo
  ADD COLUMN memo_ty_code varchar(10) NOT NULL DEFAULT 'WEB',
  ADD COLUMN sheet_data   jsonb,
  ADD COLUMN visblty_code varchar(20) NOT NULL DEFAULT 'PRIVATE';

-- 기존 데이터 이관: share_yn='Y' → TEAM_READ(전체조회), 'N' → PRIVATE(나만보기)
-- 과거에는 공유해도 본인만 수정 가능했으므로 TEAM_EDIT로는 옮기지 않는다.
UPDATE public.tb_ds_memo
   SET visblty_code = CASE WHEN share_yn = 'Y' THEN 'TEAM_READ' ELSE 'PRIVATE' END;

ALTER TABLE public.tb_ds_memo
  DROP COLUMN share_yn;

COMMIT;
