/**
 * GET /api/projects/[id]/pm-delay-detail
 *   — PM "지연 현황" 위젯 드릴다운: 실제 화면/기능 이름과 진척률을 보여주는 원본 목록
 *
 * 역할:
 *   - pm-summary 의 집계 숫자(멤버별 개수·지연율)를 클릭했을 때, "정확히 무엇이 지연인지"
 *     이름을 보여준다. 페이징 없이 최대 100건.
 *   - kind=DESIGN → 단위업무 기준, 2026-07-28 2차 개편 (진척률 = 하위 화면·기능 design_rt 평균)
 *   - kind=IMPL   → 기능 기준 (진척률 = impl_rt, 계층 이름은 area→screen→unitWork 조인)
 *   - 지연 판정 공식은 lib/pm/delayStatus.ts 와 동일 (기준 통일)
 *
 * Query:
 *   kind      — all | design | impl (기본 all)
 *   mberId    — 특정 멤버만 (선택). UNASSIGNED_MBER_KEY("__unassigned__") 면 담당자 없는 항목만
 *   delayOnly — "true" 면 지연 항목만
 *
 * 권한:
 *   - content.read (VIEWER 이상)
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/requirePermission";
import { apiSuccess, apiError } from "@/lib/apiResponse";
import { UNASSIGNED_MBER_KEY } from "@/lib/pm/delayStatus";
import { fetchUnitWorkProgress } from "@/lib/pm/progressRollup";
import type { DelayDetailItem } from "@/types/pm";

type RouteParams = { params: Promise<{ id: string }> };

// PM 이 한 번에 훑어볼 수 있는 상한 — 더 보고 싶으면 멤버/지연 필터로 좁히도록 유도
const ROW_LIMIT = 100;
// 안전망 — 원본 조회 자체가 무한정 커지지 않도록 (필터 전 단계)
const HARD_LIMIT = 2000;

// mberId 쿼리 파라미터 → Prisma where 절.
//   비어있음      → 필터 없음 (전체)
//   UNASSIGNED_MBER_KEY → asign_mber_id IS NULL ("미할당"만)
//   그 외         → asign_mber_id = mberId (특정 멤버만)
function assigneeWhere(mberId: string | undefined): { asign_mber_id?: string | null } {
  if (!mberId) return {};
  if (mberId === UNASSIGNED_MBER_KEY) return { asign_mber_id: null };
  return { asign_mber_id: mberId };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: projectId } = await params;

  const gate = await requirePermission(request, projectId, "content.read");
  if (gate instanceof Response) return gate;

  const url       = new URL(request.url);
  const kind      = url.searchParams.get("kind") ?? "all";
  const mberId    = url.searchParams.get("mberId") || undefined;
  const delayOnly = url.searchParams.get("delayOnly") === "true";
  const asOfParam = url.searchParams.get("asOf");

  if (!["all", "design", "impl"].includes(kind)) {
    return apiError("VALIDATION_ERROR", "kind는 all/design/impl 중 하나여야 합니다.", 400);
  }

  try {
    // 지연 기준일(asOf) — pm-summary/route.ts 와 동일 규칙. DelayStatusMatrix 에서 기준일을
    // 바꾸면 이 드릴다운도 같은 기준으로 봐야 위젯 숫자와 상세 목록이 어긋나지 않는다.
    const isValidDateStr = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const todayStr = isValidDateStr(asOfParam) ? asOfParam : new Date().toISOString().slice(0, 10);
    const items: DelayDetailItem[] = [];

    // ── DESIGN — 단위업무 기준 (2026-07-28 2차 개편: 화면이 많으면 화면별 설계 일정
    // 입력이 부담이라 설계 일정은 단위업무의 plan_dsgn_*로만 관리) ──────────────
    if (kind === "all" || kind === "design") {
      const unitWorks = await prisma.tbDsUnitWork.findMany({
        where: {
          prjct_id: projectId,
          ...assigneeWhere(mberId),
        },
        select: {
          unit_work_id: true, unit_work_nm: true, asign_mber_id: true,
          plan_dsgn_bgng_de: true, plan_dsgn_end_de: true,
        },
        take: HARD_LIMIT,
      });

      // 단위업무별 설계 진척률 — 하위 화면→영역→기능 design_rt 롤업(중앙 헬퍼 재사용)
      const uwProgressMap = await fetchUnitWorkProgress(unitWorks.map((u) => u.unit_work_id));

      for (const u of unitWorks) {
        const progress = uwProgressMap.get(u.unit_work_id)?.designRt ?? 0;
        const isDelayed = !!u.plan_dsgn_end_de && u.plan_dsgn_end_de < todayStr && progress < 100;
        items.push({
          kind: "DESIGN",
          itemId: u.unit_work_id,
          mberId: u.asign_mber_id,
          memberName: null, // 아래에서 일괄 채움
          unitWorkId:   u.unit_work_id,
          unitWorkName: u.unit_work_nm,
          screenId: null,
          screenName: null,
          areaId: null,
          areaName: null,
          functionId: null,
          functionName: null,
          progress,
          startDate: u.plan_dsgn_bgng_de,
          endDate: u.plan_dsgn_end_de,
          isDelayed,
        });
      }
    }

    // ── IMPL — 기능 기준 ─────────────────────────────────────────────────
    if (kind === "all" || kind === "impl") {
      const functions = await prisma.tbDsFunction.findMany({
        where: {
          prjct_id: projectId,
          ...assigneeWhere(mberId),
        },
        select: {
          func_id: true, func_nm: true, asign_mber_id: true,
          area: {
            select: {
              area_id: true, area_nm: true,
              screen: {
                select: {
                  scrn_id: true, scrn_nm: true, unit_work_id: true,
                  actl_impl_bgng_de: true, actl_impl_end_de: true,
                  unitWork: { select: { unit_work_nm: true } },
                },
              },
            },
          },
        },
        take: HARD_LIMIT,
      });

      const funcIds = functions.map((f) => f.func_id);
      const progressRows = funcIds.length > 0
        ? await prisma.tbCmProgress.findMany({
            where:  { ref_tbl_nm: "tb_ds_function", ref_id: { in: funcIds } },
            select: { ref_id: true, impl_rt: true },
          })
        : [];
      const implRtMap = new Map(progressRows.map((p) => [p.ref_id, p.impl_rt]));

      for (const f of functions) {
        // 기능 자신은 구현 일정이 없음 — 소속 화면의 실질구현기간을 상속(2026-07-28)
        const implBgngDe = f.area?.screen?.actl_impl_bgng_de ?? null;
        const implEndDe  = f.area?.screen?.actl_impl_end_de ?? null;
        const progress = implRtMap.get(f.func_id) ?? 0;
        const isDelayed = !!implEndDe && implEndDe < todayStr && progress < 100;
        items.push({
          kind: "IMPL",
          itemId: f.func_id,
          mberId: f.asign_mber_id,
          memberName: null,
          unitWorkId:   f.area?.screen?.unit_work_id ?? null,
          unitWorkName: f.area?.screen?.unitWork?.unit_work_nm ?? null,
          screenId:   f.area?.screen?.scrn_id ?? null,
          screenName: f.area?.screen?.scrn_nm ?? null,
          areaId:   f.area?.area_id ?? null,
          areaName: f.area?.area_nm ?? null,
          functionId:   f.func_id,
          functionName: f.func_nm,
          progress,
          startDate: implBgngDe,
          endDate: implEndDe,
          isDelayed,
        });
      }
    }

    // ── 멤버 이름 일괄 조회 (N+1 방지) ──────────────────────────────────
    const memberIds = [...new Set(items.map((i) => i.mberId).filter((v): v is string => !!v))];
    const members = memberIds.length > 0
      ? await prisma.tbCmMember.findMany({
          where:  { mber_id: { in: memberIds } },
          select: { mber_id: true, mber_nm: true, email_addr: true },
        })
      : [];
    const nameMap = new Map(members.map((m) => [m.mber_id, m.mber_nm || m.email_addr || null]));
    for (const it of items) {
      it.memberName = it.mberId ? (nameMap.get(it.mberId) ?? it.mberId) : null;
    }

    // ── 필터 + 정렬(지연 먼저, 그다음 진척률 낮은 순) + 상한 ────────────
    const filtered = delayOnly ? items.filter((i) => i.isDelayed) : items;
    filtered.sort((a, b) => {
      if (a.isDelayed !== b.isDelayed) return a.isDelayed ? -1 : 1;
      return a.progress - b.progress;
    });

    return apiSuccess({
      items: filtered.slice(0, ROW_LIMIT),
      total: filtered.length,
    });
  } catch (err) {
    console.error(`[GET /api/projects/${projectId}/pm-delay-detail] DB 오류:`, err);
    return apiError("DB_ERROR", "지연 현황 상세 조회에 실패했습니다.", 500);
  }
}
