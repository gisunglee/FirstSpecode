/**
 * scan-text-lengths.ts — 장문 텍스트 컬럼 길이 분포 스캔 (1회성 보고)
 *
 * 실행: npm run scan:text-lengths
 *
 * 목적:
 *   - 길이 제한 정책 도입 전, 기존 데이터의 분포 파악
 *   - 어느 한도가 안전한지(예: 50,000자) 결정 근거 제공
 *   - 한도 적용 시 "현재 초과 row 가 몇 건인가" 사전 파악
 *
 * 대상 컬럼 (사용자 입력 장문 — AI 결과/JSON 등은 제외):
 *   tb_ds_unit_work.unit_work_dc      — 단위업무 설명 (markdown)
 *   tb_ds_screen.scrn_dc              — 화면 설명
 *   tb_ds_screen.layer_data_dc        — 화면 레이아웃 설계
 *   tb_ds_area.area_dc                — 영역 설명
 *   tb_ds_area.layer_data_dc          — 영역 레이아웃 설계
 *   tb_ds_function.func_dc            — 기능 설명
 *   tb_ds_db_table.tbl_dc             — DB 테이블 설명
 *   tb_rq_requirement.orgnl_cn        — 요구사항 원문 (HTML)
 *   tb_rq_requirement.curncy_cn       — 요구사항 현행화 (HTML)
 *   tb_rq_requirement.analy_cn        — 요구사항 분석 메모 (markdown)
 *   tb_rq_requirement.spec_cn         — 요구사항 상세 명세 (markdown)
 *   tb_rq_task.defn_cn                — 과업 정의
 *   tb_rq_task.dtl_cn                 — 과업 상세
 *   tb_rq_task.output_info_cn         — 과업 산출물 정보
 *
 * 제외 (의도적으로 무제한 유지 — 정책 결정에 따름):
 *   tb_ai_task.req_cn / coment_cn / result_cn — AI 입출력
 *   tb_ai_task.req_snapshot_data              — JSON
 *   tb_dt_*                                   — 시스템 템플릿
 */

import { prisma } from "../src/lib/prisma";

// ── 스캔 대상 정의 ────────────────────────────────────────────────────────────

type Target = {
  table:  string;          // 물리 테이블명 (raw SQL 용)
  column: string;          // 컬럼명
  label:  string;          // 화면 표시용 라벨 (한글)
};

const TARGETS: Target[] = [
  { table: "tb_ds_unit_work",   column: "unit_work_dc",   label: "단위업무 설명" },
  { table: "tb_ds_screen",      column: "scrn_dc",        label: "화면 설명" },
  { table: "tb_ds_screen",      column: "layer_data_dc",  label: "화면 레이아웃" },
  { table: "tb_ds_area",        column: "area_dc",        label: "영역 설명" },
  { table: "tb_ds_area",        column: "layer_data_dc",  label: "영역 레이아웃" },
  { table: "tb_ds_function",    column: "func_dc",        label: "기능 설명" },
  { table: "tb_ds_db_table",    column: "tbl_dc",         label: "DB 테이블 설명" },
  { table: "tb_rq_requirement", column: "orgnl_cn",       label: "요구사항 원문(HTML)" },
  { table: "tb_rq_requirement", column: "curncy_cn",      label: "요구사항 현행화(HTML)" },
  { table: "tb_rq_requirement", column: "analy_cn",       label: "요구사항 분석메모" },
  { table: "tb_rq_requirement", column: "spec_cn",        label: "요구사항 상세명세" },
  { table: "tb_rq_task",        column: "defn_cn",        label: "과업 정의" },
  { table: "tb_rq_task",        column: "dtl_cn",         label: "과업 상세" },
  { table: "tb_rq_task",        column: "output_info_cn", label: "과업 산출물정보" },
];

// 한도 후보값 — "이 한도를 적용하면 몇 건이 초과되는가" 판정용
const THRESHOLDS = [5_000, 10_000, 50_000, 100_000];

// ── 스캔 실행 ─────────────────────────────────────────────────────────────────

type Stat = {
  label:        string;
  table:        string;
  column:       string;
  total:        number;     // 전체 row
  nonNull:      number;     // NULL 아닌 row
  max:          number;     // 최대 글자수 (NULL 은 0 로 집계 안 됨)
  avg:          number;     // 평균 (NULL 제외)
  p95:          number;     // 95 percentile (NULL 제외)
  overCounts:   number[];   // THRESHOLDS 별 초과 건수
};

async function scanColumn(t: Target): Promise<Stat> {
  // PostgreSQL CHAR_LENGTH — 멀티바이트 글자수 (한국어 1글자 = 1)
  // bytea 가 아닌 text 컬럼이라 LENGTH() 로 충분하지만 명시적으로 CHAR_LENGTH 사용.
  //
  // percentile_cont 로 p95 까지 한 번에 집계 — 추가 round-trip 없음.
  // raw SQL 인 이유: Prisma 의 type-safe 쿼리는 동적 컬럼·집계 함수에 약함.
  const sql = `
    SELECT
      COUNT(*)                                                                       AS total,
      COUNT(${t.column})                                                             AS non_null,
      COALESCE(MAX(CHAR_LENGTH(${t.column})), 0)                                     AS max_len,
      COALESCE(ROUND(AVG(CHAR_LENGTH(${t.column}))::numeric, 0), 0)                  AS avg_len,
      COALESCE(
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY CHAR_LENGTH(${t.column}))::int,
        0
      )                                                                              AS p95_len,
      ${THRESHOLDS.map((th) =>
        `COUNT(*) FILTER (WHERE CHAR_LENGTH(${t.column}) > ${th}) AS over_${th}`
      ).join(",\n      ")}
    FROM ${t.table};
  `;

  const rows = await prisma.$queryRawUnsafe<Array<Record<string, bigint | number>>>(sql);
  const r = rows[0];

  // PostgreSQL 의 COUNT 는 BIGINT → Number 변환 (집계값이 2^53 넘을 일 없음)
  const num = (v: unknown): number => Number(v ?? 0);

  return {
    label:      t.label,
    table:      t.table,
    column:     t.column,
    total:      num(r.total),
    nonNull:    num(r.non_null),
    max:        num(r.max_len),
    avg:        num(r.avg_len),
    p95:        num(r.p95_len),
    overCounts: THRESHOLDS.map((th) => num(r[`over_${th}`])),
  };
}

// ── 출력 ──────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function printReport(stats: Stat[]) {
  console.log("\n장문 텍스트 컬럼 길이 분포 보고");
  console.log("=".repeat(110));
  console.log("(글자수 기준 — UTF-8 바이트가 아님. 한국어 1글자 = 1로 집계)\n");

  // 메인 테이블
  const headers = [
    "라벨",
    "row(전체/입력)",
    "최대",
    "평균",
    "p95",
    ...THRESHOLDS.map((th) => `>${fmt(th)}`),
  ];
  const widths = [22, 18, 10, 8, 8, ...THRESHOLDS.map(() => 10)];

  function row(cols: string[]) {
    return cols
      .map((c, i) => c.padEnd(widths[i]))
      .join(" │ ");
  }

  console.log(row(headers));
  console.log("─".repeat(widths.reduce((a, b) => a + b + 3, 0)));

  for (const s of stats) {
    console.log(
      row([
        s.label,
        `${fmt(s.total)} / ${fmt(s.nonNull)}`,
        fmt(s.max),
        fmt(s.avg),
        fmt(s.p95),
        ...s.overCounts.map((c) => (c === 0 ? "0" : `⚠ ${fmt(c)}`)),
      ])
    );
  }

  // 한도 후보별 요약
  console.log("\n한도 후보별 영향 (전체 컬럼 합산):");
  console.log("─".repeat(50));
  for (let i = 0; i < THRESHOLDS.length; i++) {
    const total = stats.reduce((sum, s) => sum + s.overCounts[i], 0);
    console.log(`  ${fmt(THRESHOLDS[i]).padStart(8)}자 한도 → 초과 row ${fmt(total)}건`);
  }

  console.log("\n참고:");
  console.log("  • '입력' 은 NULL 아닌 row 수");
  console.log("  • p95 = 입력된 row 중 95번째 백분위 (대부분 사용자가 이 길이 이하)");
  console.log("  • '⚠' 표시 = 해당 한도를 적용하면 차단되는 row");
  console.log("  • AI 태스크(tb_ai_task.*) 는 의도적으로 스캔 제외 — 무제한 유지\n");
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`스캔 시작 — 대상 ${TARGETS.length} 개 컬럼\n`);

  // 병렬 실행 — 각 컬럼이 독립적인 집계 쿼리라 의존 없음
  const stats = await Promise.all(TARGETS.map(scanColumn));

  printReport(stats);
}

main()
  .catch((err) => {
    console.error("스캔 실패:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
