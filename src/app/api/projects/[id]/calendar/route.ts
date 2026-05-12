/**
 * GET /api/projects/[id]/calendar?ym=YYYY-MM
 *   — 해당 월의 단위업무(종료일 기준) 조회
 *
 * Query:
 *   ym — YYYY-MM (없으면 현재 월)
 *
 * 권한:
 *   - content.read
 *
 * 격리:
 *   - 단위업무 fetch service (lib/exports/unit-works-data.ts) 를 재사용하지 않음.
 *     이유: 그 함수는 진척률·스냅샷 등 무거운 데이터까지 join → 캘린더 셀에는 과함.
 *     캘린더 전용 가벼운 쿼리로 별도 작성.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import type { CalendarResponse } from "@/types/calendar";

type RouteParams = { params: Promise<{ id: string }> };

// 단위업무가 한 달에 많이 몰려도 화면 렌더 안정성을 위해 상한.
const MAX_ITEMS_PER_MONTH = 500;

// YYYY-MM 문자열 검증
const YM_RE = /^(\d{4})-(\d{2})$/;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  // ── 조회 월 파싱 ─────────────────────────────────────────────────────
  const url    = new URL(request.url);
  const ymRaw  = url.searchParams.get("ym");

  let year: number;
  let month: number; // 1~12

  if (ymRaw && YM_RE.test(ymRaw)) {
    const [, y, m] = YM_RE.exec(ymRaw)!;
    year  = parseInt(y, 10);
    month = parseInt(m, 10);
    // 비정상 값 방어 — 1900~2999, 1~12
    if (year < 1900 || year > 2999 || month < 1 || month > 12) {
      return apiError("VALIDATION_ERROR", "잘못된 ym 형식입니다. (YYYY-MM)", 400);
    }
  } else {
    // 기본값 — 현재 월 (사용자 로컬 시간 기준이 아닌 서버 시간 기준이지만,
    // KST/UTC 9시간 차이는 월 경계에서만 영향 → 사용자가 직접 ym 지정하면 해결).
    const now = new Date();
    year  = now.getFullYear();
    month = now.getMonth() + 1;
  }

  // 월 시작·끝 ISO 문자열 (YYYY-MM-DD)
  const monthStart = `${year}-${pad2(month)}-01`;
  // 다음 달의 0일 = 이번 달 말일
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${pad2(month)}-${pad2(lastDay)}`;

  try {
    const items = await prisma.tbDsUnitWork.findMany({
      where: {
        prjct_id: projectId,
        end_de:   { gte: monthStart, lte: monthEnd, not: null },
      },
      select: {
        unit_work_id:         true,
        unit_work_display_id: true,
        unit_work_nm:         true,
        end_de:               true,
        progrs_rt:            true,
        asign_mber_id:        true,
      },
      orderBy: { end_de: "asc" },
      take: MAX_ITEMS_PER_MONTH,
    });

    // 담당자 이름 일괄 조회 (N+1 방지)
    const assigneeIds = [
      ...new Set(items.map((u) => u.asign_mber_id).filter((v): v is string => !!v)),
    ];
    const members = assigneeIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: assigneeIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const nameMap = new Map(
      members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null])
    );

    const response: CalendarResponse = {
      monthStart,
      monthEnd,
      items: items.map((u) => ({
        unitWorkId:   u.unit_work_id,
        displayId:    u.unit_work_display_id,
        name:         u.unit_work_nm,
        endDate:      u.end_de ?? "", // where 에서 not:null 보장
        progress:     u.progrs_rt,
        assigneeName: u.asign_mber_id ? (nameMap.get(u.asign_mber_id) ?? null) : null,
        isMine:       u.asign_mber_id === gate.mberId,
      })),
    };

    return apiSuccess(response);
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/calendar] DB 오류:`, err);
    return apiError("DB_ERROR", "캘린더 데이터 조회에 실패했습니다.", 500);
  }
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }
