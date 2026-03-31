/**
 * useTripleClick — 빠른 3연타 클릭 감지 훅
 *
 * 역할:
 *   - window 전체에 click 리스너를 붙여 지정 시간(threshold) 내에
 *     3번 연속 클릭이 발생하면 callback을 실행한다.
 *   - 컴포넌트 언마운트 시 리스너 자동 정리.
 *
 * 사용 예시:
 *   useTripleClick(() => toggleSidebar());         // 기본 400ms
 *   useTripleClick(() => doSomething(), { threshold: 500 });
 */

import { useEffect, useRef } from "react";

type Options = {
  /** 연속 클릭으로 인정하는 최대 간격 (ms). 기본값 400 */
  threshold?: number;
};

export function useTripleClick(callback: () => void, options: Options = {}) {
  const { threshold = 400 } = options;

  // 마지막 클릭 시각과 연속 카운트를 ref로 관리
  // (state로 관리하면 불필요한 리렌더 발생)
  const clickCount = useRef(0);
  const lastClickTime = useRef(0);

  useEffect(() => {
    function handleClick() {
      const now = Date.now();
      const elapsed = now - lastClickTime.current;

      if (elapsed <= threshold) {
        // 이전 클릭과 충분히 가까우면 카운트 증가
        clickCount.current += 1;
      } else {
        // 간격이 너무 길면 카운트 리셋 후 1로 시작
        clickCount.current = 1;
      }

      lastClickTime.current = now;

      if (clickCount.current >= 3) {
        clickCount.current = 0; // 트리거 후 즉시 리셋 (연속 트리거 방지)
        callback();
      }
    }

    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  // callback이 바뀌어도 리스너 재등록을 막기 위해 ref로 래핑하지 않고
  // threshold 변경 시에만 재등록 — callback은 안정적인 함수(store action)여야 함
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);
}
