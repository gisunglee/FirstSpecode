-- ================================================================
-- 권한 시스템 재설계 — 역할 4단계 축소 + 직무 컬럼 + 계정 플랜
--   작성일 : 2026-04-21
--   범위   : TbCmMember / TbPjProjectMember / TbPjProjectInvitation
--   참고   : src/lib/permissions.md
--
-- 실행 방법:
--   1) 이 파일 전체를 DB 클라이언트(또는 psql)로 실행
--   2) 실행 후 `npx prisma generate` 로 클라이언트 재생성
--   3) 애플리케이션 재기동
--
-- 롤백이 필요하면 이 파일 하단의 [ROLLBACK] 섹션 참조
-- ================================================================

BEGIN;

-- ── 1. TbCmMember — 계정 플랜 컬럼 추가 ─────────────────────────
ALTER TABLE tb_cm_member
  ADD COLUMN IF NOT EXISTS plan_code      VARCHAR(20)  NOT NULL DEFAULT 'FREE',
  ADD COLUMN IF NOT EXISTS plan_expire_dt TIMESTAMP(3) NULL;

COMMENT ON COLUMN tb_cm_member.plan_code      IS '계정 플랜 (FREE/PRO/TEAM/ENTERPRISE)';
COMMENT ON COLUMN tb_cm_member.plan_expire_dt IS '유료 플랜 만료일 (NULL=무료/무제한)';


-- ── 2. TbPjProjectMember — 직무 컬럼 추가 ────────────────────────
ALTER TABLE tb_pj_project_member
  ADD COLUMN IF NOT EXISTS job_title_code VARCHAR(20) NOT NULL DEFAULT 'ETC';

COMMENT ON COLUMN tb_pj_project_member.role_code      IS '프로젝트 역할 (OWNER/ADMIN/MEMBER/VIEWER)';
COMMENT ON COLUMN tb_pj_project_member.job_title_code IS '직무 (PM/PL/DBA/DEV/DESIGNER/QA/ETC)';


-- ── 3. TbPjProjectInvitation — 직무 컬럼 추가 ────────────────────
ALTER TABLE tb_pj_project_invitation
  ADD COLUMN IF NOT EXISTS job_title_code VARCHAR(20) NOT NULL DEFAULT 'ETC';

COMMENT ON COLUMN tb_pj_project_invitation.job_title_code IS '초대 시 지정 직무';


-- ── 4. 기존 데이터 이관 — role 값에서 직무로 분리 ───────────────────
--   기존 7-role 체계 → 4-role + 직무 체계
--   PM/DESIGNER/DEVELOPER 역할이었던 사람은
--     role_code='MEMBER' + job_title_code={원래 직무}
--   로 이관
UPDATE tb_pj_project_member
SET
  job_title_code = CASE role_code
    WHEN 'PM'        THEN 'PM'
    WHEN 'DESIGNER'  THEN 'DESIGNER'
    WHEN 'DEVELOPER' THEN 'DEV'
    ELSE 'ETC'
  END,
  role_code = CASE role_code
    WHEN 'PM'        THEN 'MEMBER'
    WHEN 'DESIGNER'  THEN 'MEMBER'
    WHEN 'DEVELOPER' THEN 'MEMBER'
    ELSE role_code   -- OWNER/ADMIN/MEMBER/VIEWER 는 그대로
  END
WHERE role_code IN ('PM', 'DESIGNER', 'DEVELOPER');


-- ── 5. 초대 테이블도 동일하게 이관 ────────────────────────────────
UPDATE tb_pj_project_invitation
SET
  job_title_code = CASE role_code
    WHEN 'PM'        THEN 'PM'
    WHEN 'DESIGNER'  THEN 'DESIGNER'
    WHEN 'DEVELOPER' THEN 'DEV'
    ELSE 'ETC'
  END,
  role_code = CASE role_code
    WHEN 'PM'        THEN 'MEMBER'
    WHEN 'DESIGNER'  THEN 'MEMBER'
    WHEN 'DEVELOPER' THEN 'MEMBER'
    ELSE role_code
  END
WHERE role_code IN ('PM', 'DESIGNER', 'DEVELOPER');


-- ── 6. 검증 — 허용 외 값이 남아있으면 에러 발생시킴 ─────────────────
--   role_code  ∈ {OWNER, ADMIN, MEMBER, VIEWER}
--   job_title_code ∈ {PM, PL, DBA, DEV, DESIGNER, QA, ETC}
--   plan_code ∈ {FREE, PRO, TEAM, ENTERPRISE}
DO $$
DECLARE
  bad_role_cnt   INT;
  bad_job_cnt    INT;
  bad_plan_cnt   INT;
BEGIN
  SELECT COUNT(*) INTO bad_role_cnt
  FROM tb_pj_project_member
  WHERE role_code NOT IN ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

  SELECT COUNT(*) INTO bad_job_cnt
  FROM tb_pj_project_member
  WHERE job_title_code NOT IN ('PM', 'PL', 'DBA', 'DEV', 'DESIGNER', 'QA', 'ETC');

  SELECT COUNT(*) INTO bad_plan_cnt
  FROM tb_cm_member
  WHERE plan_code NOT IN ('FREE', 'PRO', 'TEAM', 'ENTERPRISE');

  IF bad_role_cnt > 0 THEN
    RAISE EXCEPTION '허용 외 role_code 값이 % 건 있습니다. 데이터 확인 필요.', bad_role_cnt;
  END IF;
  IF bad_job_cnt > 0 THEN
    RAISE EXCEPTION '허용 외 job_title_code 값이 % 건 있습니다.', bad_job_cnt;
  END IF;
  IF bad_plan_cnt > 0 THEN
    RAISE EXCEPTION '허용 외 plan_code 값이 % 건 있습니다.', bad_plan_cnt;
  END IF;

  RAISE NOTICE '검증 통과: 모든 값이 허용 범위입니다.';
END $$;


COMMIT;


-- ================================================================
-- [ROLLBACK] — 필요 시 수동 실행
-- ================================================================
--
-- BEGIN;
-- ALTER TABLE tb_cm_member              DROP COLUMN IF EXISTS plan_code;
-- ALTER TABLE tb_cm_member              DROP COLUMN IF EXISTS plan_expire_dt;
-- ALTER TABLE tb_pj_project_member      DROP COLUMN IF EXISTS job_title_code;
-- ALTER TABLE tb_pj_project_invitation  DROP COLUMN IF EXISTS job_title_code;
-- -- role 값 복구는 원본 백업 없이는 불가 (이관 시 정보 유실됨)
-- -- → 반드시 이 마이그레이션 실행 전 tb_pj_project_member 를 백업하세요.
-- COMMIT;
