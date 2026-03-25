/**
 * RootPage — 루트 진입점 (/)
 *
 * 역할:
 *   - 로그인 후 대시보드로 리다이렉트
 *   - 인증 구현 후 미로그인 시 /login으로 분기 예정
 */

import { redirect } from "next/navigation";

export default function RootPage() {
  // 인증 구현 전까지 무조건 대시보드로 이동
  redirect("/dashboard");
}
