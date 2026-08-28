/**
 * scripts/fix-unit-work-table-script-placeholder.ts
 *
 * 일회성 수정 — tb_ai_design_template(UNIT_WORK, 시스템 공통)의 template_cn 끝부분
 * "- <TABLE_SCRIPT:>" 를 "- <TABLE_SCRIPT:테이블물리명>" 으로 교체.
 *
 * 배경: 빈 <TABLE_SCRIPT:> 태그가 문서 내 다른 빈칸({{displayId}} 등)과 시각적으로
 *       구분되지 않아 AI가 태그 자체를 지워버리고 일반 텍스트로 써버리는 문제 발생.
 *       (2026-04-24_seed_tb_ai_design_template.sql 도 동일하게 수정 — 이 스크립트는
 *       이미 seed 된 운영 DB row 를 맞추기 위한 1회성 보정)
 *
 * 안전장치: DB의 현재 값이 예상한 원본과 정확히 일치할 때만 교체. 누군가 이미
 *          수동으로 고쳤거나 다른 내용으로 바뀌어 있으면 아무것도 하지 않고 종료.
 *
 * 실행: dotenv -e .env.local -- npx tsx scripts/fix-unit-work-table-script-placeholder.ts
 */

import { prisma } from "../src/lib/prisma";

const TARGET_ID = "11111111-1111-1111-1111-000000000002"; // UNIT_WORK 시스템 공통 양식
// DB에는 CRLF(\r\n)로 저장되어 있음 — seed SQL 원본은 LF지만 실제 row는 CRLF로 확인됨
const OLD_TAIL = "## 6. 참조 테이블\r\n- <TABLE_SCRIPT:>";
const NEW_TAIL = "## 6. 참조 테이블\r\n- <TABLE_SCRIPT:테이블물리명>";

async function main() {
  const row = await prisma.tbAiDesignTemplate.findUnique({
    where: { dsgn_tmpl_id: TARGET_ID },
  });

  if (!row) {
    console.log(`row 없음 (dsgn_tmpl_id=${TARGET_ID}) — 스킵`);
    await prisma.$disconnect();
    return;
  }

  const current = row.template_cn ?? "";

  if (!current.endsWith(OLD_TAIL)) {
    console.log("template_cn이 예상한 원본과 다릅니다 — 이미 수정되었거나 변경된 것으로 보여 아무것도 안 함.");
    console.log("현재 마지막 200자:", JSON.stringify(current.slice(-200)));
    await prisma.$disconnect();
    return;
  }

  const updated = current.slice(0, current.length - OLD_TAIL.length) + NEW_TAIL;

  await prisma.tbAiDesignTemplate.update({
    where: { dsgn_tmpl_id: TARGET_ID },
    data: { template_cn: updated, mdfcn_dt: new Date() },
  });

  console.log("✅ template_cn 갱신 완료:", TARGET_ID);
  console.log("변경 후 마지막 60자:", JSON.stringify(updated.slice(-60)));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
