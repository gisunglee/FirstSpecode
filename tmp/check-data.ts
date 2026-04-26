import { PrismaClient } from "@prisma/client";

const PROJECT_ID = "bbba8058-a48f-4dfb-a586-71e2d87be7a4";
const REQ_ID     = "f2ceae3a-2ea3-4d4c-b303-caccb005e9fc";

(async () => {
  const prisma = new PrismaClient();

  const project = await prisma.tbPjProject.findUnique({
    where:  { prjct_id: PROJECT_ID },
    select: { prjct_nm: true, client_nm: true },
  });
  console.log("=== 프로젝트 ===");
  console.log("prjct_nm   :", JSON.stringify(project?.prjct_nm));
  console.log("client_nm  :", JSON.stringify(project?.client_nm));
  console.log("발주처(머리글):", JSON.stringify(project?.client_nm?.trim() || "발주처 미지정"));

  const req = await prisma.tbRqRequirement.findUnique({
    where:   { req_id: REQ_ID },
    include: { task: { select: { task_nm: true } } },
  });
  console.log("\n=== 요구사항 ===");
  console.log("req_display_id:", req?.req_display_id);
  console.log("req_nm        :", req?.req_nm);
  console.log("priort_code   :", req?.priort_code);
  console.log("src_code      :", req?.src_code);
  console.log("rfp_page_no   :", req?.rfp_page_no);
  console.log("sort_ordr     :", req?.sort_ordr);
  console.log("task          :", req?.task?.task_nm);
  console.log("asign_mber_id :", req?.asign_mber_id);
  console.log("\n=== spec_cn (상세 명세) ===");
  console.log(req?.spec_cn ?? "(비어있음)");

  await prisma.$disconnect();
})();
