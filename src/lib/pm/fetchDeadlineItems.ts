/**
 * pm/fetchDeadlineItems — 엔티티(단위업무/화면/기능)별 마감일+진척률 원본 조회 (공용, prisma 사용)
 *
 * pm-deadline-progress/route.ts, pm-deadline-progress-detail/route.ts, pm-deadline-list/route.ts,
 * my-work/route.ts 여러 곳이 똑같은 조회 로직(엔티티별 마감일 필드 + 기능 impl_rt/design_rt 롤업)을
 * 쓰길래 한 곳으로 모았다.
 *
 * lib/pm/delayStatus.ts 등과 달리 이 파일은 prisma 를 직접 쓴다 — "순수 함수, prisma 무관" 원칙은
 * lib/pm/deadlineProgress.ts(분류·집계 로직)에 남겨두고, 여긴 DB 조회 전용으로 역할을 분리했다.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DeadlineEntityKind, ProgressKind } from "@/types/pm";

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
  /** 공수(시간). FUNCTION=efrt_val, SCREEN=design_efrt_val. UNIT_WORK는 해당 필드 자체가 없어 항상 null */
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
      select: { func_id: true, func_display_id: true, func_nm: true, asign_mber_id: true, impl_bgng_de: true, impl_end_de: true, efrt_val: true },
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
    return functions.map((f) => ({
      id: f.func_id, displayId: f.func_display_id, name: f.func_nm,
      href: `/projects/${projectId}/functions/${f.func_id}`,
      mberId: f.asign_mber_id, startDate: f.impl_bgng_de, endDate: f.impl_end_de,
      progress: rtMap.get(f.func_id) ?? 0, effort: f.efrt_val,
    }));
  }

  if (entity === "SCREEN") {
    const screens = await prisma.tbDsScreen.findMany({
      where:  { prjct_id: projectId, ...(mberId ? { asign_mber_id: mberId } : {}) },
      select: { scrn_id: true, scrn_display_id: true, scrn_nm: true, asign_mber_id: true, design_bgng_de: true, design_end_de: true, design_efrt_val: true },
      take:   HARD_LIMIT,
    });
    const scrnIds = screens.map((s) => s.scrn_id);
    // 화면별 하위 기능들의 진척률 평균. progressKind에 따라 impl_rt/design_rt 컬럼만 바꿔서 집계
    // (둘 다 고정 SQL — progressKind는 호출자가 이미 IMPL/DESIGN 중 하나로 검증했으므로 안전).
    const rtRows = scrnIds.length === 0 ? [] : progressKind === "DESIGN"
      ? await prisma.$queryRaw<{ scrn_id: string; avg_rt: number }[]>`
          SELECT a.scrn_id, COALESCE(AVG(p.design_rt), 0) AS avg_rt
            FROM tb_ds_function f
            JOIN tb_ds_area a ON a.area_id = f.area_id
            LEFT JOIN tb_cm_progress p
              ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
           WHERE a.scrn_id IN (${Prisma.join(scrnIds)})
           GROUP BY a.scrn_id
        `
      : await prisma.$queryRaw<{ scrn_id: string; avg_rt: number }[]>`
          SELECT a.scrn_id, COALESCE(AVG(p.impl_rt), 0) AS avg_rt
            FROM tb_ds_function f
            JOIN tb_ds_area a ON a.area_id = f.area_id
            LEFT JOIN tb_cm_progress p
              ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
           WHERE a.scrn_id IN (${Prisma.join(scrnIds)})
           GROUP BY a.scrn_id
        `;
    const rtMap = new Map(rtRows.map((r) => [r.scrn_id, Math.round(Number(r.avg_rt))]));
    return screens.map((s) => ({
      id: s.scrn_id, displayId: s.scrn_display_id, name: s.scrn_nm,
      href: `/projects/${projectId}/screens/${s.scrn_id}`,
      mberId: s.asign_mber_id, startDate: s.design_bgng_de, endDate: s.design_end_de,
      progress: rtMap.get(s.scrn_id) ?? 0, effort: s.design_efrt_val,
    }));
  }

  // UNIT_WORK
  const unitWorks = await prisma.tbDsUnitWork.findMany({
    where:  { prjct_id: projectId, ...(mberId ? { asign_mber_id: mberId } : {}) },
    select: { unit_work_id: true, unit_work_display_id: true, unit_work_nm: true, asign_mber_id: true, bgng_de: true, end_de: true },
    take:   HARD_LIMIT,
  });
  const uwIds = unitWorks.map((u) => u.unit_work_id);
  // 단위업무별 하위 전체 기능(unitWork→screen→area→function)의 진척률 평균 —
  // buildImplDelayRows(lib/pm/delayStatus.ts)의 4계층 롤업과 같은 조인 구조를 SQL로 미리 평균냄.
  const rtRows = uwIds.length === 0 ? [] : progressKind === "DESIGN"
    ? await prisma.$queryRaw<{ unit_work_id: string; avg_rt: number }[]>`
        SELECT s.unit_work_id, COALESCE(AVG(p.design_rt), 0) AS avg_rt
          FROM tb_ds_function f
          JOIN tb_ds_area a ON a.area_id = f.area_id
          JOIN tb_ds_screen s ON s.scrn_id = a.scrn_id
          LEFT JOIN tb_cm_progress p
            ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
         WHERE s.unit_work_id IN (${Prisma.join(uwIds)})
         GROUP BY s.unit_work_id
      `
    : await prisma.$queryRaw<{ unit_work_id: string; avg_rt: number }[]>`
        SELECT s.unit_work_id, COALESCE(AVG(p.impl_rt), 0) AS avg_rt
          FROM tb_ds_function f
          JOIN tb_ds_area a ON a.area_id = f.area_id
          JOIN tb_ds_screen s ON s.scrn_id = a.scrn_id
          LEFT JOIN tb_cm_progress p
            ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
         WHERE s.unit_work_id IN (${Prisma.join(uwIds)})
         GROUP BY s.unit_work_id
      `;
  const rtMap = new Map(rtRows.map((r) => [r.unit_work_id, Math.round(Number(r.avg_rt))]));
  return unitWorks.map((u) => ({
    id: u.unit_work_id, displayId: u.unit_work_display_id, name: u.unit_work_nm,
    href: `/projects/${projectId}/unit-works/${u.unit_work_id}`,
    mberId: u.asign_mber_id, startDate: u.bgng_de, endDate: u.end_de,
    progress: rtMap.get(u.unit_work_id) ?? 0, effort: null,
  }));
}
