/**
 * appStore — 전역 앱 상태 (Zustand)
 *
 * 역할:
 *   - 현재 활성 프로젝트 ID (GNB 프로젝트 셀렉터에서 변경)
 *   - 테마 (dark/light/dark-purple) — localStorage 영속화
 *   - 사이드바 접힘 상태 — localStorage 영속화
 *   - 전역 "내 담당" 모드 — DB 저장(tb_cm_member.asignee_view_mode)
 *     persist 안 함(서버가 원천). GNB가 프로필 로드 시 초기화
 *
 * 사용 위치:
 *   - GNB: 프로젝트 전환, 테마 전환, 내 담당 모드 토글
 *   - LNB: 사이드바 접힘/펼침
 *   - StatusBar: 현재 프로젝트 ID 기반 데이터 폴링
 *   - 5개 목록 페이지: myAssigneeMode 구독으로 필터 자동 적용
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Theme } from "@/types/layout";

export type BreadcrumbItem = { label: string; href?: string; tag?: string };
export type AssigneeMode   = "all" | "me";

type AppState = {
  // 현재 작업 중인 프로젝트 ID (null = 프로젝트 미선택)
  currentProjectId: string | null;
  // 테마 — document.documentElement의 data-theme 속성과 동기화
  theme: Theme;
  // 사이드바 접힘 여부
  sidebarCollapsed: boolean;
  // GNB 브레드크럼 — 페이지가 마운트 시 설정, 언마운트 시 초기화
  breadcrumb: BreadcrumbItem[];
  // 전역 "내 담당" 모드 — 담당자 있는 모든 목록 페이지에 적용
  myAssigneeMode: AssigneeMode;
  // 프로필 로드 완료 플래그 — 프로필에서 myAssigneeMode를 받아오기 전까지
  //   각 목록 페이지가 useQuery를 지연시켜 플리커를 방지
  _hasLoadedProfile: boolean;
  // 전역 검색 다이얼로그 열림 여부 — GNB 돋보기 버튼과 Ctrl+K 단축키가 토글
  globalSearchOpen: boolean;
};

type AppActions = {
  setCurrentProjectId: (id: string | null) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setBreadcrumb: (items: BreadcrumbItem[]) => void;
  setMyAssigneeMode: (mode: AssigneeMode) => void;
  setHasLoadedProfile: (loaded: boolean) => void;
  setGlobalSearchOpen: (open: boolean) => void;
  toggleGlobalSearch: () => void;
};

// theme와 sidebarCollapsed만 persist — projectId는 세션 초기화 시 재선택
// myAssigneeMode는 persist 안 함 — 서버(DB)가 원천
export const useAppStore = create<AppState & AppActions>()(
  persist(
    (set, get) => ({
      currentProjectId: null,
      theme: "dark",
      sidebarCollapsed: false,
      breadcrumb: [],
      myAssigneeMode: "all",
      _hasLoadedProfile: false,
      globalSearchOpen: false,

      setCurrentProjectId: (id) => set({ currentProjectId: id }),
      setBreadcrumb: (items) => set({ breadcrumb: items }),
      setMyAssigneeMode: (mode) => set({ myAssigneeMode: mode }),
      setHasLoadedProfile: (loaded) => set({ _hasLoadedProfile: loaded }),
      setGlobalSearchOpen: (open) => set({ globalSearchOpen: open }),
      toggleGlobalSearch: () => set((s) => ({ globalSearchOpen: !s.globalSearchOpen })),

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
      // currentProjectId·myAssigneeMode·_hasLoadedProfile은 persist 제외
      //   - currentProjectId: 새로고침 시 재선택 유도
      //   - myAssigneeMode: 서버(DB)가 원천 — GNB가 프로필 로드해 초기화
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);
