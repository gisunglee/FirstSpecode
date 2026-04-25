/**
 * RootLayout — 앱 최상위 레이아웃
 *
 * 역할:
 *   - 전역 Provider 등록 (QueryProvider, Toast)
 *   - 공통 메타데이터 설정
 *   - 전역 CSS 적용
 */

import type { Metadata } from "next";
import { Toaster } from "sonner";
import QueryProvider from "@/providers/QueryProvider";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "FirstSpecode",
  description: "Next.js + Supabase 프로젝트",
};

type Props = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: Props) {
  return (
    // suppressHydrationWarning:
    // 일부 브라우저 확장(WXT 기반: data-wxt-integrated 등)이 React 하이드레이션 전에
    // DOM 속성을 주입해 hidden / data-* 등이 서버 HTML과 달라지는 문제를 방지.
    // 동작에는 영향이 없으며 Next.js 공식 권장 패턴.
    <html lang="ko" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* TanStack Query 전역 Provider */}
        <QueryProvider>
          {children}
          {/* Toast 알림 — API 성공/실패 시 toast.success() / toast.error() 사용 */}
          <Toaster position="bottom-center" richColors />
        </QueryProvider>
      </body>
    </html>
  );
}
