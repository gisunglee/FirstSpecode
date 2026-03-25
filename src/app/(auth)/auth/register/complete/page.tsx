"use client";

/**
 * RegisterCompletePage — 이메일 인증 완료 (PID-00005, AR-00005)
 *
 * 역할:
 *   - URL token 파라미터로 POST /api/auth/verify 호출 (FID-00012)
 *   - 성공: 완료 메시지 + 3초 카운트다운 후 /dashboard 이동 (FID-00013)
 *   - 실패(만료/무효): 에러 메시지 + 재발송 안내 이동 버튼
 *
 * URL: /auth/register/complete?token=<token>
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

const REDIRECT_DELAY_SEC = 3;

export default function RegisterCompletePage() {
  return (
    <Suspense fallback={null}>
      <RegisterCompleteInner />
    </Suspense>
  );
}

type VerifyStatus = "loading" | "success" | "error";

function RegisterCompleteInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get("token") ?? "";

  const [status,    setStatus]    = useState<VerifyStatus>("loading");
  const [errorMsg,  setErrorMsg]  = useState("");
  const [countdown, setCountdown] = useState(REDIRECT_DELAY_SEC);

  // 화면 진입 시 토큰 검증 (FID-00012)
  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMsg("유효하지 않은 인증 링크입니다.");
      return;
    }

    apiFetch<{ data: { accessToken: string; refreshToken: string } }>(
      "/api/auth/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }
    )
      .then((res) => {
        // 토큰 저장 (추후 인증 상태 관리 통합 시 교체)
        // apiSuccess()는 { data: T } 구조로 감싸므로 res.data로 접근
        if (typeof window !== "undefined") {
          sessionStorage.setItem("access_token", res.data.accessToken);
          // refreshToken은 httpOnly cookie로 이동 예정 — 현재는 sessionStorage 임시 저장
          sessionStorage.setItem("refresh_token", res.data.refreshToken);
        }
        setStatus("success");
      })
      .catch((err: unknown) => {
        setStatus("error");
        setErrorMsg(
          err instanceof Error ? err.message : "인증 처리 중 오류가 발생했습니다."
        );
      });
  }, [token]);

  // 성공 시 3초 카운트다운 후 대시보드 이동 (FID-00013)
  useEffect(() => {
    if (status !== "success") return;
    if (countdown <= 0) { router.replace("/dashboard"); return; }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [status, countdown, router]);

  // ── 로딩 ─────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="sp-group">
        <div className="sp-group-body" style={{ textAlign: "center", padding: "32px" }}>
          <p style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-base)" }}>
            인증 처리 중...
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
          <span className="sp-group-title">인증 실패</span>
        </div>
        <div className="sp-group-body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div
            style={{
              padding: "12px 14px",
              background: "var(--color-error-subtle)",
              border: "1px solid var(--color-error-border)",
              borderRadius: "var(--radius-md)",
              color: "var(--color-error)",
              fontSize: "var(--text-sm)",
            }}
          >
            {errorMsg}
          </div>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
            인증 링크가 만료되었거나 이미 사용된 링크입니다.
            <br />
            인증 메일을 재발송해 주세요.
          </p>
          <button
            className="sp-btn sp-btn-secondary"
            onClick={() => router.push("/auth/register/verify")}
            style={{ width: "100%" }}
          >
            재발송 안내로 이동
          </button>
        </div>
      </div>
    );
  }

  // ── 성공 ─────────────────────────────────────────────────────
  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <span className="sp-group-title">가입 완료</span>
      </div>
      <div
        className="sp-group-body"
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", textAlign: "center" }}
      >
        <div style={{ fontSize: 40 }}>✅</div>
        <p style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--color-text-heading)" }}>
          회원가입이 완료되었습니다!
        </p>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          {countdown}초 후 자동으로 이동합니다.
        </p>
        <button
          className="sp-btn sp-btn-primary"
          onClick={() => router.replace("/dashboard")}
          style={{ width: "100%" }}
        >
          바로 이동
        </button>
      </div>
    </div>
  );
}
