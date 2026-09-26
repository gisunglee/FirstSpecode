/**
 * Supabase Storage 주간 안전 감사.
 *
 * 일일 정밀 정리에서 잡을 수 없는 예외(장애·구버전 코드 등)만 보완하기 위해 버킷 전체를
 * 최대 7일에 한 번 조회한다. 삭제 직전 DB 참조를 다시 확인해 목록 조회 중 생긴 업로드도 보호한다.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import type { BatchAuth } from "@/lib/batch/requireBatchAuth";
import { runJob, type RunJobResult } from "@/lib/batch/runJob";
import {
  listStorageObjects,
  removeStorageObjects,
  storageBucketName,
  storagePrefix,
} from "@/lib/supabaseStorage";

const AUDIT_LIMIT = 500;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const AUDIT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

type AuditCandidate = { objectPath: string };

function isInsideCurrentPrefix(objectPath: string, prefix: string): boolean {
  return objectPath.startsWith(`${prefix}/`);
}

/** 최근 성공 감사로부터 7일이 지났을 때만 전체 Storage 목록을 확인한다. */
export async function isStorageAuditDue(): Promise<boolean> {
  const lastSuccess = await prisma.tbCmBatchJob.findFirst({
    where: { job_ty_code: "ATTACH_FILE_AUDIT", sttus_code: "SUCCESS" },
    select: { end_dt: true },
    orderBy: { end_dt: "desc" },
  });
  if (!lastSuccess?.end_dt) return true;
  return lastSuccess.end_dt.getTime() < Date.now() - AUDIT_INTERVAL_MS;
}

/** DB 추적에서 완전히 빠진 예외적인 Storage orphan을 보완한다. */
export async function runStorageAudit(auth: BatchAuth): Promise<RunJobResult> {
  const prefix = storagePrefix();

  return runJob<AuditCandidate>({
    jobTyCode: "ATTACH_FILE_AUDIT",
    jobNm: "첨부파일 Storage 주간 안전 감사",
    trgrTyCode: auth.trigger,
    trgrMberId: auth.mberId,
    maxItems: AUDIT_LIMIT,
    summary: { bucket: storageBucketName(), prefix, mode: "full-scan" },

    async loadTargets() {
      const [commonFiles, systemFiles, pendingFiles, objects] = await Promise.all([
        prisma.tbCmAttachFile.findMany({ select: { file_path_nm: true } }),
        prisma.tbSysAttachFile.findMany({
          select: {
            attach_id: true,
            ref_tbl_nm: true,
            ref_id: true,
            attach_div_code: true,
            file_path_nm: true,
            use_yn: true,
          },
        }),
        prisma.tbCmStorageUploadPending.findMany({ select: { file_path_nm: true } }),
        listStorageObjects(prefix),
      ]);

      const pageIds = [...new Set(systemFiles
        .filter((file) => file.ref_tbl_nm === "tb_sys_docs_page")
        .map((file) => file.ref_id))];
      const pages = pageIds.length > 0
        ? await prisma.tbSysDocsPage.findMany({
            where: { page_id: { in: pageIds } },
            select: { page_id: true, page_cn: true },
          })
        : [];
      const pageContent = new Map(pages.map((page) => [page.page_id, page.page_cn ?? ""]));

      const knownPaths = new Set([
        ...commonFiles.map((file) => file.file_path_nm),
        ...pendingFiles.map((file) => file.file_path_nm),
      ]);
      for (const file of systemFiles) {
        if (file.use_yn !== "Y") continue;
        if (file.ref_tbl_nm !== "tb_sys_docs_page" || file.attach_div_code !== "INLINE") {
          knownPaths.add(file.file_path_nm);
          continue;
        }
        if (pageContent.get(file.ref_id)?.includes(`/api/docs/files/${file.attach_id}/view`)) {
          knownPaths.add(file.file_path_nm);
        }
      }

      const orphanBefore = Date.now() - ORPHAN_GRACE_MS;
      return objects
        .filter((object) => {
          if (knownPaths.has(object.path) || !object.createdAt) return false;
          return new Date(object.createdAt).getTime() < orphanBefore;
        })
        .map((object) => ({
          item: { objectPath: object.path },
          trgtId: object.path,
          label: object.path,
          trgtTy: "ATTACH_FILE",
        }));
    },

    async processItem(candidate) {
      if (!isInsideCurrentPrefix(candidate.objectPath, prefix)) {
        return {
          status: "SKIPPED",
          reason: "outside storage prefix",
          meta: { path: candidate.objectPath },
        };
      }

      // 목록 조회 뒤 새 완료 요청이 생길 수 있으므로 삭제 직전에 다시 확인한다.
      const [commonRef, pendingRef, systemRef] = await Promise.all([
        prisma.tbCmAttachFile.findFirst({
          where: { file_path_nm: candidate.objectPath },
          select: { attach_file_id: true },
        }),
        prisma.tbCmStorageUploadPending.findFirst({
          where: { file_path_nm: candidate.objectPath },
          select: { upload_id: true },
        }),
        prisma.tbSysAttachFile.findFirst({
          where: { file_path_nm: candidate.objectPath },
          select: { attach_id: true, use_yn: true, ref_tbl_nm: true, ref_id: true, attach_div_code: true },
        }),
      ]);
      if (commonRef || pendingRef) {
        return { status: "SKIPPED", reason: "attachment became referenced" };
      }
      if (systemRef?.use_yn === "Y") {
        if (systemRef.ref_tbl_nm !== "tb_sys_docs_page" || systemRef.attach_div_code !== "INLINE") {
          return { status: "SKIPPED", reason: "system attachment is active" };
        }
        const page = await prisma.tbSysDocsPage.findUnique({
          where: { page_id: systemRef.ref_id },
          select: { page_cn: true },
        });
        if (page?.page_cn?.includes(`/api/docs/files/${systemRef.attach_id}/view`)) {
          return { status: "SKIPPED", reason: "inline attachment became referenced" };
        }
        await prisma.tbSysAttachFile.updateMany({
          where: { attach_id: systemRef.attach_id, use_yn: "Y" },
          data: { use_yn: "N", mdfcn_dt: new Date() },
        });
      }

      await removeStorageObjects([candidate.objectPath]);
      return { status: "SUCCESS", meta: { path: candidate.objectPath } };
    },
  });
}
