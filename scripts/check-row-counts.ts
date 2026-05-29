/**
 * scripts/check-row-counts.ts
 *
 * db:push 전후 데이터 무사 확인용 — 영향 받는 테이블 row 수 출력.
 *
 * 실행:
 *   dotenv -e .env.local -- npx tsx scripts/check-row-counts.ts
 */

import { prisma } from "../src/lib/prisma";

const TABLES = [
  "tb_ds_document_release",
  "tb_sg_std_guide",
  "tb_sys_attach_file",
  "tb_sys_config_template",
  "tb_sys_docs_page",
  "tb_sys_docs_section",
  "tb_qa_test_spec",        // 진척률 컬럼 추가 대상
  "tb_cm_batch_job",        // PK 이름 RENAME 대상
  "tb_cm_batch_job_item",
];

async function main() {
  console.log("\n=== Row 수 스냅샷 (push 전/후 비교용) ===\n");
  for (const t of TABLES) {
    try {
      const result = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
        `SELECT COUNT(*)::bigint AS cnt FROM ${t};`
      );
      console.log(`${t.padEnd(35)} : ${result[0].cnt} rows`);
    } catch (e) {
      console.log(`${t.padEnd(35)} : ❌ (테이블 없거나 오류) ${(e as Error).message.split("\n")[0]}`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
