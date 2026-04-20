/**
 * renderMarkdown — 마크다운 → HTML 변환 공통 유틸
 *
 * 역할:
 *   - marked 라이브러리 기반 GFM(GitHub Flavored Markdown) 렌더링
 *   - 표(table), 코드블록(```), 체크박스 등 전체 마크다운 문법 지원
 *   - 전 프로젝트에서 단일 설정으로 일관된 렌더링 보장
 *
 * 사용:
 *   import { renderMarkdown } from "@/lib/renderMarkdown";
 *   <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
 *
 * 보안:
 *   이 앱은 인증된 사용자가 본인 데이터를 편집하는 내부 도구이므로
 *   XSS 위험이 낮음. 외부 사용자 입력을 노출하는 공개 페이지 추가 시
 *   DOMPurify 등으로 sanitize 레이어 추가 필요.
 */

import { marked } from "marked";

// ── marked 전역 옵션 ────────────────────────────────────────────────────────
// gfm: true  → GitHub Flavored Markdown (표, 취소선, 체크박스 등)
// breaks: true → 줄바꿈 1개를 <br>로 변환 (일반 텍스트 입력 편의)
marked.setOptions({
  gfm:    true,
  breaks: true,
});

/**
 * 마크다운 문자열을 HTML 문자열로 변환
 * - 빈 값이면 빈 문자열 반환
 * - marked.parse()는 동기 함수 (async: false 기본값)
 * - diff 코드블록(````diff`)에 sp-diff 클래스를 추가하여 CSS로 라인별 색상 강조 가능
 */
export function renderMarkdown(md: string | null | undefined): string {
  if (!md?.trim()) return "";

  // marked.parse()는 string | Promise<string> 반환 타입이지만
  // async: false(기본값)이므로 실제로는 항상 string
  let html = marked.parse(md) as string;

  // diff 코드블록 강조
  // 1. 클래스 추가: <pre>에 sp-diff-block, <code>에 sp-diff
  // 2. 내부 라인별 span 래핑: +/- 라인에 색상 클래스 적용
  html = html.replace(
    /<pre><code class="language-diff">([\s\S]*?)<\/code><\/pre>/g,
    (_match, inner: string) => {
      const colored = colorizeDiffLines(inner);
      return `<pre class="sp-diff-block"><code class="language-diff sp-diff">${colored}</code></pre>`;
    }
  );

  return html;
}

/**
 * diff 코드블록 내부의 각 라인에 CSS 클래스 span을 적용
 * - @@ 섹션 헤더 → sp-diff-line-section (파랑)
 * - + [추가] → sp-diff-line-add (초록)
 * - - [삭제] → sp-diff-line-del (빨강)
 * - 기타 → 그대로
 */
function colorizeDiffLines(html: string): string {
  return html
    .split("\n")
    .map((line) => {
      // HTML 엔티티가 적용된 상태이므로 원본 텍스트 기준으로 판정
      const trimmed = line.trimStart();
      if (trimmed.startsWith("@@")) {
        return `<span class="sp-diff-line-section">${line}</span>`;
      }
      if (trimmed.startsWith("+ [") || trimmed.startsWith("+")) {
        return `<span class="sp-diff-line-add">${line}</span>`;
      }
      if (trimmed.startsWith("- [") || trimmed.startsWith("-")) {
        return `<span class="sp-diff-line-del">${line}</span>`;
      }
      return line;
    })
    .join("\n");
}
