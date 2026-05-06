/**
 * POST /api/admin/batch/run/attach-file-cleanup
 *   - 디스크에는 있으나 DB(tb_cm_attach_file)에 없는 orphan 파일 정리 배치
 *   - 외부 cron 또는 SUPER_ADMIN 어드민이 호출
 *
 * 동작:
 *   업로드 루트(@/lib/fileStorage 의 UPLOAD_ROOT — 모든 업로드/배치 공용)를
 *   스캔하고, DB 의 file_path_nm 과 일치하지 않는 파일을 orphan 으로 간주
 *   하여 삭제한다. 보안 가드: 삭제 직전 절대경로가 UPLOAD_ROOT 안에 있는지
 *   재확인하여 심볼릭 링크 등으로 경계 밖이 가리켜져도 차단.
 *
 * 디스크 스캔은 환경별 비용 차이가 크므로 최초 도입은 1단계 디렉터리만
 * 훑는다. 깊이/패턴이 확정되면 그때 강화.
 */

import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { runJob } from "@/lib/batch/runJob";
import { requireBatchAuth } from "@/lib/batch/requireBatchAuth";
import { UPLOAD_ROOT } from "@/lib/fileStorage";

interface OrphanCandidate {
  absPath: string;
}

/** absPath 가 UPLOAD_ROOT 안에 있는지 — 디스크 삭제의 마지막 방어선. */
function isInsideUploadRoot(absPath: string): boolean {
  const rel = path.relative(UPLOAD_ROOT, absPath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * 재귀 스캔 — UPLOAD_ROOT 하위 모든 파일을 수집한다.
 *
 * 우리 업로드 경로는 `requirements/{projectId}/{reqId}/{file}` 처럼 4단계
 * 깊이까지 들어간다. 1단계 readdir 만 하면 서브디렉터리의 orphan 을 통째로
 * 놓치므로 재귀가 필수.
 *
 * 안전장치:
 *   - depth limit (기본 8) — 무한 심볼릭 링크 / 비정상 디렉터리 방어
 *   - withFileTypes 로 stat 호출 비용 절감
 */
async function collectAllFiles(rootDir: string, maxDepth = 8): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      // 권한 부족 등으로 못 열면 그 디렉터리만 건너뜀 — 잡 전체는 계속 진행
      console.warn(`[batch:ATTACH_FILE_CLEANUP] readdir 실패 (skip): ${dir}`, e);
      return;
    }

    for (const e of entries) {
      const abs = path.resolve(dir, e.name);
      if (e.isFile())           out.push(abs);
      else if (e.isDirectory()) await walk(abs, depth + 1);
      // 심볼릭 링크 등은 무시 — 보안 + 단순성
    }
  }

  await walk(rootDir, 0);
  return out;
}

export async function POST(request: NextRequest) {
  const auth = await requireBatchAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const result = await runJob<OrphanCandidate>({
      jobTyCode:  "ATTACH_FILE_CLEANUP",
      jobNm:      "첨부파일 디스크 정리(orphan)",
      trgrTyCode: auth.trigger,
      trgrMberId: auth.mberId,
      maxItems:   500,
      summary:    { uploadRoot: UPLOAD_ROOT },

      async loadTargets() {
        // 업로드 루트가 존재하지 않으면 안전한 no-op
        try {
          await fs.access(UPLOAD_ROOT);
        } catch {
          return [];
        }

        // DB 에 등록된 모든 file_path_nm 을 한 번에 수집.
        // file_path_nm 이 상대경로/절대경로 어느 쪽이든 동일하게 비교될 수
        // 있도록 path.resolve(UPLOAD_ROOT, ...) 으로 정규화.
        const knownFiles = await prisma.tbCmAttachFile.findMany({
          select: { file_path_nm: true },
        });
        const knownSet = new Set(
          knownFiles.map((f) => path.resolve(UPLOAD_ROOT, f.file_path_nm))
        );

        // 재귀 스캔 — 우리 업로드 경로가 깊이 4단계까지 들어가므로
        // 1단계 readdir 만 하면 orphan 을 놓친다.
        const allFiles = await collectAllFiles(UPLOAD_ROOT);

        const candidates: { item: OrphanCandidate; trgtId: string; label: string; trgtTy: string }[] = [];
        for (const abs of allFiles) {
          if (knownSet.has(abs)) continue;
          candidates.push({
            item:   { absPath: abs },
            // 사후 추적 라벨은 UPLOAD_ROOT 기준 상대경로 — 운영자가 화면에서
            // 어떤 위치인지 한눈에 파악 가능
            trgtId: abs,
            label:  path.relative(UPLOAD_ROOT, abs),
            trgtTy: "ATTACH_FILE",
          });
        }
        return candidates;
      },

      async processItem(c) {
        // 디스크 삭제 직전 마지막 방어선 — 경계 밖이면 거부
        if (!isInsideUploadRoot(c.absPath)) {
          console.error(
            `[batch:ATTACH_FILE_CLEANUP] SECURITY_BLOCK 업로드 경계 밖 경로 — 삭제 거부: ${c.absPath}`
          );
          return { status: "SKIPPED", reason: "outside upload root", meta: { path: c.absPath } };
        }

        try {
          await fs.unlink(c.absPath);
          return { status: "SUCCESS", meta: { path: c.absPath } };
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            return { status: "SKIPPED", reason: "file not found", meta: { path: c.absPath } };
          }
          throw e;
        }
      },
    });

    return apiSuccess(result);
  } catch (err) {
    console.error("[POST /api/admin/batch/run/attach-file-cleanup] 오류:", err);
    return apiError("BATCH_ERROR", "배치 실행 중 오류가 발생했습니다.", 500);
  }
}
