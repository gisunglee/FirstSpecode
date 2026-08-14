"use client";

/**
 * useResizablePanelSize — 확대 창(플로팅 패널)의 폭·높이를 우하단 핸들 드래그로 조절
 *
 * ResizableImage.tsx의 이미지 리사이즈와 동일한 mousedown→window mousemove/up 패턴을
 * 폭+높이 동시 조절로 확장한 것. RichEditor·MarkdownEditor 확대 창에서 공용으로 사용.
 */

import { useCallback, useState } from "react";

const MIN_WIDTH  = 420;
const MIN_HEIGHT = 280;
const MAX_WIDTH  = 1400;
const WIDTH_STEP = 80;

export function useResizablePanelSize(initial: { width: number; height: number }) {
  const [size, setSize] = useState(initial);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const origW  = size.width;
    const origH  = size.height;

    const onMove = (ev: MouseEvent) => {
      setSize({
        width:  Math.max(MIN_WIDTH,  origW + (ev.clientX - startX)),
        height: Math.max(MIN_HEIGHT, origH + (ev.clientY - startY)),
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [size]);

  // 헤더의 "넓게/좁게" 버튼용 — 드래그 핸들과 별개로 폭만 단계 조절(높이는 그대로 둠)
  const widen  = useCallback(() => setSize((s) => ({ ...s, width: Math.min(MAX_WIDTH, s.width + WIDTH_STEP) })), []);
  const narrow = useCallback(() => setSize((s) => ({ ...s, width: Math.max(MIN_WIDTH, s.width - WIDTH_STEP) })), []);

  return { size, onResizeStart, widen, narrow };
}
