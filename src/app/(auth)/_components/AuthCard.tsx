/**
 * AuthCard — (auth) 화면 공용 흰 카드 (로고 + 제목 + 부제 + 본문)
 *
 * 역할:
 *   - 가입·소셜 가입 완료 등 인증 화면의 카드 껍데기. 오른쪽 폼 영역(sp-auth-main)에 놓인다.
 *   - 스타일은 components.css 의 .sp-auth-card* (토큰만 사용). 카드 안은 light 테마로 고정.
 *   - 데스크톱(좌측 소개 패널이 보이는 폭)에서는 로고·브랜드가 패널과 겹치므로 CSS 로 숨기고,
 *     패널이 사라지는 900px 이하에서만 카드 안 로고·브랜드를 보여 준다.
 */

import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";

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
        <div className="sp-auth-card-logo" aria-hidden="true"><BrandMark /></div>
        <div className="sp-auth-card-brand">SPECODE</div>
        <h1 className="sp-auth-card-title">{title}</h1>
        {subtitle && <p className="sp-auth-card-sub">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
