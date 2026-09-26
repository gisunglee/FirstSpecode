/** Supabase Storage에는 있지만 첨부 DB에는 없는 orphan 객체를 정리한다. */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { runJob } from "@/lib/batch/runJob";
import { requireBatchAuth } from "@/lib/batch/requireBatchAuth";
import {
  listStorageObjects,
  removeStorageObjects,
  storageBucketName,
  storagePrefix,
} from "@/lib/supabaseStorage";

interface OrphanCandidate {
  objectPath: string;
  systemAttachId: string | null;
}

const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const auth = await requireBatchAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const prefix = storagePrefix();
    const result = await runJob<OrphanCandidate>({
      jobTyCode: "ATTACH_FILE_CLEANUP",
      jobNm: "첨부파일 Storage 정리(orphan)",
      trgrTyCode: auth.trigger,
      trgrMberId: auth.mberId,
      maxItems: 500,
      summary: { bucket: storageBucketName(), prefix },

      async loadTargets() {
        const [commonFiles, systemFiles] = await Promise.all([
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
        ]);
        const docsPageIds = [...new Set(systemFiles
          .filter((file) => file.ref_tbl_nm === "tb_sys_docs_page")
          .map((file) => file.ref_id))];
        const docsPages = docsPageIds.length > 0
          ? await prisma.tbSysDocsPage.findMany({
              where: { page_id: { in: docsPageIds } },
              select: { page_id: true, page_cn: true },
            })
          : [];
        const docsContentByPage = new Map(
          docsPages.map((page) => [page.page_id, page.page_cn ?? ""]),
        );

        const knownSet = new Set(commonFiles.map((file) => file.file_path_nm));
        const systemFileByPath = new Map(systemFiles.map((file) => [file.file_path_nm, file]));
        for (const file of systemFiles) {
          if (file.use_yn !== "Y") continue;
          if (file.ref_tbl_nm !== "tb_sys_docs_page") {
            knownSet.add(file.file_path_nm);
            continue;
          }

          const pageContent = docsContentByPage.get(file.ref_id);
          if (pageContent === undefined) continue;
          if (
            file.attach_div_code === "INLINE" &&
            !pageContent.includes(`/api/docs/files/${file.attach_id}/view`)
          ) {
            // 본문 저장 전에 이탈한 인라인 업로드는 24시간 유예 후 정리한다.
            continue;
          }
          knownSet.add(file.file_path_nm);
        }
        const objects = await listStorageObjects(prefix);
        const orphanBefore = Date.now() - ORPHAN_GRACE_MS;

        return objects
          .filter((object) => {
            if (knownSet.has(object.path) || !object.createdAt) return false;
            return new Date(object.createdAt).getTime() < orphanBefore;
          })
          .map((object) => ({
            item: {
              objectPath: object.path,
              systemAttachId: systemFileByPath.get(object.path)?.attach_id ?? null,
            },
            trgtId: object.path,
            label: object.path,
            trgtTy: "ATTACH_FILE",
          }));
      },

      async processItem(candidate) {
        // 현재 실행 환경의 prefix 밖 객체는 절대 삭제하지 않는다.
        if (!candidate.objectPath.startsWith(`${prefix}/`)) {
          return {
            status: "SKIPPED",
            reason: "outside storage prefix",
            meta: { path: candidate.objectPath },
          };
        }

        if (candidate.systemAttachId) {
          await prisma.tbSysAttachFile.updateMany({
            where: { attach_id: candidate.systemAttachId, use_yn: "Y" },
            data: { use_yn: "N", mdfcn_dt: new Date() },
          });
        }
        await removeStorageObjects([candidate.objectPath]);
        return { status: "SUCCESS", meta: { path: candidate.objectPath } };
      },
    });

    return apiSuccess(result);
  } catch (error) {
    console.error("[POST /api/admin/batch/run/attach-file-cleanup] 오류:", error);
    return apiError("BATCH_ERROR", "배치 실행 중 오류가 발생했습니다.", 500);
  }
}

/** Vercel Cron은 등록된 경로를 GET으로 호출한다. */
export async function GET(request: NextRequest) {
  return POST(request);
}
