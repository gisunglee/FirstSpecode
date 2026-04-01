import { useEffect } from "react";

/**
 * useEscapeKey — ESC 키 누를 때 콜백 실행
 *
 * @param callback - ESC 눌렸을 때 실행할 함수 (보통 onClose)
 * @param enabled  - false이면 리스너 등록 안 함 (팝업이 닫혀있을 때 비활성화)
 */
export function useEscapeKey(callback: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") callback();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [callback, enabled]);
}
