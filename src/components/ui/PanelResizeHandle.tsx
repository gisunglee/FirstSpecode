"use client";

/**
 * PanelResizeHandle — 확대 창 우하단 리사이즈 핸들(시각 요소)
 *
 * 드래그 로직은 useResizablePanelSize가 담당하고, 이 컴포넌트는 핸들 표시만 담당.
 */

import type { MouseEventHandler } from "react";

export function PanelResizeHandle({ onMouseDown }: { onMouseDown: MouseEventHandler }) {
  return (
    <div
      onMouseDown={onMouseDown}
      title="드래그해서 크기 조절"
      style={{
        position:     "absolute",
        bottom:       2,
        right:        2,
        width:        14,
        height:       14,
        cursor:       "nwse-resize",
        zIndex:       10,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" style={{ display: "block" }}>
        <path d="M12 2 L2 12 M12 7 L7 12 M12 12 L12 12" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}
