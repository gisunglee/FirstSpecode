"use client";

/**
 * SocialCallbackPage — OAuth 콜백 처리 (PID-00059)
 *
 * 역할:
 *   - URL의 code, state 파라미터 → POST /api/auth/social/callback 호출
 *   - NEW/EXISTING: 토큰 저장 → 대시보드 이동
 *   - LINK_REQUIRED: 연동 확인 화면(PID-00008)으로 이동
 *   - 에러: 메시지 표시 + 로그인 이동 버튼
 *
 * URL: /auth/social/callback?code=...&state=...
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function SocialCallbackPage() {
  return (
    <Suspense fallback={null}>
      <SocialCallbackInner />
    </Suspense>
  );
}

function SocialCallbackInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const code         = searchParams.get("code") ?? "";
  const state        = searchParams.get("state") ?? "";

  const [error, setError] = useState("");

  useEffect(() => {
    if (!code || !state) {
      setError("인증 요청이 유효하지 않습니다. 다시 시도해 주세요.");
      return;
    }

    fetch("/api/auth/social/callback", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ code, state }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          setError(body.message ?? "소셜 로그인에 실패했습니다.");
          return;
        }

        const { resultType, accessToken, refreshToken, socialToken, email, provider } = body.data;

        if (resultType === "NEW" || resultType === "EXISTING") {
          // 토큰 저장 후 대시보드 이동
          sessionStorage.setItem("access_token", accessToken);
          sessionStorage.setItem("refresh_token", refreshToken);
          router.replace("/dashboard");

        } else if (resultType === "LINK_REQUIRED") {
          // 연동 확인 화면으로 이동 (email + socialToken 전달)
          router.replace(
            `/auth/social/link?email=${encodeURIComponent(email)}&token=${encodeURIComponent(socialToken)}`
          );

        } else if (resultType === "ADD_SOCIAL") {
          // 이미 로그인한 회원의 소셜 추가 연동 — AT + socialToken으로 연동 API 호출
          const at = sessionStorage.getItem("access_token");
          if (!at) {
            setError("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
            return;
          }
          const linkRes = await fetch("/api/member/social/link", {
            method:  "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${at}` },
            body:    JSON.stringify({ provider, socialToken }),
          });
          const linkBody = await linkRes.json();
          if (!linkRes.ok) {
            setError(linkBody.message ?? "소셜 계정 연동에 실패했습니다.");
            return;
          }
          router.replace("/settings/profile?tab=social&linked=1");

        } else if (resultType === "ADD_SOCIAL_DUPLICATE") {
          setError("이미 다른 계정에 연동된 소셜 계정입니다.");

        } else if (resultType === "WITHDRAW_SOCIAL") {
          // 탈퇴 화면으로 socialToken 전달 → 탈퇴 화면에서 DELETE /api/member/me 호출
          router.replace(
            `/settings/account/withdraw?socialToken=${encodeURIComponent(socialToken)}`
          );
        }
      })
      .catch(() => {
        setError("소셜 로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      });
  }, [code, state, router]);

  // 에러 발생 시
  if (error) {
    return (
      <div className="sp-group">
        <div className="sp-group-header">
          <span className="sp-group-title">로그인 실패</span>
        </div>
        <div className="sp-group-body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div
            style={{
              padding:      "12px 14px",
              background:   "var(--color-error-subtle)",
              border:       "1px solid var(--color-error-border)",
              borderRadius: "var(--radius-md)",
              color:        "var(--color-error)",
              fontSize:     "var(--text-sm)",
            }}
          >
            {error}
          </div>
          <button
            className="sp-btn sp-btn-secondary"
            onClick={() => router.push("/auth/login")}
            style={{ width: "100%" }}
          >
            로그인으로 이동
          </button>
        </div>
      </div>
    );
  }

  // 처리 중
  return (
    <div className="sp-group">
      <div className="sp-group-body" style={{ textAlign: "center", padding: "32px" }}>
        <p style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-base)" }}>
          로그인 처리 중...
        </p>
      </div>
    </div>
  );
}
