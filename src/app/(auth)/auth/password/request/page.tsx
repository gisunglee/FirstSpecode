"use client";

/**
 * PasswordRequestPage — 비밀번호 재설정 요청 (PID-00009)
 *
 * 역할:
 *   - 이메일 입력 + 형식 유효성 검증 (FID-00027)
 *   - [재설정 링크 발송] → POST /api/auth/password/reset-request (FID-00026)
 *   - 발송 완료 후 → 안내 화면으로 상태 전환 (FID-00028)
 *
 * 화면 껍데기는 AuthCard, 2단 레이아웃은 (auth)/layout.tsx 가 담당한다.
 *
 * URL: /auth/password/request
 */

import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "../../../_components/AuthCard";

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
      <AuthCard title="메일을 보냈어요" subtitle="받은편지함에서 재설정 링크를 확인해 주세요.">

        {/* 입력한 주소를 그대로 보여준다 — 오타로 잘못 보냈는지 사용자가 바로 알아챌 수 있게 */}
        <div className="sp-auth-identity">
          <span aria-hidden="true">✉️</span>
          <div>
            <div className="sp-auth-identity-email">{email}</div>
            <div className="sp-auth-identity-via">재설정 링크 발송 주소</div>
          </div>
        </div>

        <p className="sp-auth-text">
          링크는 <strong>1시간</strong> 후 만료됩니다.<br />
          메일이 보이지 않으면 스팸함도 확인해 주세요.
        </p>

        {/* FID-00028 다시 요청하기 — STEP 1으로 복귀 */}
        <button
          type="button"
          className="sp-btn sp-btn-secondary sp-btn-lg sp-btn-full"
          onClick={() => { setStep("form"); setEmail(""); setEmailError(""); setSubmitError(""); }}
        >
          다시 요청하기
        </button>

        <p className="sp-auth-foot">
          <Link href="/auth/login">로그인으로 돌아가기</Link>
        </p>
      </AuthCard>
    );
  }

  // ── AR-00011 이메일 입력 폼 ───────────────────────────────────
  return (
    <AuthCard title="비밀번호를 잊으셨나요?" subtitle="가입한 이메일로 재설정 링크를 보내드려요.">
      <form onSubmit={handleSubmit} noValidate>
        <div className="sp-field">
          <label className="sp-label" htmlFor="pwreq-email">이메일</label>
          <input
            id="pwreq-email"
            className={`sp-input${emailError ? " is-err" : ""}`}
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailError(""); setSubmitError(""); }}
            onBlur={(e) => validateEmail(e.target.value)}
            disabled={isSending}
            autoComplete="email"
          />
          {emailError && <div className="sp-hint is-err">{emailError}</div>}
        </div>

        {/* 서버 에러 메시지 (소셜 전용 계정 안내 포함) */}
        {submitError && <div className="sp-auth-error">{submitError}</div>}

        <button
          type="submit"
          className="sp-btn sp-btn-primary sp-btn-lg sp-btn-full"
          disabled={isSending}
        >
          {isSending ? "발송 중..." : "재설정 링크 발송"}
        </button>
      </form>

      <p className="sp-auth-foot">
        비밀번호가 기억나셨나요? <Link href="/auth/login">로그인</Link>
      </p>
    </AuthCard>
  );
}
