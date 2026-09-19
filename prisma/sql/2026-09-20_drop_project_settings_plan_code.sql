-- tb_pj_project_settings.plan_code 삭제 (결제 2단계 마무리)
--
-- 이유:
--   플랜은 회원(tb_cm_member.plan_code)에 있고, 상한·좌석 판정은 프로젝트 소유자의 플랜을 본다
--   (정책 §1-3). 프로젝트 설정의 plan_code 는 생성·복사 라우트가 'FREE' 를 써 넣기만 하고
--   아무 코드도 읽지 않았다 (2026-09-20 grep 재확인). 두 곳에 플랜이 있으면 언젠가 누가
--   잘못 읽으므로 컬럼을 없앤다.
--
-- 적용 순서 (2단계 DDL 규칙 — 옛 코드와 공존):
--   ① 새 코드(생성·복사 라우트에서 plan_code 쓰기 제거, Prisma 모델에서 필드 제거) 배포
--   ② 배포 확인 후 이 파일 적용
--   ①보다 먼저 적용하면 옛 코드의 INSERT 가 "column does not exist" 로 실패한다.
--   Prisma 모델에서 먼저 필드를 빼 두어도 DB 컬럼에 DEFAULT 'FREE' 가 있어 ① 시점에는 문제없다.

BEGIN;

ALTER TABLE public.tb_pj_project_settings
  DROP COLUMN IF EXISTS plan_code;

COMMIT;
