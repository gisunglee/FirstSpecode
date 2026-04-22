/**
 * test-ddl-parser.ts — DDL 파서 시나리오 자체 점검
 *
 * 실행: npx tsx scripts/test-ddl-parser.ts
 *
 * 목적:
 *   - 상세 ADD DDL / 일괄 등록 양쪽의 파싱 근본인 parseDdlScript 동작을 15개 시나리오로 검증
 *   - 실제 사용자가 붙여넣을 법한 DDL(Oracle/PostgreSQL/MySQL 섞임)을 위주로 구성
 */

import { parseDdlScript } from "../src/lib/ddlParser";

// 각 시나리오: label / ddl / 기대 검증 함수
type Scenario = {
  label:  string;
  ddl:    string;
  check: (result: ReturnType<typeof parseDdlScript>) => string | null;  // null = pass, string = 실패 사유
};

function eq<T>(actual: T, expected: T, field: string): string | null {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return null;
  return `${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

const scenarios: Scenario[] = [

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "1. 단일 테이블 + 인라인 -- 주석 (기본)",
    ddl: `
CREATE TABLE tb_member (
  mber_id   VARCHAR(36) NOT NULL, -- 회원 ID
  mber_nm   VARCHAR(100) NOT NULL, -- 회원명
  PRIMARY KEY (mber_id)
);
`,
    check: (r) => {
      if (r.length !== 1) return `테이블 개수: expected 1, got ${r.length}`;
      const t = r[0]!;
      return eq(t.tblPhysclNm, "tb_member", "tblPhysclNm")
          ?? eq(t.columns.length, 2, "columns.length")
          ?? eq(t.columns[0]?.colPhysclNm, "mber_id", "col0.physcl")
          ?? eq(t.columns[0]?.colLgclNm, "회원 ID", "col0.lgcl")
          ?? eq(t.columns[1]?.colLgclNm, "회원명", "col1.lgcl")
          ?? eq(t.columns[0]?.dataTyNm, "VARCHAR(36)", "col0.type");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "2. 블록 주석 /* */ 인라인",
    ddl: `
CREATE TABLE tb_order (
  order_id   BIGINT NOT NULL, /* 주문 ID */
  order_dt   DATE   NOT NULL  /* 주문 일시 */
);
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.columns[0]?.colLgclNm, "주문 ID", "col0.lgcl")
          ?? eq(t.columns[1]?.colLgclNm, "주문 일시", "col1.lgcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "3. COMMENT ON TABLE / COMMENT ON COLUMN",
    ddl: `
CREATE TABLE tb_product (
  prod_id    VARCHAR(36) NOT NULL,
  prod_nm    VARCHAR(200),
  prod_price NUMBER(10,2)
);
COMMENT ON TABLE  tb_product         IS '상품';
COMMENT ON COLUMN tb_product.prod_id IS '상품 ID';
COMMENT ON COLUMN tb_product.prod_nm IS '상품명';
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.tblLgclNm, "상품", "tblLgclNm")
          ?? eq(t.columns[0]?.colLgclNm, "상품 ID", "col0.lgcl")
          ?? eq(t.columns[1]?.colLgclNm, "상품명", "col1.lgcl")
          ?? eq(t.columns[2]?.colLgclNm, "", "col2.lgcl (주석 없음)");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "4. 다중 CREATE TABLE + 중간 CREATE INDEX/ALTER 혼재",
    ddl: `
CREATE TABLE tb_a (
  a_id VARCHAR(36) NOT NULL -- A ID
);
CREATE INDEX idx_a_1 ON tb_a(a_id);
ALTER TABLE tb_a ADD CONSTRAINT pk_a PRIMARY KEY (a_id);

CREATE TABLE tb_b (
  b_id VARCHAR(36) NOT NULL, -- B ID
  b_nm VARCHAR(100)           -- B Name
);
`,
    check: (r) => {
      if (r.length !== 2) return `테이블 개수: expected 2, got ${r.length}`;
      return eq(r[0]?.tblPhysclNm, "tb_a", "0.physcl")
          ?? eq(r[1]?.tblPhysclNm, "tb_b", "1.physcl")
          ?? eq(r[0]?.columns.length, 1, "0.cols.length")
          ?? eq(r[1]?.columns.length, 2, "1.cols.length")
          ?? eq(r[1]?.columns[1]?.colLgclNm, "B Name", "1.col1.lgcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "5. CREATE TABLE 앞 줄 단독 주석 → 테이블 논리명",
    ddl: `
-- 회원 테이블
CREATE TABLE tb_member (
  mber_id VARCHAR(36) NOT NULL
);

/* 주문 테이블 */
CREATE TABLE tb_order (
  order_id BIGINT
);
`,
    check: (r) => {
      return eq(r[0]?.tblLgclNm, "회원 테이블", "0.lgcl (--)")
          ?? eq(r[1]?.tblLgclNm, "주문 테이블", "1.lgcl (/* */)");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "6. CREATE TABLE tb_x (  -- 회원 → 오픈 괄호 뒤 인라인 주석",
    ddl: `
CREATE TABLE tb_member (  -- 회원 테이블
  mber_id VARCHAR(36) NOT NULL -- 회원 ID
);
`,
    check: (r) => eq(r[0]?.tblLgclNm, "회원 테이블", "tblLgclNm"),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "7. 컬럼 앞 줄 단독 주석 → 컬럼 논리명",
    ddl: `
CREATE TABLE tb_x (
  -- 식별자
  x_id  VARCHAR(36) NOT NULL,
  -- 이름
  x_nm  VARCHAR(100)
);
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.columns[0]?.colLgclNm, "식별자", "col0.lgcl")
          ?? eq(t.columns[1]?.colLgclNm, "이름",   "col1.lgcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "8. 괄호 중첩 — CHECK / DEFAULT NEXTVAL(seq)",
    ddl: `
CREATE TABLE tb_x (
  x_id  NUMBER  DEFAULT NEXTVAL('seq_x') NOT NULL, -- ID
  cnt   NUMBER  CHECK (cnt > 0)                    -- 카운트
);
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.columns.length, 2, "cols.length")
          ?? eq(t.columns[0]?.colPhysclNm, "x_id", "col0.physcl")
          ?? eq(t.columns[0]?.colLgclNm,   "ID",   "col0.lgcl")
          ?? eq(t.columns[1]?.colPhysclNm, "cnt",  "col1.physcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "9. 문자열 리터럴 안의 주석 기호 — DEFAULT '--not a comment'",
    ddl: `
CREATE TABLE tb_x (
  col1  VARCHAR(10) DEFAULT '--hidden' NOT NULL,  -- 진짜 주석
  col2  VARCHAR(10) DEFAULT '/* not */'           -- 진짜 주석2
);
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.columns.length, 2, "cols.length")
          ?? eq(t.columns[0]?.colLgclNm, "진짜 주석",  "col0.lgcl")
          ?? eq(t.columns[1]?.colLgclNm, "진짜 주석2", "col1.lgcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "10. COMMENT ON 문 안의 이스케이프 작은따옴표",
    ddl: `
CREATE TABLE tb_x (
  col_a VARCHAR(10)
);
COMMENT ON COLUMN tb_x.col_a IS 'It''s tricky';
COMMENT ON TABLE  tb_x       IS 'Jenny''s table';
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.tblLgclNm, "Jenny's table", "tblLgclNm")
          ?? eq(t.columns[0]?.colLgclNm, "It's tricky", "col0.lgcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "11. CONSTRAINT / PRIMARY KEY / FOREIGN KEY / UNIQUE / INDEX 스킵",
    ddl: `
CREATE TABLE tb_x (
  id     VARCHAR(36) NOT NULL, -- ID
  ref_id VARCHAR(36),           -- 참조 ID
  nm     VARCHAR(100),          -- 이름
  CONSTRAINT pk_x PRIMARY KEY (id),
  CONSTRAINT fk_x FOREIGN KEY (ref_id) REFERENCES tb_y(y_id),
  UNIQUE KEY uk_nm (nm),
  INDEX idx_nm (nm)
);
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.columns.length, 3, "실제 컬럼 3개만 (제약 스킵)");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "12. 쿼팅 — Oracle \"\", MySQL ``, MSSQL []",
    ddl: `
CREATE TABLE "tb_x" (
  "id"    VARCHAR(36) NOT NULL,  -- Oracle 쿼팅
  \`nm\`   VARCHAR(100),           -- MySQL 쿼팅
  [desc]  VARCHAR(500)              -- MSSQL 쿼팅
);
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.tblPhysclNm, "tb_x", "tblPhysclNm (쿼팅 제거)")
          ?? eq(t.columns.map((c) => c.colPhysclNm), ["id", "nm", "desc"], "cols.physcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "13. IF NOT EXISTS + 스키마 접두사",
    ddl: `
CREATE TABLE IF NOT EXISTS public.tb_member (
  mber_id VARCHAR(36) NOT NULL
);
COMMENT ON TABLE public.tb_member IS '회원(스키마 포함)';
`,
    check: (r) => {
      return eq(r[0]?.tblPhysclNm, "tb_member", "물리명(스키마 제거)")
          ?? eq(r[0]?.tblLgclNm,   "회원(스키마 포함)", "논리명 매칭");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "14. 닫는 괄호 누락 — 다음 블록 살아남는지",
    ddl: `
CREATE TABLE tb_broken (
  col1 VARCHAR(10) NOT NULL,
  col2 VARCHAR(10)
-- 일부러 닫는 괄호 빠뜨림

CREATE TABLE tb_ok (
  id VARCHAR(36) NOT NULL -- OK
);
`,
    check: (r) => {
      // 현재 구현은 첫 블록이 문서 끝까지 먹어버릴 수 있음 — 동작 확인용
      // 최소한 "tb_ok" 테이블 또는 "tb_broken" 중 하나는 인식되어야 함
      const names = r.map((t) => t.tblPhysclNm);
      if (names.includes("tb_ok")) return null;
      return `다음 블록 복구 실패: parsed=${JSON.stringify(names)}`;
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "15. 빈 입력 / CREATE TABLE 없음",
    ddl: `
-- 그냥 주석만
SELECT * FROM tb_x;
`,
    check: (r) => eq(r.length, 0, "result.length (CREATE TABLE 없음)"),
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "16. 혼합 대용량 — 논리명 4계층 섞임",
    ddl: `
-- 결제 테이블
CREATE TABLE tb_payment (  -- 결제(인라인도 있음)
  /* 결제 ID */
  pay_id   VARCHAR(36) NOT NULL,
  amt      NUMBER(10,2),            -- 금액
  status   VARCHAR(20),
  memo     TEXT
);
COMMENT ON TABLE tb_payment IS '결제(COMMENT ON 최우선)';
COMMENT ON COLUMN tb_payment.status IS '상태';
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.tblLgclNm, "결제(COMMENT ON 최우선)", "tblLgclNm 1순위")
          ?? eq(t.columns[0]?.colLgclNm, "결제 ID", "col0 앞줄 주석")
          ?? eq(t.columns[1]?.colLgclNm, "금액",    "col1 인라인")
          ?? eq(t.columns[2]?.colLgclNm, "상태",    "col2 COMMENT ON")
          ?? eq(t.columns[3]?.colLgclNm, "",        "col3 소스 없음");
    },
  },
];

// ── 실행 ─────────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures: string[] = [];

console.log("=".repeat(80));
console.log("DDL 파서 시나리오 테스트");
console.log("=".repeat(80));

for (const s of scenarios) {
  try {
    const result = parseDdlScript(s.ddl);
    const err = s.check(result);
    if (err === null) {
      console.log(`✅  ${s.label}`);
      passed++;
    } else {
      console.log(`❌  ${s.label}`);
      console.log(`      → ${err}`);
      console.log(`      → parsed: ${JSON.stringify(result.map((t) => ({
        physcl: t.tblPhysclNm,
        lgcl:   t.tblLgclNm,
        colsPhy: t.columns.map((c) => c.colPhysclNm),
        colsLg:  t.columns.map((c) => c.colLgclNm),
        errors:  t.errors,
      })), null, 2)}`);
      failures.push(s.label);
      failed++;
    }
  } catch (e) {
    console.log(`💥  ${s.label}`);
    console.log(`      → Exception: ${e instanceof Error ? e.message : e}`);
    failures.push(s.label);
    failed++;
  }
}

console.log("=".repeat(80));
console.log(`결과: ${passed} passed, ${failed} failed / 총 ${scenarios.length}`);
if (failed > 0) {
  console.log("실패:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
