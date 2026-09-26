"use client";

/**
 * PasswordResetPage — 새 비밀번호 설정 (PID-00010)
 *
 * 역할:
 *   - 화면 진입 시 토큰 유효성 검증 (FID-00030) — 무효 시 /auth/password/invalid?reason=... 이동
 *   - 새 비밀번호 정책 검증 (FID-00031)
 *   - [재설정 완료] → POST /api/auth/password/reset (FID-00032)
 *
 * 화면 껍데기는 AuthCard, 2단 레이아웃은 (auth)/layout.tsx 가 담당한다.
 *
 * URL: /auth/password/reset?token=...
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "../../../_components/AuthCard";

// 비밀번호 정책: 8자 이상, 영문·숫자·특수문자 포함
const PASSWORD_POLICY = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

export default function PasswordResetPage() {
  return (
    <Suspense fallback={null}>
      <PasswordResetInner />
    </Suspense>
  );
}

function PasswordResetInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get("token") ?? "";

  type TokenStatus = "checking" | "valid" | "invalid";
  const [tokenStatus,   setTokenStatus]   = useState<TokenStatus>("checking");
  const [newPassword,   setNewPassword]   = useState("");
  const [confirmPw,     setConfirmPw]     = useState("");
  const [showPw,        setShowPw]        = useState(false);
  const [showConfirm,   setShowConfirm]   = useState(false);
  const [pwError,       setPwError]       = useState("");
  const [confirmError,  setConfirmError]  = useState("");
  const [submitError,   setSubmitError]   = useState("");
  const [isSubmitting,  setIsSubmitting]  = useState(false);

  // ── FID-00030 화면 진입 시 토큰 검증 ─────────────────────────
  useEffect(() => {
    if (!token) {
      router.replace("/auth/password/invalid?reason=INVALID");
      return;
    }

    fetch(`/api/auth/password/reset?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json();
          // code가 곧 reason (EXPIRED / USED / INVALID)
          const reason = body.code ?? "INVALID";
          router.replace(`/auth/password/invalid?reason=${reason}`);
        } else {
          setTokenStatus("valid");
        }
      })
      .catch(() => {
        router.replace("/auth/password/invalid?reason=INVALID");
      });
  }, [token, router]);

  // ── FID-00031 비밀번호 정책 유효성 검증 ──────────────────────
  function validatePassword(value: string): boolean {
    if (!value) { setPwError("새 비밀번호를 입력해 주세요."); return false; }
    if (!PASSWORD_POLICY.test(value)) {
      setPwError("8자 이상, 영문·숫자·특수문자를 포함해야 합니다.");
      return false;
    }
    setPwError("");
    return true;
  }

  function validateConfirm(pw: string, confirm: string): boolean {
    if (confirm && pw !== confirm) {
      setConfirmError("비밀번호가 일치하지 않습니다.");
      return false;
    }
    setConfirmError("");
    return true;
  }

  // ── FID-00032 새 비밀번호 저장 ───────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");

    const pwOk      = validatePassword(newPassword);
    const confirmOk = validateConfirm(newPassword, confirmPw);
    if (!pwOk || !confirmOk) return;

    setIsSubmitting(true);
    try {
      const res  = await fetch("/api/auth/password/reset", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token, newPassword, newPasswordConfirm: confirmPw }),
      });
      const body = await res.json();

      if (!res.ok) {
        // 토큰 만료 (제출하는 사이에 만료된 경우)
        if (body.code === "EXPIRED") {
          router.replace("/auth/password/invalid?reason=EXPIRED");
          return;
        }
        setSubmitError(body.message ?? "일시적인 오류가 발생했습니다.");
        return;
      }

      // 재설정 완료 → 로그인 이동
      router.replace("/auth/login");

    } catch {
      setSubmitError("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // 토큰 검증 중
  if (tokenStatus === "checking") {
    return (
      <AuthCard title="새 비밀번호 설정" subtitle="링크 확인 중...">
        <div className="sp-auth-loading"><div className="sp-spinner" /></div>
      </AuthCard>
    );
  }

  // ── AR-00013 새 비밀번호 입력 폼 ─────────────────────────────
  return (
    <AuthCard title="새 비밀번호 설정" subtitle="앞으로 로그인할 때 사용할 비밀번호를 입력해 주세요.">
      <form onSubmit={handleSubmit} noValidate>

        {/* 새 비밀번호 */}
        <div className="sp-field">
          <label className="sp-label" htmlFor="pwreset-new">새 비밀번호</label>
          <div className="sp-input-wrap">
            <input
              id="pwreset-new"
              className={`sp-input${pwError ? " is-err" : ""}`}
              type={showPw ? "text" : "password"}
              placeholder="영문·숫자·특수문자 포함 8자 이상"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setPwError(""); setSubmitError(""); }}
              onBlur={(e) => validatePassword(e.target.value)}
              disabled={isSubmitting}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="sp-input-action sp-auth-pw-toggle"
              onClick={() => setShowPw(!showPw)}
              aria-label={showPw ? "비밀번호 숨기기" : "비밀번호 표시"}
              tabIndex={-1}
            >
              {showPw ? "숨김" : "표시"}
            </button>
          </div>
          {pwError && <div className="sp-hint is-err">{pwError}</div>}
        </div>

        {/* 새 비밀번호 확인 */}
        <div className="sp-field">
          <label className="sp-label" htmlFor="pwreset-confirm">새 비밀번호 확인</label>
          <div className="sp-input-wrap">
            <input
              id="pwreset-confirm"
              className={`sp-input${confirmError ? " is-err" : ""}`}
              type={showConfirm ? "text" : "password"}
              placeholder="새 비밀번호를 다시 입력하세요"
              value={confirmPw}
              onChange={(e) => {
                setConfirmPw(e.target.value);
                // 입력 중 실시간 불일치 확인
                validateConfirm(newPassword, e.target.value);
              }}
              disabled={isSubmitting}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="sp-input-action sp-auth-pw-toggle"
              onClick={() => setShowConfirm(!showConfirm)}
              aria-label={showConfirm ? "비밀번호 숨기기" : "비밀번호 표시"}
              tabIndex={-1}
            >
              {showConfirm ? "숨김" : "표시"}
            </button>
          </div>
          {confirmError && <div className="sp-hint is-err">{confirmError}</div>}
        </div>

        {/* 비밀번호 정책 안내 */}
        <ul className="sp-auth-rules">
          <li>• 8자 이상</li>
          <li>• 영문·숫자·특수문자 조합</li>
          <li>• 기존 비밀번호와 다르게 설정</li>
        </ul>

        {/* 서버 에러 메시지 */}
        {submitError && <div className="sp-auth-error">{submitError}</div>}

        <button
          type="submit"
          className="sp-btn sp-btn-primary sp-btn-lg sp-btn-full"
          disabled={isSubmitting}
        >
          {isSubmitting ? "저장 중..." : "재설정 완료"}
        </button>
      </form>
    </AuthCard>
  );
}
