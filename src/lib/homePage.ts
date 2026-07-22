/**
 * homePage — "내 홈페이지"(로그인 직후 첫 화면) 쿠키 유틸
 *
 * 역할:
 *   - LNB "대시보드" 그룹의 6개 항목 중 하나를 사용자가 별 아이콘으로 지정하면
 *     그 경로를 쿠키에 저장해두고, 다음 로그인 때 그 페이지로 바로 착지시킨다.
 *   - 서버 DB에는 저장하지 않는다 — 기기/브라우저별로 따로 기억되는 게 의도된 동작
 *     (사용자 확인: "쿠키나 브라우저 설정 정도로만 해도 될 것 같다").
 *   - 순수 document.cookie 조작 — 클라이언트 컴포넌트에서만 사용.
 */

const HOME_PAGE_COOKIE = "sp_home_page";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1년

// LNB "대시보드" 그룹의 canPinHome 6개 항목과 동일 목록 — 메뉴가 없어지거나 이름이
// 바뀌어도 옛날에 저장된 쿠키 값이 죽은 경로를 가리키지 않도록 여기서 한 번 더 검증한다.
const VALID_HOME_PATHS = ["/dashboard", "/my-task", "/my-work", "/calendar", "/pm-board", "/pm"];

export function getHomePageCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${HOME_PAGE_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : null;
  if (value && !VALID_HOME_PATHS.includes(value)) {
    // 삭제된 메뉴를 가리키는 낡은 쿠키 — 조용히 정리
    clearHomePageCookie();
    return null;
  }
  return value;
}

export function setHomePageCookie(path: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${HOME_PAGE_COOKIE}=${encodeURIComponent(path)}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function clearHomePageCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${HOME_PAGE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}
