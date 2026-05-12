import { prisma } from "../src/lib/prisma";

async function main() {
  const sections = await prisma.tbSysDocsSection.findMany({
    where: { use_yn: "Y" },
    orderBy: { sort_ordr: "asc" },
    select: {
      sect_id: true,
      sect_slug: true,
      sect_nm: true,
      sort_ordr: true,
      pages: {
        where: { use_yn: "Y" },
        orderBy: { sort_ordr: "asc" },
        select: {
          page_id: true,
          page_slug: true,
          page_sj: true,
          page_sttus_code: true,
          sort_ordr: true,
        },
      },
    },
  });

  for (const s of sections) {
    console.log(`\n[${s.sort_ordr}] ${s.sect_nm} (/${s.sect_slug})  ${s.sect_id}`);
    for (const p of s.pages) {
      console.log(`   - [${p.sort_ordr}] ${p.page_sj} (/${p.page_slug}) [${p.page_sttus_code}]  ${p.page_id}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
