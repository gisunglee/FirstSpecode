/**
 * PATCH /api/projects/[id]/members/[memberId]/job — 직무 변경
 *
 * 역할:
 *   - member.changeJob 권한 보유자만 변경 가능 (OWNER/ADMIN)
 *   - 직무는 권한에 영향 없는 "업무 성격" 태그 → OWNER 보호 등 불필요
 *   - 허용 값: PM / PL / DBA / DEV / DESIGNER / QA / ETC
 *
 * 설계 문서: src/lib/permissions.md
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { JOB_CODES, isJobCode } from "@/lib/permissions";

type RouteParams = { params: Promise<{ id: string; memberId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id: projectId, memberId } = await params;

  const gate = await requirePermission(request, projectId, "member.changeJob");
  if (gate instanceof Response) return gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("VALIDATION_ERROR", "올바른 JSON 형식이 아닙니다.", 400);
  }

  const { job } = body as { job?: string };

  if (!isJobCode(job)) {
    return apiError(
      "VALIDATION_ERROR",
      `유효하지 않은 직무입니다. (허용: ${JOB_CODES.join(", ")})`,
      400
    );
  }

  // 대상 멤버 존재 확인
  const target = await prisma.tbPjProjectMember.findUnique({
    where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: memberId } },
    select: { mber_sttus_code: true },
  });
  if (!target || target.mber_sttus_code !== "ACTIVE") {
    return apiError("NOT_FOUND", "멤버를 찾을 수 없습니다.", 404);
  }

  try {
    await prisma.tbPjProjectMember.update({
      where: { prjct_id_mber_id: { prjct_id: projectId, mber_id: memberId } },
      data:  { job_title_code: job },
    });

    return apiSuccess({ memberId, job });
  } catch (err) {
    console.error(`[PATCH /api/projects/${projectId}/members/${memberId}/job] DB 오류:`, err);
    return apiError("DB_ERROR", "직무 변경 중 오류가 발생했습니다.", 500);
  }
}
