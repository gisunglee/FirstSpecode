/**
 * GET /api/projects/[id]/pm-missing-detail
 *   — PM "미지정 현황" 위젯 드릴다운: 담당자/일정/공수가 비어있는 실제 항목 목록
 *
 * 역할:
 *   - pm-summary 의 미지정 매트릭스(엔티티 × 담당자/일정/공수) 셀을 클릭했을 때,
 *     "정확히 무엇이 비어있는지" 이름과 바로가기 링크를 보여준다. 페이징 없이 최대 100건.
 *   - 판정 공식은 lib/pm/missingStatus.ts buildMissingStat 과 동일 (기준 통일):
 *       담당자 미지정 = asign_mber_id 없음
 *       일정 미입력   = 시작일·종료일 중 하나라도 없음 (화면은 실질구현기간 기준 —
 *                       실질설계기간은 2026-07-28부터 화면에 없고 단위업무에만 있음)
 *       공수 미입력   = parseEffortHours <= 0 (기능에만 존재)
 *
 * Query:
 *   entity  — REQUIREMENT | UNIT_WORK | SCREEN | FUNCTION (필수)
 *   missing — assignee | date | effort (필수, effort 는 화면/기능에서만 유효)
 *
 * 권한:
 *   - content.read (VIEWER 이상)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { parseEffortHours } from "@/lib/effort";
import type { MissingDetailItem, MissingEntityKind } from "@/types/pm";

type RouteParams = { params: Promise<{ id: string }> };

const ROW_LIMIT = 100;
const HARD_LIMIT = 2000;

type MissingKind = "assignee" | "date" | "effort";

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url     = new URL(request.url);
  const entity  = url.searchParams.get("entity") as MissingEntityKind | null;
  const missing = url.searchParams.get("missing") as MissingKind | null;

  if (!entity || !["REQUIREMENT", "UNIT_WORK", "SCREEN", "FUNCTION"].includes(entity)) {
    return apiError("VALIDATION_ERROR", "entity는 REQUIREMENT/UNIT_WORK/SCREEN/FUNCTION 중 하나여야 합니다.", 400);
  }
  if (!missing || !["assignee", "date", "effort"].includes(missing)) {
    return apiError("VALIDATION_ERROR", "missing은 assignee/date/effort 중 하나여야 합니다.", 400);
  }
  // 요구사항/단위업무/화면은 공수 필드가 아예 없음 — 잘못된 조합은 사전에 막아서 "0건"으로 오인하지 않게 함
  if (missing === "effort" && entity !== "FUNCTION") {
    return apiError("VALIDATION_ERROR", `${entity}는 공수 필드가 없어 effort 기준을 사용할 수 없습니다.`, 400);
  }

  // 공통 판정 함수 — buildMissingStat 과 동일 기준
  function isMissing(asignMberId: string | null, startDate: string | null, endDate: string | null, effortRaw?: string | null): boolean {
    if (missing === "assignee") return !asignMberId;
    if (missing === "date")     return !startDate || !endDate;
    return parseEffortHours(effortRaw) <= 0;
  }

  try {
    // 엔티티별 원본 조회 — 이름/표시ID/링크에 필요한 필드만
    type RawItem = {
      id: string; displayId: string; name: string; href: string;
      asignMberId: string | null; startDate: string | null; endDate: string | null;
      effort: string | null;
    };

    let raw: RawItem[] = [];

    if (entity === "REQUIREMENT") {
      const rows = await prisma.tbRqRequirement.findMany({
        where:  { prjct_id: projectId },
        select: { req_id: true, req_display_id: true, req_nm: true, asign_mber_id: true, anls_bgng_de: true, anls_end_de: true },
        take:   HARD_LIMIT,
      });
      raw = rows.map((r) => ({
        id: r.req_id, displayId: r.req_display_id, name: r.req_nm,
        href: `/projects/${projectId}/requirements/${r.req_id}`,
        asignMberId: r.asign_mber_id, startDate: r.anls_bgng_de, endDate: r.anls_end_de, effort: null,
      }));
    } else if (entity === "UNIT_WORK") {
      const rows = await prisma.tbDsUnitWork.findMany({
        where:  { prjct_id: projectId },
        select: { unit_work_id: true, unit_work_display_id: true, unit_work_nm: true, asign_mber_id: true, plan_dsgn_bgng_de: true, plan_dsgn_end_de: true },
        take:   HARD_LIMIT,
      });
      raw = rows.map((u) => ({
        id: u.unit_work_id, displayId: u.unit_work_display_id, name: u.unit_work_nm,
        href: `/projects/${projectId}/unit-works/${u.unit_work_id}`,
        asignMberId: u.asign_mber_id, startDate: u.plan_dsgn_bgng_de, endDate: u.plan_dsgn_end_de, effort: null,
      }));
    } else if (entity === "SCREEN") {
      const rows = await prisma.tbDsScreen.findMany({
        where:  { prjct_id: projectId },
        select: {
          scrn_id: true, scrn_display_id: true, scrn_nm: true, asign_mber_id: true,
          actl_impl_bgng_de: true, actl_impl_end_de: true,
        },
        take: HARD_LIMIT,
      });
      raw = rows.map((s) => ({
        id: s.scrn_id, displayId: s.scrn_display_id, name: s.scrn_nm,
        href: `/projects/${projectId}/screens/${s.scrn_id}`,
        // 실질설계기간은 2026-07-28부터 화면에 없음(단위업무 소관) — 화면 자체 일정은 구현만 남음
        asignMberId: s.asign_mber_id, startDate: s.actl_impl_bgng_de, endDate: s.actl_impl_end_de, effort: null,
      }));
    } else {
      const rows = await prisma.tbDsFunction.findMany({
        where:  { prjct_id: projectId },
        select: {
          func_id: true, func_display_id: true, func_nm: true, asign_mber_id: true, impl_efrt_val: true,
          area: { select: { screen: { select: { actl_impl_bgng_de: true, actl_impl_end_de: true } } } },
        },
        take: HARD_LIMIT,
      });
      raw = rows.map((f) => ({
        id: f.func_id, displayId: f.func_display_id, name: f.func_nm,
        href: `/projects/${projectId}/functions/${f.func_id}`,
        // 기능 자신은 구현 일정이 없음 — 소속 화면의 실질구현기간을 상속(2026-07-28)
        asignMberId: f.asign_mber_id,
        startDate: f.area?.screen?.actl_impl_bgng_de ?? null,
        endDate:   f.area?.screen?.actl_impl_end_de ?? null,
        effort:    f.impl_efrt_val,
      }));
    }

    const filtered = raw.filter((r) => isMissing(r.asignMberId, r.startDate, r.endDate, r.effort));

    // ── 멤버 이름 일괄 조회 (N+1 방지) ──────────────────────────────────
    const memberIds = [...new Set(filtered.map((r) => r.asignMberId).filter((v): v is string => !!v))];
    const members = memberIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));

    const items: MissingDetailItem[] = filtered.map((r) => ({
      id:         r.id,
      displayId:  r.displayId,
      name:       r.name,
      href:       r.href,
      mberId:     r.asignMberId,
      memberName: r.asignMberId ? (nameMap.get(r.asignMberId) ?? r.asignMberId) : null,
      startDate:  r.startDate,
      endDate:    r.endDate,
      effort:     r.effort,
    }));

    return apiSuccess({
      items: items.slice(0, ROW_LIMIT),
      total: items.length,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/pm-missing-detail] DB 오류:`, err);
    return apiError("DB_ERROR", "미지정 현황 상세 조회에 실패했습니다.", 500);
  }
}
