/**
 * ProjectAbbrChip — 프로젝트 약어 부제 칩
 *
 * 역할:
 *   - 프로젝트명 옆에 작은 monospace 칩으로 약어 표시 (예: GBMS)
 *   - value 가 null/undefined/빈문자열이면 아무것도 렌더링하지 않음 — 호출부의 conditional 제거
 *
 * 사용처:
 *   - 프로젝트 목록 행, GNB 셀렉터 현재값, GNB 드롭다운 항목
 */

type Props = {
  value: string | null | undefined;
};

export default function ProjectAbbrChip({ value }: Props) {
  if (!value) return null;
  return (
    <span
      style={{
        fontSize:     "var(--text-xs)",
        color:        "var(--color-text-secondary)",
        fontFamily:   "var(--font-mono)",
        padding:      "1px 6px",
        background:   "var(--color-bg-elevated)",
        borderRadius: "var(--radius-sm, 3px)",
        flexShrink:   0,
      }}
    >
      {value}
    </span>
  );
}
