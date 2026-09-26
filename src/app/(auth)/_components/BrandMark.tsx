/**
 * BrandMark — SPECODE 번개 로고 마크 (SVG)
 *
 * 역할:
 *   - 인증 화면(좌측 패널 브랜드, AuthCard 로고)에서 쓰는 번개 모양.
 *   - ⚡ 이모지는 OS·브라우저마다 모양과 색이 달라지고(Windows 에서는 주황 바탕에 묻힘)
 *     글자색(color)을 따르지 않으므로 SVG 로 그린다. 색은 fill="currentColor" 로
 *     부모 클래스(.sp-auth-brand-mark / .sp-auth-card-logo)의 color 를 따른다.
 *   - 크기는 부모가 CSS 로 정한다 (width/height 1em 기준).
 */

export function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M13.2 2.5 4.8 13.4c-.4.5 0 1.1.6 1.1h5.3l-1.1 7c-.1.7.8 1.1 1.2.5l8.4-10.9c.4-.5 0-1.1-.6-1.1h-5.3l1.1-7c.1-.7-.8-1.1-1.2-.5Z" />
    </svg>
  );
}
