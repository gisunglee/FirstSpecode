/**
 * securityHeaders — 전역 보안 응답 헤더 정의
 *
 * 역할:
 *   - CSP, HSTS, X-Frame-Options 등 브라우저 레벨 방어막을 한 곳에서 관리
 *   - dev/prod 분기 — dev는 Next.js HMR/Fast Refresh 허용, prod는 엄격
 *
 * 소비처:
 *   next.config.ts 의 async headers() — 모든 경로(`/:path*`)에 적용
 *
 * 유의:
 *   - 현재 정책은 inline style/script를 허용한다(Next.js hydration + 광범위 inline style).
 *     외부 도메인 스크립트/이미지/연결은 차단되므로 XSS 페이로드 탈취 경로가 크게 축소됨.
 *   - 장기적으로 nonce + 'strict-dynamic' 로 강화 권장.
 */

type Header = { key: string; value: string };

// OAuth 소셜 Provider 프로필 이미지가 저장되는 CDN
//   - Google: lh3.googleusercontent.com, lh4~6 포함 가능성 고려
//   - GitHub: avatars.githubusercontent.com
const SOCIAL_IMG_HOSTS = [
  "https://lh3.googleusercontent.com",
  "https://lh4.googleusercontent.com",
  "https://lh5.googleusercontent.com",
  "https://lh6.googleusercontent.com",
  "https://avatars.githubusercontent.com",
];

/** 환경별 CSP directive 목록 생성 */
function buildCspDirectives(isProd: boolean): string[] {
  return [
    "default-src 'self'",

    // Next.js 런타임이 hydration용 inline script를 주입한다.
    //   dev: React Fast Refresh가 eval 사용 → 'unsafe-eval' 허용 필요
    //   prod: 'unsafe-inline'만 허용(eval 차단)
    `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,

    // 프로젝트 전반에 inline style({ style: ... } 및 Tailwind runtime)을 씀.
    "style-src 'self' 'unsafe-inline'",

    // 이미지: self + data:(base64 썸네일) + blob:(업로드 미리보기) + 소셜 CDN
    `img-src 'self' data: blob: ${SOCIAL_IMG_HOSTS.join(" ")}`,

    "font-src 'self' data:",

    // XHR/fetch 대상.
    //   dev: HMR이 ws:/wss: 사용 → 허용
    //   prod: 'self'만 허용 (모든 외부 호출은 서버 경유)
    `connect-src 'self'${isProd ? "" : " ws: wss:"}`,

    "media-src 'self' blob:",

    // 이 사이트를 iframe으로 감싸는 것을 전면 차단(클릭재킹)
    "frame-ancestors 'none'",

    // 우리가 iframe을 쓸 일 없음 — 전면 차단
    "frame-src 'none'",

    // 폼 submit 대상 제한
    "form-action 'self'",

    // <base> 태그 조작으로 상대 경로 리다이렉트 공격 방지
    "base-uri 'self'",

    // Flash/PDF/Java 플러그인 등 전부 차단
    "object-src 'none'",

    // 모든 HTTP 요청을 HTTPS로 자동 업그레이드(prod만)
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ];
}

/** next.config.ts의 headers() 에 그대로 스프레드할 Header 배열 반환 */
export function getSecurityHeaders(): Header[] {
  const isProd = process.env.NODE_ENV === "production";

  const csp = buildCspDirectives(isProd).join("; ");

  const headers: Header[] = [
    { key: "Content-Security-Policy", value: csp },

    // iframe 차단 — CSP frame-ancestors의 구식 대체(레거시 브라우저 호환)
    { key: "X-Frame-Options", value: "DENY" },

    // MIME 스니핑 차단 — 업로드 파일이 의도와 다르게 실행되는 걸 방지
    { key: "X-Content-Type-Options", value: "nosniff" },

    // 외부 이동 시 URL의 쿼리/패스가 Referer로 누출되는 것을 제한
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

    // 사용하지 않는 민감 브라우저 API 전면 거부
    //   FLoC 추적(interest-cohort) 포함 — 제3자 추적 차단
    {
      key:   "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()",
    },
  ];

  // HSTS — production에서만 설정.
  //   localhost에 HSTS가 박히면 브라우저가 영구 캐싱해 다른 로컬 프로젝트까지 영향을 준다.
  if (isProd) {
    headers.push({
      key:   "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }

  return headers;
}
