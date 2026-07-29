/**
 * lib/pm/progressRollup.ts — 화면/단위업무 설계·구현 진척률 롤업 (단일 소스)
 *
 * 화면 자신은 진척률을 저장하지 않는다 — 하위 기능(tb_cm_progress.design_rt/impl_rt)의
 * 평균이 곧 화면의 설계/구현 진척률이고, 단위업무는 그 화면들(사실상 기능 전체)의 평균이다.
 * 예전엔 이 조인을 unitWorkPhaseRollup.ts/fetchDeadlineItems.ts 등 여러 곳에서 각자
 * 재구현했었는데(2026-07-28 이전), 계산식이 하나라도 바뀌면 전부 따로 고쳐야 해서
 * 이 파일 하나로 통일했다 — 다른 곳에서 같은 조인을 새로 짜지 말고 이 함수들을 쓸 것.
 *
 * 가중치(공수 가중평균 vs 단순평균)는 아직 미정 — 지금은 기존 동작과 동일하게 단순평균.
 * 나중에 공수 가중평균으로 바뀌면 이 파일 안의 SQL만 고치면 전체에 반영된다.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type PhaseProgress = { designRt: number; implRt: number };

/**
 * 화면별 설계/구현 진척률 — 하위 기능(tb_cm_progress) 평균. 기능이 하나도 없는 화면은 0.
 * 테스트(test_rt)는 2026-07-28 3차 개편으로 UI 전체에서 뺐으므로 여기서도 더 이상 계산하지 않는다.
 */
export async function fetchScreenProgress(screenIds: string[]): Promise<Map<string, PhaseProgress>> {
  if (screenIds.length === 0) return new Map();
  // COALESCE(AVG(COALESCE(rt,0)),0) — tb_cm_progress 행이 없는 기능(LEFT JOIN NULL)을
  // 평균에서 제외하지 않고 0점으로 채운 뒤 평균낸다(그냥 AVG는 NULL을 무시해 평균이 부풀려짐).
  const rows = await prisma.$queryRaw<{ scrn_id: string; avg_design_rt: number; avg_impl_rt: number }[]>`
    SELECT a.scrn_id,
           COALESCE(AVG(COALESCE(p.design_rt, 0)), 0) AS avg_design_rt,
           COALESCE(AVG(COALESCE(p.impl_rt, 0)),   0) AS avg_impl_rt
      FROM tb_ds_area a
      JOIN tb_ds_function f ON f.area_id = a.area_id
      LEFT JOIN tb_cm_progress p
        ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
     WHERE a.scrn_id IN (${Prisma.join(screenIds)})
     GROUP BY a.scrn_id
  `;
  return new Map(rows.map((r) => [r.scrn_id, {
    designRt: Math.round(Number(r.avg_design_rt)),
    implRt:   Math.round(Number(r.avg_impl_rt)),
  }]));
}

/** 단위업무별 설계/구현 진척률 — 하위 화면→영역→기능 전체 평균. 화면이 하나도 없으면 0. */
export async function fetchUnitWorkProgress(unitWorkIds: string[]): Promise<Map<string, PhaseProgress>> {
  if (unitWorkIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ unit_work_id: string; avg_design_rt: number; avg_impl_rt: number }[]>`
    SELECT s.unit_work_id,
           COALESCE(AVG(COALESCE(p.design_rt, 0)), 0) AS avg_design_rt,
           COALESCE(AVG(COALESCE(p.impl_rt, 0)),   0) AS avg_impl_rt
      FROM tb_ds_screen s
      JOIN tb_ds_area a ON a.scrn_id = s.scrn_id
      JOIN tb_ds_function f ON f.area_id = a.area_id
      LEFT JOIN tb_cm_progress p
        ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
     WHERE s.unit_work_id IN (${Prisma.join(unitWorkIds)})
     GROUP BY s.unit_work_id
  `;
  return new Map(rows.map((r) => [r.unit_work_id, {
    designRt: Math.round(Number(r.avg_design_rt)),
    implRt:   Math.round(Number(r.avg_impl_rt)),
  }]));
}

export type DateRange = { start: string | null; end: string | null };

/**
 * 단위업무별 구현 일정 — 단위업무 자신은 구현 일정 필드가 없음(2026-07-28 개편으로 화면 소관).
 * 하위 화면들의 실질구현기간(actl_impl_*)에서 시작=가장 이른 값, 종료=가장 늦은 값으로 롤업한다.
 * 화면이 하나도 없거나 전부 날짜 미입력이면 start/end 둘 다 null.
 */
export async function fetchUnitWorkImplDates(unitWorkIds: string[]): Promise<Map<string, DateRange>> {
  if (unitWorkIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ unit_work_id: string; start_de: string | null; end_de: string | null }[]>`
    SELECT unit_work_id,
           MIN(actl_impl_bgng_de) AS start_de,
           MAX(actl_impl_end_de) AS end_de
      FROM tb_ds_screen
     WHERE unit_work_id IN (${Prisma.join(unitWorkIds)})
     GROUP BY unit_work_id
  `;
  return new Map(rows.map((r) => [r.unit_work_id, { start: r.start_de, end: r.end_de }]));
}

/** 단일 엔티티 편의 함수 — 목록이 아니라 상세 페이지 하나만 조회할 때 */
export async function fetchOneScreenProgress(screenId: string): Promise<PhaseProgress> {
  const map = await fetchScreenProgress([screenId]);
  return map.get(screenId) ?? { designRt: 0, implRt: 0 };
}

export async function fetchOneUnitWorkProgress(unitWorkId: string): Promise<PhaseProgress> {
  const map = await fetchUnitWorkProgress([unitWorkId]);
  return map.get(unitWorkId) ?? { designRt: 0, implRt: 0 };
}

/** 단위업무 "전체 실적 진행률" 단일 값 — 설계+구현 평균(분석은 요구사항 레벨이라 제외). */
export function combinePhaseProgress(p: PhaseProgress): number {
  return Math.round((p.designRt + p.implRt) / 2);
}

export type FunctionScreenDates = {
  implBgngDe: string | null;
  implEndDe:  string | null;
};

/**
 * 기능 → 소속 화면의 실질구현기간 조회 맵 — 기능 자신은 일정이 없어(2026-07-28)
 * area_id로 화면을 찾아 상속한다. 이미 메모리에 있는 배열(추가 쿼리 없이)로 계산.
 *
 * 설계 일정은 2026-07-28 2차 개편으로 화면이 아니라 단위업무(plan_dsgn_*)에만 있어
 * 여기서 다루지 않는다 — 필요하면 함수 소속 화면의 unit_work_id로 직접 조회할 것.
 *
 * dashboard/manage-summary, pm-summary 등 여러 라우트가 각자 area→screen 2단 Map을
 * 손으로 만들어 같은 걸 반복 구현했었어서(그 과정에서 화면 하나는 end만, 하나는
 * start까지 노출하는 등 미묘하게 갈라짐) 여기 하나로 모았다 — 새 호출부는 이 함수만 쓸 것.
 */
export function resolveFunctionScreenDates(
  functions: { func_id: string; area_id: string | null }[],
  areas: { area_id: string; scrn_id: string | null }[],
  screens: {
    scrn_id: string;
    actl_impl_bgng_de: string | null; actl_impl_end_de: string | null;
  }[],
): Map<string, FunctionScreenDates> {
  const areaToScrn = new Map(areas.map((a) => [a.area_id, a.scrn_id]));
  const scrnById   = new Map(screens.map((s) => [s.scrn_id, s]));

  const result = new Map<string, FunctionScreenDates>();
  for (const f of functions) {
    const scrnId = f.area_id ? areaToScrn.get(f.area_id) : null;
    const screen = scrnId ? scrnById.get(scrnId) : null;
    result.set(f.func_id, {
      implBgngDe: screen?.actl_impl_bgng_de ?? null,
      implEndDe:  screen?.actl_impl_end_de ?? null,
    });
  }
  return result;
}
