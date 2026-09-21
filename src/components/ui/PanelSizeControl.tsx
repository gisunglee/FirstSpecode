"use client";

/**
 * PanelSizeControl — 확대 창 폭 넓게/좁게 + FULL 버튼
 *
 * 우하단 드래그 핸들(PanelResizeHandle)의 대안 조작법 — 정확한 드래그가 번거로울 때
 * 클릭만으로 단계 조절. 창 크기는 컴포넌트별 로컬 상태(useResizablePanelSize)라
 * FontScaleControl과 달리 전역 스토어가 아니라 부모에서 widen/narrow/toggleFull 을
 * 그대로 전달받는다. FULL 의 의미(세로 전체 + 가로 읽기 폭 상한)는 훅 쪽 주석 참고.
 */

import type { CSSProperties } from "react";

type Props = {
  onNarrow:     () => void;
  onWiden:      () => void;
  isFull:       boolean;
  onToggleFull: () => void;
};

export function PanelSizeControl({ onNarrow, onWiden, isFull, onToggleFull }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }} title="창 크기">
      <button type="button" onClick={onNarrow} title="창 좁게" style={btnStyle}>◀ 좁게</button>
      <button type="button" onClick={onWiden}  title="창 넓게" style={btnStyle}>넓게 ▶</button>
      <button
        type="button"
        onClick={onToggleFull}
        title={isFull ? "이전 크기로 돌아가기" : "세로를 화면 끝까지 키우기 (가로는 읽기 좋은 폭까지)"}
        style={isFull ? fullActiveBtnStyle : btnStyle}
      >
        ⛶ FULL
      </button>
    </div>
  );
}

// border를 shorthand로 두면 아래 fullActiveBtnStyle에서 borderColor만 덮어쓸 때
// React가 shorthand/longhand 혼용 경고를 내므로 longhand로 분리
const btnStyle: CSSProperties = {
  padding:      "2px 7px",
  borderRadius: 4,
  borderWidth:  1,
  borderStyle:  "solid",
  borderColor:  "var(--color-border)",
  background:   "var(--color-bg-muted)",
  color:        "var(--color-text-secondary)",
  fontSize:     11,
  fontWeight:   500,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};

const fullActiveBtnStyle: CSSProperties = {
  ...btnStyle,
  background:  "var(--color-brand)",
  color:       "var(--color-text-inverse)",
  borderColor: "var(--color-brand)",
};
