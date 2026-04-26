/**
 * 테스트 스크립트 — 요구사항 docx export API 호출
 *
 * 동작:
 *   1. 프로젝트의 OWNER/ADMIN/MEMBER 1명을 DB 에서 찾음
 *   2. 그 멤버 ID 로 JWT 발급
 *   3. API 호출 → docx 파일을 tmp/ 에 저장
 *   4. 파일 사이즈, 헤더 출력
 */

import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";

const PROJECT_ID = "bbba8058-a48f-4dfb-a586-71e2d87be7a4";
const REQ_ID     = "f2ceae3a-2ea3-4d4c-b303-caccb005e9fc";
const BASE_URL   = "http://localhost:3000";

async function main() {
  const prisma = new PrismaClient();

  // ① 멤버 찾기 — OWNER/ADMIN/MEMBER 중 1명 (export 권한 있어야 함)
  const member = await prisma.tbPjProjectMember.findFirst({
    where: {
      prjct_id:        PROJECT_ID,
      mber_sttus_code: "ACTIVE",
      role_code:       { in: ["OWNER", "ADMIN", "MEMBER"] },
    },
    include: { member: { select: { email_addr: true } } },
  });

  if (!member) {
    console.error("❌ 프로젝트 멤버를 찾을 수 없음:", PROJECT_ID);
    process.exit(1);
  }
  console.log(`✓ 멤버: ${member.mber_id} (${member.role_code}) ${member.member.email_addr}`);

  // ② JWT 발급
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("❌ JWT_SECRET 환경변수 없음");
    process.exit(1);
  }
  const token = jwt.sign(
    { mberId: member.mber_id, email: member.member.email_addr },
    secret,
    { expiresIn: "1h" }
  );
  console.log(`✓ JWT 발급 완료 (${token.length} chars)`);

  // ③ API 호출
  const url = `${BASE_URL}/api/projects/${PROJECT_ID}/requirements/${REQ_ID}/export/docx`;
  console.log(`→ GET ${url}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  console.log(`✓ HTTP ${res.status} ${res.statusText}`);
  console.log(`  Content-Type:        ${res.headers.get("content-type")}`);
  console.log(`  Content-Length:      ${res.headers.get("content-length")}`);
  console.log(`  Content-Disposition: ${res.headers.get("content-disposition")}`);

  if (!res.ok) {
    const errText = await res.text();
    console.error(`❌ 에러 응답: ${errText}`);
    process.exit(1);
  }

  // ④ 저장
  const buffer = Buffer.from(await res.arrayBuffer());
  // 매 실행마다 새 파일명 — Word 가 열려 있어도 EBUSY 안 나도록
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(11, 19);
  const outPath = path.join("d:/source/FirstSpecode/tmp", `EXPORT_TEST_${REQ_ID.slice(0, 8)}_${stamp}.docx`);
  fs.writeFileSync(outPath, buffer);
  console.log(`✓ 저장: ${outPath}`);
  console.log(`  크기: ${(buffer.length / 1024).toFixed(1)} KB`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ 예외:", err);
  process.exit(1);
});
