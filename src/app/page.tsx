/**
 * RootPage — 루트 진입점 (/)
 *
 * 역할:
 *   - 로그인 후 대시보드로 리다이렉트
 *   - 인증 구현 후 미로그인 시 /login으로 분기 예정
 *
 * entry=1 — 대시보드 페이지가 이 마커를 보고 "로그인 직후 1회" 착지 분기(내 홈페이지
 * 쿠키 → 없으면 PM 직무면 PM 현황)를 수행한다. LNB에서 평소 클릭으로 들어올 때는
 * 이 마커가 없어 그 로직이 절대 발동하지 않는다.
 */

import { redirect } from "next/navigation";

export default function RootPage() {
  // 인증 구현 전까지 무조건 대시보드로 이동
  redirect("/dashboard?entry=1");
}
