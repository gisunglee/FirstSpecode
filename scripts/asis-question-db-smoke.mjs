/** tb_ds_asis_question CRUD/제약을 실제 PostgreSQL에서 검증한다 (rollback으로 흔적 안 남김). */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  await runSmoke();
} finally {
  await prisma.$disconnect();
}

async function runSmoke() {
  const project = await prisma.tbPjProject.findFirst({
    select: { prjct_id: true },
    orderBy: { creat_dt: "asc" },
  });
  if (!project) {
    console.log("ASIS_QUESTION_DB_SMOKE_SKIPPED_NO_PROJECT");
    return;
  }

  const member = await prisma.tbCmMember.findFirst({
    select: { mber_id: true },
    orderBy: { join_dt: "asc" },
  });
  if (!member) {
    console.log("ASIS_QUESTION_DB_SMOKE_SKIPPED_NO_MEMBER");
    return;
  }

  // ── 1) 정상 CRUD 흐름 — 생성 → 답변 등록 → 상태 전환 확인 → rollback ──
  await expectRollback("create + answer flow", async (tx) => {
    const questionId = randomUUID();
    const created = await tx.tb_ds_asis_question.create({
      data: {
        question_id:  questionId,
        prjct_id:     project.prjct_id,
        purpose_code: "ASIS_ONBOARDING",
        batch_id:     "SMOKE_TEST_BATCH",
        ref_tbl_nm:   "tb_ds_screen",
        ref_id:       randomUUID(),
        question_cn:  "smoke test question",
        req_mber_id:  member.mber_id,
      },
    });
    if (created.status_code !== "OPEN") {
      throw new Error(`기본 상태가 OPEN이 아닙니다: ${created.status_code}`);
    }

    // purpose_code 필터로 조회되는지 (실제 API의 필수 필터 조건과 동일한 조회 경로)
    const found = await tx.tb_ds_asis_question.findMany({
      where: { prjct_id: project.prjct_id, purpose_code: "ASIS_ONBOARDING", batch_id: "SMOKE_TEST_BATCH" },
    });
    if (found.length !== 1) {
      throw new Error(`purpose_code+batch_id 필터 조회 결과가 예상과 다릅니다: ${found.length}건`);
    }

    const answered = await tx.tb_ds_asis_question.update({
      where: { question_id: questionId },
      data: { answer_cn: "smoke test answer", status_code: "ANSWERED", answered_dt: new Date() },
    });
    if (answered.status_code !== "ANSWERED" || !answered.answer_cn) {
      throw new Error("답변 등록 후 상태/내용이 반영되지 않았습니다.");
    }

    throw new Error("EXPECTED_SMOKE_ROLLBACK");
  });

  // ── 2) FK 제약 — 존재하지 않는 프로젝트로 생성하면 실패해야 함 ──
  await expectForeignKeyFailure(member.mber_id);

  console.log("ASIS_QUESTION_DB_SMOKE_OK");
}

async function expectRollback(label, action) {
  try {
    await prisma.$transaction(action);
    throw new Error(`${label}: rollback 신호가 발생하지 않았습니다.`);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "EXPECTED_SMOKE_ROLLBACK") {
      throw error;
    }
  }
}

async function expectForeignKeyFailure(memberId) {
  try {
    await prisma.tb_ds_asis_question.create({
      data: {
        question_id:  randomUUID(),
        prjct_id:     randomUUID(), // 존재하지 않는 프로젝트
        purpose_code: "ASIS_ONBOARDING",
        ref_tbl_nm:   "tb_ds_screen",
        ref_id:       randomUUID(),
        question_cn:  "should fail",
        req_mber_id:  memberId,
      },
    });
    throw new Error("존재하지 않는 prjct_id로도 생성이 성공했습니다 — FK 제약이 없습니다.");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Foreign key constraint")) {
      throw error;
    }
  }
}
