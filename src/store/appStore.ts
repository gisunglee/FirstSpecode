/**
 * appStore — 전역 앱 상태 (Zustand)
 *
 * 역할:
 *   - 현재 활성 프로젝트 ID (GNB 프로젝트 셀렉터에서 변경)
 *   - 테마 (dark/light/dark-purple) — localStorage 영속화
 *   - 사이드바 접힘 상태 — localStorage 영속화
 *   - 전역 "내 담당" 모드 — DB 저장(tb_cm_member.asignee_view_mode)
 *     persist 안 함(서버가 원천). GNB가 프로필 로드 시 초기화
 *   - 전역 "단위업무 고정" — 브라우저 세션 한정(persist 안 함, 새로고침하면 해제).
 *     화면/영역/기능 목록을 하나의 단위업무로 제한해서 보고 싶을 때 GNB에서 설정.
 *     프로젝트 전환 시 자동 해제(다른 프로젝트의 단위업무 ID라 의미가 없어짐).
 *
 * 사용 위치:
 *   - GNB: 프로젝트 전환, 테마 전환, 내 담당 모드 토글, 단위업무 고정
 *   - LNB: 사이드바 접힘/펼침
 *   - StatusBar: 현재 프로젝트 ID 기반 데이터 폴링
 *   - 5개 목록 페이지: myAssigneeMode 구독으로 필터 자동 적용
 *   - 화면/영역/기능 목록: pinnedUnitWorkId 구독으로 필터 자동 적용
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
  // 전역 "단위업무 고정" — 화면/영역/기능 목록을 이 단위업무로 제한. null = 고정 없음(전체 보기)
  pinnedUnitWorkId: string | null;
  pinnedUnitWorkName: string | null;
  // 프로필 로드 완료 플래그 — 프로필에서 myAssigneeMode를 받아오기 전까지
  //   각 목록 페이지가 useQuery를 지연시켜 플리커를 방지
  _hasLoadedProfile: boolean;
  // 전역 검색 다이얼로그 열림 여부 — GNB 돋보기 버튼과 Ctrl+K 단축키가 토글
  globalSearchOpen: boolean;
  // 사이드바 "<" 토글 버튼을 3번 빠르게 눌러야 접기/펼치기가 되는 모드.
  // 기본값 false(=클릭 1번으로 즉시 토글) — 실수로 여러 번 눌렀을 때 사이드바가
  // 갑자기 접히는 걸 막고 싶은 사용자를 위한 옵션(GNB 우측 상단 토글로 on/off).
  tripleClickToggleEnabled: boolean;
};

type AppActions = {
  setCurrentProjectId: (id: string | null) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setBreadcrumb: (items: BreadcrumbItem[]) => void;
  setMyAssigneeMode: (mode: AssigneeMode) => void;
  setPinnedUnitWork: (id: string, name: string) => void;
  clearPinnedUnitWork: () => void;
  setHasLoadedProfile: (loaded: boolean) => void;
  setGlobalSearchOpen: (open: boolean) => void;
  toggleGlobalSearch: () => void;
  toggleTripleClickToggle: () => void;
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
      pinnedUnitWorkId: null,
      pinnedUnitWorkName: null,
      _hasLoadedProfile: false,
      globalSearchOpen: false,
      tripleClickToggleEnabled: false,

      // 프로젝트가 실제로 바뀔 때만 고정 단위업무 해제 — 다른 프로젝트의 unitWorkId는
      // 이 프로젝트에 존재하지 않으므로 그대로 들고 있으면 목록이 전부 0건으로 보임
      setCurrentProjectId: (id) => {
        const prev = get().currentProjectId;
        if (id === prev) return;
        set({ currentProjectId: id, pinnedUnitWorkId: null, pinnedUnitWorkName: null });
      },
      setBreadcrumb: (items) => set({ breadcrumb: items }),
      setMyAssigneeMode: (mode) => set({ myAssigneeMode: mode }),
      setPinnedUnitWork: (id, name) => set({ pinnedUnitWorkId: id, pinnedUnitWorkName: name }),
      clearPinnedUnitWork: () => set({ pinnedUnitWorkId: null, pinnedUnitWorkName: null }),
      setHasLoadedProfile: (loaded) => set({ _hasLoadedProfile: loaded }),
      setGlobalSearchOpen: (open) => set({ globalSearchOpen: open }),
      toggleGlobalSearch: () => set((s) => ({ globalSearchOpen: !s.globalSearchOpen })),
      toggleTripleClickToggle: () => set((s) => ({ tripleClickToggleEnabled: !s.tripleClickToggleEnabled })),

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
        tripleClickToggleEnabled: state.tripleClickToggleEnabled,
      }),
    }
  )
);
