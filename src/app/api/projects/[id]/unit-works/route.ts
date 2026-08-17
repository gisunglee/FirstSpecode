/**
 * GET  /api/projects/[id]/unit-works — 단위업무 목록 조회 (FID-00129)
 * POST /api/projects/[id]/unit-works — 단위업무 생성 (FID-00130 신규)
 *
 * Query: reqId? — 특정 요구사항의 단위업무만 조회 (없으면 프로젝트 전체)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { getIdPrefix } from "@/lib/idPrefix";
import { computeNextDisplayId } from "@/lib/nextDisplayId";
import { apiTextLimitGuard } from "@/lib/constants/textLimits";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { unitWorkCreateSchema } from "@/lib/specContentSchemas";
import { listMeaningfulFields } from "@/lib/specContentFieldPolicy";
import { requireSpecCreateFields } from "@/lib/specContentWritePolicy";
import { fetchProjectUnitWorks } from "@/lib/exports/unit-works-data";

type RouteParams = { params: Promise<{ id: string }> };

// ─── GET: 단위업무 목록 조회 ─────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;
  const url   = new URL(request.url);
  const reqId = url.searchParams.get("reqId") ?? undefined;
  // 담당자 필터 — "me"는 로그인 사용자, 그 외 값은 해당 mberId로 필터
  const assignedTo = url.searchParams.get("assignedTo") ?? undefined;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  // assignedTo="me" → 로그인 사용자 mberId로 치환
  const assigneeFilter = assignedTo === "me" ? gate.mberId : (assignedTo || undefined);

  try {
    // 데이터 조회+가공 로직은 service 로 분리 — export 라우트와 동일 결과 보장
    const items = await fetchProjectUnitWorks({ projectId, reqId, assigneeFilter });
    return apiSuccess({ items, totalCount: items.length });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/unit-works] DB 오류:`, err);
    return apiError("DB_ERROR", "단위업무 목록 조회에 실패했습니다.", 500);
  }
}

// ─── POST: 단위업무 생성 ─────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.create");
  if (gate instanceof Response) return gate;

  const parsed = await parseJsonBody(request, unitWorkCreateSchema);
  if (parsed instanceof Response) return parsed;
  const { reqId, name, displayId: inputDisplayId, description, assignMemberId, startDate, endDate } = parsed.data;
  const fieldError = requireSpecCreateFields(gate, "UNIT_WORK", listMeaningfulFields(parsed.data));
  if (fieldError) return fieldError;

  // 장문 텍스트 한도 검증 — 정책은 src/lib/constants/textLimits.ts
  const limitErr = apiTextLimitGuard([
    ["name",        name],
    ["displayId",   inputDisplayId],
    ["description", description],
  ]);
  if (limitErr) return limitErr;

  // 요구사항이 이 프로젝트에 속하는지 확인 (보안: 다른 프로젝트 요구사항 연결 차단)
  const req = await prisma.tbRqRequirement.findUnique({ where: { req_id: reqId } });
  if (!req || req.prjct_id !== projectId) {
    return apiError("NOT_FOUND", "요구사항을 찾을 수 없습니다.", 404);
  }

  try {
    // 표시 ID — 사용자 입력이 있으면 그대로 사용, 없으면 자동 채번 (UW-NNNNN)
    let displayId: string;
    if (inputDisplayId?.trim()) {
      displayId = inputDisplayId.trim();
    } else {
      const uwPrefix = await getIdPrefix(projectId, "UNIT_WORK");
      const existing = await prisma.tbDsUnitWork.findMany({
        where:  { prjct_id: projectId },
        select: { unit_work_display_id: true },
      });
      displayId = computeNextDisplayId(existing.map((u) => u.unit_work_display_id), uwPrefix);
    }

    // sort_ordr: 해당 요구사항 내 마지막 + 1
    const maxSort = await prisma.tbDsUnitWork.findFirst({
      where:   { req_id: reqId },
      orderBy: { sort_ordr: "desc" },
      select:  { sort_ordr: true },
    });

    const unitWork = await prisma.tbDsUnitWork.create({
      data: {
        prjct_id:             projectId,
        req_id:               reqId,
        unit_work_display_id: displayId,
        unit_work_nm:         name.trim(),
        unit_work_dc:         description?.trim() || null,
        asign_mber_id:        assignMemberId || null,
        plan_dsgn_bgng_de:    startDate?.trim() || null,
        plan_dsgn_end_de:     endDate?.trim() || null,
        sort_ordr:            (maxSort?.sort_ordr ?? 0) + 1,
        creat_mber_id:        gate.mberId,
      },
    });

    return apiSuccess({ unitWorkId: unitWork.unit_work_id, displayId: unitWork.unit_work_display_id }, 201);
  } catch (err) {
    console.error(`[POST /api/projects/${projectId}/unit-works] DB 오류:`, err);
    return apiError("DB_ERROR", "저장 중 오류가 발생했습니다.", 500);
  }
}
