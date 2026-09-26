/**
 * (auth) Route Group Layout — 인증 화면 공통 2단 레이아웃 (2026-09-24 개편)
 *
 * 역할:
 *   - 왼쪽: 서비스 소개 패널(dark) — "AI 와 구현하기 전에 SPECODE 에서 설계" 메시지 + 핵심 3가지
 *   - 오른쪽: 폼 영역(light) — 로그인·회원가입·비밀번호 재설정·초대 수락 등 children 이 가운데 카드로 놓임
 *   - 900px 미만(모바일)에서는 소개 패널을 숨기고 폼만 보인다
 *   - 로그인 전 상태라 Zustand 테마를 쓰지 않고 data-theme 을 영역별로 고정한다
 *
 * 스타일: src/styles/components.css 의 .sp-auth-* (토큰만 사용)
 * 카피 출처: /intro, /intro/about 의 문구를 가입 맥락에 맞게 압축
 */

import Link from "next/link";

// 왼쪽 패널 핵심 3가지 — 문구를 바꿀 때 여기만 고치면 된다
const POINTS = [
  {
    title: "설계는 Claude Code 에서, MCP 로",
    desc:  "요구사항 → 단위업무 → 화면 → 기능. 대화하듯 채우면 SPECODE 에 구조로 저장됩니다.",
  },
  {
    title: "모인 설계가 곧 구현 지시서",
    desc:  "설계를 PRD(MD) 로 내려받아 AI 에게 넘기면, 그 문서를 기준으로 구현합니다.",
  },
  {
    title: "팀과 미래의 나를 위한 기준",
    desc:  "무엇을 왜 결정했는지 남아, 구축 이후 운영·유지보수까지 이어집니다.",
  },
];

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="sp-auth-shell">

      {/* 왼쪽 — 서비스 소개 패널 */}
      <aside className="sp-auth-aside" data-theme="dark">
        <div className="sp-auth-aside-inner">
          <Link href="/intro" className="sp-auth-brand">
            <span className="sp-auth-brand-mark" aria-hidden="true">⚡</span>
            SPECODE
          </Link>

          <div>
            <div className="sp-auth-eyebrow">Design before build</div>
            <h2 className="sp-auth-title">
              AI 와 구현하기 전에,<br />
              SPECODE 에서 설계하세요
            </h2>
          </div>

          <p className="sp-auth-lead">
            Claude Code 안에서 MCP 로 설계를 쌓고, 그 설계가 모인 문서(MD)로 구현합니다.
            프롬프트에 흩어지던 결정이 팀의 기준으로 남습니다.
          </p>

          <ul className="sp-auth-points">
            {POINTS.map((p) => (
              <li key={p.title} className="sp-auth-point">
                <span className="sp-auth-point-check" aria-hidden="true">✓</span>
                <div>
                  <div className="sp-auth-point-title">{p.title}</div>
                  <div className="sp-auth-point-desc">{p.desc}</div>
                </div>
              </li>
            ))}
          </ul>

          <Link href="/intro" className="sp-auth-more">SPECODE 더 알아보기 →</Link>
        </div>
      </aside>

      {/* 오른쪽 — 폼 영역 */}
      <main className="sp-auth-main" data-theme="light">
        <div className="sp-auth-main-inner">
          {children}
        </div>
      </main>

    </div>
  );
}
