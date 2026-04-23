/**
 * dbTableUsage — DB 테이블 매핑 인사이트(Usage) 집계 유틸
 *
 * 역할:
 *   - countTableFunctionUsage():  테이블 목록에 표시할 "기능 연결수" 배치 집계
 *   - getTableUsageDetail():       테이블 상세의 "사용 현황" 카드/리스트/컬럼별 사용도 계산
 *
 * 설계 의도:
 *   - tb_ds_col_mapping 은 col_id 로만 DB 컬럼을 참조 (테이블 직접 참조 아님).
 *     따라서 tbl_id 기준 집계를 위해 col_id → tbl_id 매핑을 먼저 만든 뒤 조인한다.
 *   - ref_ty_code 는 FUNCTION | AREA | SCREEN 세 종류 (확장 여지 있음).
 *     세 종류 모두 이름이 다른 테이블에 있으므로 각각 배치 조회 후 in-memory 로 붙인다.
 *   - N+1 방지: 모든 참조는 findMany({ in: [...] }) 로 한 번만 조회한다.
 *
 * 성능 참고:
 *   - 카운트 함수는 프로젝트 전체 컬럼/매핑을 가져오므로, 대형 프로젝트에서는
 *     raw SQL group by 로 최적화 여지가 있다. 현재는 가독성 우선.
 */

import { prisma } from "./prisma";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type RefIoProfile = { in: number; out: number; inout: number };

export type TableUsedBy = {
  refType:   "FUNCTION" | "AREA" | "SCREEN" | string;
  refId:     string;
  refName:   string;              // 이름 없으면 "(이름 없음)"
  scrnId:    string | null;        // 소속 화면 (드릴다운용)
  scrnNm:    string | null;
  areaId:    string | null;        // 소속 영역 (FUNCTION일 때만 의미 있음)
  areaNm:    string | null;
  ioProfile: RefIoProfile;         // 이 참조가 이 테이블을 어떻게 쓰는가
  colCount:  number;                // 이 참조가 이 테이블에서 쓰는 컬럼 수 (distinct)
};

export type ColumnUsageStat = { in: number; out: number; inout: number; total: number };

export type TableUsageDetail = {
  summary: {
    functionCount: number;          // distinct function 수
    areaCount:     number;
    screenCount:   number;
    usedColCount:  number;          // 매핑된 적이 있는 컬럼 수
    totalColCount: number;
    /**
     * 테이블 전체 IO 카운트 (Phase 3).
     *   · 중복 매핑이 있어도 모두 합산 (ref 단위가 아닌 mapping 단위)
     *   · IO 스택 바 차트 그리는 용도
     */
    ioTotals:      { in: number; out: number; inout: number };
    /**
     * 이 테이블 대상 매핑 중 가장 최근 creat_dt (ISO 문자열).
     *   · 매핑이 없으면 null
     *   · 상세 페이지의 "마지막 사용" 요약 카드에 사용
     */
    lastUsedDt:    string | null;
  };
  usedBy:      TableUsedBy[];
  columnUsage: Record<string, ColumnUsageStat>; // key = col_id
};

// ── 목록용: 테이블별 인사이트 배치 집계 ─────────────────────────────────────

/**
 * IO 프로필 분류 (Phase 2).
 *   - NONE:        매핑 자체가 없음 (아직 쓰이지 않는 테이블)
 *   - READ_HEAVY:  OUTPUT 비율이 전체의 65% 이상 — 조회 위주
 *   - WRITE_HEAVY: INPUT + INOUT 비율이 65% 이상 — 저장/수정 위주
 *   - MIXED:       그 외 (양쪽이 비슷한 비율)
 *
 * 임계값 65% 는 경험칙. 필요 시 상수 튜닝.
 */
export type IoProfile = "NONE" | "READ_HEAVY" | "WRITE_HEAVY" | "MIXED";

const IO_PROFILE_THRESHOLD = 0.65;

function classifyIoProfile(io: { in: number; out: number; inout: number }): IoProfile {
  const total = io.in + io.out + io.inout;
  if (total === 0) return "NONE";
  const readRatio  = io.out / total;                // OUTPUT = 조회
  const writeRatio = (io.in + io.inout) / total;    // INPUT/INOUT = 저장·수정
  if (readRatio  >= IO_PROFILE_THRESHOLD) return "READ_HEAVY";
  if (writeRatio >= IO_PROFILE_THRESHOLD) return "WRITE_HEAVY";
  return "MIXED";
}

export type TableInsight = {
  functionCount: number;
  usedColCount:  number; // distinct col_id 중 매핑 존재한 것
  ioProfile:     IoProfile;
  /**
   * 마지막 사용일 (Phase 3, ISO 8601 문자열).
   *   = 이 테이블의 컬럼을 가리키는 매핑 중 가장 최근 creat_dt
   *   · 매핑이 하나도 없으면 null
   *   · col-mappings API 가 교체식(delete-all + insert) 이라 "가장 최근에 매핑이 저장된 시점" 의미
   *   · 데드 테이블(오래됨) 판별에 활용
   */
  lastUsedDt:    string | null;
};

/**
 * 프로젝트의 모든 테이블에 대해 목록 화면용 인사이트를 배치 집계한다.
 *
 * 반환: Map<tblId, TableInsight>
 *   - Map 에 없는 테이블은 "매핑 전혀 없음" 으로 간주 (functionCount 0, ioProfile NONE, usedColCount 0)
 *
 * 쿼리 2회 + 단일 순회:
 *   1) 프로젝트 내 모든 컬럼 (col_id → tbl_id)
 *   2) 해당 col_id 를 참조하는 모든 매핑 (ref_ty_code 무관 — IO 집계엔 전체 필요)
 */
export async function getTableListInsights(projectId: string): Promise<Map<string, TableInsight>> {
  // 1단계: 프로젝트 범위 내 모든 컬럼의 (col_id → tbl_id) 맵
  const cols = await prisma.tbDsDbTableColumn.findMany({
    where:  { table: { prjct_id: projectId } },
    select: { col_id: true, tbl_id: true },
  });
  if (cols.length === 0) return new Map();

  const colToTbl = new Map(cols.map((c) => [c.col_id, c.tbl_id]));

  // 2단계: 이 프로젝트 컬럼들을 참조하는 모든 매핑
  //        (IO 집계를 위해 ref_ty_code 상관없이 전부 가져온다.
  //         creat_dt 도 포함해서 "마지막 사용일" 을 함께 집계)
  const mappings = await prisma.tbDsColMapping.findMany({
    where: { col_id: { in: [...colToTbl.keys()] } },
    select: {
      ref_ty_code: true, ref_id: true, col_id: true,
      io_se_code: true, creat_dt: true,
    },
  });

  // 3단계: 테이블별 집계 — 기능 set, 사용 컬럼 set, IO 카운트, 최신 매핑 시각
  type Agg = {
    functions:   Set<string>;                     // distinct FUNCTION ref_id
    usedCols:    Set<string>;                     // distinct 매핑된 col_id
    io:          { in: number; out: number; inout: number };
    lastUsedDt:  Date | null;                     // max(creat_dt)
  };
  const agg = new Map<string, Agg>();

  for (const m of mappings) {
    if (!m.col_id) continue;
    const tblId = colToTbl.get(m.col_id);
    if (!tblId) continue;

    let a = agg.get(tblId);
    if (!a) {
      a = { functions: new Set(), usedCols: new Set(), io: { in: 0, out: 0, inout: 0 }, lastUsedDt: null };
      agg.set(tblId, a);
    }
    if (m.ref_ty_code === "FUNCTION") a.functions.add(m.ref_id);
    a.usedCols.add(m.col_id);
    if      (m.io_se_code === "INPUT")  a.io.in++;
    else if (m.io_se_code === "OUTPUT") a.io.out++;
    else if (m.io_se_code === "INOUT")  a.io.inout++;

    // 최신 매핑 시각 유지 — creat_dt 가 null 인 레코드는 건너뜀
    if (m.creat_dt && (!a.lastUsedDt || m.creat_dt > a.lastUsedDt)) {
      a.lastUsedDt = m.creat_dt;
    }
  }

  // 4단계: Map 변환 + IO 프로필 분류
  const result = new Map<string, TableInsight>();
  for (const [tblId, a] of agg) {
    result.set(tblId, {
      functionCount: a.functions.size,
      usedColCount:  a.usedCols.size,
      ioProfile:     classifyIoProfile(a.io),
      lastUsedDt:    a.lastUsedDt ? a.lastUsedDt.toISOString() : null,
    });
  }
  return result;
}

/**
 * @deprecated Phase 2 부터는 getTableListInsights() 사용.
 *   목록 API 가 functionCount 외에 IO/커버리지까지 필요해지면서 한 번에 집계하도록 통합됨.
 *   기존 호출부(목록 API) 만 정리하면 이 함수는 제거 가능.
 */
export async function countTableFunctionUsage(projectId: string): Promise<Map<string, number>> {
  const insights = await getTableListInsights(projectId);
  const m = new Map<string, number>();
  for (const [tblId, ins] of insights) m.set(tblId, ins.functionCount);
  return m;
}

// ── 공용 내부 헬퍼: ref 이름/계층 배치 조회 ─────────────────────────────────

type FuncRefInfo = { name: string; areaId: string | null; areaNm: string | null; scrnId: string | null; scrnNm: string | null };
type AreaRefInfo = { name: string; scrnId: string | null; scrnNm: string | null };
type ScrnRefInfo = { name: string };

export type RefNameMaps = {
  funcMap: Map<string, FuncRefInfo>;
  areaMap: Map<string, AreaRefInfo>;
  scrnMap: Map<string, ScrnRefInfo>;
};

/**
 * ref_ty_code 별로 모은 id 집합에서 이름/계층(Screen > Area > Function) 을 배치 조회한다.
 *
 *   · 두 공개 함수(getTableUsageDetail, getColumnUsageDetail) 가 동일한 로직을 갖고 있어
 *     한 군데로 추출. 각 도메인 테이블은 최대 1회씩만 조회됨 (N+1 없음).
 *   · 비어있는 type 은 쿼리 자체를 스킵하여 불필요한 DB 왕복 방지.
 *
 * 반환:
 *   · 호출자가 m.ref_ty_code 에 따라 funcMap/areaMap/scrnMap 을 선택해서 이름을 조립한다.
 */
async function fetchRefNames(refsByType: Record<string, Set<string>>): Promise<RefNameMaps> {
  const funcMap = new Map<string, FuncRefInfo>();
  const areaMap = new Map<string, AreaRefInfo>();
  const scrnMap = new Map<string, ScrnRefInfo>();

  // FUNCTION → area → screen 까지 include 한 번에
  if (refsByType.FUNCTION && refsByType.FUNCTION.size > 0) {
    const funcs = await prisma.tbDsFunction.findMany({
      where:  { func_id: { in: [...refsByType.FUNCTION] } },
      select: {
        func_id: true, func_nm: true,
        area: {
          select: {
            area_id: true, area_nm: true,
            screen: { select: { scrn_id: true, scrn_nm: true } },
          },
        },
      },
    });
    for (const f of funcs) {
      funcMap.set(f.func_id, {
        name:   f.func_nm || "(이름 없음)",
        areaId: f.area?.area_id ?? null,
        areaNm: f.area?.area_nm ?? null,
        scrnId: f.area?.screen?.scrn_id ?? null,
        scrnNm: f.area?.screen?.scrn_nm ?? null,
      });
    }
  }

  if (refsByType.AREA && refsByType.AREA.size > 0) {
    const areas = await prisma.tbDsArea.findMany({
      where:  { area_id: { in: [...refsByType.AREA] } },
      select: {
        area_id: true, area_nm: true,
        screen: { select: { scrn_id: true, scrn_nm: true } },
      },
    });
    for (const a of areas) {
      areaMap.set(a.area_id, {
        name:   a.area_nm || "(이름 없음)",
        scrnId: a.screen?.scrn_id ?? null,
        scrnNm: a.screen?.scrn_nm ?? null,
      });
    }
  }

  if (refsByType.SCREEN && refsByType.SCREEN.size > 0) {
    const scrns = await prisma.tbDsScreen.findMany({
      where:  { scrn_id: { in: [...refsByType.SCREEN] } },
      select: { scrn_id: true, scrn_nm: true },
    });
    for (const s of scrns) {
      scrnMap.set(s.scrn_id, { name: s.scrn_nm || "(이름 없음)" });
    }
  }

  return { funcMap, areaMap, scrnMap };
}

// ── 컬럼 단위 드릴다운 ───────────────────────────────────────────────────────

export type ColumnUsageItem = {
  mappingId:  string;
  ioSeCode:   "INPUT" | "OUTPUT" | "INOUT" | "";
  refType:    "FUNCTION" | "AREA" | "SCREEN" | string;
  refId:      string;
  refName:    string;
  scrnId:     string | null;
  scrnNm:     string | null;
  areaId:     string | null;
  areaNm:     string | null;
  usePurpsCn: string;           // 기능이 이 컬럼을 "어떤 항목으로" 쓰는지 (ColMappingDialog 의 항목명)
};

export type ColumnUsageDetail = {
  column: { colId: string; colPhysclNm: string; colLgclNm: string };
  items:  ColumnUsageItem[];
};

/**
 * 단일 컬럼의 사용처 상세를 반환한다 (드릴다운 팝업용).
 *   · 매핑을 (io_se_code, 계층 정렬) 로 정렬한다
 *   · 기능/영역/화면 이름은 배치 조회로 붙임
 */
export async function getColumnUsageDetail(
  projectId: string,
  tblId:     string,
  colId:     string,
): Promise<ColumnUsageDetail | null> {
  // 1) 대상 컬럼 자체 (존재/소속 검증 + 컬럼명 반환용)
  const col = await prisma.tbDsDbTableColumn.findUnique({
    where:  { col_id: colId },
    select: {
      col_id: true, col_physcl_nm: true, col_lgcl_nm: true,
      table:  { select: { tbl_id: true, prjct_id: true } },
    },
  });
  if (!col || col.table.tbl_id !== tblId || col.table.prjct_id !== projectId) {
    return null;
  }

  // 2) 이 컬럼을 참조하는 모든 매핑
  const mappings = await prisma.tbDsColMapping.findMany({
    where:   { col_id: colId },
    orderBy: { sort_ordr: "asc" },
    select: {
      mapping_id: true, ref_ty_code: true, ref_id: true,
      io_se_code: true, use_purps_cn: true,
    },
  });

  if (mappings.length === 0) {
    return {
      column: { colId, colPhysclNm: col.col_physcl_nm, colLgclNm: col.col_lgcl_nm ?? "" },
      items:  [],
    };
  }

  // 3) ref 이름/계층 배치 조회 — 공용 헬퍼로 위임
  const refsByType: Record<string, Set<string>> = {};
  for (const m of mappings) {
    if (!refsByType[m.ref_ty_code]) refsByType[m.ref_ty_code] = new Set<string>();
    refsByType[m.ref_ty_code].add(m.ref_id);
  }
  const { funcMap, areaMap, scrnMap } = await fetchRefNames(refsByType);

  // 4) items 변환 + IO → 계층 순 정렬
  const items: ColumnUsageItem[] = mappings.map((m) => {
    let refName = "(이름 없음)";
    let scrnId: string | null = null, scrnNm: string | null = null;
    let areaId: string | null = null, areaNm: string | null = null;

    if (m.ref_ty_code === "FUNCTION") {
      const f = funcMap.get(m.ref_id);
      if (f) { refName = f.name; scrnId = f.scrnId; scrnNm = f.scrnNm; areaId = f.areaId; areaNm = f.areaNm; }
    } else if (m.ref_ty_code === "AREA") {
      const ar = areaMap.get(m.ref_id);
      if (ar) { refName = ar.name; scrnId = ar.scrnId; scrnNm = ar.scrnNm; }
    } else if (m.ref_ty_code === "SCREEN") {
      const s = scrnMap.get(m.ref_id);
      if (s) { refName = s.name; scrnId = m.ref_id; scrnNm = s.name; }
    }

    const io = m.io_se_code as "INPUT" | "OUTPUT" | "INOUT" | null;
    return {
      mappingId:  m.mapping_id,
      ioSeCode:   io ?? "",
      refType:    m.ref_ty_code,
      refId:      m.ref_id,
      refName,
      scrnId, scrnNm, areaId, areaNm,
      usePurpsCn: m.use_purps_cn ?? "",
    };
  });

  // IO 순 (IN → OUT → INOUT → 미지정) 후 화면·영역·이름 순
  const IO_ORDER: Record<string, number> = { INPUT: 0, OUTPUT: 1, INOUT: 2, "": 3 };
  items.sort((x, y) => {
    const io = (IO_ORDER[x.ioSeCode] ?? 9) - (IO_ORDER[y.ioSeCode] ?? 9);
    if (io !== 0) return io;
    const sx = x.scrnNm ?? "~"; const sy = y.scrnNm ?? "~";
    if (sx !== sy) return sx.localeCompare(sy, "ko");
    const ax = x.areaNm ?? "~"; const ay = y.areaNm ?? "~";
    if (ax !== ay) return ax.localeCompare(ay, "ko");
    return x.refName.localeCompare(y.refName, "ko");
  });

  return {
    column: { colId, colPhysclNm: col.col_physcl_nm, colLgclNm: col.col_lgcl_nm ?? "" },
    items,
  };
}

// ── 상세용: 단일 테이블 사용 현황 ────────────────────────────────────────────

/**
 * 특정 테이블의 사용 현황 상세를 반환한다.
 *
 * 반환 구조:
 *   - summary:     카드로 표시할 집계 수치
 *   - usedBy:      이 테이블을 참조하는 FUNCTION/AREA/SCREEN 리스트 (계층 이름 포함)
 *   - columnUsage: 컬럼별 사용 통계 (미사용 컬럼은 key 가 없음)
 *
 * 쿼리 3~6회 (컬럼 / 매핑 / FUNCTION / AREA / SCREEN / — ref_ty_code 별 필요 시만).
 */
export async function getTableUsageDetail(
  projectId: string,
  tblId:     string,
): Promise<TableUsageDetail> {
  // 1단계: 이 테이블의 모든 컬럼 id 목록
  const cols = await prisma.tbDsDbTableColumn.findMany({
    where:  { tbl_id: tblId, table: { prjct_id: projectId } },
    select: { col_id: true },
  });
  const colIds = cols.map((c) => c.col_id);

  // 컬럼이 없거나(신규 테이블) 매핑도 없는 조기 종료 처리
  const EMPTY_IO = { in: 0, out: 0, inout: 0 };
  if (colIds.length === 0) {
    return {
      summary: {
        functionCount: 0, areaCount: 0, screenCount: 0,
        usedColCount: 0, totalColCount: 0,
        ioTotals: { ...EMPTY_IO },
        lastUsedDt: null,
      },
      usedBy:      [],
      columnUsage: {},
    };
  }

  // 2단계: 이 컬럼들을 참조하는 모든 매핑 (ref_ty_code 무관)
  //         creat_dt 도 함께 가져와 "마지막 사용일" 집계
  const mappings = await prisma.tbDsColMapping.findMany({
    where:  { col_id: { in: colIds } },
    select: {
      ref_ty_code: true, ref_id: true, col_id: true,
      io_se_code: true, creat_dt: true,
    },
  });

  if (mappings.length === 0) {
    return {
      summary: {
        functionCount: 0, areaCount: 0, screenCount: 0,
        usedColCount: 0, totalColCount: colIds.length,
        ioTotals: { ...EMPTY_IO },
        lastUsedDt: null,
      },
      usedBy:      [],
      columnUsage: {},
    };
  }

  // 3단계: ref_ty_code 별로 필요한 id 집합을 먼저 모은 뒤 이름/계층을 배치 조회
  const refsByType: Record<string, Set<string>> = {};
  for (const m of mappings) {
    const k = m.ref_ty_code;
    if (!refsByType[k]) refsByType[k] = new Set<string>();
    refsByType[k].add(m.ref_id);
  }
  const { funcMap, areaMap, scrnMap } = await fetchRefNames(refsByType);

  // 4단계: 한 번의 순회로 다음 4가지를 동시 누적
  //   (1) ref 그룹 집계 (usedBy 리스트 재료)
  //   (2) 컬럼별 사용 집계 (columnUsage)
  //   (3) 테이블 전체 IO totals (스택 바 차트용)
  //   (4) 최신 매핑 시각 (lastUsedDt)
  type RefAgg = {
    refType: string; refId: string;
    ioIn:    number; ioOut: number; ioInout: number;
    cols:    Set<string>;
  };
  const refAgg      = new Map<string, RefAgg>();
  const columnUsage: Record<string, ColumnUsageStat> = {};
  const ioTotals    = { in: 0, out: 0, inout: 0 };
  let   lastUsedDt: Date | null = null;

  for (const m of mappings) {
    if (!m.col_id) continue;

    // (1) ref 그룹 집계 (key = type::id)
    const key = `${m.ref_ty_code}::${m.ref_id}`;
    let agg   = refAgg.get(key);
    if (!agg) {
      agg = { refType: m.ref_ty_code, refId: m.ref_id, ioIn: 0, ioOut: 0, ioInout: 0, cols: new Set<string>() };
      refAgg.set(key, agg);
    }
    agg.cols.add(m.col_id);
    if      (m.io_se_code === "INPUT")  agg.ioIn++;
    else if (m.io_se_code === "OUTPUT") agg.ioOut++;
    else if (m.io_se_code === "INOUT")  agg.ioInout++;

    // (2) 컬럼별 사용 집계
    const stat = columnUsage[m.col_id] ?? (columnUsage[m.col_id] = { in: 0, out: 0, inout: 0, total: 0 });
    stat.total++;
    if      (m.io_se_code === "INPUT")  stat.in++;
    else if (m.io_se_code === "OUTPUT") stat.out++;
    else if (m.io_se_code === "INOUT")  stat.inout++;

    // (3) 테이블 전체 IO totals
    if      (m.io_se_code === "INPUT")  ioTotals.in++;
    else if (m.io_se_code === "OUTPUT") ioTotals.out++;
    else if (m.io_se_code === "INOUT")  ioTotals.inout++;

    // (4) 최신 매핑 시각
    if (m.creat_dt && (!lastUsedDt || m.creat_dt > lastUsedDt)) {
      lastUsedDt = m.creat_dt;
    }
  }

  // 5단계: usedBy 리스트 변환 — ref 이름/계층 붙이기
  const usedBy: TableUsedBy[] = [...refAgg.values()].map((a) => {
    let refName = "(이름 없음)";
    let scrnId: string | null = null, scrnNm: string | null = null;
    let areaId: string | null = null, areaNm: string | null = null;

    if (a.refType === "FUNCTION") {
      const f = funcMap.get(a.refId);
      if (f) { refName = f.name; scrnId = f.scrnId; scrnNm = f.scrnNm; areaId = f.areaId; areaNm = f.areaNm; }
    } else if (a.refType === "AREA") {
      const ar = areaMap.get(a.refId);
      if (ar) { refName = ar.name; scrnId = ar.scrnId; scrnNm = ar.scrnNm; }
    } else if (a.refType === "SCREEN") {
      const s = scrnMap.get(a.refId);
      // SCREEN 참조는 scrnId == refId 로 통일 (자기 자신)
      if (s) { refName = s.name; scrnId = a.refId; scrnNm = s.name; }
    }

    return {
      refType:   a.refType,
      refId:     a.refId,
      refName,
      scrnId, scrnNm, areaId, areaNm,
      ioProfile: { in: a.ioIn, out: a.ioOut, inout: a.ioInout },
      colCount:  a.cols.size,
    };
  });

  // 정렬: 화면 → 영역 → 이름 (사용자가 UI 계층 순서로 읽을 수 있도록)
  // null 값은 "~" 로 치환해서 항상 뒤로 가게 함 (tilde는 문자열 정렬에서 후순위)
  usedBy.sort((x, y) => {
    const sx = x.scrnNm ?? "~"; const sy = y.scrnNm ?? "~";
    if (sx !== sy) return sx.localeCompare(sy, "ko");
    const ax = x.areaNm ?? "~"; const ay = y.areaNm ?? "~";
    if (ax !== ay) return ax.localeCompare(ay, "ko");
    return x.refName.localeCompare(y.refName, "ko");
  });

  // 6단계: 요약 집계 (Phase 3 — ioTotals, lastUsedDt 포함)
  const functionCount = refsByType.FUNCTION?.size ?? 0;
  const areaCount     = refsByType.AREA?.size     ?? 0;
  const screenCount   = refsByType.SCREEN?.size   ?? 0;
  const usedColCount  = Object.keys(columnUsage).length;

  return {
    summary: {
      functionCount, areaCount, screenCount,
      usedColCount, totalColCount: colIds.length,
      ioTotals,
      lastUsedDt: lastUsedDt ? (lastUsedDt as Date).toISOString() : null,
    },
    usedBy,
    columnUsage,
  };
}
