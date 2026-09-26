/** 기존 uploads/ 파일을 Supabase Storage로 옮기고 DB 경로를 갱신한다. */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "../src/lib/prisma";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
}

function argumentValue(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim() || null;
}

function mimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const known: Record<string, string> = {
    ".bmp": "image/bmp",
    ".csv": "text/csv",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".webp": "image/webp",
  };
  return known[extension] ?? "application/octet-stream";
}

function resolveLocalFile(uploadRoot: string, storedPath: string): { absolute: string; relative: string } {
  const absolute = path.resolve(uploadRoot, storedPath);
  const relative = path.relative(uploadRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`uploads 경계 밖의 경로입니다: ${storedPath}`);
  }
  return { absolute, relative: relative.split(path.sep).join("/") };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const uploadRoot = path.resolve(process.cwd(), "uploads");
  const prefix = (argumentValue("prefix") ?? requiredEnv("SUPABASE_STORAGE_PREFIX"))
    .replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.includes("..")) throw new Error("SUPABASE_STORAGE_PREFIX 값이 올바르지 않습니다.");

  const bucketName = requiredEnv("SUPABASE_STORAGE_BUCKET");
  const client = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SECRET_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const [commonRows, systemRows] = await Promise.all([
    prisma.tbCmAttachFile.findMany({ select: { file_path_nm: true } }),
    prisma.tbSysAttachFile.findMany({ select: { file_path_nm: true } }),
  ]);
  const oldPaths = [...new Set([...commonRows, ...systemRows].map((row) => row.file_path_nm))]
    .filter((storedPath) => !storedPath.startsWith(`${prefix}/`));

  let migrated = 0;
  let missing = 0;
  for (const oldPath of oldPaths) {
    const local = resolveLocalFile(uploadRoot, oldPath);
    try {
      await fs.access(local.absolute);
    } catch {
      missing++;
      console.warn(`[missing] ${oldPath}`);
      continue;
    }

    const storagePath = `${prefix}/${local.relative}`;
    if (!apply) {
      console.log(`[dry-run] ${oldPath} -> ${storagePath}`);
      continue;
    }

    const buffer = await fs.readFile(local.absolute);
    const { error } = await client.storage.from(bucketName).upload(storagePath, buffer, {
      contentType: mimeType(local.absolute),
      upsert: true,
    });
    if (error) throw new Error(`${oldPath} 업로드 실패: ${error.message}`);

    await prisma.$transaction([
      prisma.tbCmAttachFile.updateMany({
        where: { file_path_nm: oldPath },
        data: { file_path_nm: storagePath },
      }),
      prisma.tbSysAttachFile.updateMany({
        where: { file_path_nm: oldPath },
        data: { file_path_nm: storagePath },
      }),
    ]);
    migrated++;
    console.log(`[migrated] ${oldPath} -> ${storagePath}`);
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", targets: oldPaths.length, migrated, missing }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
