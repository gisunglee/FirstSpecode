/**
 * unitWorkPhaseRollup.ts — 단위업무의 WBS 기간·진척률을 phase(설계/구현)별로 롤업
 *
 * 단위업무 자신의 bgng_de/end_de, progrs_rt는 하위 화면/기능의 실제 진행 상황과
 * 무관하게 관리되는 값(progrs_rt는 사람이 직접 입력)이라 WBS에서는 아예 안 쓴다.
 * 대신 fetchDeadlineItems.ts의 UNIT_WORK 브랜치와 같은 조인(기능→영역→화면, unit_work_id로
 * GROUP BY)을 참고하되, 진척률뿐 아니라 기간까지 함께 롤업한다(fetchDeadlineItems는 진척률만
 * 롤업하고 기간은 단위업무 자체 컬럼을 그대로 쓰기 때문에 이 용도로는 재사용할 수 없음 —
 * 그래서 별도 파일로 둠, PM 히트맵 등 다른 화면에 영향 없이).
 *
 * - 설계(DESIGN): 화면의 design_bgng_de/design_end_de 최소~최대 + 기능 design_rt 평균
 * - 구현(IMPL)  : 기능의 impl_bgng_de/impl_end_de 최소~최대 + 기능 impl_rt 평균
 *
 * DESIGN phase의 기간과 진척률은 하나의 조인 쿼리로 합칠 수 없어 쿼리를 분리했다 —
 * "함수가 하나도 없는 화면"이 있으면(JOIN tb_ds_function으로 함수를 거쳐야만 화면 행이
 * 나오는 구조라) 그 화면의 설계 일정이 통째로 롤업에서 빠져버리는 문제가 있었다(실측
 * 확인함). 사용자 지시("화면의 가장 작은 설계 시작일과 가장 큰 종료일")는 함수 존재
 * 여부와 무관하게 화면 자체 기준이라, 기간은 화면 테이블에서 직접(함수 조인 없이) 롤업하고
 * 진척률만 기능 조인으로 따로 계산한다. IMPL phase는 기간·진척률 둘 다 애초에 기능
 * 레벨 값이라 조인 하나로 충분(화면에 함수가 없으면 그 화면은 자연히 기여할 값이 없다 —
 * 맞는 동작).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

type ProgressRow = {
  unit_work_id: string;
  avg_rt:       number;
};

type CombinedRow = DateRow & { avg_rt: number };

export async function fetchUnitWorkPhaseRollup(
  unitWorkIds: string[],
  phase: ProgressKind,
): Promise<Map<string, UnitWorkPhaseRollup>> {
  if (unitWorkIds.length === 0) return new Map();

  const ids = Prisma.join(unitWorkIds);

  // AVG(p.design_rt)는 tb_cm_progress 행이 아예 없는 기능(LEFT JOIN → NULL)을 "0점"이
  // 아니라 평균 계산에서 통째로 제외해버린다(SQL의 AVG는 NULL을 무시) — COALESCE(AVG(...),0)은
  // 전체 결과가 NULL일 때만 방어할 뿐, 개별 NULL 행은 막지 못해 평균이 부풀려진다.
  // 진척률 기록이 아예 없는 기능은 0%로 취급해야(다른 곳의 `?? 0` 폴백과 동일한 의미) 하므로
  // AVG 안에서 먼저 COALESCE(p.design_rt, 0)로 개별 행을 0으로 채운 뒤 평균낸다.
  if (phase === "IMPL") {
    const rows = await prisma.$queryRaw<CombinedRow[]>`
      SELECT s.unit_work_id,
             MIN(f.impl_bgng_de) AS min_start,
             MAX(f.impl_end_de)  AS max_end,
             COALESCE(AVG(COALESCE(p.impl_rt, 0)), 0) AS avg_rt
        FROM tb_ds_screen s
        JOIN tb_ds_area a ON a.scrn_id = s.scrn_id
        JOIN tb_ds_function f ON f.area_id = a.area_id
        LEFT JOIN tb_cm_progress p
          ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
       WHERE s.unit_work_id IN (${ids})
       GROUP BY s.unit_work_id
    `;
    return new Map(rows.map((r) => [r.unit_work_id, {
      start:    r.min_start ?? null,
      end:      r.max_end ?? null,
      progress: Math.round(Number(r.avg_rt)),
    }]));
  }

  // DESIGN — 기간은 화면 테이블에서 직접(함수 존재 여부와 무관하게), 진척률은 기능 조인으로 별도.
  const [dateRows, progressRows] = await Promise.all([
    prisma.$queryRaw<DateRow[]>`
      SELECT unit_work_id,
             MIN(design_bgng_de) AS min_start,
             MAX(design_end_de)  AS max_end
        FROM tb_ds_screen
       WHERE unit_work_id IN (${ids})
       GROUP BY unit_work_id
    `,
    prisma.$queryRaw<ProgressRow[]>`
      SELECT s.unit_work_id,
             COALESCE(AVG(COALESCE(p.design_rt, 0)), 0) AS avg_rt
        FROM tb_ds_screen s
        JOIN tb_ds_area a ON a.scrn_id = s.scrn_id
        JOIN tb_ds_function f ON f.area_id = a.area_id
        LEFT JOIN tb_cm_progress p
          ON p.ref_tbl_nm = 'tb_ds_function' AND p.ref_id = f.func_id
       WHERE s.unit_work_id IN (${ids})
       GROUP BY s.unit_work_id
    `,
  ]);

  const progressMap = new Map(progressRows.map((r) => [r.unit_work_id, Math.round(Number(r.avg_rt))]));

  return new Map(dateRows.map((r) => [r.unit_work_id, {
    start:    r.min_start ?? null,
    end:      r.max_end ?? null,
    progress: progressMap.get(r.unit_work_id) ?? 0,
  }]));
}
