/** 브라우저 → Supabase Storage 직접 업로드 공통 클라이언트. */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authFetch } from "@/lib/authFetch";

let cachedClient: SupabaseClient | null = null;

function browserStorageClient(): SupabaseClient {
  if (!cachedClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Supabase Storage 공개 환경변수가 설정되지 않았습니다.");
    cachedClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }
  return cachedClient;
}

type PreparedUpload = {
  bucket: string;
  path: string;
  uploadToken: string;
  completionToken: string;
};

type UploadResponse<T> = { data: T };

async function prepareAndUpload(options: {
  endpoint: string;
  files: File[];
  extra?: Record<string, unknown>;
}): Promise<{ completionTokens: string[]; extra: Record<string, unknown> }> {
  const extra = options.extra ?? {};
  const preparedResponse = await authFetch<UploadResponse<{ uploads: PreparedUpload[] }>>(options.endpoint, {
    method: "POST",
    body: JSON.stringify({
      action: "prepare",
      files: options.files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
      ...extra,
    }),
  });
  const prepared = preparedResponse.data.uploads;
  const completionTokens = prepared.map((item) => item.completionToken);

  try {
    await Promise.all(prepared.map(async (item, index) => {
      const file = options.files[index];
      if (!file) throw new Error("업로드 파일 준비 결과가 일치하지 않습니다.");
      const { error } = await browserStorageClient()
        .storage
        .from(item.bucket)
        .uploadToSignedUrl(item.path, item.uploadToken, file, {
          contentType: file.type || "application/octet-stream",
          cacheControl: "3600",
        });
      if (error) throw new Error(`파일 "${file.name}" 업로드 실패: ${error.message}`);
    }));
    return { completionTokens, extra };
  } catch (error) {
    await abortDirectUploads(options.endpoint, completionTokens, extra);
    throw error;
  }
}

export async function abortDirectUploads(
  endpoint: string,
  completionTokens: string[],
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (completionTokens.length === 0) return;
  await authFetch(endpoint, {
    method: "POST",
    body: JSON.stringify({ action: "abort", completionTokens, ...extra }),
  }).then(() => undefined);
}

export async function prepareFilesDirect(options: {
  endpoint: string;
  files: File[];
  extra?: Record<string, unknown>;
}): Promise<string[]> {
  if (options.files.length === 0) return [];
  const result = await prepareAndUpload(options);
  return result.completionTokens;
}

export async function uploadFilesDirect<T>(options: {
  endpoint: string;
  files: File[];
  extra?: Record<string, unknown>;
}): Promise<T> {
  const { completionTokens, extra } = await prepareAndUpload(options);

  try {
    const completed = await authFetch<UploadResponse<T>>(options.endpoint, {
      method: "POST",
      body: JSON.stringify({ action: "complete", completionTokens, ...extra }),
    });
    return completed.data;
  } catch (error) {
    await abortDirectUploads(options.endpoint, completionTokens, extra).catch(() => undefined);
    throw error;
  }
}
