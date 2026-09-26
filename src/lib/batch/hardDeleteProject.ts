/** 프로젝트 한 건을 DB와 Supabase Storage에서 영구 삭제한다. */

import { prisma } from "@/lib/prisma";
import { removeStorageObjects } from "@/lib/supabaseStorage";

export interface HardDeleteProjectResult {
  attachFileCnt: number;
  /** 기존 배치 결과 스키마와의 호환을 위해 disk 명칭을 유지한다. */
  diskDeleted: number;
  diskFailed: number;
  diskBlockedUnsafe: number;
  failedPaths: string[];
  failedTruncated: boolean;
  blockedPaths: string[];
  blockedTruncated: boolean;
}

const PATH_LIST_MAX = 100;

function isSafeStoragePath(storagePath: string): boolean {
  const clean = storagePath.trim();
  if (!clean || clean.startsWith("/") || clean.includes("\\")) return false;
  return clean.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export async function hardDeleteProject(prjctId: string): Promise<HardDeleteProjectResult> {
  // CASCADE 삭제 전에 Storage 객체 경로를 보관한다.
  const attachFiles = await prisma.tbCmAttachFile.findMany({
    where: { prjct_id: prjctId },
    select: { file_path_nm: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.tbPjProjectSettings.deleteMany({ where: { prjct_id: prjctId } });
    await tx.tbPjProjectMember.deleteMany({ where: { prjct_id: prjctId } });
    await tx.tbPjProject.delete({ where: { prjct_id: prjctId } });
  }, {
    timeout: 60_000,
    maxWait: 10_000,
  });

  let diskDeleted = 0;
  let diskFailed = 0;
  let diskBlockedUnsafe = 0;
  const failedPaths: string[] = [];
  const blockedPaths: string[] = [];
  const uniquePaths = [...new Set(attachFiles.map((file) => file.file_path_nm))];

  // DB 삭제는 이미 완료됐으므로 Storage 삭제는 기존 정책대로 best-effort 처리한다.
  for (const storagePath of uniquePaths) {
    if (!isSafeStoragePath(storagePath)) {
      diskBlockedUnsafe++;
      if (blockedPaths.length < PATH_LIST_MAX) blockedPaths.push(storagePath);
      console.error(`[hardDeleteProject] SECURITY_BLOCK Storage 경로 삭제 거부: ${storagePath}`);
      continue;
    }

    try {
      await removeStorageObjects([storagePath]);
      diskDeleted++;
    } catch (error) {
      diskFailed++;
      if (failedPaths.length < PATH_LIST_MAX) failedPaths.push(storagePath);
      console.warn(`[hardDeleteProject] Storage 파일 삭제 실패: ${storagePath}`, error);
    }
  }

  return {
    attachFileCnt: attachFiles.length,
    diskDeleted,
    diskFailed,
    diskBlockedUnsafe,
    failedPaths,
    failedTruncated: diskFailed > PATH_LIST_MAX,
    blockedPaths,
    blockedTruncated: diskBlockedUnsafe > PATH_LIST_MAX,
  };
}
