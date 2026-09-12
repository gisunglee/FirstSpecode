/**
 * test-xlsx-test-spec-rounds.ts — 테스트 명세서/결과서 xlsx 빌더 스모크 테스트
 *
 * 확인 목적:
 *   회차별 시트 구조로 바꾸면서 동적 컬럼(회차 수만큼 옆으로 붙는 판정 컬럼)이
 *   생겼다. ExcelJS 는 머지 범위가 겹치면 파일을 쓸 때가 아니라 **열 때** 깨지므로,
 *   타입 체크만으로는 안전을 확신할 수 없다. 실제로 buffer 를 만들고 다시 읽어서
 *   시트가 기대대로 생성됐는지 검증한다.
 *
 * 실행: npx tsx scripts/test-xlsx-test-spec-rounds.ts
 */

import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  buildTestSpecXlsx,
  type TestSpecXlsxCase,
  type TestSpecXlsxRound,
  type TestSpecDocKind,
} from "../src/lib/exports/xlsx/test-spec";

// ── 픽스처 ───────────────────────────────────────────────────────────────────

function makeCase(no: number, group: string, verdicts: string[] = []): TestSpecXlsxCase {
  return {
    no,
    group,
    scenario:    `시나리오 ${no}`,
    expected:    `예상 결과 ${no}`,
    testedDate:  "2026-09-01",
    resultLabel: verdicts[0] ?? "",
    defectText:  no % 2 === 0 ? "결함 내용" : "",
    fixDate:     "",
    fixResult:   "",
    roundVerdicts: verdicts,
  };
}

function makeRound(roundNo: number, caseCount: number): TestSpecXlsxRound {
  const checklist:  TestSpecXlsxCase[] = [];
  const functional: TestSpecXlsxCase[] = [];
  for (let i = 1; i <= caseCount; i++) {
    (i % 2 === 0 ? functional : checklist).push(makeCase(i, `그룹${i}`));
  }
  return {
    roundNo,
    envirLabel:  "DEV",
    bldVrsnNm:   `build-${roundNo}`,
    bgngDate:    "2026-09-01",
    endDate:     roundNo === 1 ? "2026-09-02" : "",
    statusLabel: roundNo === 1 ? "완료" : "진행중",
    checklist,
    functional,
    summary:     { 적합: 3, 부적합: 1 },
  };
}

function makeInput(docKind: TestSpecDocKind, rounds: TestSpecXlsxRound[]) {
  const roundCount = rounds.length;
  // 명세 전체 케이스 6건 — 회차별 판정은 회차 수만큼 채운다
  const checklist:  TestSpecXlsxCase[] = [];
  const functional: TestSpecXlsxCase[] = [];
  for (let i = 1; i <= 6; i++) {
    const verdicts = Array.from({ length: roundCount }, (_, r) =>
      // 마지막 케이스는 2차에만 결과가 있는 상황(회차 시작 후 추가) 재현
      i === 6 && r === 0 ? "" : "적합"
    );
    (i % 2 === 0 ? functional : checklist).push(makeCase(i, `그룹${i}`, verdicts));
  }
  return {
    docKind,
    projectName:   "테스트 프로젝트",
    projectAbbr:   "TP",
    displayId:     "TS-00001",
    testSpecNm:    "멤버 목록",
    testKindLabel: "단위 테스트",
    docNo:         "TP_I501_001",
    programIds:    "PID-00022",
    testTaskNm:    "멤버 목록",
    subtitle:      "역할 관리",
    checklist,
    functional,
    rounds,
  };
}

// ── 검증 헬퍼 ────────────────────────────────────────────────────────────────

async function sheetNamesOf(buffer: Buffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  // 다시 읽어서 열리는지 확인 — 머지 충돌은 여기서 드러난다
  await wb.xlsx.load(new Uint8Array(buffer).buffer as ArrayBuffer);
  return wb.worksheets.map((ws) => ws.name);
}

let failures = 0;
async function check(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${label}`);
  } catch (err) {
    failures++;
    console.log(`  ❌ ${label}`);
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── 실행 ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("테스트 명세서/결과서 xlsx 빌더 검증\n");

  await check("명세서(spec) — 회차 시트 없이 표지/변경이력/테스트케이스만", async () => {
    const buf = await buildTestSpecXlsx(makeInput("spec", []));
    const names = await sheetNamesOf(buf);
    assert.deepEqual(names, ["표지", "변경 이력", "테스트케이스"]);
  });

  await check("결과서 + 회차 0개 — 회차 시트 없이 증적까지", async () => {
    const buf = await buildTestSpecXlsx(makeInput("result", []));
    const names = await sheetNamesOf(buf);
    assert.deepEqual(names, ["표지", "변경 이력", "테스트케이스", "증적"]);
  });

  await check("결과서 + 회차 1개 — 1차 결과 시트 생성", async () => {
    const buf = await buildTestSpecXlsx(makeInput("result", [makeRound(1, 4)]));
    const names = await sheetNamesOf(buf);
    assert.deepEqual(names, ["표지", "변경 이력", "테스트케이스", "1차 결과", "증적"]);
  });

  await check("결과서 + 회차 3개 — 회차마다 시트 생성", async () => {
    const rounds = [makeRound(1, 4), makeRound(2, 6), makeRound(3, 6)];
    const buf = await buildTestSpecXlsx(makeInput("result", rounds));
    const names = await sheetNamesOf(buf);
    assert.deepEqual(names, [
      "표지", "변경 이력", "테스트케이스",
      "1차 결과", "2차 결과", "3차 결과",
      "증적",
    ]);
  });

  await check("회차 10개 — 판정 컬럼이 많아도 파일이 깨지지 않음", async () => {
    const rounds = Array.from({ length: 10 }, (_, i) => makeRound(i + 1, 4));
    const buf = await buildTestSpecXlsx(makeInput("result", rounds));
    const names = await sheetNamesOf(buf);
    assert.equal(names.length, 3 + 10 + 1);
  });

  await check("조망 시트 — 회차 수만큼 판정 헤더가 붙고 최신 회차가 표시된다", async () => {
    const rounds = [makeRound(1, 4), makeRound(2, 4), makeRound(3, 4)];
    const buf = await buildTestSpecXlsx(makeInput("result", rounds));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(buf).buffer as ArrayBuffer);
    const ws = wb.getWorksheet("테스트케이스");
    assert.ok(ws, "테스트케이스 시트가 없습니다");

    // 시트 전체에서 회차 헤더 셀을 수집한다 (행 위치는 박스 행 수에 따라 달라짐)
    const found = new Set<string>();
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        const v = String(cell.value ?? "").trim();
        if (/^\d+차(\(최신\))?$/.test(v)) found.add(v);
      });
    });
    assert.ok(found.has("1차"), "1차 판정 컬럼 헤더를 찾지 못했습니다");
    assert.ok(found.has("2차"), "2차 판정 컬럼 헤더를 찾지 못했습니다");
    // 마지막 회차만 "(최신)" 이 붙어야 한다 — 어느 결과가 현재 유효한지 구분되는 지점
    assert.ok(found.has("3차(최신)"), "최신 회차 표시가 없습니다");
    assert.ok(!found.has("3차"), "최신 회차인데 표시가 빠진 헤더가 있습니다");
    assert.ok(!found.has("1차(최신)"), "최신이 아닌 회차에 최신 표시가 붙었습니다");
  });

  await check("회차 1개 — 그 회차가 곧 최신", async () => {
    const buf = await buildTestSpecXlsx(makeInput("result", [makeRound(1, 4)]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(buf).buffer as ArrayBuffer);
    const ws = wb.getWorksheet("테스트케이스");
    assert.ok(ws);
    let hasLatest = false;
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (String(cell.value ?? "").trim() === "1차(최신)") hasLatest = true;
      });
    });
    assert.ok(hasLatest, "회차가 1개일 때도 최신 표시가 있어야 합니다");
  });

  await check("회차 시트 — 결과가 있는 케이스만 담긴다(빈 회차도 안전)", async () => {
    const emptyRound: TestSpecXlsxRound = {
      ...makeRound(1, 0),
      checklist:  [],
      functional: [],
      summary:    {},
    };
    const buf = await buildTestSpecXlsx(makeInput("result", [emptyRound]));
    const names = await sheetNamesOf(buf);
    assert.ok(names.includes("1차 결과"));
  });

  console.log(
    failures === 0
      ? "\n전체 통과"
      : `\n실패 ${failures}건`
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
