"use client";

/**
 * QueryProvider — TanStack Query 클라이언트 Provider
 *
 * 역할:
 *   - QueryClientProvider를 앱 최상단에서 한 번만 선언
 *   - ReactQueryDevtools: 개발 환경에서만 렌더링 (production 빌드에서 자동 제외)
 *
 * 주의:
 *   - "use client" 선언이 필수 (QueryClientProvider는 클라이언트 전용)
 *   - app/layout.tsx에서 이 컴포넌트로 감싸야 함
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

type Props = {
  children: React.ReactNode;
};

export default function QueryProvider({ children }: Props) {
  // QueryClient를 useState로 생성하는 이유:
  // 서버 컴포넌트에서 직접 생성하면 요청 간 상태가 공유되어 데이터 오염 발생
  // 클라이언트 인스턴스별로 독립적인 캐시를 유지하기 위해 useState 사용
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 창 포커스 시 자동 재조회 비활성화 (원하면 true로 변경)
            refetchOnWindowFocus: false,
            // 에러 발생 시 재시도 횟수 (기본 3 → 1로 줄여 빠른 에러 표시)
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
