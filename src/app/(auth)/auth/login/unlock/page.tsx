"use client";

/**
 * UnlockPage — 계정 잠금 해제 처리
 *
 * 역할:
 *   - URL token 파라미터로 POST /api/auth/unlock/complete 호출
 *   - 성공: 완료 메시지 + 3초 후 /auth/login 이동
 *   - 실패(만료/무효): 에러 메시지 + /auth/login 이동 버튼
 *
 * URL: /auth/login/unlock?token=<token>
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

const REDIRECT_DELAY_SEC = 3;

export default function UnlockPage() {
  return (
    <Suspense fallback={null}>
      <UnlockPageInner />
    </Suspense>
  );
}

type UnlockStatus = "loading" | "success" | "error";

function UnlockPageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get("token") ?? "";

  const [status,    setStatus]    = useState<UnlockStatus>("loading");
  const [errorMsg,  setErrorMsg]  = useState("");
  const [countdown, setCountdown] = useState(REDIRECT_DELAY_SEC);

  // 진입 시 잠금 해제 처리
  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("유효하지 않은 잠금 해제 링크입니다.");
      return;
    }

    apiFetch("/api/auth/unlock/complete", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ token }),
    })
      .then(() => setStatus("success"))
      .catch((err: unknown) => {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "잠금 해제 처리 중 오류가 발생했습니다.");
      });
  }, [token]);

  // 성공 시 카운트다운 후 로그인 이동
  useEffect(() => {
    if (status !== "success") return;
    if (countdown <= 0) { router.replace("/auth/login"); return; }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [status, countdown, router]);

  // ── 로딩 ─────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="sp-group">
        <div className="sp-group-body" style={{ textAlign: "center", padding: "32px" }}>
          <p style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-base)" }}>
            잠금 해제 처리 중...
          </p>
        </div>
      </div>
    );
  }

  // ── 에러 ─────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className="sp-group">
        <div className="sp-group-header">
          <span className="sp-group-title">잠금 해제 실패</span>
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
            {errorMsg}
          </div>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
            잠금 해제 링크가 만료되었거나 이미 사용된 링크입니다.
            <br />
            로그인 화면에서 다시 요청해 주세요.
          </p>
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

  // ── 성공 ─────────────────────────────────────────────────────
  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <span className="sp-group-title">잠금 해제 완료</span>
      </div>
      <div
        className="sp-group-body"
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", textAlign: "center" }}
      >
        <div style={{ fontSize: 40 }}>🔓</div>
        <p style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--color-text-heading)" }}>
          계정 잠금이 해제되었습니다!
        </p>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          {countdown}초 후 로그인 화면으로 이동합니다.
        </p>
        <button
          className="sp-btn sp-btn-primary"
          onClick={() => router.replace("/auth/login")}
          style={{ width: "100%" }}
        >
          바로 이동
        </button>
      </div>
    </div>
  );
}
