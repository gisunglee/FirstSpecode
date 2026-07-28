/**
 * unitWorkPhaseRollup.ts — 단위업무의 WBS 기간·진척률을 phase(설계/구현)별로 롤업
 *
 * 단위업무 자신의 plan_dsgn_bgng_de/plan_dsgn_end_de 는 PM이 잡는 상위 계획치(목표)라
 * 하위 화면·기능의 실제 진행 상황과 무관하게 관리되는 값이고, WBS에서는 아예 안 쓴다.
 * 대신 화면의 실질설계/구현기간(actl_dsgn_ 계열 / actl_impl_ 계열)을 화면 단위로 MIN/MAX 롤업한다.
 *
 * 2026-07-28 스키마 개편으로 구현기간이 기능(함수)→화면으로 이동하면서, 예전에 이 파일과
 * fetchDeadlineItems.ts가 각자 구현했던 조인 로직 문제(함수가 없는 화면이 롤업에서
 * 통째로 빠지는 문제 등)가 자연히 해소됐다 — 설계·구현 기간 둘 다 이제 화면 테이블에서
 * 직접(함수 조인 없이) MIN/MAX만 하면 되고, 진척률(%)만 lib/pm/progressRollup.ts의
 * 공용 함수(기능 롤업)를 그대로 쓴다.
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
      : prisma.$queryRaw<DateRow[]>`
          SELECT unit_work_id,
                 MIN(actl_dsgn_bgng_de) AS min_start,
                 MAX(actl_dsgn_end_de)  AS max_end
            FROM tb_ds_screen
           WHERE unit_work_id IN (${ids})
           GROUP BY unit_work_id
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
