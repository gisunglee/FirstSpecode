"use client";

/**
 * PanelSizeControl — 확대 창 폭 넓게/좁게 버튼
 *
 * 우하단 드래그 핸들(PanelResizeHandle)의 대안 조작법 — 정확한 드래그가 번거로울 때
 * 클릭만으로 단계 조절. 창 크기는 컴포넌트별 로컬 상태(useResizablePanelSize)라
 * FontScaleControl과 달리 전역 스토어가 아니라 부모에서 widen/narrow를 그대로 전달받는다.
 */

import type { CSSProperties } from "react";

export function PanelSizeControl({ onNarrow, onWiden }: { onNarrow: () => void; onWiden: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }} title="창 폭">
      <button type="button" onClick={onNarrow} title="창 좁게" style={btnStyle}>◀ 좁게</button>
      <button type="button" onClick={onWiden}  title="창 넓게" style={btnStyle}>넓게 ▶</button>
    </div>
  );
}

const btnStyle: CSSProperties = {
  padding:      "2px 7px",
  borderRadius: 4,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-muted)",
  color:        "var(--color-text-secondary)",
  fontSize:     11,
  fontWeight:   500,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};
