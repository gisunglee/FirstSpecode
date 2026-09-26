/**
 * AuthCard — (auth) 화면 공용 흰 카드 (로고 + 제목 + 부제 + 본문)
 *
 * 역할:
 *   - 가입·소셜 가입 완료 등 인증 화면의 카드 껍데기. 오른쪽 폼 영역(sp-auth-main)에 놓인다.
 *   - 스타일은 components.css 의 .sp-auth-card* (토큰만 사용). 카드 안은 light 테마로 고정.
 *
 * 참고: 로그인 화면(auth/login)은 이 컴포넌트 이전에 만들어져 자체 카드 스타일을 쓴다 — 후속 정리 대상.
 */

import type { ReactNode } from "react";

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title:     string;
  subtitle?: string;
  children:  ReactNode;
}) {
  return (
    <div className="sp-auth-card" data-theme="light">
      <div className="sp-auth-card-head">
        <div className="sp-auth-card-logo" aria-hidden="true">⚡</div>
        <div className="sp-auth-card-brand">SPECODE</div>
        <h1 className="sp-auth-card-title">{title}</h1>
        {subtitle && <p className="sp-auth-card-sub">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
