-- 2026-05-12 — 요구사항 확정(baseline) 시스템 제거
--
-- 사유: 요구사항 정의서 "발행" 시스템(TbDsDocumentRelease, doc_kind='REQUIREMENTS_DEF')으로 통합.
--      별도의 baseline 개념은 폐기.
--
-- 실행 전:
--   - 운영에 baseline 데이터가 있다면 보존 가치 확인 후 별도 백업
--   - dev 서버는 끄고 실행 (Prisma client 재생성 lock 회피)
--
-- 실행 방법 (Windows / PowerShell):
--   npx dotenv -e .env.local -- npx prisma db execute --file ddl/20260512-drop-baseline.sql --schema prisma/schema.prisma
--   npx prisma generate

DROP TABLE IF EXISTS public.tb_rq_baseline_snapshot CASCADE;
