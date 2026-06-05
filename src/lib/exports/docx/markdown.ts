/**
 * exports/docx/markdown.ts — 자유 마크다운을 docx 요소로 변환하는 공통 파서/렌더러
 *
 * 역할:
 *   - 사용자 입력(요구사항 상세 명세 / 단위업무 설명 / 영역 설명 / 기능 설명 등)에
 *     포함된 가벼운 마크다운을 docx Paragraph/Table 로 변환한다.
 *   - 모든 산출물 빌더(requirement.ts / unit-work.ts / 향후 산출물)가 import 해서 사용.
 *
 * 인식 토큰:
 *   - 헤딩         — `#` ~ `######` (1~6단계)
 *   - 불릿         — `- ` 또는 `* `
 *   - 번호 항목    — `1. ` 또는 `1) `
 *   - 인용문       — `> 텍스트`
 *   - 수평선       — `---` 또는 `***` (3개 이상)
 *   - 코드 블록    — ``` ``` ``` ``` 또는 `~~~ ~~~` 페어
 *   - 표           — GFM 표 (`| ... |` 헤더 + `|---|` 구분선 + 데이터 행)
 *   - 일반 문단    — 그 외
 *   - 인라인       — `**굵게**`, `` `code` `` (helpers.parseInline 에서 처리)
 *
 * 정규식 정책 (오인식 회피):
 *   - 표 구분선(`|---|`)과 수평선(`---`) 충돌 회피 → 표가 looksLikeTableRow 로 먼저 가로챔
 *   - 코드 블록 fence 안의 라인은 어떤 마커도 처리하지 않고 그대로 보존 (들여쓰기 X)
 *
 * 빌더별 커스터마이즈:
 *   - 헤딩 출력 방식이 빌더마다 다르다 (자동번호 prefix 부착 vs 일반 굵은 문단).
 *     → renderMarkdown 의 옵션으로 renderHeading 콜백 주입.
 */

import {
  Paragraph, Table, TableRow, TextRun, ImageRun,
  AlignmentType, WidthType,
} from "docx";
import sizeOf from "image-size";
import {
  CONTENT_WIDTH,
  COLOR_PRIMARY, FONT,
  SIZE_BODY, SIZE_HEADING_2,
} from "./tokens";
import {
  p, headerCell, valueCell,
  bulletItem, numberedItem,
  codeBlock, quoteParagraph, horizontalRule,
} from "./helpers";
import { looksLikeHtml, htmlToBlocks } from "./html";

// ═══════════════════════════════════════════════════════════════════════
//  파서
// ═══════════════════════════════════════════════════════════════════════

export type MarkdownBlock =
  | { kind: "heading"; text: string; level: number }
  | { kind: "bullet";  text: string }
  | { kind: "number";  text: string }
  | { kind: "plain";   text: string }
  | { kind: "table";   header: string[]; rows: string[][] }
  | { kind: "code";    text: string }
  | { kind: "quote";   text: string }
  | { kind: "hr" }
  | { kind: "image";   data: Buffer; type: ImageType; alt: string; displayWidth?: number };

/** docx ImageRun 이 받는 type 파라미터와 호환. */
export type ImageType = "png" | "jpg" | "gif" | "bmp";

// "|----|---|" 같은 GFM 표 구분선 — `-` 가 적어도 1개 + 셀이 -, :, 공백, | 로만 구성
function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line) && line.includes("-");
}
// "| a | b | c |" → ["a", "b", "c"]
function splitTableRow(line: string): string[] {
  return line.slice(1, -1).split("|").map((c) => c.trim());
}
// 양 끝이 | 이고 내부에 | 가 있어야 표 행 (셀 2개 이상)
function looksLikeTableRow(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|") && line.length > 2 && line.includes("|", 1);
}

/**
 * 자유 마크다운 문자열 → MarkdownBlock 배열.
 * 빈 줄은 블록 구분자로만 사용되고 출력엔 영향 없음.
 */
export function parseMarkdown(md: string): MarkdownBlock[] {
  const lines = md.split(/\r?\n/);
  const out: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) { i++; continue; }

    // ── 코드 블록 (``` 또는 ~~~) ───────────────────────────────
    // 안의 줄은 트림 안 함 — ASCII 박스/들여쓰기 정렬 보존
    const fenceMatch = line.match(/^(```|~~~)/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      i++;
      const buf: string[] = [];
      while (i < lines.length) {
        const t = lines[i];
        if (t.trim().startsWith(fence)) { i++; break; }
        buf.push(t);
        i++;
      }
      out.push({ kind: "code", text: buf.join("\n") });
      continue;
    }

    // ── 표 (헤더 + 구분선 연속) ────────────────────────────────
    if (looksLikeTableRow(line) && isTableSeparator((lines[i + 1] ?? "").trim())) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!looksLikeTableRow(t)) break;
        const cells = splitTableRow(t);
        while (cells.length < header.length) cells.push("");
        rows.push(cells.slice(0, header.length));
        i++;
      }
      out.push({ kind: "table", header, rows });
      continue;
    }

    // ── 수평선 (--- 또는 ***) ─────────────────────────────────
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push({ kind: "hr" });
      i++;
      continue;
    }
    // ── 인용문 (>) ────────────────────────────────────────────
    if (line.startsWith(">")) {
      out.push({ kind: "quote", text: line.replace(/^>\s?/, "") });
      i++;
      continue;
    }

    // ── 헤딩 (긴 마커 우선 매치) / 리스트 / 일반 문단 ──────────
    if (line.startsWith("###### "))      out.push({ kind: "heading", text: line.slice(7), level: 6 });
    else if (line.startsWith("##### "))  out.push({ kind: "heading", text: line.slice(6), level: 5 });
    else if (line.startsWith("#### "))   out.push({ kind: "heading", text: line.slice(5), level: 4 });
    else if (line.startsWith("### "))    out.push({ kind: "heading", text: line.slice(4), level: 3 });
    else if (line.startsWith("## "))     out.push({ kind: "heading", text: line.slice(3), level: 2 });
    else if (line.startsWith("# "))      out.push({ kind: "heading", text: line.slice(2), level: 1 });
    else if (/^[-*]\s+/.test(line))      out.push({ kind: "bullet", text: line.replace(/^[-*]\s+/, "") });
    else if (/^\d+[.)]\s+/.test(line))   out.push({ kind: "number", text: line.replace(/^\d+[.)]\s+/, "") });
    else out.push({ kind: "plain", text: line });
    i++;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
//  표 빌더 (자동 폭 분배)
//
//  - 2컬럼 + 1열 평균 ≤ 8글자 → "라벨/값" 패턴으로 간주, 28/72 분배
//  - 그 외 → 균등 분할. 마지막 컬럼이 자투리 흡수해 합계 = CONTENT_WIDTH
// ═══════════════════════════════════════════════════════════════════════
export function buildMarkdownTable(header: string[], rows: string[][]): Table {
  const colCount = header.length;

  const isLabelValue = colCount === 2 && rows.length > 0 && (() => {
    const avg = rows.reduce((sum, r) => sum + (r[0]?.length ?? 0), 0) / rows.length;
    return avg <= 8;
  })();

  let widths: number[];
  if (isLabelValue) {
    const labelW = Math.floor(CONTENT_WIDTH * 0.28);
    widths = [labelW, CONTENT_WIDTH - labelW];
  } else {
    const baseW = Math.floor(CONTENT_WIDTH / colCount);
    widths = header.map((_, i) =>
      i === colCount - 1 ? CONTENT_WIDTH - baseW * (colCount - 1) : baseW
    );
  }

  return new Table({
    width:        { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map((h, i) => headerCell(h, widths[i])),
      }),
      ...rows.map((r) => new TableRow({
        children: r.map((cell, i) => valueCell(cell, widths[i])),
      })),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  렌더러
// ═══════════════════════════════════════════════════════════════════════

export type RenderMarkdownOptions = {
  /** 빈 입력 시 출력할 placeholder. null 또는 미지정이면 빈 배열 반환. */
  emptyText?: string | null;
  /**
   * 헤딩 출력 방식. 미지정 시 기본 = level 별 크기 차등의 일반 굵은 문단.
   * 빌더가 자동번호("2.X") prefix 같은 커스터마이즈를 원할 때 주입.
   *
   * @param text   `#` 마커를 제거한 헤딩 텍스트
   * @param level  1~6
   * @param idx    이 입력 안에서 등장한 헤딩 순번 (1부터)
   */
  renderHeading?: (text: string, level: number, idx: number) => Paragraph;
};

// ─── 이미지 렌더 ─────────────────────────────────────
/**
 * 이미지 블록 → docx Paragraph (ImageRun 단일 자식).
 *
 * 크기 결정 정책:
 *   1) 에디터에서 지정한 표시 너비(displayWidth, px)가 있으면 그 값을 우선 — 사용자가
 *      웹에디터에서 줄여 둔 스크린샷이 출력 시 다시 커지지 않도록.
 *   2) 없으면 원본 픽셀 너비 사용.
 *   3) 어느 경우든 본문 폭(IMAGE_MAX_PX)을 넘으면 축소 (페이지 밖으로 안 나가게).
 *   - 높이는 항상 원본 비율로 산출 — 가로세로 왜곡 방지.
 *
 * 본문 폭(CONTENT_WIDTH ≈ 9026 DXA) 안에서 헤더/푸터 제외 약 480px 를 max 로 둔다.
 */
const IMAGE_MAX_PX = 480;

function buildImageParagraph(
  block: { data: Buffer; type: ImageType; alt: string; displayWidth?: number },
): Paragraph {
  // 원본 픽셀 크기 — 비율 산출 + fallback. 실패 시 4:3 기본 가정.
  let intrinsicW = IMAGE_MAX_PX;
  let intrinsicH = Math.round(IMAGE_MAX_PX * 0.75);
  try {
    const dim = sizeOf(block.data);
    if (dim.width && dim.height) {
      intrinsicW = dim.width;
      intrinsicH = dim.height;
    }
  } catch {
    // sizeOf 실패 — 기본값 그대로 유지
  }

  const ratio = intrinsicH / intrinsicW;
  // 목표 너비 = 에디터 지정 너비(있으면) 또는 원본 너비. 단 본문 폭 초과 시 축소.
  const desiredW = block.displayWidth && block.displayWidth > 0 ? block.displayWidth : intrinsicW;
  const width  = Math.min(desiredW, IMAGE_MAX_PX);
  const height = Math.round(width * ratio);

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [
      new ImageRun({
        data: block.data,
        transformation: { width, height },
        type: block.type,
        altText: block.alt
          ? { title: block.alt, description: block.alt, name: block.alt }
          : undefined,
      }),
    ],
  });
}

/** 기본 헤딩 렌더러 — level 1 은 약간 큰 굵은 문단, 그 외는 본문 굵기. */
function defaultHeadingRenderer(text: string, level: number): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 100 },
    children: [
      new TextRun({
        text,
        font:  FONT,
        size:  level <= 1 ? SIZE_HEADING_2 : SIZE_BODY,
        bold:  true,
        color: COLOR_PRIMARY,
      }),
    ],
  });
}

/**
 * 자유 마크다운 *또는* HTML 문자열을 docx 요소 배열로 변환.
 *
 * 입력이 HTML 로 감지되면 HTML 파서가 MarkdownBlock[] 으로 정규화 (이미지 임베드 포함),
 * 그 외엔 마크다운 파서 사용. 두 경로 모두 같은 렌더 파이프라인을 통과한다.
 *
 * @param md    원본 (마크다운 / HTML 혼용 허용)
 * @param opts  렌더 옵션 — emptyText, renderHeading 커스터마이즈
 */
export function renderMarkdown(
  md: string,
  opts: RenderMarkdownOptions = {},
): (Paragraph | Table)[] {
  if (!md.trim()) {
    return opts.emptyText
      ? [p(opts.emptyText, { color: "808080" })]
      : [];
  }

  // HTML 감지 시 HTML→블록 변환, 그 외엔 마크다운 파서.
  // 두 경로 모두 결과는 MarkdownBlock[] 이므로 아래 렌더 루프는 동일하다.
  const blocks = looksLikeHtml(md) ? htmlToBlocks(md) : parseMarkdown(md);

  // HTML 변환 결과가 비어 있을 수 있음 — emptyText 동일 처리
  if (blocks.length === 0) {
    return opts.emptyText
      ? [p(opts.emptyText, { color: "808080" })]
      : [];
  }

  const renderHeading = opts.renderHeading ?? defaultHeadingRenderer;
  const out: (Paragraph | Table)[] = [];
  let headingIdx = 0;

  for (const b of blocks) {
    switch (b.kind) {
      case "heading":
        headingIdx++;
        out.push(renderHeading(b.text, b.level, headingIdx));
        break;
      case "bullet":  out.push(bulletItem(b.text));   break;
      case "number":  out.push(numberedItem(b.text)); break;
      case "plain":   out.push(p(b.text));            break;
      case "table":   out.push(buildMarkdownTable(b.header, b.rows)); break;
      case "code":    out.push(codeBlock(b.text));    break;
      case "quote":   out.push(quoteParagraph(b.text)); break;
      case "hr":      out.push(horizontalRule());     break;
      case "image":   out.push(buildImageParagraph(b)); break;
    }
  }
  return out;
}
