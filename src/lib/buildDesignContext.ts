/**
 * buildDesignContext — AI 점검용 <전체 설계서> XML 컨텍스트 빌더
 *
 * 역할:
 *   - 주어진 시작 레벨(refType)에서 계층 정보를 수집해 XML 반환
 *
 * refType별 수집 방향:
 *   - FUNCTION:  기능 → 영역 → 화면 → 단위업무 (bottom-up, 같은 영역 기능 전체)
 *   - AREA:      영역 → 화면 → 단위업무 (bottom-up, 영역 내 기능 전체)
 *   - SCREEN:    화면 → 단위업무 (bottom-up, 화면 내 영역+기능 전체)
 *   - UNIT_WORK: 단위업무 → 화면 → 영역 → 기능 (top-down, 전체 tree)
 */

import { prisma } from "@/lib/prisma";

// ── 반환 타입 ─────────────────────────────────────────────────────────────────

export type DesignContext = {
  /** <전체 설계서>...</전체 설계서> XML 문자열 */
  xml: string;
  /** 수집된 계층 요약 (로깅·디버그용) */
  summary: {
    unitWorkId:   string | null;
    unitWorkNm:   string | null;
    screenId:     string | null;
    screenNm:     string | null;
    areaId:       string | null;
    areaNm:       string | null;
    functionCount: number;
  };
};

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

export async function buildDesignContext(
  refType: "FUNCTION" | "AREA" | "SCREEN" | "UNIT_WORK",
  refId: string,
): Promise<DesignContext> {
  switch (refType) {
    case "FUNCTION":  return buildFromFunction(refId);
    case "AREA":      return buildFromArea(refId);
    case "SCREEN":    return buildFromScreen(refId);
    case "UNIT_WORK": return buildFromUnitWork(refId);
  }
}

// ── FUNCTION 기준 (현재 구현) ─────────────────────────────────────────────────
// 기능 → 영역 → 화면 → 단위업무 순으로 bottom-up 수집

async function buildFromFunction(functionId: string): Promise<DesignContext> {
  // 1. 현재 기능 조회
  const fn = await prisma.tbDsFunction.findUnique({
    where: { func_id: functionId },
  });

  const areaId = fn?.area_id ?? null;

  // area_id 없으면 기능 단독으로만 반환
  if (!areaId) {
    return {
      xml: "",
      summary: { unitWorkId: null, unitWorkNm: null, screenId: null, screenNm: null, areaId: null, areaNm: null, functionCount: 0 },
    };
  }

  return buildFromArea(areaId, functionId);
}

// ── AREA 기준 ─────────────────────────────────────────────────────────────────
// 영역 → 화면 → 단위업무 + 영역 내 전체 기능

async function buildFromArea(
  areaId: string,
  // 점검 대상 기능 ID (표시 시 구분용, 없으면 undefined)
  currentFunctionId?: string,
): Promise<DesignContext> {
  // 영역 + 하위 기능 전체 조회
  const area = await prisma.tbDsArea.findUnique({
    where: { area_id: areaId },
    include: {
      functions: {
        orderBy: { sort_ordr: "asc" },
      },
    },
  });

  const screenId = area?.scrn_id ?? null;

  // 화면 조회
  const screen = screenId
    ? await prisma.tbDsScreen.findUnique({ where: { scrn_id: screenId } })
    : null;

  const unitWorkId = screen?.unit_work_id ?? null;

  // 단위업무 조회
  const unitWork = unitWorkId
    ? await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } })
    : null;

  const functions = area?.functions ?? [];

  // ── XML 조립 ────────────────────────────────────────────────────────────────
  const lines: string[] = [];

  // 단위업무
  if (unitWork) {
    lines.push("[단위업무]");
    lines.push(`ID: ${unitWork.unit_work_display_id}`);
    lines.push(`명칭: ${unitWork.unit_work_nm}`);
    if (unitWork.unit_work_dc?.trim()) {
      lines.push(`설명: ${unitWork.unit_work_dc.trim()}`);
    }
    lines.push("");
  }

  // 화면
  if (screen) {
    lines.push("[화면]");
    lines.push(`ID: ${screen.scrn_display_id}`);
    lines.push(`명칭: ${screen.scrn_nm}`);
    if (screen.scrn_dc?.trim()) {
      lines.push(`설명: ${screen.scrn_dc.trim()}`);
    }
    lines.push("");
  }

  // 영역
  if (area) {
    lines.push("[영역]");
    lines.push(`ID: ${area.area_display_id}`);
    lines.push(`명칭: ${area.area_nm}`);
    if (area.area_dc?.trim()) {
      lines.push(`설명: ${area.area_dc.trim()}`);
    }
    lines.push("");
  }

  // 영역 내 기능 목록
  if (functions.length > 0) {
    const marker = currentFunctionId ? ` (총 ${functions.length}개, ★ 현재 점검 대상)` : ` (총 ${functions.length}개)`;
    lines.push(`[영역 내 기능 목록${marker}]`);

    for (const f of functions) {
      lines.push("---");
      const isCurrent = f.func_id === currentFunctionId;
      lines.push(`기능 ID: ${f.func_display_id}${isCurrent ? "  ★ 점검 대상" : ""}`);
      lines.push(`기능명: ${f.func_nm}`);
      if (f.func_dc?.trim()) {
        lines.push(`설명:`);
        lines.push(f.func_dc.trim());
      }
    }
    lines.push("---");
  }

  const xml = `<전체 설계서>\n${lines.join("\n")}\n</전체 설계서>`;

  return {
    xml,
    summary: {
      unitWorkId:    unitWork?.unit_work_id   ?? null,
      unitWorkNm:    unitWork?.unit_work_nm   ?? null,
      screenId:      screen?.scrn_id         ?? null,
      screenNm:      screen?.scrn_nm         ?? null,
      areaId:        area?.area_id           ?? null,
      areaNm:        area?.area_nm           ?? null,
      functionCount: functions.length,
    },
  };
}

// ── SCREEN 기준 (추후 확장용 skeleton) ────────────────────────────────────────
// 화면 → 단위업무 + 화면 내 전체 영역+기능

async function buildFromScreen(screenId: string): Promise<DesignContext> {
  const screen = await prisma.tbDsScreen.findUnique({
    where: { scrn_id: screenId },
    include: {
      areas: {
        orderBy: { sort_ordr: "asc" },
        include: {
          functions: { orderBy: { sort_ordr: "asc" } },
        },
      },
    },
  });

  const unitWorkId = screen?.unit_work_id ?? null;
  const unitWork   = unitWorkId
    ? await prisma.tbDsUnitWork.findUnique({ where: { unit_work_id: unitWorkId } })
    : null;

  const lines: string[] = [];

  if (unitWork) {
    lines.push("[단위업무]");
    lines.push(`ID: ${unitWork.unit_work_display_id}`);
    lines.push(`명칭: ${unitWork.unit_work_nm}`);
    if (unitWork.unit_work_dc?.trim()) lines.push(`설명: ${unitWork.unit_work_dc.trim()}`);
    lines.push("");
  }

  if (screen) {
    lines.push("[화면]");
    lines.push(`ID: ${screen.scrn_display_id}`);
    lines.push(`명칭: ${screen.scrn_nm}`);
    if (screen.scrn_dc?.trim()) lines.push(`설명: ${screen.scrn_dc.trim()}`);
    lines.push("");
  }

  const areas = screen?.areas ?? [];
  for (const area of areas) {
    lines.push(`[영역: ${area.area_display_id} ${area.area_nm}]`);
    if (area.area_dc?.trim()) lines.push(`설명: ${area.area_dc.trim()}`);
    for (const f of area.functions) {
      lines.push("---");
      lines.push(`기능 ID: ${f.func_display_id}`);
      lines.push(`기능명: ${f.func_nm}`);
      if (f.func_dc?.trim()) { lines.push("설명:"); lines.push(f.func_dc.trim()); }
    }
    lines.push("---");
    lines.push("");
  }

  const totalFunctions = areas.reduce((s, a) => s + a.functions.length, 0);
  const xml = `<전체 설계서>\n${lines.join("\n")}\n</전체 설계서>`;

  return {
    xml,
    summary: {
      unitWorkId: unitWork?.unit_work_id ?? null,
      unitWorkNm: unitWork?.unit_work_nm ?? null,
      screenId:   screen?.scrn_id       ?? null,
      screenNm:   screen?.scrn_nm       ?? null,
      areaId:     null,
      areaNm:     null,
      functionCount: totalFunctions,
    },
  };
}

// ── UNIT_WORK 기준 (top-down) ─────────────────────────────────────────────────
// 단위업무 → 화면 → 영역 → 기능 전체 tree 수집

async function buildFromUnitWork(unitWorkId: string): Promise<DesignContext> {
  const unitWork = await prisma.tbDsUnitWork.findUnique({
    where: { unit_work_id: unitWorkId },
    include: {
      screens: {
        orderBy: { sort_ordr: "asc" },
        include: {
          areas: {
            orderBy: { sort_ordr: "asc" },
            include: {
              functions: { orderBy: { sort_ordr: "asc" } },
            },
          },
        },
      },
    },
  });

  const lines: string[] = [];

  if (unitWork) {
    lines.push("[단위업무]");
    lines.push(`ID: ${unitWork.unit_work_display_id}`);
    lines.push(`명칭: ${unitWork.unit_work_nm}`);
    if (unitWork.unit_work_dc?.trim()) lines.push(`설명: ${unitWork.unit_work_dc.trim()}`);
    lines.push("");
  }

  const screens = unitWork?.screens ?? [];
  for (const screen of screens) {
    lines.push(`[화면: ${screen.scrn_display_id} ${screen.scrn_nm}]`);
    if (screen.scrn_dc?.trim()) lines.push(`설명: ${screen.scrn_dc.trim()}`);
    lines.push("");

    for (const area of screen.areas) {
      lines.push(`  [영역: ${area.area_display_id} ${area.area_nm}]`);
      if (area.area_dc?.trim()) lines.push(`  설명: ${area.area_dc.trim()}`);

      for (const f of area.functions) {
        lines.push("  ---");
        lines.push(`  기능 ID: ${f.func_display_id}`);
        lines.push(`  기능명: ${f.func_nm}`);
        if (f.func_dc?.trim()) {
          lines.push("  설명:");
          // 들여쓰기 유지
          lines.push(f.func_dc.trim().split("\n").map((l) => `  ${l}`).join("\n"));
        }
      }
      if (area.functions.length > 0) lines.push("  ---");
      lines.push("");
    }
  }

  const totalFunctions = screens
    .flatMap((s) => s.areas)
    .reduce((sum, a) => sum + a.functions.length, 0);

  const xml = `<전체 설계서>\n${lines.join("\n")}\n</전체 설계서>`;

  return {
    xml,
    summary: {
      unitWorkId:    unitWork?.unit_work_id   ?? null,
      unitWorkNm:    unitWork?.unit_work_nm   ?? null,
      screenId:      null,
      screenNm:      null,
      areaId:        null,
      areaNm:        null,
      functionCount: totalFunctions,
    },
  };
}
