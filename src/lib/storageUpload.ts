/**
 * 브라우저 직접 업로드의 준비·완료 검증 공통 로직.
 *
 * 서버가 서명한 완료 토큰에 사용자/프로젝트/참조 대상/파일 메타데이터를 담아,
 * 클라이언트가 다른 Storage 객체를 임의로 DB에 연결하지 못하게 한다.
 */

import "server-only";
import path from "path";
import jwt from "jsonwebtoken";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildStoragePath,
  createStorageUploadUrl,
  getStorageObjectInfo,
  removeStorageObjects,
  storageBucketName,
} from "@/lib/supabaseStorage";

const UPLOAD_AUDIENCE = "specode-storage-upload";
// 업로드 토큰은 2시간만 유효하지만, 느린 네트워크와 배포 중 요청을 보호하려고
// 정리 가능 시점은 넉넉히 24시간 뒤로 둔다.
const PENDING_RETENTION_MS = 24 * 60 * 60 * 1000;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);

export type UploadFileInput = {
  name: string;
  size: number;
  type?: string;
};

type UploadClaim = {
  purpose: "storage-upload";
  // 2026-09-26 이전 배포에서 발급한 토큰도 완료할 수 있도록 optional로 유지한다.
  uploadId?: string;
  memberId: string;
  projectId: string | null;
  refTable: string;
  refId: string;
  storagePath: string;
  storedName: string;
  originalName: string;
  extension: string;
  fileType: "IMAGE" | "FILE";
  mimeType: string;
  size: number;
  metadata: Record<string, string>;
};

export type PreparedStorageUpload = {
  bucket: string;
  path: string;
  uploadToken: string;
  completionToken: string;
};

export type CompletedStorageUpload = Omit<UploadClaim, "purpose" | "memberId">;

type PrepareOptions = {
  memberId: string;
  projectId?: string | null;
  refTable: string;
  refId: string;
  relativeDir: string;
  files: UploadFileInput[];
  maxFileCount: number;
  maxFileSize: number;
  blockedExtensions?: Set<string>;
  allowedExtensions?: Set<string>;
  metadata?: Record<string, string>;
};

function uploadSecret(): string {
  const value = process.env.JWT_SECRET?.trim();
  if (!value) throw new Error("JWT_SECRET 환경변수가 설정되지 않았습니다.");
  return value;
}

function cleanOriginalName(value: unknown): string {
  if (typeof value !== "string") throw new Error("파일명이 올바르지 않습니다.");
  const name = path.basename(value.trim());
  if (!name || name.length > 255 || name.includes("\0")) {
    throw new Error("파일명이 올바르지 않습니다.");
  }
  return name;
}

function validateFiles(files: UploadFileInput[], options: PrepareOptions): void {
  if (!Array.isArray(files) || files.length === 0) throw new Error("업로드할 파일을 선택해 주세요.");
  if (files.length > options.maxFileCount) {
    throw new Error(`파일은 한 번에 최대 ${options.maxFileCount}개까지 업로드할 수 있습니다.`);
  }
  for (const file of files) {
    cleanOriginalName(file.name);
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > options.maxFileSize) {
      throw new Error(`파일 "${file.name}" 크기가 허용 범위를 벗어났습니다.`);
    }
    const ext = path.extname(file.name).slice(1).toLowerCase();
    if (options.blockedExtensions?.has(ext)) throw new Error(`'.${ext}' 파일은 업로드할 수 없습니다.`);
    if (options.allowedExtensions && !options.allowedExtensions.has(ext)) {
      throw new Error(`'.${ext || "확장자 없음"}' 파일은 업로드할 수 없습니다.`);
    }
  }
}

function signClaim(claim: UploadClaim): string {
  return jwt.sign(claim, uploadSecret(), {
    algorithm: "HS256",
    audience: UPLOAD_AUDIENCE,
    expiresIn: "2h",
  });
}

function verifyClaim(token: string): UploadClaim {
  const decoded = jwt.verify(token, uploadSecret(), {
    algorithms: ["HS256"],
    audience: UPLOAD_AUDIENCE,
  });
  if (!decoded || typeof decoded === "string") throw new Error("업로드 완료 토큰이 올바르지 않습니다.");
  const claim = decoded as unknown as UploadClaim;
  if (claim.purpose !== "storage-upload") throw new Error("업로드 완료 토큰이 올바르지 않습니다.");
  return claim;
}

export async function prepareStorageUploads(options: PrepareOptions): Promise<PreparedStorageUpload[]> {
  validateFiles(options.files, options);
  const prepared: PreparedStorageUpload[] = [];
  const pendingIds: string[] = [];
  try {
    for (const input of options.files) {
      const originalName = cleanOriginalName(input.name);
      const extension = path.extname(originalName).slice(1).toLowerCase() || "bin";
      const storedName = `${crypto.randomUUID()}.${extension}`;
      const storagePath = buildStoragePath(`${options.relativeDir}/${storedName}`);
      const signed = await createStorageUploadUrl(storagePath);
      const uploadId = crypto.randomUUID();
      const claim: UploadClaim = {
        purpose: "storage-upload",
        uploadId,
        memberId: options.memberId,
        projectId: options.projectId ?? null,
        refTable: options.refTable,
        refId: options.refId,
        storagePath,
        storedName,
        originalName,
        extension,
        fileType: IMAGE_EXTENSIONS.has(extension) ? "IMAGE" : "FILE",
        mimeType: input.type?.trim() || "application/octet-stream",
        size: input.size,
        metadata: options.metadata ?? {},
      };
      await prisma.tbCmStorageUploadPending.create({
        data: {
          upload_id: uploadId,
          mber_id: options.memberId,
          prjct_id: options.projectId ?? null,
          ref_tbl_nm: options.refTable,
          ref_id: options.refId,
          orgnl_file_nm: originalName,
          stor_file_nm: storedName,
          file_path_nm: storagePath,
          file_sz: BigInt(input.size),
          file_extsn_nm: extension,
          file_ty_code: claim.fileType,
          mime_ty: claim.mimeType,
          expiry_dt: new Date(Date.now() + PENDING_RETENTION_MS),
        },
      });
      pendingIds.push(uploadId);
      prepared.push({
        bucket: storageBucketName(),
        path: signed.path,
        uploadToken: signed.token,
        completionToken: signClaim(claim),
      });
    }
    return prepared;
  } catch (error) {
    await Promise.all([
      prisma.tbCmStorageUploadPending.deleteMany({
        where: { upload_id: { in: pendingIds } },
      }).catch(() => undefined),
      removeStorageObjects(prepared.map((item) => item.path)).catch(() => undefined),
    ]);
    throw error;
  }
}

export async function completeStorageUploads(options: {
  completionTokens: string[];
  memberId: string;
  projectId?: string | null;
  refTable: string;
  refId: string;
}): Promise<CompletedStorageUpload[]> {
  if (!Array.isArray(options.completionTokens) || options.completionTokens.length === 0) {
    throw new Error("완료할 업로드가 없습니다.");
  }
  const claims = options.completionTokens.map(verifyClaim);
  const uniquePaths = new Set(claims.map((claim) => claim.storagePath));
  if (uniquePaths.size !== claims.length) {
    throw new Error("같은 업로드 완료 토큰을 중복 사용할 수 없습니다.");
  }

  const trackedIds = claims
    .map((claim) => claim.uploadId)
    .filter((uploadId): uploadId is string => typeof uploadId === "string" && uploadId.length > 0);
  const pendingRows = trackedIds.length > 0
    ? await prisma.tbCmStorageUploadPending.findMany({ where: { upload_id: { in: trackedIds } } })
    : [];
  const pendingById = new Map(pendingRows.map((row) => [row.upload_id, row]));

  for (const claim of claims) {
    if (
      claim.memberId !== options.memberId ||
      claim.projectId !== (options.projectId ?? null) ||
      claim.refTable !== options.refTable ||
      claim.refId !== options.refId
    ) {
      throw new Error("업로드 대상 정보가 일치하지 않습니다.");
    }
    if (claim.uploadId) {
      const pending = pendingById.get(claim.uploadId);
      if (!pending) {
        throw new Error(`파일 "${claim.originalName}" 업로드가 이미 완료됐거나 만료되었습니다.`);
      }
      if (
        pending.mber_id !== claim.memberId ||
        pending.prjct_id !== claim.projectId ||
        pending.ref_tbl_nm !== claim.refTable ||
        pending.ref_id !== claim.refId ||
        pending.file_path_nm !== claim.storagePath ||
        pending.stor_file_nm !== claim.storedName ||
        pending.orgnl_file_nm !== claim.originalName ||
        pending.file_sz !== BigInt(claim.size) ||
        pending.file_extsn_nm !== claim.extension ||
        pending.file_ty_code !== claim.fileType ||
        pending.mime_ty !== claim.mimeType
      ) {
        throw new Error(`파일 "${claim.originalName}"의 업로드 추적 정보가 일치하지 않습니다.`);
      }
    }
    const info = await getStorageObjectInfo(claim.storagePath);
    if (info.size !== claim.size) {
      await removeStorageObjects([claim.storagePath]).catch(() => undefined);
      throw new Error(`파일 "${claim.originalName}"의 업로드 크기가 일치하지 않습니다.`);
    }
  }
  return claims.map(({ purpose: _purpose, memberId: _memberId, ...claim }) => claim);
}

/** 최종 첨부 INSERT와 같은 트랜잭션에서 pending 행을 소비해 중간 상태를 남기지 않는다. */
export async function consumeStorageUploadPendings(
  tx: Prisma.TransactionClient,
  uploads: Array<{ uploadId?: string }>,
): Promise<void> {
  const uploadIds = uploads
    .map((upload) => upload.uploadId)
    .filter((uploadId): uploadId is string => typeof uploadId === "string" && uploadId.length > 0);
  if (uploadIds.length === 0) return;

  const deleted = await tx.tbCmStorageUploadPending.deleteMany({
    where: { upload_id: { in: uploadIds } },
  });
  if (deleted.count !== uploadIds.length) {
    throw new Error("업로드 완료 상태가 변경되었습니다. 다시 업로드해 주세요.");
  }
}

export async function abortStorageUploads(completionTokens: string[], memberId: string): Promise<void> {
  if (!Array.isArray(completionTokens) || completionTokens.length === 0) return;
  const claims: UploadClaim[] = [];
  for (const token of completionTokens) {
    try {
      const claim = verifyClaim(token);
      if (claim.memberId === memberId) claims.push(claim);
    } catch {
      // 유효하지 않은 토큰은 삭제 대상으로 신뢰하지 않는다.
    }
  }
  const removablePaths: string[] = [];
  for (const storagePath of new Set(claims.map((claim) => claim.storagePath))) {
    const [commonRef, systemRef] = await Promise.all([
      prisma.tbCmAttachFile.findFirst({
        where: { file_path_nm: storagePath },
        select: { attach_file_id: true },
      }),
      prisma.tbSysAttachFile.findFirst({
        where: { file_path_nm: storagePath },
        select: { attach_id: true },
      }),
    ]);
    // 완료 응답이 유실된 뒤 abort가 도착해도 이미 DB에 연결된 객체는 보존한다.
    if (!commonRef && !systemRef) removablePaths.push(storagePath);
  }
  await removeStorageObjects(removablePaths);
  const pendingIds = claims
    .map((claim) => claim.uploadId)
    .filter((uploadId): uploadId is string => typeof uploadId === "string" && uploadId.length > 0);
  if (pendingIds.length > 0) {
    await prisma.tbCmStorageUploadPending.deleteMany({
      where: { upload_id: { in: pendingIds }, mber_id: memberId },
    });
  }
}
