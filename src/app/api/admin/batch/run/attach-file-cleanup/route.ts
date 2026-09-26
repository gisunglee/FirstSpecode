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
          prisma.tbSysAttachFile.findMany({ select: { file_path_nm: true } }),
        ]);
        const knownSet = new Set(
          [...commonFiles, ...systemFiles].map((file) => file.file_path_nm),
        );
        const objects = await listStorageObjects(prefix);
        const orphanBefore = Date.now() - ORPHAN_GRACE_MS;

        return objects
          .filter((object) => {
            if (knownSet.has(object.path) || !object.createdAt) return false;
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
        // 현재 실행 환경의 prefix 밖 객체는 절대 삭제하지 않는다.
        if (!candidate.objectPath.startsWith(`${prefix}/`)) {
          return {
            status: "SKIPPED",
            reason: "outside storage prefix",
            meta: { path: candidate.objectPath },
          };
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
