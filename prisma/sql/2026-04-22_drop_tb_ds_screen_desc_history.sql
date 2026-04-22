-- ================================================================
-- 사용되지 않는 이력 테이블 제거 — tb_ds_screen_desc_history
--   작성일 : 2026-04-22
--   범위   : public.tb_ds_screen_desc_history 1개 테이블만 DROP
--   사유   : 화면 설명 변경 이력은 tb_ds_design_change 통합 이력 테이블로
--            이관됨(FID-00147 v3). 구 전용 테이블은 INSERT 경로가 전혀 없고
--            현재 0건 상태이며, UI/MCP 어느 곳에서도 호출되지 않음.
--
-- 실행 방법:
--   1) 이 파일 전체를 DB 클라이언트(또는 psql)로 실행
--   2) 실행 후 `npm run db:generate` 로 Prisma Client 재생성
--   3) 애플리케이션 재기동
--
-- 안전장치:
--   - 데이터가 있으면 의도치 않은 삭제 방지를 위해 ROLLBACK
--   - 다른 테이블은 절대 건드리지 않음 (DROP 대상 명시)
-- ================================================================

BEGIN;

-- 0) 대상 테이블 존재 확인 및 데이터 0건 검증
DO $$
DECLARE
  v_exists BOOLEAN;
  v_count  BIGINT;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'tb_ds_screen_desc_history'
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE NOTICE '[SKIP] tb_ds_screen_desc_history 테이블이 이미 존재하지 않습니다.';
    RETURN;
  END IF;

  EXECUTE 'SELECT COUNT(*) FROM public.tb_ds_screen_desc_history' INTO v_count;

  IF v_count > 0 THEN
    RAISE EXCEPTION '[ABORT] tb_ds_screen_desc_history 에 데이터 %건이 존재합니다. 의도치 않은 삭제 방지를 위해 롤백합니다. 데이터를 확인·백업한 뒤 수동으로 제거 후 재실행하세요.', v_count;
  END IF;

  RAISE NOTICE '[OK] tb_ds_screen_desc_history — 존재 확인, 데이터 0건. DROP 진행.';
END$$;

-- 1) 테이블 DROP — CASCADE 없이 수행하여 예상치 못한 의존 객체 차단
DROP TABLE IF EXISTS public.tb_ds_screen_desc_history;

COMMIT;


-- ================================================================
-- [ROLLBACK] — 테이블 재생성이 필요할 경우 (데이터는 복구 불가)
--   아래 블록은 참고용. 운영 복구 시에는 백업본으로 복원 권장.
-- ================================================================
-- BEGIN;
-- CREATE TABLE public.tb_ds_screen_desc_history (
--   hist_id     VARCHAR(36) PRIMARY KEY,
--   scrn_id     VARCHAR(36) NOT NULL,
--   prjct_id    VARCHAR(36) NOT NULL,
--   bfr_dc      TEXT        NULL,
--   aftr_dc     TEXT        NULL,
--   chg_mber_id VARCHAR(36) NOT NULL,
--   creat_dt    TIMESTAMP   NOT NULL DEFAULT NOW(),
--   CONSTRAINT fk_tb_ds_screen_desc_history_screen
--     FOREIGN KEY (scrn_id) REFERENCES public.tb_ds_screen(scrn_id) ON DELETE CASCADE
-- );
-- COMMIT;
