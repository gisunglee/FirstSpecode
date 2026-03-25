/**
 * appStore — 전역 앱 상태 (Zustand)
 *
 * 역할:
 *   - 현재 활성 프로젝트 ID (GNB 프로젝트 셀렉터에서 변경)
 *   - 테마 (dark/light/dark-purple) — localStorage 영속화
 *   - 사이드바 접힘 상태 — localStorage 영속화
 *
 * 사용 위치:
 *   - GNB: 프로젝트 전환, 테마 전환
 *   - LNB: 사이드바 접힘/펼침
 *   - StatusBar: 현재 프로젝트 ID 기반 데이터 폴링
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Theme } from "@/types/layout";

type AppState = {
  // 현재 작업 중인 프로젝트 ID (null = 프로젝트 미선택)
  currentProjectId: string | null;
  // 테마 — document.documentElement의 data-theme 속성과 동기화
  theme: Theme;
  // 사이드바 접힘 여부
  sidebarCollapsed: boolean;
};

type AppActions = {
  setCurrentProjectId: (id: string | null) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
};

// theme와 sidebarCollapsed만 persist — projectId는 세션 초기화 시 재선택
export const useAppStore = create<AppState & AppActions>()(
  persist(
    (set, get) => ({
      currentProjectId: null,
      theme: "dark",
      sidebarCollapsed: false,

      setCurrentProjectId: (id) => set({ currentProjectId: id }),

      setTheme: (theme) => {
        // document에 data-theme 반영 (CSS 토큰 전환 트리거)
        if (typeof document !== "undefined") {
          document.documentElement.setAttribute("data-theme", theme);
        }
        set({ theme });
      },

      // light ↔ dark 토글 (dark-purple는 setTheme으로 직접 설정)
      toggleTheme: () => {
        const next = get().theme === "light" ? "dark" : "light";
        get().setTheme(next);
      },

      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: "specode-app-state",
      // currentProjectId는 persist 제외 — 새로고침 시 재선택 유도
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);
