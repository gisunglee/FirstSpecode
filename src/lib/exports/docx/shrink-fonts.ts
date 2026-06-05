/**
 * exports/docx/shrink-fonts.ts — 생성된 docx 의 폰트 크기를 일괄 축소 (후처리)
 *
 * 역할:
 *   - Packer 로 만든 .docx(zip) 안의 모든 글꼴 크기를 규칙에 따라 줄인다.
 *   - 규칙: 10pt 초과만 1pt 축소, 10pt 이하(표 셀 10pt·머리글 10pt·바닥글 9/8pt 등)는 유지.
 *     (docx 의 글꼴 크기 단위는 half-point — 10pt = 20. 그래서 "20 초과면 -2".)
 *
 * 왜 후처리인가:
 *   - 글꼴 크기는 공유 토큰(tokens.ts)·헬퍼(helpers.ts)·프레임(frame.ts)에서 나온다.
 *     토큰을 바꾸면 모든 Word 산출물이 한꺼번에 바뀐다.
 *   - "산출물별로 하나씩 적용해 확인" 하려면, 그 산출물의 출력 버퍼에만 이 변환을 거는 게
 *     가장 깔끔하다. (해당 빌더가 명시적으로 호출 → 숨은 동작 아님)
 *   - 추후 모든 산출물에 적용하기로 확정되면, 이 후처리 대신 tokens.ts 값을 직접 줄이고
 *     이 모듈을 제거하는 게 더 단순하다.
 *
 * 안전성:
 *   - 글꼴 크기는 `<w:sz w:val="N"/>` / `<w:szCs w:val="N"/>` 요소다.
 *     표 보더 두께는 `w:sz="4"` 처럼 "속성" 형태라 이 정규식에 걸리지 않는다 (오변환 방지).
 */

import JSZip from "jszip";

/** half-point 기준 임계값 — 20(=10pt) 초과만 축소 */
const KEEP_AT_OR_BELOW = 20;
/** 1pt = half-point 2 */
const SHRINK_BY = 2;

/** 한 XML 문자열의 글꼴 크기 요소를 규칙대로 축소. */
function shrinkXml(xml: string): string {
  return xml.replace(
    /<w:(sz|szCs)\s+w:val="(\d+)"\s*\/>/g,
    (match, tag: string, val: string) => {
      const n = parseInt(val, 10);
      if (n <= KEEP_AT_OR_BELOW) return match; // 10pt 이하 유지
      return `<w:${tag} w:val="${n - SHRINK_BY}"/>`;
    },
  );
}

/**
 * docx 버퍼의 본문/머리글/바닥글/스타일 글꼴 크기를 일괄 축소한 새 버퍼를 반환.
 *
 * @param buffer  Packer.toBuffer(doc) 결과
 */
export async function shrinkDocxFonts(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);

  // word/document.xml, word/header*.xml, word/footer*.xml, word/styles.xml 등
  const xmlParts = Object.keys(zip.files).filter(
    (name) => name.startsWith("word/") && name.endsWith(".xml"),
  );

  for (const name of xmlParts) {
    const file = zip.file(name);
    if (!file) continue;
    const xml  = await file.async("string");
    const next = shrinkXml(xml);
    if (next !== xml) zip.file(name, next);
  }

  return zip.generateAsync({ type: "nodebuffer" });
}
