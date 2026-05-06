/**
 * GET /api/admin/batch/jobs — 배치 잡 실행 이력 목록 (SUPER_ADMIN)
 *
 * 쿼리:
 *   ?type=PROJECT_HARD_DELETE   잡 종류 필터 (생략 시 전체)
 *   ?status=SUCCESS|PARTIAL|FAILED|RUNNING   상태 필터
 *   ?page=1&pageSize=50
 *
 * 정렬: 최신순(bgng_dt DESC). 항목별 상세는 [jobId]/items 에서.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import type { Prisma } from "@prisma/client";

const PAGE_SIZE_MAX = 200;

export async function GET(request: NextRequest) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { searchParams } = new URL(request.url);
  const type     = searchParams.get("type")?.trim()   ?? "";
  const status   = searchParams.get("status")?.trim() ?? "";
  const page     = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50)
  );

  // where 는 동적으로 — 각 필터는 미지정 시 전체 노출
  const where: Prisma.TbCmBatchJobWhereInput = {
    ...(type   ? { job_ty_code: type } : {}),
    ...(status ? { sttus_code:  status } : {}),
  };

  try {
    const [items, totalCount] = await Promise.all([
      prisma.tbCmBatchJob.findMany({
        where,
        orderBy: { bgng_dt: "desc" },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
      }),
      prisma.tbCmBatchJob.count({ where }),
    ]);

    return apiSuccess({
      items: items.map((j) => ({
        jobId:        j.job_id,
        jobTyCode:    j.job_ty_code,
        jobName:      j.job_nm,
        triggerType:  j.trgr_ty_code,
        triggerMber:  j.trgr_mber_id ?? null,
        status:       j.sttus_code,
        startedAt:    j.bgng_dt.toISOString(),
        endedAt:      j.end_dt?.toISOString() ?? null,
        targetCount:  j.trgt_cnt,
        successCount: j.success_cnt,
        failCount:    j.fail_cnt,
        skipCount:    j.skip_cnt,
        errorMsg:     j.error_msg ?? null,
        // 운영자가 잡 메타(보관기간 등)를 한 눈에 볼 수 있도록 그대로 전달
        summary:      j.summary_json ?? null,
      })),
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (err) {
    console.error("[GET /api/admin/batch/jobs] DB 오류:", err);
    return apiError("DB_ERROR", "배치 잡 이력 조회에 실패했습니다.", 500);
  }
}
