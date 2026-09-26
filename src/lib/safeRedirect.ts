/**
 * safeRedirect — 로그인·소셜 가입 뒤 이동할 redirect 값 정제
 *
 * URL 파라미터로 받은 redirect 를 그대로 router.replace() 에 넘기면
 * 외부 도메인(오픈 리다이렉트)이나 javascript: 스킴(XSS)으로 이어질 수 있다.
 * "우리 사이트 안의 경로"만 통과시키고 나머지는 기본값으로 바꾼다.
 *
 * 허용: "/" 로 시작하는 경로 (예: /invite/accept?token=..., /dashboard?entry=1)
 * 거부: 스킴이 있는 값(https:, javascript:), 프로토콜 상대 URL(//evil.com, /\evil.com), 빈 값
 *
 * 클라이언트(로그인·콜백·소셜 가입 화면)와 서버(authorize state·콜백 응답) 양쪽에서 같은 함수를 쓴다.
 */

const DEFAULT_AFTER_LOGIN = "/dashboard?entry=1";

export function sanitizeInternalRedirect(
  value: string | null | undefined,
  fallback: string = DEFAULT_AFTER_LOGIN,
): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  // "/" 로 시작하되 두 번째 글자가 "/" 또는 "\" 이면 안 된다 — 브라우저가 //host 를 절대 URL 로 해석한다
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  // 제어문자·공백이 섞인 값은 신뢰하지 않는다
  if (/[\u0000-\u001f\s]/.test(v)) return fallback;
  return v;
}
