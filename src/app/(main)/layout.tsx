/**
 * (main) Route Group Layout
 *
 * 역할:
 *   - /dashboard, /requirements, /screens 등 메인 워크스페이스 화면에
 *     공통 레이아웃(GNB + LNB + StatusBar)을 적용
 *   - (main) 그룹은 URL에 영향 없음 — /dashboard 그대로 유지
 *   - MainLayout은 "use client" 컴포넌트이므로 이 파일은 서버 컴포넌트로 유지
 */

import MainLayout from "@/components/layout/MainLayout";

export default function MainGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainLayout>{children}</MainLayout>;
}
