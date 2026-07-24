/**
 * useTripleClickSidebarToggle — 원래 기능(어디를 클릭하든 3연타 시 사이드바 접기/펼치기)
 *
 * 역할:
 *   - useTripleClick + appStore.toggleSidebar 를 결합한 편의 훅
 *   - window 전체에 리스너를 붙인다 — 페이지 아무 곳이나 빠르게 3번 클릭해도 감지된다.
 *   - appStore.tripleClickToggleEnabled(GNB 우측 상단 "3연타" 토글)가 꺼져 있으면
 *     리스너 자체를 등록하지 않는다 — 기본값은 꺼짐, 켜야 이 제스처가 동작한다.
 *
 * 사용 예시:
 *   useTripleClickSidebarToggle();   // MainLayout에서 한 번만 호출
 */

import { useTripleClick } from "./useTripleClick";
import { useAppStore } from "@/store/appStore";

export function useTripleClickSidebarToggle() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const enabled = useAppStore((s) => s.tripleClickToggleEnabled);
  useTripleClick(toggleSidebar, { enabled });
}
