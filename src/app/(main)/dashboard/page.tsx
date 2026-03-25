/**
 * DashboardPage — 대시보드 (플레이스홀더)
 *
 * 역할:
 *   - 로그인 후 기본 진입 화면
 *   - 각 단위업무 개발 전까지 시스템 공통 레이아웃 동작 확인용
 *
 * URL: /dashboard
 */

export default function DashboardPage() {
  return (
    <div
      style={{
        padding: "32px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <h1
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: 700,
            color: "var(--color-text-heading)",
            marginBottom: 8,
          }}
        >
          대시보드
        </h1>
        <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)" }}>
          SPECODE에 오신 것을 환영합니다. 좌측 메뉴에서 단위업무를 선택하세요.
        </p>
      </div>

      {/* 레이아웃 확인용 카드 */}
      <div className="sp-group" style={{ maxWidth: 480 }}>
        <div className="sp-group-header">
          <span className="sp-group-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            시스템 상태
          </span>
        </div>
        <div className="sp-group-body">
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            레이아웃이 정상 렌더링되었습니다.
          </p>
          <p
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-tertiary)",
              marginTop: 8,
              fontFamily: "var(--font-mono)",
            }}
          >
            GNB · LNB · StatusBar · MainLayout ✓
          </p>
        </div>
      </div>
    </div>
  );
}
