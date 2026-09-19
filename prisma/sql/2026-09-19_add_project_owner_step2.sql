-- 프로젝트 소유자 컬럼 2단계 — NOT NULL 전환
--
-- 실행 조건: 새 코드(생성·복사·양도가 owner_mber_id 를 채우는 버전)가 운영에
-- 배포된 뒤에만 실행한다. 1단계(2026-09-19_add_project_owner.sql) 와 배포 사이에
-- 옛 코드가 만든 프로젝트는 owner_mber_id 가 NULL 이므로 먼저 다시 채운다.
--
-- 실행 전 확인(0 이어야 정상이지만, 아래 UPDATE 가 있으므로 0 이 아니어도 안전):
--   SELECT count(*) FROM tb_pj_project WHERE owner_mber_id IS NULL;
--
-- 이 파일을 적용한 뒤 prisma/schema.prisma 의 TbPjProject.owner_mber_id 를
-- String? → String 으로 바꾸고 prisma generate 를 다시 돌린다.

BEGIN;

UPDATE public.tb_pj_project p
   SET owner_mber_id = m.mber_id
  FROM public.tb_pj_project_member m
 WHERE m.prjct_id        = p.prjct_id
   AND m.role_code       = 'OWNER'
   AND m.mber_sttus_code = 'ACTIVE'
   AND p.owner_mber_id IS NULL;

UPDATE public.tb_pj_project
   SET owner_mber_id = creat_mber_id
 WHERE owner_mber_id IS NULL
   AND creat_mber_id IS NOT NULL;

ALTER TABLE public.tb_pj_project
  ALTER COLUMN owner_mber_id SET NOT NULL;

COMMENT ON COLUMN public.tb_pj_project.owner_mber_id IS
  '프로젝트 소유자 회원 ID (항상 1명, OWNER 역할 멤버와 동일). 양도 시 갱신. 탈퇴·상한·결제 판정의 단일 기준';

COMMIT;
