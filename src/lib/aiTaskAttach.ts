/**
 * AI 태스크 요청 본문과 첨부파일 저장 공통 로직.
 *
 * 브라우저는 파일을 Supabase Storage에 직접 올린 뒤 attachmentTokens만 전송한다.
 * multipart files[]는 기존 외부 호출자의 하위 호환을 위해 남겨 두되, 파일은 동일하게
 * Supabase Storage로 저장한다.
 */

import path from "path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { completeStorageUploads, consumeStorageUploadPendings } from "@/lib/storageUpload";
import {
  buildStoragePath,
  removeStorageObjects,
  uploadStorageBuffer,
} from "@/lib/supabaseStorage";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILE_COUNT = 10;

export type ParsedAiRequest = {
  raw: Record<string, string>;
  files: File[];
  attachmentTokens: string[];
  json: Record<string, unknown> | null;
};

export async function parseAiRequest(request: NextRequest): Promise<ParsedAiRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const raw: Record<string, string> = {};
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        if (key === "files") files.push(value);
      } else {
        raw[key] = value;
      }
    }
    return { raw, files, attachmentTokens: [], json: null };
  }

  const body = await request.json() as Record<string, unknown>;
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") raw[key] = value;
  }
  const attachmentTokens = Array.isArray(body.attachmentTokens)
    ? body.attachmentTokens.filter((value): value is string => typeof value === "string")
    : [];
  return { raw, files: [], attachmentTokens, json: body };
}

export async function saveAiTaskAttachments(options: {
  projectId: string;
  taskId: string;
  memberId: string;
  files?: File[];
  attachmentTokens?: string[];
}): Promise<number> {
  const files = options.files ?? [];
  const attachmentTokens = options.attachmentTokens ?? [];
  if (files.length + attachmentTokens.length === 0) return 0;
  if (files.length + attachmentTokens.length > MAX_FILE_COUNT) {
    throw new Error(`첨부 파일은 최대 ${MAX_FILE_COUNT}개까지 업로드할 수 있습니다.`);
  }

  const storedFiles: Array<{
    storagePath: string;
    storedName: string;
    originalName: string;
    extension: string;
    fileType: "IMAGE" | "FILE";
    size: number;
    uploadId?: string;
  }> = [];
  try {
    if (attachmentTokens.length > 0) {
      const completed = await completeStorageUploads({
        completionTokens: attachmentTokens,
        memberId: options.memberId,
        projectId: options.projectId,
        refTable: "tb_ai_task",
        refId: "pending",
      });
      storedFiles.push(...completed.map((file) => ({
        storagePath: file.storagePath,
        storedName: file.storedName,
        originalName: file.originalName,
        extension: file.extension,
        fileType: file.fileType,
        size: file.size,
        uploadId: file.uploadId,
      })));
    }

    for (const file of files) {
      if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
        throw new Error(`파일 "${file.name}" 크기가 ${MAX_FILE_SIZE / 1024 / 1024}MB를 초과합니다.`);
      }
      const originalName = path.basename(file.name);
      const extension = path.extname(originalName).slice(1).toLowerCase() || "bin";
      const storedName = `${crypto.randomUUID()}.${extension}`;
      const storagePath = buildStoragePath(`ai-tasks/${options.projectId}/${options.taskId}/${storedName}`);
      const buffer = Buffer.from(await file.arrayBuffer());
      await uploadStorageBuffer(storagePath, buffer, file.type || "application/octet-stream");
      storedFiles.push({
        storagePath,
        storedName,
        originalName,
        extension,
        fileType: IMAGE_EXTENSIONS.has(extension) ? "IMAGE" : "FILE",
        size: buffer.length,
      });
    }

    await prisma.$transaction(async (tx) => {
      for (const file of storedFiles) {
        await tx.tbCmAttachFile.create({
          data: {
            prjct_id: options.projectId,
            ref_tbl_nm: "tb_ai_task",
            ref_id: options.taskId,
            file_ty_code: file.fileType,
            orgnl_file_nm: file.originalName,
            stor_file_nm: file.storedName,
            file_path_nm: file.storagePath,
            file_sz: file.size,
            file_extsn_nm: file.extension,
            req_ref_yn: "Y",
          },
        });
      }
      await consumeStorageUploadPendings(tx, storedFiles);
    });
    return storedFiles.length;
  } catch (error) {
    await removeStorageObjects(storedFiles.map((file) => file.storagePath)).catch(() => undefined);
    throw error;
  }
}

/** 재요청으로 같은 객체를 공유할 수 있어 마지막 DB 참조가 사라질 때만 객체를 삭제한다. */
export async function deleteAiTaskAttachments(taskId: string): Promise<void> {
  const files = await prisma.tbCmAttachFile.findMany({
    where: { ref_tbl_nm: "tb_ai_task", ref_id: taskId },
    select: { attach_file_id: true, file_path_nm: true },
  });

  const removablePaths: string[] = [];
  for (const file of files) {
    const otherCount = await prisma.tbCmAttachFile.count({
      where: {
        file_path_nm: file.file_path_nm,
        attach_file_id: { not: file.attach_file_id },
      },
    });
    if (otherCount === 0) removablePaths.push(file.file_path_nm);
  }
  await removeStorageObjects(removablePaths).catch((error) => {
    console.warn("[deleteAiTaskAttachments] Storage 객체 삭제 실패:", error);
  });
  if (files.length > 0) {
    await prisma.tbCmAttachFile.deleteMany({
      where: { ref_tbl_nm: "tb_ai_task", ref_id: taskId },
    });
  }
}
