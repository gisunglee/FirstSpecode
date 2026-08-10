-- 핵심 스펙 엔티티 생성자/최종 수정자 추적
-- 기존 데이터는 NULL로 유지한다. 과거 행의 생성자를 임의 추정하지 않기 위함이다.

ALTER TABLE tb_rq_task
  ADD COLUMN IF NOT EXISTS creat_mber_id text,
  ADD COLUMN IF NOT EXISTS mdfcn_mber_id text;

ALTER TABLE tb_rq_requirement
  ADD COLUMN IF NOT EXISTS creat_mber_id text,
  ADD COLUMN IF NOT EXISTS mdfcn_mber_id text;

ALTER TABLE tb_rq_user_story
  ADD COLUMN IF NOT EXISTS creat_mber_id text,
  ADD COLUMN IF NOT EXISTS mdfcn_mber_id text;

ALTER TABLE tb_ds_unit_work
  ADD COLUMN IF NOT EXISTS creat_mber_id text,
  ADD COLUMN IF NOT EXISTS mdfcn_mber_id text;

ALTER TABLE tb_ds_screen
  ADD COLUMN IF NOT EXISTS creat_mber_id text,
  ADD COLUMN IF NOT EXISTS mdfcn_mber_id text;

ALTER TABLE tb_ds_area
  ADD COLUMN IF NOT EXISTS creat_mber_id text,
  ADD COLUMN IF NOT EXISTS mdfcn_mber_id text;

ALTER TABLE tb_ds_function
  ADD COLUMN IF NOT EXISTS creat_mber_id text,
  ADD COLUMN IF NOT EXISTS mdfcn_mber_id text;

COMMENT ON COLUMN tb_rq_task.creat_mber_id IS '생성자 회원 ID';
COMMENT ON COLUMN tb_rq_task.mdfcn_mber_id IS '최종 수정자 회원 ID';
COMMENT ON COLUMN tb_rq_requirement.creat_mber_id IS '생성자 회원 ID';
COMMENT ON COLUMN tb_rq_requirement.mdfcn_mber_id IS '최종 수정자 회원 ID';
COMMENT ON COLUMN tb_rq_user_story.creat_mber_id IS '생성자 회원 ID';
COMMENT ON COLUMN tb_rq_user_story.mdfcn_mber_id IS '최종 수정자 회원 ID';
COMMENT ON COLUMN tb_ds_unit_work.creat_mber_id IS '생성자 회원 ID';
COMMENT ON COLUMN tb_ds_unit_work.mdfcn_mber_id IS '최종 수정자 회원 ID';
COMMENT ON COLUMN tb_ds_screen.creat_mber_id IS '생성자 회원 ID';
COMMENT ON COLUMN tb_ds_screen.mdfcn_mber_id IS '최종 수정자 회원 ID';
COMMENT ON COLUMN tb_ds_area.creat_mber_id IS '생성자 회원 ID';
COMMENT ON COLUMN tb_ds_area.mdfcn_mber_id IS '최종 수정자 회원 ID';
COMMENT ON COLUMN tb_ds_function.creat_mber_id IS '생성자 회원 ID';
COMMENT ON COLUMN tb_ds_function.mdfcn_mber_id IS '최종 수정자 회원 ID';
