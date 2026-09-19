-- 프로젝트 소유자 단일 컬럼 도입 — tb_pj_project.owner_mber_id
--
-- 목적:
--   "이 프로젝트의 소유자는 누구인가"를 한 곳에서 답하기 위함.
--   지금까지는 두 가지가 섞여 쓰였다.
--     (a) tb_pj_project.creat_mber_id           — 생성자. 양도해도 바뀌지 않음
--     (b) tb_pj_project_member.role_code='OWNER' — 역할. 여러 명일 수 있었음
--   회원 탈퇴 API 는 (a) 로 소유 프로젝트를 골라 삭제했고, 탈퇴 화면은 (b) 로
--   목록을 보여 줬다. 양도 후 원 생성자가 탈퇴하면 이미 넘긴 프로젝트가
--   지워지는 구멍이 있었다.
--   결제(플랜·좌석) 는 "결제자 = 프로젝트 소유자 1명" 을 전제로 하므로,
--   소유자를 단일 컬럼으로 못 박고 모든 판정(탈퇴·상한·잠금·결제)이 이 컬럼만
--   보게 한다. OWNER 역할은 이제 항상 1명이며 owner_mber_id 와 같은 사람이다.
--   creat_mber_id 는 감사용(누가 만들었나)으로만 남긴다.
--
-- 백필 기준:
--   활성(ACTIVE) OWNER 멤버 → 없으면 creat_mber_id.
--   2026-09-19 운영 점검 결과 10개 프로젝트 전부 활성 OWNER 1명 = 생성자여서
--   애매한 행은 없다. 그래도 fallback 을 두어 NOT NULL 전환이 실패하지 않게 한다.
--
-- 두 단계로 나눈 이유 (이 파일은 1단계):
--   운영 앱은 아직 owner_mber_id 를 모르는 옛 코드로 돌고 있다. 지금 NOT NULL 을
--   걸면 배포 전까지 운영에서 프로젝트 생성 INSERT 가 실패한다. 그래서
--     1단계(이 파일)  : 컬럼 추가(nullable) + 백필 + 인덱스  — 옛 코드와 공존 가능
--     새 코드 배포     : 생성·복사·양도가 owner_mber_id 를 채우기 시작
--     2단계(_step2)   : 배포 후 생긴 NULL 재백필 + NOT NULL 전환
--   순서를 지키면 어느 시점에도 운영이 깨지지 않는다.
--
-- FK 를 걸지 않는 이유:
--   creat_mber_id 와 동일하게 문자열 참조로만 둔다. 회원은 논리 삭제(WITHDRAWN)만
--   하므로 참조 무결성은 애플리케이션 레벨로 충분하고, 운영 DB 에 제약을 추가하는
--   위험을 줄인다.

BEGIN;

ALTER TABLE public.tb_pj_project
  ADD COLUMN IF NOT EXISTS owner_mber_id text;

-- 1차: 활성 OWNER 멤버 기준
UPDATE public.tb_pj_project p
   SET owner_mber_id = m.mber_id
  FROM public.tb_pj_project_member m
 WHERE m.prjct_id        = p.prjct_id
   AND m.role_code       = 'OWNER'
   AND m.mber_sttus_code = 'ACTIVE'
   AND p.owner_mber_id IS NULL;

-- 2차: 활성 OWNER 가 없는 행은 생성자로 채움 (현재 데이터에는 해당 없음)
UPDATE public.tb_pj_project
   SET owner_mber_id = creat_mber_id
 WHERE owner_mber_id IS NULL
   AND creat_mber_id IS NOT NULL;

-- NOT NULL 전환은 새 코드 배포 뒤 2026-09-19_add_project_owner_step2.sql 에서.

-- 소유자별 프로젝트 조회(상한 검사·탈퇴 처리·결제) 용
CREATE INDEX IF NOT EXISTS tb_pj_project_owner_idx
  ON public.tb_pj_project (owner_mber_id);

COMMENT ON COLUMN public.tb_pj_project.owner_mber_id IS
  '프로젝트 소유자 회원 ID (항상 1명, OWNER 역할 멤버와 동일). 양도 시 갱신. 탈퇴·상한·결제 판정의 단일 기준. NULL 은 배포 전 옛 코드가 만든 행 — step2 에서 채우고 NOT NULL 전환';

COMMIT;
