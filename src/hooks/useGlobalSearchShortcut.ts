"use client";

/**
 * useGlobalSearchShortcut — Ctrl+K (Cmd+K) 전역 단축키 바인딩
 *
 * 역할:
 *   - 어디서든 Ctrl+K(Win) / Cmd+K(Mac) 누르면 GlobalSearchDialog 토글
 *   - 입력창·textarea 안에서 누른 경우도 동작 (브라우저 기본 동작은 메뉴가 아니라 주소창이므로 preventDefault)
 *
 * 사용:
 *   - MainLayout 최상단에서 한 번 호출
 */

import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";

export function useGlobalSearchShortcut() {
  const toggle = useAppStore((s) => s.toggleGlobalSearch);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // 패스워드 매니저/IME/오토필이 e.key 없는 합성 이벤트를 쏘는 케이스가 있어
      // toLowerCase 호출 전 방어 (없으면 비밀번호 입력창 등에서 TypeError 발생)
      if (typeof e.key !== "string") return;
      // Ctrl+K / Cmd+K — 대소문자 무시
      const key = e.key.toLowerCase();
      const isShortcut = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === "k";
      if (isShortcut) {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);
}
