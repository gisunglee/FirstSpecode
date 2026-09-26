/**
 * POST /api/projects/[id]/attachment-uploads
 * AI 태스크 생성 전에 참고 파일을 Supabase Storage로 직접 올리기 위한 서명 토큰 발급/취소.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/requireAuth";
import { requireProjectUnlocked } from "@/lib/requireProjectUnlocked";
import { checkRole } from "@/lib/checkRole";
import { checkUploadAllowed } from "@/lib/planLimits";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import {
  abortStorageUploads,
  prepareStorageUploads,
  type UploadFileInput,
} from "@/lib/storageUpload";

type RouteParams = { params: Promise<{ id: string }> };

const MAX_FILE_COUNT = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "msi", "scr", "vbs", "js", "jar",
  "sh", "ps1", "dll", "app", "deb", "rpm",
]);

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { id: projectId } = await params;
  const lockError = await requireProjectUnlocked(projectId);
  if (lockError) return lockError;

  const membership = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: auth.mberId } },
  });
  if (!membership || membership.mber_sttus_code !== "ACTIVE") {
    return apiError("FORBIDDEN", "접근 권한이 없습니다.", 403);
  }
  const roleError = checkRole(membership.role_code, ["OWNER", "ADMIN", "PM", "DESIGNER", "DEVELOPER"]);
  if (roleError) return roleError;

  const planError = await checkUploadAllowed(projectId);
  if (planError) return planError;

  let body: { action?: unknown; files?: unknown; completionTokens?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "업로드 요청 형식이 올바르지 않습니다.", 400);
  }

  try {
    if (body.action === "prepare") {
      const uploads = await prepareStorageUploads({
        memberId: auth.mberId,
        projectId,
        refTable: "tb_ai_task",
        refId: "pending",
        relativeDir: `ai-tasks/${projectId}/pending`,
        files: body.files as UploadFileInput[],
        maxFileCount: MAX_FILE_COUNT,
        maxFileSize: MAX_FILE_SIZE,
        blockedExtensions: BLOCKED_EXTENSIONS,
      });
      return apiSuccess({ uploads });
    }

    if (body.action === "abort") {
      await abortStorageUploads(body.completionTokens as string[], auth.mberId);
      return apiSuccess({ aborted: true });
    }

    return apiError("VALIDATION_ERROR", "지원하지 않는 업로드 작업입니다.", 400);
  } catch (error) {
    console.error(`[POST /api/projects/${projectId}/attachment-uploads]`, error);
    return apiError(
      "FILE_UPLOAD_ERROR",
      error instanceof Error ? error.message : "파일 업로드 준비 중 오류가 발생했습니다.",
      400,
    );
  }
}
