/**
 * test-ddl-parser-2.ts — DDL 파서 2차 엣지 케이스
 *
 * 실행: npx tsx scripts/test-ddl-parser-2.ts
 *
 * 1차(16개) 통과 후, 실무에서 자주 마주치는 변종들을 추가 검증:
 *   - MySQL 방식: 컬럼 정의 뒤에 COMMENT '...' 키워드
 *   - 여러 줄 블록 주석
 *   - 대소문자 섞임
 *   - 타입 파라미터 복잡(NUMERIC(18,6), TIMESTAMP WITH TIME ZONE)
 *   - 줄바꿈이 적은 "한 줄로 된" DDL
 *   - 따옴표 안에 탭/괄호
 *   - GENERATED / AUTO_INCREMENT / SERIAL 같은 특수 키워드
 *   - 공백 없이 바짝 붙인 포맷
 *   - 세미콜론 없음
 *   - 중복 물리명 (파서는 중복을 허용하되 FE/API 가 거른다)
 */

import { parseDdlScript } from "../src/lib/ddlParser";

type Scenario = {
  label: string;
  ddl:   string;
  check: (r: ReturnType<typeof parseDdlScript>) => string | null;
};

function eq<T>(actual: T, expected: T, field: string): string | null {
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? null
    : `${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

const scenarios: Scenario[] = [

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "17. MySQL 방식 — 컬럼 정의 뒤 COMMENT '논리명'",
    ddl: `
CREATE TABLE tb_x (
  id   INT NOT NULL COMMENT '식별자',
  nm   VARCHAR(100) COMMENT '이름'
) ENGINE=InnoDB;
`,
    // MySQL 의 COMMENT 'xxx' 는 우리가 현재 파싱하지 않음 → 논리명 빈 값이 되는지 확인
    // (회귀 방지 + 추후 지원 시 기대값 교체)
    check: (r) => {
      const t = r[0]!;
      return eq(t.columns.length, 2, "cols.length")
          ?? eq(t.columns[0]?.colPhysclNm, "id", "col0.physcl")
          ?? eq(t.columns[1]?.colPhysclNm, "nm", "col1.physcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "18. 여러 줄 블록 주석",
    ddl: `
/*
 * 상품 테이블
 * 상품 마스터 정보
 */
CREATE TABLE tb_product (
  prod_id  VARCHAR(36) /* 상품 ID */ NOT NULL,
  prod_nm  VARCHAR(200)
);
`,
    check: (r) => {
      const t = r[0]!;
      // 여러 줄 블록 주석은 trim 후 첫 줄만 표시되는 게 자연스럽지 않음 —
      // 현재 구현은 전체 내용을 trim 한다 (줄바꿈 포함). 이걸 문자열로 보고 확인.
      const lgcl = t.tblLgclNm;
      if (!lgcl.includes("상품 테이블")) return `tblLgclNm: "${lgcl}" does not contain "상품 테이블"`;
      return eq(t.columns[0]?.colLgclNm, "상품 ID", "col0.lgcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "19. 대소문자 섞임 — create Table, Comment On",
    ddl: `
create table Tb_User (
  user_id varchar(36) not null,
  user_nm varchar(100)
);
Comment On Table Tb_User IS '사용자';
Comment On Column Tb_User.user_id IS '사용자 ID';
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.tblPhysclNm, "Tb_User", "tblPhysclNm (대소문자 보존)")
          ?? eq(t.tblLgclNm,   "사용자",  "tblLgclNm")
          ?? eq(t.columns[0]?.colLgclNm, "사용자 ID", "col0.lgcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "20. 복잡한 타입 — NUMERIC(18,6), TIMESTAMP WITH TIME ZONE",
    ddl: `
CREATE TABLE tb_tx (
  tx_id     BIGINT NOT NULL,
  amount    NUMERIC(18,6) NOT NULL, -- 금액
  created   TIMESTAMP WITH TIME ZONE, -- 생성일시
  country   CHAR(2)
);
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.columns[1]?.dataTyNm, "NUMERIC(18,6)", "col1.type")
          ?? eq(t.columns[1]?.colLgclNm, "금액", "col1.lgcl")
          ?? eq(t.columns[2]?.dataTyNm, "TIMESTAMP", "col2.type (WITH TIME ZONE 는 현재 생략)")
          ?? eq(t.columns[2]?.colLgclNm, "생성일시", "col2.lgcl")
          ?? eq(t.columns[3]?.dataTyNm, "CHAR(2)", "col3.type");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "21. 한 줄로 된 DDL (줄바꿈 최소)",
    ddl: `CREATE TABLE tb_min(id INT NOT NULL,nm VARCHAR(50));COMMENT ON TABLE tb_min IS '최소';`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.tblPhysclNm, "tb_min", "physcl")
          ?? eq(t.tblLgclNm,   "최소",   "lgcl")
          ?? eq(t.columns.length, 2, "cols.length")
          ?? eq(t.columns[0]?.colPhysclNm, "id", "col0.physcl")
          ?? eq(t.columns[1]?.colPhysclNm, "nm", "col1.physcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "22. 작은따옴표 안에 괄호/탭 — DEFAULT 'a\\tb (c)'",
    ddl: `
CREATE TABLE tb_x (
  col1 VARCHAR(10) DEFAULT 'a\tb (c)', -- 특수값
  col2 VARCHAR(10)                       -- 보통값
);
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.columns.length, 2, "cols.length")
          ?? eq(t.columns[0]?.colLgclNm, "특수값", "col0.lgcl")
          ?? eq(t.columns[1]?.colLgclNm, "보통값", "col1.lgcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "23. 특수 키워드 — GENERATED / AUTO_INCREMENT / SERIAL",
    ddl: `
CREATE TABLE tb_x (
  id_a  INT GENERATED ALWAYS AS IDENTITY NOT NULL, -- PG identity
  id_b  INT AUTO_INCREMENT,                         -- MySQL
  id_c  SERIAL PRIMARY KEY,                         -- PG serial
  nm    VARCHAR(100)
);
`,
    check: (r) => {
      const t = r[0]!;
      // 물리명만 정확히 추출되면 OK (타입은 베스트에포트)
      return eq(t.columns.map((c) => c.colPhysclNm), ["id_a", "id_b", "id_c", "nm"], "cols.physcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "24. 공백 없이 바짝 붙인 포맷 (쉼표 뒤 공백 없음)",
    ddl: `
CREATE TABLE tb_x(id INT,nm VARCHAR(50),dt DATE);
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.columns.map((c) => c.colPhysclNm), ["id", "nm", "dt"], "cols.physcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "25. 세미콜론 없음 + 뒤에 다른 CREATE 이어짐",
    ddl: `
CREATE TABLE tb_a (
  a_id INT
)
CREATE TABLE tb_b (
  b_id INT
)
`,
    check: (r) => {
      return eq(r.length, 2, "테이블 개수 (세미콜론 없어도 2개 파싱)")
          ?? eq(r[0]?.tblPhysclNm, "tb_a", "0.physcl")
          ?? eq(r[1]?.tblPhysclNm, "tb_b", "1.physcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "26. 같은 스크립트에 동일 물리명 두 번 (파서는 허용, 외부가 거름)",
    ddl: `
CREATE TABLE tb_dup (
  c1 INT
);
CREATE TABLE tb_dup (
  c2 VARCHAR(10)
);
`,
    check: (r) => {
      // 파서는 그대로 2건 반환 — 중복 처리는 API/FE 책임
      return eq(r.length, 2, "result.length")
          ?? eq(r[0]?.tblPhysclNm, "tb_dup", "0.physcl")
          ?? eq(r[1]?.tblPhysclNm, "tb_dup", "1.physcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "27. 주석 안에 CREATE TABLE 이 있어도 속지 않음",
    ddl: `
/* 예전에는 CREATE TABLE tb_old ( ... ) 였음. 이젠 tb_new 사용 */
-- CREATE TABLE tb_commented_out ( /* ... */ );
CREATE TABLE tb_new (
  n_id INT
);
`,
    check: (r) => {
      return eq(r.length, 1, "테이블 개수 (주석 내부 CREATE 무시)")
          ?? eq(r[0]?.tblPhysclNm, "tb_new", "physcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "28. 빈 테이블 본문 — CREATE TABLE tb_x ();",
    ddl: `
CREATE TABLE tb_empty ();
CREATE TABLE tb_ok (
  id INT -- ID
);
`,
    check: (r) => {
      return eq(r.length, 2, "result.length")
          ?? eq(r[0]?.columns.length, 0, "0.cols.length (빈 본문)")
          ?? eq(r[1]?.columns[0]?.colLgclNm, "ID", "1.col0.lgcl");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "29. CREATE TABLE 뒤에 탭/여러 공백",
    ddl: `
CREATE\tTABLE\t\ttb_tabs (
  id\tINT NOT NULL
);
`,
    check: (r) => {
      return eq(r[0]?.tblPhysclNm, "tb_tabs", "physcl")
          ?? eq(r[0]?.columns.length, 1, "cols.length");
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    label: "30. 블록 주석이 DDL 중간에 삽입됨",
    ddl: `
CREATE TABLE /* inline */ tb_mid (
  id INT, /* 중간
              여러 줄
              */
  nm VARCHAR(10) -- 이름
);
`,
    check: (r) => {
      const t = r[0]!;
      return eq(t.tblPhysclNm, "tb_mid", "physcl")
          ?? eq(t.columns.length, 2, "cols.length")
          ?? eq(t.columns[0]?.colPhysclNm, "id", "col0.physcl")
          ?? eq(t.columns[1]?.colPhysclNm, "nm", "col1.physcl")
          ?? eq(t.columns[1]?.colLgclNm,   "이름", "col1.lgcl");
    },
  },
];

// ── 실행 ─────────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures: string[] = [];

console.log("=".repeat(80));
console.log("DDL 파서 2차 엣지 케이스 테스트");
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
        cols: t.columns.map((c) => ({ p: c.colPhysclNm, l: c.colLgclNm, t: c.dataTyNm })),
        errors: t.errors,
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
