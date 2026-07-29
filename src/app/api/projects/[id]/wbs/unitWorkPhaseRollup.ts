/**
 * unitWorkPhaseRollup.ts — 단위업무의 WBS 기간·진척률을 phase(설계/구현)별로 롤업
 *
 * 2026-07-28 2차 개편: 설계 일정(plan_dsgn_bgng_de/end_de)은 화면이 여러 개인 단위업무에서
 * 화면마다 따로 잡기엔 부담이라는 판단으로 단위업무 자신의 컬럼으로만 관리하게 됐다 —
 * 그래서 DESIGN phase는 더 이상 하위 화면을 MIN/MAX 롤업할 필요 없이 단위업무 자신의
 * 값을 그대로 쓴다(예전엔 화면 기준이었음). IMPL phase는 여전히 화면 단위(actl_impl_*)를
 * MIN/MAX 롤업 — 구현은 화면마다 개별 배정되는 게 자연스러워 화면 기준을 유지.
 *
 * 진척률(%)은 두 phase 모두 lib/pm/progressRollup.ts의 공용 함수(기능 롤업)를 그대로 쓴다.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchUnitWorkProgress } from "@/lib/pm/progressRollup";
import type { ProgressKind } from "@/types/pm";

export type UnitWorkPhaseRollup = {
  start:    string | null;
  end:      string | null;
  progress: number;
};

type DateRow = {
  unit_work_id: string;
  min_start:    string | null;
  max_end:      string | null;
};

export async function fetchUnitWorkPhaseRollup(
  unitWorkIds: string[],
  phase: ProgressKind,
): Promise<Map<string, UnitWorkPhaseRollup>> {
  if (unitWorkIds.length === 0) return new Map();

  const ids = Prisma.join(unitWorkIds);

  const [dateRows, progressMap] = await Promise.all([
    phase === "IMPL"
      ? prisma.$queryRaw<DateRow[]>`
          SELECT unit_work_id,
                 MIN(actl_impl_bgng_de) AS min_start,
                 MAX(actl_impl_end_de)  AS max_end
            FROM tb_ds_screen
           WHERE unit_work_id IN (${ids})
           GROUP BY unit_work_id
        `
      // 설계는 단위업무 자신의 계획설계기간을 그대로 씀 — 롤업(MIN/MAX)이 필요 없어 단순 SELECT.
      : prisma.$queryRaw<DateRow[]>`
          SELECT unit_work_id,
                 plan_dsgn_bgng_de AS min_start,
                 plan_dsgn_end_de  AS max_end
            FROM tb_ds_unit_work
           WHERE unit_work_id IN (${ids})
        `,
    fetchUnitWorkProgress(unitWorkIds),
  ]);

  return new Map(dateRows.map((r) => [r.unit_work_id, {
    start:    r.min_start ?? null,
    end:      r.max_end   ?? null,
    progress: phase === "IMPL"
      ? (progressMap.get(r.unit_work_id)?.implRt   ?? 0)
      : (progressMap.get(r.unit_work_id)?.designRt ?? 0),
  }]));
}
