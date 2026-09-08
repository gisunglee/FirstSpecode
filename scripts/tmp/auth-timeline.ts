// 읽기 전용 — 최근 3시간 내 로그인/로그아웃/RT 회전 타임라인 (테스트 재현 분석용)
import { prisma } from "../../src/lib/prisma";

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    WITH ev AS (
      SELECT r.creat_dt AS at, 'RT_ISSUED' AS ev, left(r.sesn_id,8) AS sesn, left(r.token_id,8) AS tok, r.auto_login_yn AS al, m.email_addr AS email
        FROM tb_cm_refresh_token r JOIN tb_cm_member m ON m.mber_id=r.mber_id WHERE r.creat_dt >= now() - interval '3 hours'
      UNION ALL
      SELECT r.revoked_dt, 'RT_REVOKED', left(r.sesn_id,8), left(r.token_id,8), r.auto_login_yn, m.email_addr
        FROM tb_cm_refresh_token r JOIN tb_cm_member m ON m.mber_id=r.mber_id WHERE r.revoked_dt >= now() - interval '3 hours'
      UNION ALL
      SELECT s.creat_dt, 'SESSION_NEW', left(s.sesn_id,8), NULL, NULL, m.email_addr
        FROM tb_cm_member_session s JOIN tb_cm_member m ON m.mber_id=s.mber_id WHERE s.creat_dt >= now() - interval '3 hours'
      UNION ALL
      SELECT s.invald_dt, 'SESSION_INVALIDATED', left(s.sesn_id,8), NULL, NULL, m.email_addr
        FROM tb_cm_member_session s JOIN tb_cm_member m ON m.mber_id=s.mber_id WHERE s.invald_dt >= now() - interval '3 hours'
    )
    SELECT to_char(at AT TIME ZONE 'Asia/Seoul','HH24:MI:SS') AS kst, ev, sesn, tok, al, split_part(email,'@',1) AS who
    FROM ev ORDER BY at`);
  console.table(rows);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
