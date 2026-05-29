/**
 * scripts/check-pk-drift.ts
 *
 * 6개 의심 테이블의 현재 PK constraint 이름·정의를 조회하여 출력한다.
 * Prisma schema 가 기대하는 이름(<table>_pkey) 과 DB 실제값을 같이 보여줌.
 *
 * 실행:
 *   npm run check:pk-drift
 *   (또는 직접: dotenv -e .env.local -- npx tsx scripts/check-pk-drift.ts)
 */

import { prisma } from "../src/lib/prisma";

const TABLES = [
  "tb_ds_document_release",
  "tb_sg_std_guide",
  "tb_sys_attach_file",
  "tb_sys_config_template",
  "tb_sys_docs_page",
  "tb_sys_docs_section",
];

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    {
      table_name: string;
      current_pk_name: string;
      expected_pk_name: string;
      pk_definition: string;
    }[]
  >(`
    SELECT
      c.conrelid::regclass::text AS table_name,
      c.conname                   AS current_pk_name,
      c.conrelid::regclass::text || '_pkey' AS expected_pk_name,
      pg_get_constraintdef(c.oid) AS pk_definition
    FROM pg_constraint c
    WHERE c.contype = 'p'
      AND c.conrelid::regclass::text IN (${TABLES.map((t) => `'${t}'`).join(", ")})
    ORDER BY c.conrelid::regclass::text;
  `);

  console.log("\n=== PK 상태 진단 ===\n");
  if (rows.length === 0) {
    console.log("⚠️  대상 테이블의 PK constraint 를 찾지 못했습니다. (테이블 자체가 없을 수도 있음)");
  } else {
    for (const r of rows) {
      const ok = r.current_pk_name === r.expected_pk_name;
      console.log(`${ok ? "✅" : "❌"} ${r.table_name}`);
      console.log(`   현재 이름  : ${r.current_pk_name}`);
      console.log(`   기대 이름  : ${r.expected_pk_name}`);
      console.log(`   PK 정의    : ${r.pk_definition}`);
      console.log("");
    }
  }

  // 발견되지 않은 테이블 표시
  const found = new Set(rows.map((r) => r.table_name));
  const missing = TABLES.filter((t) => !found.has(t));
  if (missing.length > 0) {
    console.log("⚠️  다음 테이블은 결과에 없음 (테이블 미존재 가능성):");
    missing.forEach((t) => console.log(`   - ${t}`));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
