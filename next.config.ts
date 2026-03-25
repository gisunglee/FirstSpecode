import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 세부내용에 base64 이미지 첨부 지원 — Server Actions body 크기 10MB로 확장
    // App Router API route도 이 설정을 따름
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
