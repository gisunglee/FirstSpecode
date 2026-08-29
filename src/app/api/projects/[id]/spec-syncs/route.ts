/** 프로젝트 동기화 실행 생성과 실행 목록 조회 API. */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiSuccess } from "@/lib/apiResponse";
import { requirePermission } from "@/lib/requirePermission";
import { specSyncApiError } from "@/lib/spec-sync/api";
import { startSyncRun } from "@/lib/spec-sync/service";
import { normalizeSyncSummary } from "@/lib/spec-sync/summary";

type RouteParams = { params: Promise<{ id: string }> };

const startSchema = z.object({
  unitWorkRef: z.string().trim().min(1).max(50),
  mode: z.enum(["CHECK", "DEEP_SYNC"]).default("CHECK"),
  clientSubmissionKey: z.string().trim().min(1).max(100).optional(),
});

const listQuerySchema = z.object({
  status: z
    .enum([
      "RUNNING",
      "NEEDS_INPUT",
      "NEEDS_REVIEW",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ])
    .optional(),
  unitWork: z.string().trim().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "specSync.submit");
  if (gate instanceof Response) return gate;

  try {
    const body = startSchema.parse(await request.json());
    return apiSuccess(
      await startSyncRun({
        projectId,
        unitWorkRef: body.unitWorkRef,
        mode: body.mode,
        memberId: gate.mberId,
        clientSubmissionKey: body.clientSubmissionKey,
      }),
      201,
    );
  } catch (error) {
    return specSyncApiError(error);
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const gate = await requirePermission(request, projectId, "specSync.read");
  if (gate instanceof Response) return gate;

  try {
    const url = new URL(request.url);
    const query = listQuerySchema.parse({
      status: url.searchParams.get("status")?.trim() || undefined,
      unitWork: url.searchParams.get("unitWork")?.trim() || undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const runs = await prisma.tbSpSyncRun.findMany({
      where: {
        prjct_id: projectId,
        ...(query.status ? { sync_sttus_code: query.status } : {}),
        ...(query.unitWork
          ? {
              OR: [
                { unit_work_id: query.unitWork },
                { unit_work_display_id: query.unitWork },
              ],
            }
          : {}),
      },
      orderBy: { creat_dt: "desc" },
      take: query.limit,
      select: {
        sync_run_id: true,
        unit_work_id: true,
        unit_work_display_id: true,
        unit_work_nm: true,
        sync_mode_code: true,
        sync_sttus_code: true,
        implementation_verdict_code: true,
        design_coverage_verdict_code: true,
        req_mber_id: true,
        creat_dt: true,
        analyzed_dt: true,
        compl_dt: true,
        analysis_summary_data: true,
        items: {
          select: {
            finding_ty_code: true,
            result_code: true,
            item_sttus_code: true,
          },
        },
      },
    });

    const memberIds = [...new Set(runs.flatMap((run) =>
      run.req_mber_id ? [run.req_mber_id] : [],
    ))];
    const members = memberIds.length
      ? await prisma.tbCmMember.findMany({
          where: { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const memberNames = new Map(
      members.map((member) => [
        member.mber_id,
        member.mber_nm || member.email_addr || member.mber_id,
      ]),
    );

    return apiSuccess({
      items: runs.map((run) => {
        const summary = normalizeSyncSummary(
          run.analysis_summary_data,
          run.items,
        );
        return {
          syncRunId: run.sync_run_id,
          unitWorkId: run.unit_work_id,
          unitWorkDisplayId: run.unit_work_display_id,
          unitWorkName: run.unit_work_nm,
          mode: run.sync_mode_code,
          status: run.sync_sttus_code,
          implementationVerdict: run.implementation_verdict_code,
          designCoverageVerdict: run.design_coverage_verdict_code,
          requesterId: run.req_mber_id,
          requesterName: run.req_mber_id
            ? memberNames.get(run.req_mber_id) ?? run.req_mber_id
            : "알 수 없음",
          evaluatedTargetCount: summary.evaluatedTargetCount,
          normalTargetCount: summary.normalTargetCount,
          issueCount: summary.issueCount,
          // 기존 목록 소비자 호환용 별칭. 이제 item은 문제 항목만 뜻한다.
          itemCount: summary.issueCount,
          pendingCount: summary.pendingCount,
          createdAt: run.creat_dt.toISOString(),
          analyzedAt: run.analyzed_dt?.toISOString() ?? null,
          completedAt: run.compl_dt?.toISOString() ?? null,
        };
      }),
    });
  } catch (error) {
    return specSyncApiError(error);
  }
}
