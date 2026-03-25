"use client";

/**
 * LockedPage — 계정 잠금 해제 안내 (PID-00007)
 *
 * 역할:
 *   - 발송된 이메일 주소 표시 (FID-00020)
 *   - 잠금 해제 메일 재발송 + 60초 쿨타임 (FID-00021, FID-00022)
 *   - 이메일 값 없으면 /auth/login 리다이렉트
 *
 * URL: /auth/login/locked?email=xxx@yyy.com
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { apiFetch } from "@/lib/apiFetch";

const RESEND_COOLDOWN_SEC = 60;

export default function LockedPage() {
  return (
    <Suspense fallback={null}>
      <LockedPageInner />
    </Suspense>
  );
}

function LockedPageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const email        = searchParams.get("email") ?? "";

  const [cooldown,    setCooldown]    = useState(0);
  const [isResending, setIsResending] = useState(false);

  // 이메일 없으면 로그인 화면으로
  useEffect(() => {
    if (!email) router.replace("/auth/login");
  }, [email, router]);

  // 쿨타임 카운트다운
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // FID-00021 재발송
  async function handleResend() {
    if (cooldown > 0 || isResending) return;
    setIsResending(true);
    try {
      await apiFetch("/api/auth/unlock/email/resend", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
      });
      toast.success("잠금 해제 메일을 재발송했습니다.");
      setCooldown(RESEND_COOLDOWN_SEC);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "재발송 중 오류가 발생했습니다.");
    } finally {
      setIsResending(false);
    }
  }

  if (!email) return null;

  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <span className="sp-group-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m2 7 10 7 10-7" />
          </svg>
          잠금 해제 메일 발송 완료
        </span>
      </div>

      <div className="sp-group-body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

        {/* FID-00020 이메일 표시 + 안내 */}
        <div
          style={{
            padding:      "16px",
            background:   "var(--color-bg-surface)",
            borderRadius: "var(--radius-md)",
            border:       "1px solid var(--color-border-subtle)",
          }}
        >
          <p style={{ fontSize: "var(--text-base)", color: "var(--color-text-primary)", marginBottom: 8 }}>
            <strong style={{ color: "var(--color-brand)" }}>{email}</strong>
            <span style={{ color: "var(--color-text-secondary)" }}> 으로<br />잠금 해제 메일을 발송했습니다.</span>
          </p>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
            메일함을 확인하고 해제 링크를 클릭해 주세요.
            <br />
            <span style={{ color: "var(--color-warning)" }}>스팸함도 확인해 주세요.</span>
          </p>
        </div>

        {/* 만료 시간 안내 */}
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", textAlign: "center" }}>
          해제 링크는 발송 후 <strong style={{ color: "var(--color-text-secondary)" }}>30분</strong> 동안 유효합니다.
        </p>

        {/* FID-00021 재발송 버튼 + FID-00022 쿨타임 */}
        <button
          className="sp-btn sp-btn-secondary"
          onClick={handleResend}
          disabled={cooldown > 0 || isResending}
          style={{ width: "100%" }}
        >
          {isResending
            ? "발송 중..."
            : cooldown > 0
            ? `재발송 (${cooldown}초 후 가능)`
            : "잠금 해제 메일 재발송"}
        </button>

      </div>
    </div>
  );
}
