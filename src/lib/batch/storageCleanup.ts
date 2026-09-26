/**
 * Supabase Storage 정리 정책.
 *
 * 일일 정리는 DB의 만료 pending 행과 논리 삭제된 시스템 첨부만 정확한 경로로 처리한다.
 * 전체 버킷 안전 감사는 storageAudit.ts가 별도로 담당한다.
 */

import "server-only";
import type { TbCmStorageUploadPending } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BatchAuth } from "@/lib/batch/requireBatchAuth";
import { runJob, type RunJobResult } from "@/lib/batch/runJob";
import {
  removeStorageObjects,
  storageBucketName,
  storagePrefix,
} from "@/lib/supabaseStorage";

const CLEANUP_LIMIT = 500;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

type SystemCleanupCandidate = {
  kind: "SYSTEM_ATTACHMENT";
  attachId: string;
  objectPath: string;
  useYn: string;
};

type PendingCleanupCandidate = {
  kind: "PENDING_UPLOAD";
  pending: TbCmStorageUploadPending;
};

type DailyCleanupCandidate = PendingCleanupCandidate | SystemCleanupCandidate;

function isInsideCurrentPrefix(objectPath: string, prefix: string): boolean {
  return objectPath.startsWith(`${prefix}/`);
}

async function hasFinalAttachment(objectPath: string): Promise<boolean> {
  const [commonRef, systemRef] = await Promise.all([
    prisma.tbCmAttachFile.findFirst({
      where: { file_path_nm: objectPath },
      select: { attach_file_id: true },
    }),
    prisma.tbSysAttachFile.findFirst({
      where: { file_path_nm: objectPath },
      select: { attach_id: true },
    }),
  ]);
  return Boolean(commonRef || systemRef);
}

/**
 * 만료 pending 행을 먼저 원자적으로 선점한다. 완료 요청과 동시에 실행되면 한쪽만
 * pending 행을 삭제할 수 있어, 최종 첨부가 생겼는데 파일만 지워지는 경쟁 상태를 막는다.
 */
async function cleanupPendingUpload(candidate: TbCmStorageUploadPending, prefix: string) {
  if (!isInsideCurrentPrefix(candidate.file_path_nm, prefix)) {
    return {
      status: "SKIPPED" as const,
      reason: "outside storage prefix",
      meta: { path: candidate.file_path_nm },
    };
  }

  const claimed = await prisma.tbCmStorageUploadPending.deleteMany({
    where: { upload_id: candidate.upload_id, expiry_dt: { lte: new Date() } },
  });
  if (claimed.count === 0) {
    return { status: "SKIPPED" as const, reason: "already completed or claimed" };
  }

  // 롤링 배포 중 구버전 서버가 최종 첨부만 만들고 pending을 소비하지 못할 수 있다.
  // 이 경우 파일은 정상 데이터이므로 pending 행만 없애고 객체는 보존한다.
  if (await hasFinalAttachment(candidate.file_path_nm)) {
    return {
      status: "SUCCESS" as const,
      meta: { path: candidate.file_path_nm, preserved: true, reason: "final attachment exists" },
    };
  }

  try {
    await removeStorageObjects([candidate.file_path_nm]);
    return { status: "SUCCESS" as const, meta: { path: candidate.file_path_nm } };
  } catch (error) {
    // Storage 장애면 다음 일일 배치가 재시도할 수 있게 정리 단서를 복원한다.
    await prisma.tbCmStorageUploadPending.create({ data: candidate }).catch((restoreError) => {
      console.error("[storage-cleanup] pending 복원 실패:", restoreError);
    });
    throw error;
  }
}

async function cleanupSystemAttachment(candidate: SystemCleanupCandidate, prefix: string) {
  if (!isInsideCurrentPrefix(candidate.objectPath, prefix)) {
    return {
      status: "SKIPPED" as const,
      reason: "outside storage prefix",
      meta: { path: candidate.objectPath },
    };
  }

  const current = await prisma.tbSysAttachFile.findUnique({
    where: { attach_id: candidate.attachId },
    select: { use_yn: true, ref_tbl_nm: true, ref_id: true, attach_div_code: true },
  });
  if (current?.use_yn === "Y") {
    if (current.attach_div_code !== "INLINE" || current.ref_tbl_nm !== "tb_sys_docs_page") {
      return { status: "SKIPPED" as const, reason: "attachment became active" };
    }

    const page = await prisma.tbSysDocsPage.findUnique({
      where: { page_id: current.ref_id },
      select: { page_cn: true },
    });
    if (page?.page_cn?.includes(`/api/docs/files/${candidate.attachId}/view`)) {
      return { status: "SKIPPED" as const, reason: "inline attachment is referenced" };
    }

    const marked = await prisma.tbSysAttachFile.updateMany({
      where: { attach_id: candidate.attachId, use_yn: "Y" },
      data: { use_yn: "N", mdfcn_dt: new Date() },
    });
    if (marked.count === 0) {
      return { status: "SKIPPED" as const, reason: "attachment state changed" };
    }
  }

  await removeStorageObjects([candidate.objectPath]);
  return { status: "SUCCESS" as const, meta: { path: candidate.objectPath } };
}

/** 매일 실행: 버킷 목록을 읽지 않고 DB가 가리키는 정리 대상만 처리한다. */
export async function runDailyStorageCleanup(auth: BatchAuth): Promise<RunJobResult> {
  const prefix = storagePrefix();
  const orphanBefore = new Date(Date.now() - ORPHAN_GRACE_MS);

  return runJob<DailyCleanupCandidate>({
    jobTyCode: "ATTACH_FILE_CLEANUP",
    jobNm: "첨부파일 정리(pending/논리삭제)",
    trgrTyCode: auth.trigger,
    trgrMberId: auth.mberId,
    maxItems: CLEANUP_LIMIT,
    summary: { bucket: storageBucketName(), prefix, mode: "targeted" },

    async loadTargets() {
      const [pendingRows, systemFiles] = await Promise.all([
        prisma.tbCmStorageUploadPending.findMany({
          where: { expiry_dt: { lte: new Date() } },
          orderBy: { expiry_dt: "asc" },
          take: CLEANUP_LIMIT,
        }),
        prisma.tbSysAttachFile.findMany({
          where: {
            creat_dt: { lte: orphanBefore },
            OR: [
              { use_yn: "N" },
              { use_yn: "Y", attach_div_code: "INLINE", ref_tbl_nm: "tb_sys_docs_page" },
            ],
          },
          select: {
            attach_id: true,
            ref_tbl_nm: true,
            ref_id: true,
            attach_div_code: true,
            file_path_nm: true,
            use_yn: true,
          },
          orderBy: { creat_dt: "asc" },
          take: CLEANUP_LIMIT,
        }),
      ]);

      const pageIds = [...new Set(systemFiles
        .filter((file) => file.use_yn === "Y" && file.ref_tbl_nm === "tb_sys_docs_page")
        .map((file) => file.ref_id))];
      const pages = pageIds.length > 0
        ? await prisma.tbSysDocsPage.findMany({
            where: { page_id: { in: pageIds } },
            select: { page_id: true, page_cn: true },
          })
        : [];
      const pageContent = new Map(pages.map((page) => [page.page_id, page.page_cn ?? ""]));

      const pendingTargets = pendingRows.map((pending) => ({
        item: { kind: "PENDING_UPLOAD" as const, pending },
        trgtId: pending.upload_id,
        label: pending.orgnl_file_nm,
        trgtTy: "STORAGE_UPLOAD_PENDING",
      }));
      const systemTargets = systemFiles
        .filter((file) => {
          if (file.use_yn === "N") return true;
          if (file.ref_tbl_nm !== "tb_sys_docs_page") return false;
          return !pageContent.get(file.ref_id)?.includes(`/api/docs/files/${file.attach_id}/view`);
        })
        .map((file) => ({
          item: {
            kind: "SYSTEM_ATTACHMENT" as const,
            attachId: file.attach_id,
            objectPath: file.file_path_nm,
            useYn: file.use_yn,
          },
          trgtId: file.attach_id,
          label: file.file_path_nm,
          trgtTy: "ATTACH_FILE",
        }));

      return [...pendingTargets, ...systemTargets];
    },

    processItem(candidate) {
      if (candidate.kind === "PENDING_UPLOAD") {
        return cleanupPendingUpload(candidate.pending, prefix);
      }
      return cleanupSystemAttachment(candidate, prefix);
    },
  });
}
