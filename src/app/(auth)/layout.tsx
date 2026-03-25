/**
 * (auth) Route Group Layout — 인증 화면 공통 레이아웃
 *
 * 역할:
 *   - GNB/LNB 없이 화면 중앙에 카드 형태로 표시
 *   - 로그인·회원가입·비밀번호 재설정 등 모든 인증 화면에 적용
 *   - 테마는 dark 고정 (로그인 전 상태이므로 Zustand 사용 안 함)
 */

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      data-theme="dark"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0c0c18 0%, #131228 40%, #0e1520 100%)",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 440 }}>
        {children}
      </div>
    </div>
  );
}
