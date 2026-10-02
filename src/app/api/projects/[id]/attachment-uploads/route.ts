/**
 * POST /api/projects/[id]/attachment-uploads
 * AI 태스크 생성 전에 참고 파일을 Supabase Storage로 직접 올리기 위한 서명 토큰 발급/취소.
 */

import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/requirePermission";
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
  const { id: projectId } = await params;

  // 권한 가드 — 역할 매트릭스(permissions.ts) 기반.
  // 결제 잠금(§1-6)·지원 세션 읽기전용·프로젝트 삭제 상태도 requirePermission 이 함께 처리한다.
  const auth = await requirePermission(request, projectId, "ai.request");
  if (auth instanceof Response) return auth;

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
