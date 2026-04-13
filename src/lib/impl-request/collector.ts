/**
 * impl-request/collector — 4계층 설명 수집 + 이전 스냅샷 조회 + diff 계산
 *
 * 역할:
 *   - 진입점(단위업무/화면/영역/기능)에서 하위 기능까지 역추적·순회
 *   - 각 엔티티의 현재 _dc 내용 수집
 *   - tb_sp_impl_snapshot에서 이전 요청 시점 스냅샷 조회
 *   - 현재 vs 이전 해시 비교 → 변경 모드(NO_CHANGE/DIFF/FULL/REPLACE) 결정
 *
 * 주요 기술:
 *   - diff/normalizer: normalize + hashOf (정규화 + SHA256)
 *   - diff/differ: diffLines (변동 통계)
 *   - diff/strategist: decideMode (변동률 → 모드)
 */

import { prisma } from "@/lib/prisma";
import { hashOf } from "./diff/normalizer";
import { diffLines, type LineDiffStats } from "./diff/differ";
import { decideMode } from "./diff/strategist";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type LayerType = "unit_work" | "screen" | "area" | "function";

/** 테이블명 매핑 — 스냅샷 조회/저장 시 사용 */
export const TABLE_MAP: Record<LayerType, string> = {
  unit_work: "tb_ds_unit_work",
  screen:    "tb_ds_screen",
  area:      "tb_ds_area",
  function:  "tb_ds_function",
};

/** 계층별 변경 정보 (preview + build 모두에서 사용) */
export type LayerInfo = {
  type: LayerType;
  id: string;
  displayId: string;
  name: string;
  currentDc: string;          // 현재 _dc 내용
  previousDc: string | null;  // 이전 스냅샷 _dc (없으면 null = 최초)
  currentHash: string;
  previousHash: string | null;
  mode: string;               // NO_CHANGE | DIFF | FULL | REPLACE
  lineRatio: number;
  stats: LineDiffStats;
  hasSnapshot: boolean;       // 이전 스냅샷 존재 여부
};

// ── 4계층 수집 ───────────────────────────────────────────────────────────────

/**
 * 진입점 기준으로 4계층 정보를 수집하고 diff 계산 결과를 반환
 *
 * @param entryType 진입점 계층
 * @param entryId 진입점 엔티티 ID
 * @param functionIds 선택된 기능 ID 목록 (없으면 전체)
 * @returns 계층별 LayerInfo 배열 (단위업무 → 화면 → 영역 → 기능 순서)
 */
export async function collectLayers(
  entryType: string,
  entryId: string,
  functionIds?: string[],
  projectId?: string
): Promise<LayerInfo[]> {
  const layers: LayerInfo[] = [];

  if (entryType === "FUNCTION") {
    // 기능 1건 → 상위 역추적
    const fn = await prisma.tbDsFunction.findUnique({
      where: { func_id: entryId },
      include: {
        area: {
          include: {
            screen: {
              include: { unitWork: true },
            },
          },
        },
      },
    });
    if (!fn || !fn.area?.screen?.unitWork) return [];
    // 프로젝트 스코프 검증
    if (projectId && fn.area.screen.unitWork.prjct_id !== projectId) return [];

    const uw = fn.area.screen.unitWork;
    const scr = fn.area.screen;
    const area = fn.area;

    layers.push(await buildLayerInfo("unit_work", uw.unit_work_id, uw.unit_work_display_id, uw.unit_work_nm, uw.unit_work_dc ?? ""));
    layers.push(await buildLayerInfo("screen", scr.scrn_id, scr.scrn_display_id, scr.scrn_nm, scr.scrn_dc ?? ""));
    layers.push(await buildLayerInfo("area", area.area_id, area.area_display_id, area.area_nm, area.area_dc ?? ""));
    layers.push(await buildLayerInfo("function", fn.func_id, fn.func_display_id, fn.func_nm, fn.func_dc ?? ""));

  } else if (entryType === "AREA") {
    // 영역 → 상위 역추적 + 하위 기능 순회
    const area = await prisma.tbDsArea.findUnique({
      where: { area_id: entryId },
      include: {
        screen: { include: { unitWork: true } },
        functions: true,
      },
    });
    if (!area || !area.screen?.unitWork) return [];
    if (projectId && area.screen.unitWork.prjct_id !== projectId) return [];

    const uw = area.screen.unitWork;
    const scr = area.screen;

    layers.push(await buildLayerInfo("unit_work", uw.unit_work_id, uw.unit_work_display_id, uw.unit_work_nm, uw.unit_work_dc ?? ""));
    layers.push(await buildLayerInfo("screen", scr.scrn_id, scr.scrn_display_id, scr.scrn_nm, scr.scrn_dc ?? ""));
    layers.push(await buildLayerInfo("area", area.area_id, area.area_display_id, area.area_nm, area.area_dc ?? ""));

    // 기능 — 선택된 것만 또는 전체 (병렬 처리)
    const fns = functionIds?.length
      ? area.functions.filter((f) => functionIds.includes(f.func_id))
      : area.functions;
    const fnLayers = await Promise.all(
      fns.map((fn) => buildLayerInfo("function", fn.func_id, fn.func_display_id, fn.func_nm, fn.func_dc ?? ""))
    );
    layers.push(...fnLayers);

  } else if (entryType === "SCREEN") {
    // 화면 → 상위 역추적 + 하위 영역·기능 순회
    const scr = await prisma.tbDsScreen.findUnique({
      where: { scrn_id: entryId },
      include: {
        unitWork: true,
        areas: { include: { functions: true } },
      },
    });
    if (!scr || !scr.unitWork) return [];
    if (projectId && scr.unitWork.prjct_id !== projectId) return [];

    layers.push(await buildLayerInfo("unit_work", scr.unitWork.unit_work_id, scr.unitWork.unit_work_display_id, scr.unitWork.unit_work_nm, scr.unitWork.unit_work_dc ?? ""));
    layers.push(await buildLayerInfo("screen", scr.scrn_id, scr.scrn_display_id, scr.scrn_nm, scr.scrn_dc ?? ""));

    for (const area of scr.areas) {
      layers.push(await buildLayerInfo("area", area.area_id, area.area_display_id, area.area_nm, area.area_dc ?? ""));
      const fns = functionIds?.length
        ? area.functions.filter((f) => functionIds.includes(f.func_id))
        : area.functions;
      const fnLayers = await Promise.all(
        fns.map((fn) => buildLayerInfo("function", fn.func_id, fn.func_display_id, fn.func_nm, fn.func_dc ?? ""))
      );
      layers.push(...fnLayers);
    }

  } else if (entryType === "UNIT_WORK") {
    // 단위업무 → 하위 전체 순회
    const uw = await prisma.tbDsUnitWork.findUnique({
      where: { unit_work_id: entryId },
      include: {
        screens: {
          include: {
            areas: { include: { functions: true } },
          },
        },
      },
    });
    if (!uw) return [];
    if (projectId && uw.prjct_id !== projectId) return [];

    layers.push(await buildLayerInfo("unit_work", uw.unit_work_id, uw.unit_work_display_id, uw.unit_work_nm, uw.unit_work_dc ?? ""));

    for (const scr of uw.screens) {
      layers.push(await buildLayerInfo("screen", scr.scrn_id, scr.scrn_display_id, scr.scrn_nm, scr.scrn_dc ?? ""));
      for (const area of scr.areas) {
        layers.push(await buildLayerInfo("area", area.area_id, area.area_display_id, area.area_nm, area.area_dc ?? ""));
        const fns = functionIds?.length
          ? area.functions.filter((f) => functionIds.includes(f.func_id))
          : area.functions;
        const fnLayers = await Promise.all(
          fns.map((fn) => buildLayerInfo("function", fn.func_id, fn.func_display_id, fn.func_nm, fn.func_dc ?? ""))
        );
        layers.push(...fnLayers);
      }
    }
  }

  return layers;
}

// ── 내부 함수 ────────────────────────────────────────────────────────────────

/**
 * 단일 엔티티의 LayerInfo 구성
 * - 현재 내용 해시 계산
 * - 이전 스냅샷 조회
 * - diff 통계 + 모드 결정
 */
async function buildLayerInfo(
  type: LayerType,
  id: string,
  displayId: string,
  name: string,
  currentDc: string
): Promise<LayerInfo> {
  const { hash: currentHash } = hashOf(currentDc);

  // 이전 스냅샷 조회
  const prevSnapshot = await prisma.tbSpImplSnapshot.findFirst({
    where: { ref_tbl_nm: TABLE_MAP[type], ref_id: id },
    orderBy: { creat_dt: "desc" },
    select: { content_hash: true, raw_cn: true },
  });

  const previousDc = prevSnapshot?.raw_cn ?? null;
  const previousHash = prevSnapshot?.content_hash?.trim() ?? null;
  const hasSnapshot = !!prevSnapshot;

  // diff 계산
  const hashChanged = !previousHash || previousHash !== currentHash;
  const stats = diffLines(previousDc ?? "", currentDc);
  const mode = decideMode(stats, hashChanged);

  return {
    type,
    id,
    displayId,
    name,
    currentDc,
    previousDc,
    currentHash,
    previousHash,
    mode,
    lineRatio: stats.lineRatio,
    stats,
    hasSnapshot,
  };
}
