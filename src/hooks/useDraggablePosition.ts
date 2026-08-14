"use client";

/**
 * useDraggablePosition — 요소를 마우스 드래그로 이동시키는 좌표 상태
 *
 * RichEditor·MarkdownEditor의 "확대 창"(비모달 플로팅 패널) 헤더 드래그에 공용으로 사용.
 * ResizableImage.tsx의 리사이즈 드래그와 동일한 패턴(mousedown 시 window에 mousemove/up
 * 리스너 등록 후 mouseup에서 해제)을 위치 이동에 맞게 적용한 것.
 */

import { useCallback, useState } from "react";

export function useDraggablePosition(initial: { x: number; y: number }) {
  const [pos, setPos] = useState(initial);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const origX  = pos.x;
    const origY  = pos.y;

    const onMove = (ev: MouseEvent) => {
      setPos({ x: origX + (ev.clientX - startX), y: origY + (ev.clientY - startY) });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos]);

  return { pos, onDragStart };
}
