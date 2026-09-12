"use client";

/**
 * useRelativeTimeTick — 상대시간 표시를 주기적으로 갱신시키는 훅
 *
 * 왜 필요한가:
 *   "12초 전", "3분 전" 같은 표시는 렌더 시점에 한 번 계산된 문자열이다.
 *   목록을 열어둔 채 두면 값이 그 자리에 멈춰 화면이 거짓말을 하게 된다.
 *   특히 초 단위를 보여주는 이상 갱신은 선택이 아니라 필수다.
 *
 * 무엇을 하는가:
 *   일정 주기로 강제 리렌더만 일으킨다. 데이터를 다시 불러오지 않으므로
 *   서버 호출이나 캐시 무효화는 발생하지 않는다.
 *
 * 사용법:
 *   function ListPage() {
 *     useRelativeTimeTick();          // 기본 10초
 *     return <ModifiedCell ... />;
 *   }
 */

import { useEffect, useReducer } from "react";

// 10초 — 초 단위 표시("12초 전")가 실제 경과와 크게 어긋나지 않는 선에서
// 가장 성긴 주기. 더 짧게 잡을 이유가 없고, 더 길면 초 표시가 부정확해진다.
const DEFAULT_INTERVAL_MS = 10_000;

export function useRelativeTimeTick(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}
