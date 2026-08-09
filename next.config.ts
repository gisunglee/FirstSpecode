import path from "path";
import type { NextConfig } from "next";
import { getSecurityHeaders } from "./src/lib/securityHeaders";

const nextConfig: NextConfig = {
  // 상위 폴더(/Users/igiseong)에 별도 package-lock.json이 있어서
  // Turbopack이 워크스페이스 루트를 잘못 추론해 tailwindcss 등
  // node_modules 모듈을 찾지 못하는 문제 방지 (명시적으로 프로젝트 루트 고정)
  turbopack: {
    root: path.join(__dirname),
  },

  experimental: {
    // 세부내용에 base64 이미지 첨부 지원 — Server Actions body 크기 10MB로 확장
    // App Router API route도 이 설정을 따름
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },

  // /api/mcp 의 get_worker_command_files 도구가 fs로 직접 읽는 파일들.
  // Vercel 서버리스는 코드에서 import/require 하지 않는 파일은 빌드 트레이싱에서
  // 빠지므로, 여기 명시하지 않으면 배포본에 파일이 없어 런타임에 ENOENT가 난다.
  // 경로를 바꾸면 src/lib/mcp/workerCommandFiles.ts 도 같이 수정할 것.
  outputFileTracingIncludes: {
    "/api/mcp": [
      "./.claude/commands/run-ai-tasks.md",
      "./.claude/commands/task_complete.mjs",
      "./.claude/commands/source_snapshot.mjs",
      "./.claude/commands/submit_implementation_receipt.mjs",
      "./.claude/commands/sync-specode.md",
      "./.claude/commands/prepare_specode_sync.mjs",
      "./.claude/commands/submit_maintenance_receipt.mjs",
    ],
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
