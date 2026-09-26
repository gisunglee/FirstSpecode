/**
 * Supabase Storage 서버 전용 어댑터.
 *
 * Secret key는 이 모듈 밖으로 반환하지 않는다. 브라우저 업로드에는
 * createSignedUploadUrl()이 발급한 단기 토큰만 사용한다.
 */

import "server-only";
import { StorageClient } from "@supabase/storage-js";

let cachedClient: StorageClient | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  return value;
}

function storageClient(): StorageClient {
  if (!cachedClient) {
    const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
    cachedClient = new StorageClient(
      `${requiredEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "")}/storage/v1`,
      {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
      },
    );
  }
  return cachedClient;
}

export function storageBucketName(): string {
  return requiredEnv("SUPABASE_STORAGE_BUCKET");
}

export function storagePrefix(): string {
  const prefix = requiredEnv("SUPABASE_STORAGE_PREFIX").replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.includes("..")) {
    throw new Error("올바르지 않은 Storage prefix입니다.");
  }
  return prefix;
}

/** 신규 객체에만 환경 prefix를 붙인다. DB에 저장된 기존 경로는 그대로 사용한다. */
export function buildStoragePath(relativePath: string): string {
  const prefix = storagePrefix();
  const cleanPath = relativePath.replace(/^\/+/, "");
  if (!prefix || prefix.includes("..") || !cleanPath || cleanPath.includes("..")) {
    throw new Error("올바르지 않은 Storage 경로입니다.");
  }
  return `${prefix}/${cleanPath}`;
}

export async function createStorageUploadUrl(path: string): Promise<{ path: string; token: string }> {
  const { data, error } = await storageClient()
    .from(storageBucketName())
    .createSignedUploadUrl(path, { upsert: false });
  if (error || !data) throw new Error(`Storage 업로드 URL 발급 실패: ${error?.message ?? "unknown"}`);
  return { path: data.path, token: data.token };
}

export async function getStorageObjectInfo(path: string): Promise<{ size: number; contentType: string }> {
  const { data, error } = await storageClient().from(storageBucketName()).info(path);
  if (error || !data) throw new Error(`Storage 객체 확인 실패: ${error?.message ?? "unknown"}`);
  return {
    size: data.size ?? data.metadata?.size ?? 0,
    contentType: data.contentType ?? data.metadata?.mimetype ?? "application/octet-stream",
  };
}

export async function createStorageDownloadUrl(
  path: string,
  options: { expiresIn?: number; downloadName?: string } = {},
): Promise<string> {
  const { data, error } = await storageClient()
    .from(storageBucketName())
    .createSignedUrl(path, options.expiresIn ?? 60, {
      download: options.downloadName || undefined,
    });
  if (error || !data) throw new Error(`Storage 다운로드 URL 발급 실패: ${error?.message ?? "unknown"}`);
  return data.signedUrl;
}

export async function removeStorageObjects(paths: string[]): Promise<void> {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (uniquePaths.length === 0) return;
  const { error } = await storageClient().from(storageBucketName()).remove(uniquePaths);
  if (error) throw new Error(`Storage 객체 삭제 실패: ${error.message}`);
}

export type StorageObjectEntry = {
  path: string;
  createdAt: string | null;
};

/** 현재 환경 prefix 아래의 모든 객체를 재귀적으로 조회한다. */
export async function listStorageObjects(
  rootPath = storagePrefix(),
  maxDepth = 12,
): Promise<StorageObjectEntry[]> {
  const bucket = storageClient().from(storageBucketName());
  const objects: StorageObjectEntry[] = [];

  async function walk(folder: string, depth: number): Promise<void> {
    if (depth > maxDepth) throw new Error(`Storage 폴더 깊이가 제한(${maxDepth})을 초과했습니다.`);

    let offset = 0;
    const limit = 1000;
    while (true) {
      const { data, error } = await bucket.list(folder, {
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Storage 목록 조회 실패: ${error.message}`);

      for (const item of data ?? []) {
        const itemPath = folder ? `${folder}/${item.name}` : item.name;
        if (item.id === null) await walk(itemPath, depth + 1);
        else objects.push({ path: itemPath, createdAt: item.created_at ?? null });
      }

      if (!data || data.length < limit) break;
      offset += limit;
    }
  }

  await walk(rootPath.replace(/^\/+|\/+$/g, ""), 0);
  return objects;
}

export async function listStorageObjectPaths(
  rootPath = storagePrefix(),
  maxDepth = 12,
): Promise<string[]> {
  return (await listStorageObjects(rootPath, maxDepth)).map((object) => object.path);
}

export async function uploadStorageBuffer(
  path: string,
  buffer: Buffer,
  contentType = "application/octet-stream",
): Promise<void> {
  const { error } = await storageClient().from(storageBucketName()).upload(path, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`Storage 업로드 실패: ${error.message}`);
}
