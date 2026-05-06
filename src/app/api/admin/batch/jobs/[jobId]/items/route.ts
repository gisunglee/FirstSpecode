/**
 * GET /api/admin/batch/jobs/[jobId]/items
 *   - 특정 배치 잡의 항목별 처리 결과 (SUPER_ADMIN)
 *
 * 쿼리:
 *   ?status=SUCCESS|FAILED|SKIPPED   상태 필터 (생략 시 전체)
 *   ?page=1&pageSize=100
 *
 * 정렬: processed_dt 오름차순 (처리 순서 그대로 — 디버깅 시 시계열 추적용)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { requireSystemAdmin } from "@/lib/requireSystemAdmin";
import type { Prisma } from "@prisma/client";

type RouteParams = { params: Promise<{ jobId: string }> };

const PAGE_SIZE_MAX = 500;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await requireSystemAdmin(request);
  if (gate instanceof Response) return gate;

  const { jobId } = await params;

  const { searchParams } = new URL(request.url);
  const status   = searchParams.get("status")?.trim() ?? "";
  const page     = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "100", 10) || 100)
  );

  const where: Prisma.TbCmBatchJobItemWhereInput = {
    job_id: jobId,
    ...(status ? { sttus_code: status } : {}),
  };

  try {
    // 잡 자체가 존재하는지 먼저 검증 — 잘못된 jobId 에 대해 404
    const job = await prisma.tbCmBatchJob.findUnique({
      where:  { job_id: jobId },
      select: { job_id: true },
    });
    if (!job) {
      return apiError("NOT_FOUND", "해당 배치 잡을 찾을 수 없습니다.", 404);
    }

    const [items, totalCount] = await Promise.all([
      prisma.tbCmBatchJobItem.findMany({
        where,
        orderBy: { processed_dt: "asc" },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
      }),
      prisma.tbCmBatchJobItem.count({ where }),
    ]);

    return apiSuccess({
      items: items.map((i) => ({
        itemId:      i.item_id,
        targetType:  i.trgt_ty_code,
        targetId:    i.trgt_id,
        targetLabel: i.trgt_label ?? null,
        status:      i.sttus_code,
        errorMsg:    i.error_msg  ?? null,
        processedAt: i.processed_dt.toISOString(),
        meta:        i.meta_json  ?? null,
      })),
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (err) {
    console.error(`[GET /api/admin/batch/jobs/${jobId}/items] DB 오류:`, err);
    return apiError("DB_ERROR", "배치 항목 조회에 실패했습니다.", 500);
  }
}
