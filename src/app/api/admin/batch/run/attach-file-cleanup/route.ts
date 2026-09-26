/** 일일 정밀 정리 + 7일 주기 전체 Storage 안전 감사를 실행한다. */

import { NextRequest } from "next/server";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireBatchAuth } from "@/lib/batch/requireBatchAuth";
import {
  runDailyStorageCleanup,
} from "@/lib/batch/storageCleanup";
import { isStorageAuditDue, runStorageAudit } from "@/lib/batch/storageAudit";

export async function POST(request: NextRequest) {
  const auth = await requireBatchAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const cleanup = await runDailyStorageCleanup(auth);
    // 수동 실행은 즉시 전체 감사까지 수행하고, cron은 마지막 성공 후 7일이 지난 날만 수행한다.
    const auditDue = auth.trigger === "MANUAL" || await isStorageAuditDue();
    const audit = auditDue ? await runStorageAudit(auth) : null;
    return apiSuccess({ ...cleanup, audit });
  } catch (error) {
    console.error("[POST /api/admin/batch/run/attach-file-cleanup] 오류:", error);
    return apiError("BATCH_ERROR", "배치 실행 중 오류가 발생했습니다.", 500);
  }
}

/** Vercel Cron은 등록된 경로를 GET으로 호출한다. */
export async function GET(request: NextRequest) {
  return POST(request);
}
