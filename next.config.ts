import type { NextConfig } from "next";
import { getSecurityHeaders } from "./src/lib/securityHeaders";

const nextConfig: NextConfig = {
  experimental: {
    // 세부내용에 base64 이미지 첨부 지원 — Server Actions body 크기 10MB로 확장
    // App Router API route도 이 설정을 따름
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },

  // 전역 보안 헤더 — CSP/HSTS/X-Frame-Options/Referrer-Policy 등.
  // 정의는 src/lib/securityHeaders.ts, 모든 경로에 적용.
  // XSS/클릭재킹/프로토콜 다운그레이드/MIME 스니핑 방어.
  async headers() {
    return [
      {
        source:  "/:path*",
        headers: getSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
