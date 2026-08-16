/** 동기화 도메인 오류를 일관된 JSON API 오류로 변환한다. */

import { ZodError } from "zod";
import { apiError } from "@/lib/apiResponse";
import { DesignSnapshotError } from "./designContext";
import { SpecSyncError } from "./service";

export function specSyncApiError(error: unknown) {
  if (error instanceof SpecSyncError) {
    return apiError(error.code, error.message, error.status, error.details);
  }
  if (error instanceof DesignSnapshotError) {
    return apiError(
      error.code,
      error.message,
      error.code === "UNIT_WORK_NOT_FOUND" ? 404 : 422,
    );
  }
  if (error instanceof ZodError) {
    return apiError("INVALID_REQUEST", "요청 형식이 올바르지 않습니다.", 400, {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  if (error instanceof SyntaxError) {
    return apiError("INVALID_JSON", "올바른 JSON 형식이 아닙니다.", 400);
  }
  console.error("[spec-sync] unexpected error", error);
  return apiError("INTERNAL_ERROR", "동기화 처리 중 오류가 발생했습니다.", 500);
}
