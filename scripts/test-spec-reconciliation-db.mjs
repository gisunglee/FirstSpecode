import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rollbackMarker = new Error("SPEC_RECONCILIATION_TEST_ROLLBACK");
const projectId = crypto.randomUUID();

try {
  const policyTemplateCount = await prisma.tbSysConfigTemplate.count({
    where: {
      config_key: {
        in: [
          "SPEC_RECONCILE_GATE_POLICY",
          "SPEC_RECONCILE_DIFF_RETENTION_DAYS",
          "SPEC_RECONCILE_BLOCK_RISKS",
        ],
      },
      use_yn: "Y",
    },
  });
  assert.equal(policyTemplateCount, 3);

  await prisma.$transaction(async (tx) => {
    await tx.tbPjProject.create({
      data: {
        prjct_id: projectId,
        prjct_nm: "SPEC reconciliation transaction test",
      },
    });
    const repository = await tx.tbSpSourceRepository.create({
      data: {
        prjct_id: projectId,
        repo_key: "test-repository",
        provider_code: "GITHUB",
        provider_repository_path: "specode/test",
        api_base_url: "https://api.github.com",
        default_branch_nm: "main",
      },
    });
    assert.equal(repository.repo_key, "test-repository");

    const baseline = await tx.tbSpSourceBaseline.create({
      data: {
        prjct_id: projectId,
        repo_key: "test-repository",
        repo_provider_code: "GITHUB",
        branch_nm: "main",
        checkpoint_ty_code: "GIT_COMMIT",
        last_reconciled_commit_sha: "a".repeat(40),
        checkpoint_version_no: 0,
      },
    });
    const receipt = await tx.tbSpImplReceipt.create({
      data: {
        prjct_id: projectId,
        origin_ty_code: "MAINTENANCE",
        client_submission_key: "db-test-submission",
        baseline_id: baseline.baseline_id,
        baseline_version_no: 0,
        base_checkpoint_val: "a".repeat(40),
        head_checkpoint_val: "b".repeat(40),
        checkpoint_ty_code: "GIT_COMMIT",
        source_evidence_data: {
          provider: "GITHUB",
          files: [{ path: "src/example.ts" }],
        },
        evidence_trust_code: "PROVIDER_VERIFIED",
        evidence_verify_code: "VERIFIED",
        ancestry_verify_yn: "Y",
        diff_hash: "c".repeat(64),
        head_stable_yn: "Y",
        items: {
          create: {
            classification_code: "SPEC_CHANGE",
            target_ref_ty_code: "FUNCTION",
            target_ref_id: crypto.randomUUID(),
            target_field_nm: "func_dc",
            target_hierarchy_data: {},
            source_evidence_data: {
              files: [{ path: "src/example.ts" }],
            },
            source_fact_cn: "테스트 소스 사실",
            before_value_cn: "이전 설명",
            proposed_value_cn: "변경 설명",
            before_hash: crypto
              .createHash("sha256")
              .update("이전 설명")
              .digest("hex"),
            risk_code: "MEDIUM",
            confidence_code: "HIGH",
          },
        },
      },
      include: { items: true },
    });
    assert.equal(receipt.items.length, 1);

    const batchId = crypto.randomUUID();
    const batchTask = await tx.tbAiTask.create({
      data: {
        prjct_id: projectId,
        ref_ty_code: "SPEC_RECONCILIATION_BATCH",
        ref_id: batchId,
        task_ty_code: "CUSTOM",
        req_cn: "batch test",
      },
    });
    const batch = await tx.tbSpReconcileBatch.create({
      data: {
        batch_id: batchId,
        receipt_id: receipt.receipt_id,
        prjct_id: projectId,
        batch_no: 1,
        batch_key: "SCREEN:test:1",
        scope_ty_code: "SCREEN",
        scope_nm: "DB 배치 테스트",
        source_paths_data: ["src/example.ts"],
        target_refs_data: [],
        metrics_data: { changedFileCount: 1, targetCount: 0 },
        batch_sttus_code: "PENDING",
        ai_task_id: batchTask.ai_task_id,
      },
    });
    assert.equal(batch.ai_task_id, batchTask.ai_task_id);

    await tx.tbSpReconcileItem.update({
      where: { item_id: receipt.items[0].item_id },
      data: { batch_origin_data: { batchIds: [batch.batch_id] } },
    });
    const batchCount = await tx.tbSpReconcileBatch.count({
      where: { receipt_id: receipt.receipt_id },
    });
    assert.equal(batchCount, 1);

    await tx.tbSpSpecSourceLink.create({
      data: {
        prjct_id: projectId,
        target_ref_ty_code: "FUNCTION",
        target_ref_id: receipt.items[0].target_ref_id,
        source_kind_code: "FILE",
        source_path: "src/example.ts",
        first_receipt_id: receipt.receipt_id,
        last_receipt_id: receipt.receipt_id,
      },
    });

    const firstAdvance = await tx.tbSpSourceBaseline.updateMany({
      where: {
        baseline_id: baseline.baseline_id,
        checkpoint_version_no: 0,
      },
      data: {
        checkpoint_version_no: { increment: 1 },
        last_reconciled_commit_sha: "b".repeat(40),
        last_receipt_id: receipt.receipt_id,
      },
    });
    const staleAdvance = await tx.tbSpSourceBaseline.updateMany({
      where: {
        baseline_id: baseline.baseline_id,
        checkpoint_version_no: 0,
      },
      data: {
        checkpoint_version_no: { increment: 1 },
      },
    });
    assert.equal(firstAdvance.count, 1);
    assert.equal(staleAdvance.count, 0);

    throw rollbackMarker;
  });
} catch (error) {
  if (error !== rollbackMarker) throw error;
} finally {
  const leaked = await prisma.tbPjProject.findUnique({
    where: { prjct_id: projectId },
    select: { prjct_id: true },
  });
  assert.equal(leaked, null, "테스트 트랜잭션 데이터가 rollback되어야 한다");
  await prisma.$disconnect();
}

console.log("SPEC reconciliation DB transaction scenario: PASS");
