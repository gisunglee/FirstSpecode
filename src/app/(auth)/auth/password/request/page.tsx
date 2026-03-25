"use client";

/**
 * PasswordRequestPage — 비밀번호 재설정 요청 (PID-00009)
 *
 * 역할:
 *   - 이메일 입력 + 형식 유효성 검증 (FID-00027)
 *   - [재설정 링크 발송] → POST /api/auth/password/reset-request (FID-00026)
 *   - 발송 완료 후 → 안내 화면으로 상태 전환 (FID-00028)
 *
 * URL: /auth/password/request
 */

import { useState } from "react";
import Link from "next/link";

// 이메일 형식 정규식
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = "form" | "sent";

export default function PasswordRequestPage() {
  const [step,        setStep]        = useState<Step>("form");
  const [email,       setEmail]       = useState("");
  const [emailError,  setEmailError]  = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSending,   setIsSending]   = useState(false);

  // ── FID-00027 이메일 형식 유효성 검증 ─────────────────────────
  function validateEmail(value: string): boolean {
    if (!value.trim()) {
      setEmailError("이메일을 입력해 주세요.");
      return false;
    }
    if (!EMAIL_REGEX.test(value)) {
      setEmailError("올바른 이메일 형식으로 입력해 주세요.");
      return false;
    }
    setEmailError("");
    return true;
  }

  // ── FID-00026 재설정 링크 발송 요청 ──────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");
    if (!validateEmail(email)) return;

    setIsSending(true);
    try {
      const res  = await fetch("/api/auth/password/reset-request", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
      });
      const body = await res.json();

      if (!res.ok) {
        setSubmitError(body.message ?? "일시적인 오류가 발생했습니다.");
        return;
      }

      // 소셜 전용 계정 안내
      if (body.data?.isSocialOnly) {
        setSubmitError(body.data.message);
        return;
      }

      // 발송 완료 → STEP 2 상태 전환
      setStep("sent");

    } catch {
      setSubmitError("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSending(false);
    }
  }

  // ── AR-00012 발송 완료 안내 ───────────────────────────────────
  if (step === "sent") {
    return (
      <div className="sp-group">
        <div className="sp-group-header">
          <span className="sp-group-title">이메일을 확인해 주세요!</span>
        </div>
        <div className="sp-group-body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
            입력하신 이메일 주소로 재설정 링크를 발송했습니다.<br />
            링크는 <strong style={{ color: "var(--color-text-primary)" }}>1시간</strong> 후 만료됩니다.
          </p>
          <div
            style={{
              display:        "flex",
              flexDirection:  "column",
              alignItems:     "center",
              gap:            "var(--space-3)",
              marginTop:      "var(--space-2)",
              fontSize:       "var(--text-sm)",
            }}
          >
            <span style={{ color: "var(--color-text-tertiary)" }}>이메일을 받지 못하셨나요?</span>
            {/* FID-00028 다시 요청하기 — STEP 1으로 복귀 */}
            <button
              className="sp-btn sp-btn-text"
              onClick={() => { setStep("form"); setEmail(""); setEmailError(""); setSubmitError(""); }}
              style={{ color: "var(--color-brand)" }}
            >
              다시 요청하기
            </button>
            <Link
              href="/auth/login"
              style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)", textDecoration: "none" }}
            >
              로그인으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── AR-00011 이메일 입력 폼 ───────────────────────────────────
  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <span className="sp-group-title">비밀번호를 잊으셨나요?</span>
      </div>
      <div className="sp-group-body">
        <p
          style={{
            fontSize:     "var(--text-sm)",
            color:        "var(--color-text-secondary)",
            marginBottom: "var(--space-4)",
          }}
        >
          가입한 이메일을 입력해 주세요.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="sp-field">
            <label className="sp-label">이메일</label>
            <input
              className={`sp-input${emailError ? " is-error" : ""}`}
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(""); setSubmitError(""); }}
              onBlur={(e) => validateEmail(e.target.value)}
              disabled={isSending}
              autoComplete="email"
            />
            {emailError && (
              <span className="sp-field-error">{emailError}</span>
            )}
          </div>

          {/* 서버 에러 메시지 */}
          {submitError && (
            <div
              style={{
                padding:      "10px 12px",
                borderRadius: "var(--radius-md)",
                background:   "var(--color-error-subtle)",
                border:       "1px solid var(--color-error-border)",
                color:        "var(--color-error)",
                fontSize:     "var(--text-sm)",
                marginBottom: "var(--space-3)",
              }}
            >
              {submitError}
            </div>
          )}

          <button
            type="submit"
            className="sp-btn sp-btn-primary"
            style={{ width: "100%" }}
            disabled={isSending}
          >
            {isSending ? "발송 중..." : "재설정 링크 발송"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: "var(--space-4)" }}>
          <Link
            href="/auth/login"
            style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", textDecoration: "none" }}
          >
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
