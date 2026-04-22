/**
 * ddlParser — DDL 스크립트 파서 (단일/다중 CREATE TABLE)
 *
 * 역할:
 *   - Oracle / MySQL / PostgreSQL DDL 을 공통 처리
 *   - 주석 선추출 → COMMENT ON 추출 → CREATE TABLE 반복 스캔 → 블록별 파싱
 *   - 테이블·컬럼 논리명을 4계층 우선순위로 결정 (결정론적, 반복 오류 방지)
 *   - 한 블록 파싱 실패가 다른 블록을 막지 않음 (오류는 ParsedTable.errors 에 누적)
 *
 * 논리명 우선순위:
 *   [테이블]  COMMENT ON TABLE > CREATE TABLE 앞 줄 단독 주석 > 오픈 괄호 직후 인라인 주석 > 빈 값
 *   [컬럼]    COMMENT ON COLUMN > 같은 줄 인라인 주석 > 앞 줄 단독 주석 > 빈 값
 *
 * 사용처:
 *   - DB 테이블 상세 ADD DDL (단일 테이블 컬럼만 채움)  → parseSingleDdl
 *   - DB 테이블 목록 DDL 일괄 등록 (여러 테이블 신규 생성) → parseDdlScript
 */

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type ParsedCol = {
  colPhysclNm: string;
  colLgclNm:   string;
  dataTyNm:    string;
  colDc:       string;  // 현재 자동 추출 규약 없음 — 빈 문자열. UI에서 사용자 입력 가능
};

export type ParsedTable = {
  tblPhysclNm: string;
  tblLgclNm:   string;  // 추출 실패 시 빈 문자열 — UI에서 사용자가 보완
  tblDc:       string;  // 동일
  columns:     ParsedCol[];
  rawBlock:    string;  // 원본 블록 (디버깅·사용자 확인용)
  errors:      string[];
};

// ── [1] 주석 추출 + 공백 치환 ────────────────────────────────────────────────
/**
 * 원문에서 `-- ...` 라인 주석과 `/* ... *\/` 블록 주석을 추출하고,
 * 원문은 같은 길이의 공백으로 치환한다. 개행은 유지해 줄 번호·offset 을 보존.
 *
 * 문자열 리터럴(`'...'`, `"..."`) 안의 `--` 나 `/*` 는 주석으로 오인하지 않는다.
 *
 * 반환:
 *   stripped — 주석 제거된 문자열 (후속 정규식이 안전하게 동작)
 *   comments — 각 주석의 { start, end, content } (원문 offset 기준, 매칭에 사용)
 */
type CommentEntry = { start: number; end: number; content: string };

function extractComments(src: string): { stripped: string; comments: CommentEntry[] } {
  const chars = src.split("");
  const comments: CommentEntry[] = [];

  let i = 0;
  while (i < chars.length) {
    const c  = chars[i]!;
    const c2 = chars[i + 1] ?? "";

    // 작은따옴표 문자열 — '' 이스케이프 처리
    if (c === "'") {
      i++;
      while (i < chars.length) {
        if (chars[i] === "'" && chars[i + 1] === "'") { i += 2; continue; }
        if (chars[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    // 큰따옴표 — Oracle/PG 의 쿼팅 식별자. 안에 주석 기호가 있어도 파싱 대상 아님
    if (c === '"') {
      i++;
      while (i < chars.length && chars[i] !== '"') i++;
      if (i < chars.length) i++;
      continue;
    }

    // 라인 주석 `-- ...`
    if (c === "-" && c2 === "-") {
      const start = i;
      let j = i + 2;
      while (j < chars.length && chars[j] !== "\n") j++;
      const content = src.slice(start + 2, j).trim();
      comments.push({ start, end: j, content });
      for (let k = start; k < j; k++) chars[k] = " ";
      i = j;
      continue;
    }

    // 블록 주석 `/* ... */` — 줄 걸침 허용
    if (c === "/" && c2 === "*") {
      const start = i;
      let j = i + 2;
      while (j < chars.length - 1 && !(chars[j] === "*" && chars[j + 1] === "/")) j++;
      const end = Math.min(j + 2, chars.length); // `*/` 까지 포함. 닫힘 없으면 문서 끝까지
      const content = src.slice(start + 2, Math.max(start + 2, end - 2)).trim();
      comments.push({ start, end, content });
      for (let k = start; k < end; k++) {
        // 개행은 유지해야 줄 번호·라인 계산이 어긋나지 않음
        chars[k] = chars[k] === "\n" ? "\n" : " ";
      }
      i = end;
      continue;
    }

    i++;
  }

  return { stripped: chars.join(""), comments };
}

// ── [2] COMMENT ON 문 추출 ──────────────────────────────────────────────────
/**
 * 주석이 제거된 문자열에서 `COMMENT ON TABLE/COLUMN ... IS '...'` 구문 추출.
 * 스키마 접두사·쿼팅 문자(백틱·큰따옴표·대괄호)는 제거 후 소문자 정규화.
 */
function extractCommentOn(stripped: string): {
  tableMap:  Record<string, string>;
  columnMap: Record<string, string>;
} {
  const tableMap:  Record<string, string> = {};
  const columnMap: Record<string, string> = {};

  // 작은따옴표 안의 '' 는 ' 하나로 해석
  const unescape = (s: string) => s.replace(/''/g, "'");
  // 쿼팅 제거 + 스키마 prefix 제거
  const lastSegment = (ref: string) => {
    const clean = ref.replace(/[`"\[\]]/g, "");
    const parts = clean.split(".");
    return parts[parts.length - 1]!.toLowerCase();
  };

  // COMMENT ON TABLE [schema.]tbl IS '...'
  const tblRx = /COMMENT\s+ON\s+TABLE\s+([\w."\[\]`]+)\s+IS\s+'((?:[^']|'')*)'/gi;
  let m: RegExpExecArray | null;
  while ((m = tblRx.exec(stripped)) !== null) {
    tableMap[lastSegment(m[1]!)] = unescape(m[2]!);
  }

  // COMMENT ON COLUMN [schema.]tbl.col IS '...'
  const colRx = /COMMENT\s+ON\s+COLUMN\s+([\w."\[\]`]+)\s+IS\s+'((?:[^']|'')*)'/gi;
  while ((m = colRx.exec(stripped)) !== null) {
    const clean = m[1]!.replace(/[`"\[\]]/g, "");
    const parts = clean.split(".");
    if (parts.length < 2) continue;  // tbl.col 형태 필수
    const col = parts[parts.length - 1]!.toLowerCase();
    const tbl = parts[parts.length - 2]!.toLowerCase();
    columnMap[`${tbl}.${col}`] = unescape(m[2]!);
  }

  return { tableMap, columnMap };
}

// ── [3] CREATE TABLE 블록 반복 추출 ────────────────────────────────────────
/**
 * 주석 제거된 문자열에서 각 `CREATE TABLE ... ( ... )` 를 블록으로 반환.
 * 괄호 깊이 추적으로 CONSTRAINT / 서브 괄호에서 멈추지 않음.
 * 닫는 괄호를 못 찾으면 에러로 기록하고 다음 CREATE TABLE 로 진행.
 */
type CreateBlock = {
  nameOffset: number;  // "CREATE TABLE" 선언 시작 offset (앞 줄 주석 탐색 기준)
  blockStart: number;  // 첫 '('
  bodyStart:  number;  // '(' 다음
  bodyEnd:    number;  // 짝 ')' 위치
  physclNm:   string;  // 쿼팅·스키마 제거 후 순수 물리명
};

function findCreateBlocks(stripped: string): { blocks: CreateBlock[]; errors: string[] } {
  const blocks: CreateBlock[] = [];
  const errors: string[] = [];

  // IF NOT EXISTS 까지 허용. 테이블 참조에 백틱/큰따옴표/대괄호 허용
  const headRx = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."\[\]`]+)\s*\(/gi;
  let m: RegExpExecArray | null;

  while ((m = headRx.exec(stripped)) !== null) {
    const nameOffset = m.index;
    const blockStart = m.index + m[0].length - 1;
    const rawName = m[1]!;
    const clean = rawName.replace(/[`"\[\]]/g, "");
    const parts = clean.split(".");
    const physclNm = parts[parts.length - 1]!;

    // 짝 ')' 탐색
    let depth = 0, bodyStart = blockStart + 1, bodyEnd = -1;
    for (let i = blockStart; i < stripped.length; i++) {
      const ch = stripped[i]!;
      if (ch === "(") {
        if (depth === 0) bodyStart = i + 1;
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) { bodyEnd = i; break; }
      }
    }

    if (bodyEnd === -1) {
      errors.push(`CREATE TABLE ${physclNm}: 닫는 괄호를 찾지 못했습니다.`);
      headRx.lastIndex = nameOffset + m[0].length;
      continue;
    }

    blocks.push({ nameOffset, blockStart, bodyStart, bodyEnd, physclNm });
    headRx.lastIndex = bodyEnd + 1;
  }

  return { blocks, errors };
}

// ── [4] 주석 매칭 헬퍼 ──────────────────────────────────────────────────────

/**
 * offset 바로 앞 "단독 주석"의 내용 반환.
 *
 * 정의:
 *   - offset 과 주석 사이에는 공백·개행만 있어야 한다 (코드가 끼면 매칭 불가)
 *   - 주석 자체도 자기 줄에서 단독이어야 한다 — 주석 시작 이전은 개행 또는 문서 시작
 *
 * 이 조건으로 다음을 모두 처리:
 *   - 한 줄짜리 `-- ...` 앞 주석
 *   - 여러 줄 `/* ... *\/` 앞 주석 (가장 큰 차이 — 이전 구현에선 안 됐음)
 *   - 주석과 offset 사이 빈 줄 삽입 허용
 *   - `CODE; /* ... *\/\nCREATE ...` 처럼 주석 앞에 코드 붙은 경우는 배제
 */
function getPrecedingLineComment(offset: number, src: string, comments: CommentEntry[]): string | null {
  // offset 이전에서 공백·개행을 스킵한 최초 비공백 문자 위치
  let i = offset - 1;
  while (i >= 0 && /\s/.test(src[i] ?? "")) i--;
  if (i < 0) return null;

  // 그 위치가 어떤 주석의 마지막 문자인지
  //   - 블록 주석(`/* */`) 의 end 는 `*/` 다음 → src[end-1] = '/'
  //   - 라인 주석(`-- ...`) 의 end 는 `\n` offset → src[end-1] = 주석 마지막 글자
  const matching = comments.find((c) => c.end - 1 === i);
  if (!matching) return null;

  // 해당 주석이 자기 줄에서 단독인지 — 주석 시작 이전을 공백(스페이스/탭)만 스킵했을 때
  // 만나는 문자가 개행이거나 문서 시작이어야 단독으로 본다
  let j = matching.start - 1;
  while (j >= 0 && /[ \t]/.test(src[j] ?? "")) j--;
  if (j >= 0 && src[j] !== "\n") return null;

  return matching.content;
}

/** 같은 줄 [lineStart, lineEnd) 에 있는 주석 중 가장 오른쪽 주석 내용 반환. */
function getInlineComment(lineStart: number, lineEnd: number, comments: CommentEntry[]): string | null {
  const entries = comments
    .filter((c) => c.start >= lineStart && c.start < lineEnd)
    .sort((a, b) => a.start - b.start);
  if (entries.length === 0) return null;
  return entries[entries.length - 1]!.content;
}

/** offset 위치의 원문 줄 범위 [start, end) 계산. */
function getLineRange(offset: number, src: string): { start: number; end: number } {
  let start = offset;
  while (start > 0 && src[start - 1] !== "\n") start--;
  let end = offset;
  while (end < src.length && src[end] !== "\n") end++;
  return { start, end };
}

// ── [5] 블록별 컬럼 파싱 ────────────────────────────────────────────────────

// 컬럼이 아닌 제약조건 라인을 걸러냄
const CONSTRAINT_KEYWORDS = /^\s*(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|INDEX|KEY|CHECK|FOREIGN\s+KEY)\b/i;

function parseBlockColumns(opts: {
  block:            CreateBlock;
  stripped:         string;
  src:              string;
  comments:         CommentEntry[];
  columnCommentMap: Record<string, string>;
}): { columns: ParsedCol[]; errors: string[] } {
  const { block, stripped, src, comments, columnCommentMap } = opts;
  const errors: string[] = [];
  const columns: ParsedCol[] = [];

  const body = stripped.slice(block.bodyStart, block.bodyEnd);

  // 괄호 깊이 고려 쉼표 split — 각 part 의 원본 offset 도 함께 추적 (주석 매칭용)
  type Part = { text: string; startOffset: number; endOffset: number };
  const parts: Part[] = [];
  let depth = 0, cur = "", curStart = block.bodyStart;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    const absIdx = block.bodyStart + i;
    if (ch === "(")      { depth++; cur += ch; }
    else if (ch === ")") { depth--; cur += ch; }
    else if (ch === "," && depth === 0) {
      parts.push({ text: cur, startOffset: curStart, endOffset: absIdx });
      cur = "";
      curStart = absIdx + 1;
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push({ text: cur, startOffset: curStart, endOffset: block.bodyEnd });

  const tblLower = block.physclNm.toLowerCase();

  for (const part of parts) {
    const trimmed = part.text.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    if (CONSTRAINT_KEYWORDS.test(trimmed)) continue;

    // 컬럼명 추출 (쿼팅 문자 허용)
    const colMatch = trimmed.match(/^[`"\[]?(\w+)[`"\]]?\s+(.+)$/);
    if (!colMatch) {
      errors.push(`컬럼 정의를 인식할 수 없습니다: "${trimmed.slice(0, 60)}"`);
      continue;
    }
    const colPhysclNm = colMatch[1]!;
    const rest        = colMatch[2]!;

    // 데이터 타입 추출 (괄호 포함, 이후 속성 직전까지)
    const typeMatch = rest.match(/^(\w+(?:\s*\([^)]*\))?)/i);
    const dataTyNm  = typeMatch ? typeMatch[1]!.trim() : rest.split(" ")[0]!;

    // 논리명 4계층
    const colKey = `${tblLower}.${colPhysclNm.toLowerCase()}`;
    let colLgclNm = "";

    // [1] COMMENT ON COLUMN
    if (columnCommentMap[colKey]) {
      colLgclNm = columnCommentMap[colKey]!;
    } else {
      // part 내부에서 공백 스킵한 실질 시작 offset.
      // 반드시 `stripped`(주석→공백 치환본) 기준으로 스킵해야 한다.
      // `src`(원문)를 보면 쉼표 뒤 주석의 '-' 나 '/' 같은 비공백 문자에 걸려 멈추고,
      // 그 결과 이전 컬럼 줄의 주석이 다음 컬럼에 잘못 매칭된다.
      let realStart = part.startOffset;
      while (realStart < part.endOffset && /\s/.test(stripped[realStart] ?? "")) realStart++;
      const { start: lineStart, end: lineEnd } = getLineRange(realStart, src);

      // [2] 같은 줄 인라인 주석
      const inline = getInlineComment(lineStart, lineEnd, comments);
      if (inline) {
        colLgclNm = inline;
      } else {
        // [3] 앞 줄 단독 주석
        const preceding = getPrecedingLineComment(realStart, src, comments);
        if (preceding) colLgclNm = preceding;
      }
    }

    columns.push({ colPhysclNm, colLgclNm, dataTyNm, colDc: "" });
  }

  return { columns, errors };
}

// ── [6] 통합 파서 ───────────────────────────────────────────────────────────

/**
 * DDL 스크립트에서 CREATE TABLE 블록을 모두 파싱해 테이블 배열로 반환.
 * 주석·COMMENT ON 을 활용해 테이블·컬럼 논리명을 자동 매핑한다.
 */
export function parseDdlScript(ddl: string): ParsedTable[] {
  if (!ddl || !ddl.trim()) return [];

  const { stripped, comments } = extractComments(ddl);
  const { tableMap: tblCommentMap, columnMap: colCommentMap } = extractCommentOn(stripped);
  const { blocks, errors: blockLevelErrors } = findCreateBlocks(stripped);

  // 블록 추출 경고는 콘솔에만 남김 — 블록을 못 만든 경우 UI에 노출할 엔티티 자체가 없다
  if (blockLevelErrors.length > 0) {
    console.warn("[ddlParser] 블록 추출 경고:", blockLevelErrors);
  }

  const results: ParsedTable[] = [];

  for (const block of blocks) {
    const { columns, errors } = parseBlockColumns({
      block, stripped, src: ddl, comments, columnCommentMap: colCommentMap,
    });

    // 테이블 논리명 4계층
    const physLower = block.physclNm.toLowerCase();
    let tblLgclNm = "";

    // [1] COMMENT ON TABLE
    if (tblCommentMap[physLower]) {
      tblLgclNm = tblCommentMap[physLower]!;
    } else {
      // [2] CREATE TABLE 선언 앞 줄 단독 주석
      const preceding = getPrecedingLineComment(block.nameOffset, ddl, comments);
      if (preceding) {
        tblLgclNm = preceding;
      } else {
        // [3] 오픈 괄호 '(' 다음 같은 줄 인라인 주석
        //     예) CREATE TABLE tb_member (  -- 회원
        const { end: lineEnd } = getLineRange(block.blockStart, ddl);
        const inline = getInlineComment(block.blockStart, lineEnd, comments);
        if (inline) tblLgclNm = inline;
      }
    }

    const rawBlock = ddl.slice(block.nameOffset, Math.min(block.bodyEnd + 1, ddl.length));

    results.push({
      tblPhysclNm: block.physclNm,
      tblLgclNm,
      tblDc:       "",
      columns,
      rawBlock,
      errors,
    });
  }

  return results;
}

// ── [7] 단일 테이블 컬럼 파서 — 기존 ADD DDL 호환용 ─────────────────────────

/**
 * 기존 상세 페이지의 `parseDdl(ddl: string): ParsedCol[]` 과 호환.
 * 내부적으로 `parseDdlScript` 를 호출한 뒤 첫 테이블의 컬럼만 반환.
 *
 * 장점: 기존 호출부 변경 최소. 블록 주석 `/* *\/` 지원 등 개선 자동 적용.
 */
export function parseSingleDdl(ddl: string): ParsedCol[] {
  const tables = parseDdlScript(ddl);
  return tables[0]?.columns ?? [];
}
