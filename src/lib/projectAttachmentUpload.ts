/** 프로젝트 영역·기능·요구사항 첨부의 서명 업로드 공통 처리. */

import "server-only";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import {
  abortStorageUploads,
  completeStorageUploads,
  consumeStorageUploadPendings,
  prepareStorageUploads,
  type UploadFileInput,
} from "@/lib/storageUpload";
import { removeStorageObjects } from "@/lib/supabaseStorage";

const MAX_FILE_COUNT = 10;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "msi", "scr", "vbs", "js", "jar",
  "sh", "ps1", "dll", "app", "deb", "rpm",
]);

type UploadBody = {
  action?: unknown;
  files?: unknown;
  completionTokens?: unknown;
};

export async function handleProjectAttachmentUpload(options: {
  request: NextRequest;
  memberId: string;
  projectId: string;
  refTable: string;
  refId: string;
  relativeDir: string;
  forceFileType?: "FILE";
}): Promise<Response> {
  let body: UploadBody;
  try {
    body = await options.request.json() as UploadBody;
  } catch {
    return apiError("VALIDATION_ERROR", "업로드 요청 형식이 올바르지 않습니다.", 400);
  }

  try {
    if (body.action === "prepare") {
      const uploads = await prepareStorageUploads({
        memberId: options.memberId,
        projectId: options.projectId,
        refTable: options.refTable,
        refId: options.refId,
        relativeDir: options.relativeDir,
        files: body.files as UploadFileInput[],
        maxFileCount: MAX_FILE_COUNT,
        maxFileSize: MAX_FILE_SIZE,
        blockedExtensions: BLOCKED_EXTENSIONS,
      });
      return apiSuccess({ uploads });
    }

    if (body.action === "abort") {
      await abortStorageUploads(body.completionTokens as string[], options.memberId);
      return apiSuccess({ aborted: true });
    }

    if (body.action !== "complete") {
      return apiError("VALIDATION_ERROR", "지원하지 않는 업로드 작업입니다.", 400);
    }

    const completed = await completeStorageUploads({
      completionTokens: body.completionTokens as string[],
      memberId: options.memberId,
      projectId: options.projectId,
      refTable: options.refTable,
      refId: options.refId,
    });

    try {
      const uploaded = await prisma.$transaction(async (tx) => {
        const records = [];
        for (const file of completed) {
          records.push(await tx.tbCmAttachFile.create({
            data: {
              prjct_id: options.projectId,
              ref_tbl_nm: options.refTable,
              ref_id: options.refId,
              file_ty_code: options.forceFileType ?? file.fileType,
              orgnl_file_nm: file.originalName,
              stor_file_nm: file.storedName,
              file_path_nm: file.storagePath,
              file_sz: file.size,
              file_extsn_nm: file.extension,
              req_ref_yn: "N",
            },
          }));
        }
        await consumeStorageUploadPendings(tx, completed);
        return records;
      });
      return apiSuccess({
        uploaded: uploaded.map((record, index) => ({
          fileId: record.attach_file_id,
          fileName: record.orgnl_file_nm,
          extension: record.file_extsn_nm,
          fileType: record.file_ty_code,
          reqRefYn: record.req_ref_yn ?? "N",
          storagePath: completed[index]?.storagePath,
        })),
      }, 201);
    } catch (error) {
      await removeStorageObjects(completed.map((file) => file.storagePath)).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error("[project attachment upload]", error);
    const message = error instanceof Error ? error.message : "파일 업로드 중 오류가 발생했습니다.";
    return apiError("FILE_UPLOAD_ERROR", message, 400);
  }
}
