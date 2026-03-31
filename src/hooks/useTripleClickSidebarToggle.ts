/**
 * useTripleClickSidebarToggle — 3연타로 사이드바 접기/펼치기
 *
 * 역할:
 *   - useTripleClick + appStore.toggleSidebar 를 결합한 편의 훅
 *   - MainLayout 등 최상위 레이아웃 컴포넌트에서 한 줄로 등록
 *
 * 사용 예시:
 *   useTripleClickSidebarToggle();          // 레이아웃에서 한 번만 호출
 */

import { useTripleClick } from "./useTripleClick";
import { useAppStore } from "@/store/appStore";

export function useTripleClickSidebarToggle() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  useTripleClick(toggleSidebar);
}
