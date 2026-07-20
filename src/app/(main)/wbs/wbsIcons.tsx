/**
 * wbsIcons.tsx — WBS 필터바 전용 소형 화살표 아이콘
 *
 * 예전엔 «‹›» 같은 유니코드 글자를 버튼 텍스트로 썼는데 폰트에 따라 너무 작고 흐리게
 * 보인다는 피드백 반영 — menuIcons.tsx 와 동일한 모노크롬 라인 스타일(24x24, stroke 2.2,
 * currentColor)의 실제 SVG 아이콘으로 교체.
 */

function IconWrap({ children, size = 14 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2.2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      {children}
    </svg>
  );
}

export function ChevronLeftIcon(props: { size?: number }) {
  return <IconWrap {...props}><path d="M15 18l-6-6 6-6" /></IconWrap>;
}
export function ChevronRightIcon(props: { size?: number }) {
  return <IconWrap {...props}><path d="M9 18l6-6-6-6" /></IconWrap>;
}
export function ChevronsLeftIcon(props: { size?: number }) {
  return <IconWrap {...props}><path d="M18 17l-5-5 5-5M11 17l-5-5 5-5" /></IconWrap>;
}
export function ChevronsRightIcon(props: { size?: number }) {
  return <IconWrap {...props}><path d="M6 17l5-5-5-5M13 17l5-5-5-5" /></IconWrap>;
}
