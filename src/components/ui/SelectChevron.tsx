/**
 * SelectChevron — sp-select-wrap / sp-select-arrow 패턴에서 사용하는 11x11 chevron 아이콘.
 *
 * 사용 예:
 *   <div className="sp-select-wrap">
 *     <select className="sp-input">...</select>
 *     <span className="sp-select-arrow"><SelectChevron /></span>
 *   </div>
 *
 * sp-input 의 -webkit-appearance:none 으로 인해 native arrow 가 사라지므로
 * 디자인 시스템 표준 패턴인 sp-select-arrow 와 짝지어 사용.
 */
export function SelectChevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
