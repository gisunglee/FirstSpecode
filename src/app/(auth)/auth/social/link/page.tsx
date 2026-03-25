"use client";

/**
 * SocialLinkPage — 소셜 계정 연동 확인 (PID-00008)
 *
 * 역할:
 *   - URL 파라미터(email, token)에서 연동 대상 정보 표시 (FID-00023)
 *   - [연동하기] 클릭 → POST /api/auth/social/link → 토큰 저장 → 대시보드 이동 (FID-00024)
 *   - [취소] 클릭 → 로그인 화면 복귀 (FID-00025)
 *
 * URL: /auth/social/link?email=...&token=...
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function SocialLinkPage() {
  return (
    <Suspense fallback={null}>
      <SocialLinkInner />
    </Suspense>
  );
}

function SocialLinkInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const email        = searchParams.get("email") ?? "";
  const socialToken  = searchParams.get("token") ?? "";

  const [error,       setError]       = useState("");
  const [isLinking,   setIsLinking]   = useState(false);

  // 필수 파라미터 없으면 로그인으로 복귀
  useEffect(() => {
    if (!email || !socialToken) {
      router.replace("/auth/login");
    }
  }, [email, socialToken, router]);

  // ── FID-00024 소셜 계정 연동 처리 ─────────────────────────────
  async function handleLink() {
    if (isLinking) return;
    setIsLinking(true);
    setError("");

    try {
      const res  = await fetch("/api/auth/social/link", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ socialToken, email }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.message ?? "연동 처리 중 오류가 발생했습니다.");
        return;
      }

      // 토큰 저장 후 대시보드 이동
      sessionStorage.setItem("access_token",  body.data.accessToken);
      sessionStorage.setItem("refresh_token", body.data.refreshToken);
      router.replace("/dashboard");

    } catch {
      setError("연동 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsLinking(false);
    }
  }

  // ── FID-00025 연동 취소 ────────────────────────────────────────
  function handleCancel() {
    router.push("/auth/login");
  }

  if (!email || !socialToken) return null;

  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <span className="sp-group-title">이미 가입된 계정이 있습니다.</span>
      </div>
      <div className="sp-group-body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

        {/* ── AR-00010 연동 안내 (FID-00023) ── */}
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--color-text-primary)" }}>{email}</strong> 으로
          가입된 계정이 있습니다.<br />
          소셜 계정을 연동하시겠어요?
        </p>

        {/* 에러 메시지 */}
        {error && (
          <div
            style={{
              padding:      "10px 12px",
              borderRadius: "var(--radius-md)",
              background:   "var(--color-error-subtle)",
              border:       "1px solid var(--color-error-border)",
              color:        "var(--color-error)",
              fontSize:     "var(--text-sm)",
            }}
          >
            {error}
          </div>
        )}

        {/* 버튼 영역 */}
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          <button
            className="sp-btn sp-btn-primary"
            onClick={handleLink}
            disabled={isLinking}
            style={{ flex: 1 }}
          >
            {isLinking ? "연동 중..." : "연동하기"}
          </button>
          <button
            className="sp-btn sp-btn-secondary"
            onClick={handleCancel}
            disabled={isLinking}
            style={{ flex: 1 }}
          >
            취소
          </button>
        </div>

      </div>
    </div>
  );
}
