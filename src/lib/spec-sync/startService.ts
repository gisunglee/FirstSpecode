/** 동기화 실행 생성과 멱등 재호출 응답을 담당한다. */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  designSnapshotSchema,
  syncModeSchema,
  type SyncMode,
} from "./contracts";
import { loadDesignSnapshot } from "./designContext";
import { SpecSyncError } from "./errors";
import {
  buildSourceDiscoveryPrompt,
  buildSyncAnalysisPrompt,
} from "./prompts";

export async function startSyncRun(input: {
  projectId: string;
  unitWorkRef: string;
  mode: unknown;
  memberId: string;
  clientSubmissionKey?: string | null;
}) {
  const mode = syncModeSchema.parse(input.mode ?? "CHECK");
  const clientSubmissionKey = input.clientSubmissionKey?.trim() || null;

  if (clientSubmissionKey) {
    const existing = await findIdempotentRun(
      input.projectId,
      clientSubmissionKey,
    );
    if (existing) {
      assertIdempotencyMatch(existing, input.unitWorkRef, mode);
      return formatStartResponse(existing);
    }
  }

  const { snapshot, hash } = await loadDesignSnapshot({
    projectId: input.projectId,
    unitWorkRef: input.unitWorkRef.trim(),
  });

  try {
    const run = await prisma.tbSpSyncRun.create({
      data: {
        prjct_id: input.projectId,
        unit_work_id: snapshot.unitWork.id,
        unit_work_display_id: snapshot.unitWork.displayId,
        unit_work_nm: snapshot.unitWork.name,
        client_submission_key: clientSubmissionKey,
        sync_mode_code: mode,
        sync_sttus_code: "RUNNING",
        design_snapshot_data: snapshot as Prisma.InputJsonValue,
        design_snapshot_hash: hash,
        req_mber_id: input.memberId,
      },
    });
    return formatStartResponse(run);
  } catch (error) {
    if (clientSubmissionKey && isUniqueConstraintError(error)) {
      const existing = await findIdempotentRun(
        input.projectId,
        clientSubmissionKey,
      );
      if (existing) {
        assertIdempotencyMatch(existing, input.unitWorkRef, mode);
        return formatStartResponse(existing);
      }
    }
    throw error;
  }
}

function findIdempotentRun(projectId: string, clientSubmissionKey: string) {
  return prisma.tbSpSyncRun.findUnique({
    where: {
      prjct_id_client_submission_key: {
        prjct_id: projectId,
        client_submission_key: clientSubmissionKey,
      },
    },
  });
}

function formatStartResponse(run: {
  sync_run_id: string;
  sync_mode_code: string;
  sync_sttus_code: string;
  unit_work_display_id: string;
  design_snapshot_data: Prisma.JsonValue;
  design_snapshot_hash: string;
}) {
  const snapshot = designSnapshotSchema.parse(run.design_snapshot_data);
  const mode = syncModeSchema.parse(run.sync_mode_code);
  return {
    syncRunId: run.sync_run_id,
    mode,
    status: run.sync_sttus_code,
    unitWorkDisplayId: run.unit_work_display_id,
    designSnapshotHash: run.design_snapshot_hash,
    designSnapshot: snapshot,
    sourceDiscoveryPrompt: buildSourceDiscoveryPrompt(snapshot),
    analysisPromptTemplate: buildSyncAnalysisPrompt({
      mode,
      snapshot,
      sourceScope: "로컬 탐색 뒤 확정한 sourceScope JSON을 여기에 사용",
    }),
  };
}

function assertIdempotencyMatch(
  run: {
    unit_work_id: string | null;
    unit_work_display_id: string;
    sync_mode_code: string;
  },
  unitWorkRef: string,
  mode: SyncMode,
) {
  const normalizedRef = unitWorkRef.trim();
  if (
    run.sync_mode_code !== mode ||
    ![run.unit_work_id, run.unit_work_display_id].includes(normalizedRef)
  ) {
    throw new SpecSyncError(
      "IDEMPOTENCY_KEY_REUSED",
      "같은 clientSubmissionKey를 다른 UW 또는 모드에 재사용할 수 없습니다.",
      409,
    );
  }
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
