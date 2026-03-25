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
    <html lang="ko">
      <body>
        {/* TanStack Query 전역 Provider */}
        <QueryProvider>
          {children}
          {/* Toast 알림 — API 성공/실패 시 toast.success() / toast.error() 사용 */}
          <Toaster position="top-right" richColors />
        </QueryProvider>
      </body>
    </html>
  );
}
