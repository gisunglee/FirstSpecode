"use client";

/**
 * useResizablePanelSize — 확대 창(플로팅 패널)의 폭·높이를 우하단 핸들 드래그로 조절
 *
 * ResizableImage.tsx의 이미지 리사이즈와 동일한 mousedown→window mousemove/up 패턴을
 * 폭+높이 동시 조절로 확장한 것. RichEditor·MarkdownEditor 확대 창에서 공용으로 사용.
 *
 * FULL 모드도 여기서 함께 관리한다 — "세로는 화면 끝까지, 가로는 읽기 좋은 폭까지".
 * 본문이 글(마크다운·리치텍스트)이라 한 줄이 너무 길어지면 오히려 읽기 힘들어지므로
 * 메모 모달의 FULL(96vw)처럼 가로를 꽉 채우지 않고 FULL_MAX_WIDTH 로 상한을 둔다.
 * 가로가 더 필요하면 넓게 버튼을 누르면 FULL 이 풀리고 단계 조절로 넘어간다.
 */

import { useCallback, useState } from "react";
import type { CSSProperties } from "react";

const MIN_WIDTH  = 420;
const MIN_HEIGHT = 280;
const MAX_WIDTH  = 1600;
// 넓게/좁게 한 번에 움직이는 폭 — 80px 이던 시절 "너무 조금씩 늘어나서 힘들다"는 피드백으로 키움
const WIDTH_STEP = 200;

// FULL 모드 — 화면 가장자리에서 띄우는 여백과 가로 상한(읽기 좋은 폭)
const FULL_VIEWPORT_MARGIN = 24;
const FULL_MAX_WIDTH       = 1200;

export function useResizablePanelSize(initial: { width: number; height: number }) {
  const [size, setSize]     = useState(initial);
  const [isFull, setIsFull] = useState(false);

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

  // 헤더의 "넓게/좁게" 버튼용 — 드래그 핸들과 별개로 폭만 단계 조절(높이는 그대로 둠).
  // FULL 상태에서 누르면 FULL 을 풀고 직전 크기 기준으로 단계 조절을 이어간다.
  const widen = useCallback(() => {
    setIsFull(false);
    setSize((s) => ({ ...s, width: Math.min(MAX_WIDTH, s.width + WIDTH_STEP) }));
  }, []);
  const narrow = useCallback(() => {
    setIsFull(false);
    setSize((s) => ({ ...s, width: Math.max(MIN_WIDTH, s.width - WIDTH_STEP) }));
  }, []);

  const toggleFull = useCallback(() => setIsFull((v) => !v), []);

  return { size, isFull, onResizeStart, widen, narrow, toggleFull };
}

/**
 * 확대 창의 위치·크기 부분 스타일 — RichEditor·MarkdownEditor 가 같은 규칙을 쓰도록 공용화.
 * 일반 모드는 드래그 좌표 + 단계/핸들 크기, FULL 모드는 가운데 정렬 + 세로 전체.
 */
export function expandedPanelFrameStyle(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  isFull: boolean,
): CSSProperties {
  if (isFull) {
    return {
      position:  "fixed",
      top:       FULL_VIEWPORT_MARGIN,
      left:      "50%",
      transform: "translateX(-50%)",
      width:     FULL_MAX_WIDTH,
      maxWidth:  `calc(100vw - ${FULL_VIEWPORT_MARGIN * 2}px)`,
      height:    `calc(100vh - ${FULL_VIEWPORT_MARGIN * 2}px)`,
    };
  }
  return {
    position:  "fixed",
    left:      pos.x,
    top:       pos.y,
    width:     size.width,
    maxWidth:  "calc(100vw - 48px)",
    height:    size.height,
    maxHeight: "calc(100vh - 48px)",
  };
}
