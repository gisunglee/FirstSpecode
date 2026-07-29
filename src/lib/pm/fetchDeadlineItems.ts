/**
 * pm/fetchDeadlineItems — 엔티티(단위업무/화면/기능)별 마감일+진척률 원본 조회 (공용, prisma 사용)
 *
 * pm-deadline-progress/route.ts, pm-deadline-progress-detail/route.ts, pm-deadline-list/route.ts,
 * my-work/route.ts 여러 곳이 똑같은 조회 로직(엔티티별 마감일 필드 + 기능 impl_rt/design_rt 롤업)을
 * 쓰길래 한 곳으로 모았다.
 *
 * 진척률 롤업 SQL은 lib/pm/progressRollup.ts로 다시 한번 통합했다(2026-07-28) — 예전엔 여기랑
 * wbs/unitWorkPhaseRollup.ts가 거의 같은 조인을 각자 구현하고 있었음.
 *
 * 일정(기간)은 2026-07-28 스키마 개편, 2026-07-28 2차 개편으로 위치가 바뀌었다:
 *   - 기능(FUNCTION) 자신은 일정 컬럼이 없음 — IMPL은 소속 화면의 실질구현기간을, DESIGN은
 *     화면→단위업무 2단계 상속으로 단위업무의 계획설계기간(plan_dsgn_*)을 그대로 쓴다.
 *   - 화면(SCREEN)은 실질구현기간(actl_impl_*)만 자신이 가짐 — 설계 일정은 2차 개편으로
 *     화면 자신에게서 빠져 소속 단위업무의 plan_dsgn_*를 그대로 상속해서 보여준다(화면이
 *     많은 단위업무에서 화면마다 설계 일정을 따로 잡는 부담을 없애기 위함).
 *   - 단위업무(UNIT_WORK)의 DESIGN은 자신의 계획설계기간(plan_dsgn_*) — PM이 잡는 상위 마일스톤,
 *     진척과 무관. 단위업무 자신은 구현 일정 필드가 없어 IMPL은 하위 화면들의 실질구현기간을
 *     롤업(시작=가장 이른 값, 종료=가장 늦은 값)해서 보여준다(progressRollup.ts
 *     fetchUnitWorkImplDates, 2026-07-29 추가 — "구현 마감일도 화면 걸 가져다 쓰자"는 요청으로
 *     단위업무 레벨에 없던 구현 일정 축을 채움).
 *
 * 공수(effort)도 2차 개편으로 화면 자신에게는 없다 — 설계공수는 단위업무 소관, 구현공수는
 * 기능 소관이라 화면의 effort는 항상 null.
 */

import { prisma } from "@/lib/prisma";
import type { DeadlineEntityKind, ProgressKind } from "@/types/pm";
import { fetchScreenProgress, fetchUnitWorkProgress, fetchUnitWorkImplDates } from "@/lib/pm/progressRollup";

export type RawDeadlineItem = {
  id:         string;
  displayId:  string;
  name:       string;
  /** 상세 페이지 바로가기 링크 */
  href:       string;
  mberId:     string | null;
  startDate:  string | null;
  endDate:    string | null;
  /** 0~100 — progressKind(IMPL/DESIGN)에 따라 기능의 impl_rt/design_rt 를 롤업한 값 */
  progress:   number;
  /** 공수(시간). FUNCTION=impl_efrt_val만 값이 있음. SCREEN/UNIT_WORK는 필드 자체가 없어 항상 null */
  effort:     string | null;
};

const HARD_LIMIT = 2000;

export async function fetchDeadlineItems(
  projectId: string,
  entity: DeadlineEntityKind,
  progressKind: ProgressKind,
  /** 넘기면 그 멤버가 담당자인 것만 조회(my-work/route.ts 용). 안 넘기면 전체 조회(기존 동작 그대로). */
  mberId?: string
): Promise<RawDeadlineItem[]> {
  if (entity === "FUNCTION") {
    const functions = await prisma.tbDsFunction.findMany({
      where:  { prjct_id: projectId, ...(mberId ? { asign_mber_id: mberId } : {}) },
      select: {
        func_id: true, func_display_id: true, func_nm: true, asign_mber_id: true, impl_efrt_val: true,
        area: {
          select: {
            screen: {
              select: {
                actl_impl_bgng_de: true, actl_impl_end_de: true,
                unitWork: { select: { plan_dsgn_bgng_de: true, plan_dsgn_end_de: true } },
              },
            },
          },
        },
      },
      take:   HARD_LIMIT,
    });
    const funcIds = functions.map((f) => f.func_id);
    const progressRows = funcIds.length > 0
      ? await prisma.tbCmProgress.findMany({
          where:  { ref_tbl_nm: "tb_ds_function", ref_id: { in: funcIds } },
          select: { ref_id: true, impl_rt: true, design_rt: true },
        })
      : [];
    const rtMap = new Map(progressRows.map((p) => [p.ref_id, progressKind === "DESIGN" ? p.design_rt : p.impl_rt]));
    return functions.map((f) => {
      const screen = f.area?.screen;
      const [startDate, endDate] = progressKind === "DESIGN"
        ? [screen?.unitWork?.plan_dsgn_bgng_de ?? null, screen?.unitWork?.plan_dsgn_end_de ?? null]
        : [screen?.actl_impl_bgng_de ?? null, screen?.actl_impl_end_de ?? null];
      return {
        id: f.func_id, displayId: f.func_display_id, name: f.func_nm,
        href: `/projects/${projectId}/functions/${f.func_id}`,
        mberId: f.asign_mber_id, startDate, endDate,
        progress: rtMap.get(f.func_id) ?? 0, effort: f.impl_efrt_val,
      };
    });
  }

  if (entity === "SCREEN") {
    const screens = await prisma.tbDsScreen.findMany({
      where:  { prjct_id: projectId, ...(mberId ? { asign_mber_id: mberId } : {}) },
      select: {
        scrn_id: true, scrn_display_id: true, scrn_nm: true, asign_mber_id: true,
        actl_impl_bgng_de: true, actl_impl_end_de: true,
        unitWork: { select: { plan_dsgn_bgng_de: true, plan_dsgn_end_de: true } },
      },
      take:   HARD_LIMIT,
    });
    const scrnIds = screens.map((s) => s.scrn_id);
    const progressMap = await fetchScreenProgress(scrnIds);
    return screens.map((s) => {
      const [startDate, endDate] = progressKind === "DESIGN"
        ? [s.unitWork?.plan_dsgn_bgng_de ?? null, s.unitWork?.plan_dsgn_end_de ?? null]
        : [s.actl_impl_bgng_de, s.actl_impl_end_de];
      const p = progressMap.get(s.scrn_id);
      return {
        id: s.scrn_id, displayId: s.scrn_display_id, name: s.scrn_nm,
        href: `/projects/${projectId}/screens/${s.scrn_id}`,
        mberId: s.asign_mber_id, startDate, endDate,
        progress: progressKind === "DESIGN" ? (p?.designRt ?? 0) : (p?.implRt ?? 0),
        effort: null,
      };
    });
  }

  // UNIT_WORK
  const unitWorks = await prisma.tbDsUnitWork.findMany({
    where:  { prjct_id: projectId, ...(mberId ? { asign_mber_id: mberId } : {}) },
    select: {
      unit_work_id: true, unit_work_display_id: true, unit_work_nm: true, asign_mber_id: true,
      plan_dsgn_bgng_de: true, plan_dsgn_end_de: true,
    },
    take:   HARD_LIMIT,
  });
  const uwIds = unitWorks.map((u) => u.unit_work_id);
  // IMPL 요청일 때만 화면 롤업 쿼리를 돌린다 — DESIGN 요청은 자신의 plan_dsgn_*로 충분해 불필요.
  const [progressMap, implDateMap] = await Promise.all([
    fetchUnitWorkProgress(uwIds),
    progressKind === "IMPL" ? fetchUnitWorkImplDates(uwIds) : Promise.resolve(new Map<string, { start: string | null; end: string | null }>()),
  ]);
  return unitWorks.map((u) => {
    const p = progressMap.get(u.unit_work_id);
    const [startDate, endDate] = progressKind === "DESIGN"
      ? [u.plan_dsgn_bgng_de, u.plan_dsgn_end_de]
      : [implDateMap.get(u.unit_work_id)?.start ?? null, implDateMap.get(u.unit_work_id)?.end ?? null];
    return {
      id: u.unit_work_id, displayId: u.unit_work_display_id, name: u.unit_work_nm,
      href: `/projects/${projectId}/unit-works/${u.unit_work_id}`,
      mberId: u.asign_mber_id, startDate, endDate,
      progress: progressKind === "DESIGN" ? (p?.designRt ?? 0) : (p?.implRt ?? 0),
      effort: null,
    };
  });
}
