"use client";

/**
 * AuthShell — (auth) 화면의 바깥 틀: 소개 패널을 보여 줄지 결정
 *
 * 역할:
 *   - 처음 오는 사람이 보는 화면(가입·소셜 가입 완료·초대 수락)에만 좌측 소개 패널을 붙인다.
 *   - 로그인·비밀번호 재설정·잠금·인증 안내처럼 이미 가입한 사람이 보는 화면은
 *     설득할 필요가 없으므로 패널 없이 가운데 카드만 보여 준다 (.sp-auth-shell.is-plain).
 *
 * 왜 폴더(라우트 그룹)로 나누지 않았나:
 *   /auth/register(패널 O)와 /auth/register/verify(패널 X)처럼 같은 경로 아래에서
 *   갈리는 화면이 있어, 폴더로 나누면 한 업무의 화면이 두 트리로 흩어진다.
 *   대신 아래 경로 목록 한 곳에서 관리한다 — 패널 대상 화면을 바꿀 때는 여기만 고친다.
 *
 * 패널 내용(문구)은 서버 컴포넌트인 (auth)/layout.tsx 가 만들어 panel prop 으로 넘긴다.
 */

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

// 좌측 소개 패널을 보여 줄 경로 — 정확히 일치할 때만 (하위 경로는 포함하지 않음)
const PANEL_PATHS = [
  "/auth/register",         // 이메일 회원가입
  "/auth/social/register",  // 소셜 가입 완료 (이름·약관 입력)
  "/invite/accept",         // 초대 수락 — 초대받아 처음 들어오는 사람
];

export function AuthShell({
  panel,
  children,
}: {
  panel:    ReactNode;
  children: ReactNode;
}) {
  const pathname  = usePathname();
  const showPanel = PANEL_PATHS.includes(pathname);

  return (
    <div className={`sp-auth-shell${showPanel ? "" : " is-plain"}`}>
      {showPanel && panel}

      {/* 폼 영역 */}
      <main className="sp-auth-main" data-theme="light">
        <div className="sp-auth-main-inner">
          {children}
        </div>
      </main>
    </div>
  );
}
