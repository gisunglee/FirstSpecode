"use client";

/**
 * RegisterPage — 회원가입 (PID-00003, AR-00001 + AR-00002)
 *
 * 역할:
 *   - 이메일·비밀번호·확인 입력 폼 (FID-00001~00004)
 *   - blur 시 인라인 유효성 검증 + 이메일 중복 확인 API (FID-00002)
 *   - 회원가입 버튼 → POST /api/auth/register → 인증 메일 발송 안내로 이동 (FID-00005)
 *
 * URL: /auth/register
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

// 비밀번호 복잡도: 영문+숫자+특수문자 포함 8자 이상
const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const router = useRouter();

  const [email,         setEmail]         = useState("");
  const [password,      setPassword]      = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // 인라인 에러 메시지
  const [emailError,    setEmailError]    = useState("");
  const [pwError,       setPwError]       = useState("");
  const [pwConfirmError,setPwConfirmError] = useState("");
  const [submitError,   setSubmitError]   = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── FID-00001 이메일 형식 + FID-00002 중복 확인 ──────────────
  async function handleEmailBlur() {
    setEmailError("");
    if (!email) { setEmailError("이메일을 입력해 주세요."); return; }
    if (!EMAIL_REGEX.test(email)) { setEmailError("올바른 이메일 형식을 입력해 주세요."); return; }

    try {
      const res = await apiFetch<{ isDuplicate: boolean }>(
        `/api/auth/email/check?email=${encodeURIComponent(email)}`
      );
      if (res?.isDuplicate) {
        setEmailError("이미 사용 중인 이메일입니다.");
      }
    } catch {
      setEmailError("확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  // ── FID-00003 비밀번호 복잡도 검증 ───────────────────────────
  function handlePasswordBlur() {
    setPwError("");
    if (!password) { setPwError("비밀번호를 입력해 주세요."); return; }
    if (!PASSWORD_REGEX.test(password)) {
      setPwError("비밀번호는 영문·숫자·특수문자를 포함한 8자 이상이어야 합니다.");
    }
    // 비밀번호 변경 시 확인 필드 에러 초기화 (FID-00004 규칙)
    if (passwordConfirm) setPwConfirmError("");
  }

  // ── FID-00004 비밀번호 확인 ───────────────────────────────────
  function handlePasswordConfirmBlur() {
    setPwConfirmError("");
    if (passwordConfirm && passwordConfirm !== password) {
      setPwConfirmError("비밀번호가 일치하지 않습니다.");
    }
  }

  // ── FID-00005 회원가입 제출 ───────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");

    // 전체 필드 일괄 재검증
    let hasError = false;
    if (!email || !EMAIL_REGEX.test(email)) {
      setEmailError("올바른 이메일 형식을 입력해 주세요."); hasError = true;
    }
    if (!password || !PASSWORD_REGEX.test(password)) {
      setPwError("비밀번호는 영문·숫자·특수문자를 포함한 8자 이상이어야 합니다."); hasError = true;
    }
    if (!passwordConfirm || passwordConfirm !== password) {
      setPwConfirmError("비밀번호가 일치하지 않습니다."); hasError = true;
    }
    if (hasError) return;

    setIsSubmitting(true);
    try {
      await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      // 성공 → 인증 메일 발송 안내 화면으로 이동 (email 전달)
      router.push(`/auth/register/verify?email=${encodeURIComponent(email)}`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("이미 가입된")) {
        // 이메일 필드 아래에 인라인 표시 + 로그인 안내 포함
        setEmailError(err.message);
      } else {
        setSubmitError(
          err instanceof Error ? err.message : "가입 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <span className="sp-group-title">회원가입</span>
      </div>
      <div className="sp-group-body">
        <form onSubmit={handleSubmit} noValidate>

          {/* 이메일 */}
          <div className="sp-field">
            <label className="sp-label">이메일</label>
            <input
              className={`sp-input${emailError ? " is-err" : ""}`}
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(""); }}
              onBlur={handleEmailBlur}
              autoComplete="email"
            />
            {emailError && <div style={{ color: "var(--color-error)", fontSize: "var(--text-xs)", marginTop: 4 }}>{emailError}</div>}
          </div>

          {/* 비밀번호 */}
          <div className="sp-field">
            <label className="sp-label">비밀번호</label>
            <input
              className={`sp-input${pwError ? " is-err" : ""}`}
              type="password"
              placeholder="영문·숫자·특수문자 포함 8자 이상"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPwError(""); }}
              onBlur={handlePasswordBlur}
              autoComplete="new-password"
            />
            {pwError && <div style={{ color: "var(--color-error)", fontSize: "var(--text-xs)", marginTop: 4 }}>{pwError}</div>}
          </div>

          {/* 비밀번호 확인 */}
          <div className="sp-field">
            <label className="sp-label">비밀번호 확인</label>
            <input
              className={`sp-input${pwConfirmError ? " is-err" : ""}`}
              type="password"
              placeholder="비밀번호를 다시 입력하세요"
              value={passwordConfirm}
              onChange={(e) => { setPasswordConfirm(e.target.value); setPwConfirmError(""); }}
              onBlur={handlePasswordConfirmBlur}
              autoComplete="new-password"
            />
            {pwConfirmError && <div style={{ color: "var(--color-error)", fontSize: "var(--text-xs)", marginTop: 4 }}>{pwConfirmError}</div>}
          </div>

          {/* 서버 에러 */}
          {submitError && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: "var(--radius-md)",
                background: "var(--color-error-subtle)",
                border: "1px solid var(--color-error-border)",
                color: "var(--color-error)",
                fontSize: "var(--text-sm)",
                marginBottom: "var(--space-3)",
              }}
            >
              {submitError}
            </div>
          )}

          {/* 회원가입 버튼 */}
          <button
            type="submit"
            className="sp-btn sp-btn-primary"
            style={{ width: "100%" }}
            disabled={isSubmitting}
          >
            {isSubmitting ? "처리 중..." : "회원가입"}
          </button>
        </form>

        {/* AR-00002 로그인 이동 안내 (FID-00006) */}
        <p
          style={{
            marginTop: "var(--space-4)",
            textAlign: "center",
            fontSize: "var(--text-sm)",
            color: "var(--color-text-tertiary)",
          }}
        >
          이미 계정이 있으신가요?{" "}
          <Link
            href="/auth/login"
            style={{ color: "var(--color-brand)", textDecoration: "none", fontWeight: 500 }}
          >
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
