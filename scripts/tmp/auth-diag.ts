// 읽기 전용 진단 스크립트 — 인증 세션 문제 원인 파악용 (SELECT만 수행)
import { prisma } from "../../src/lib/prisma";

async function main() {
  const q = async <T,>(label: string, sql: string) => {
    const rows = await prisma.$queryRawUnsafe<T[]>(sql);
    console.log(`\n=== ${label} ===`);
    console.table(rows);
  };

  await q("1. REFRESH 레이트리밋 키 (IP 식별 여부 + 최근 카운트)", `
    SELECT rate_key_val, req_cnt, window_start_dt, updt_dt
    FROM tb_cm_rate_limit WHERE rate_key_val LIKE 'REFRESH_IP:%'
    ORDER BY updt_dt DESC LIMIT 15`);

  await q("2. 일자별: 로그인 성공 / 세션 생성 / 세션 무효화 (최근 21일)", `
    WITH d AS (SELECT generate_series(date_trunc('day', now()) - interval '20 days', date_trunc('day', now()), '1 day') AS day)
    SELECT to_char(d.day,'MM-DD') AS day,
      (SELECT count(*) FROM tb_cm_login_attempt a WHERE a.succes_yn='Y' AND date_trunc('day',a.creat_dt)=d.day) AS login_ok,
      (SELECT count(*) FROM tb_cm_member_session s WHERE date_trunc('day',s.creat_dt)=d.day) AS sess_new,
      (SELECT count(*) FROM tb_cm_member_session s WHERE date_trunc('day',s.invald_dt)=d.day) AS sess_invalidated,
      (SELECT count(*) FROM tb_cm_refresh_token r WHERE date_trunc('day',r.creat_dt)=d.day) AS rt_issued
    FROM d ORDER BY d.day`);

  await q("3. 세션 무효화 유형 추정 (최근 10일): 무효화 시점에 회전된 RT 체인 길이·마지막 RT 나이", `
    SELECT to_char(s.invald_dt,'MM-DD HH24:MI') AS invalidated_at,
      left(s.sesn_id,8) AS sesn, left(s.mber_id,8) AS mber,
      (SELECT count(*) FROM tb_cm_refresh_token r WHERE r.sesn_id=s.sesn_id) AS rt_chain_len,
      (SELECT round(extract(epoch FROM (s.invald_dt - max(r.creat_dt)))/60) FROM tb_cm_refresh_token r WHERE r.sesn_id=s.sesn_id) AS last_rt_age_min,
      round(extract(epoch FROM (s.invald_dt - s.creat_dt))/3600) AS sess_life_h,
      left(s.device_info_cn, 40) AS ua
    FROM tb_cm_member_session s
    WHERE s.invald_dt >= now() - interval '10 days'
    ORDER BY s.invald_dt DESC LIMIT 40`);

  await q("4. 활성 세션의 나이 분포 (30일 절대만료 임박 여부)", `
    SELECT CASE WHEN age_d < 10 THEN '<10d' WHEN age_d < 20 THEN '10-20d' WHEN age_d < 28 THEN '20-28d' WHEN age_d < 30 THEN '28-30d' ELSE '>=30d' END AS bucket, count(*)
    FROM (SELECT extract(epoch FROM (now()-s.creat_dt))/86400 AS age_d FROM tb_cm_member_session s
          WHERE s.invald_dt IS NULL AND EXISTS (SELECT 1 FROM tb_cm_refresh_token r WHERE r.sesn_id=s.sesn_id AND r.revoked_dt IS NULL AND r.expiry_dt>now())) x
    GROUP BY 1 ORDER BY 1`);

  await q("5. RT 회전 과빈도 세션 (최근 24h, 회전 수 상위) — 클라이언트 시계 오차/루프 의심", `
    SELECT left(r.sesn_id,8) AS sesn, left(r.mber_id,8) AS mber, count(*) AS rotations_24h,
      round(extract(epoch FROM (max(r.creat_dt)-min(r.creat_dt)))/60) AS span_min
    FROM tb_cm_refresh_token r WHERE r.creat_dt >= now() - interval '24 hours' AND r.sesn_id IS NOT NULL
    GROUP BY r.sesn_id, r.mber_id ORDER BY 3 DESC LIMIT 10`);

  await q("6. 회전 간격이 5초 초과~2분 이내인 연속 RT (재사용 탐지 경계 근처 경쟁 흔적)", `
    SELECT left(sesn_id,8) AS sesn, to_char(creat_dt,'MM-DD HH24:MI:SS') AS at, round(extract(epoch FROM gap)) AS gap_sec
    FROM (SELECT sesn_id, creat_dt, creat_dt - lag(creat_dt) OVER (PARTITION BY sesn_id ORDER BY creat_dt) AS gap
          FROM tb_cm_refresh_token WHERE creat_dt >= now() - interval '10 days' AND sesn_id IS NOT NULL) x
    WHERE gap IS NOT NULL AND gap < interval '2 minutes' ORDER BY creat_dt DESC LIMIT 30`);

  await q("7. 폐기되지 않은 RT가 2개 이상 살아있는 세션 (회전 응답 유실 가능성)", `
    SELECT left(sesn_id,8) AS sesn, count(*) AS live_rts, to_char(max(creat_dt),'MM-DD HH24:MI') AS newest
    FROM tb_cm_refresh_token WHERE revoked_dt IS NULL AND expiry_dt > now() AND sesn_id IS NOT NULL
    GROUP BY sesn_id HAVING count(*) > 1 ORDER BY 2 DESC LIMIT 10`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
