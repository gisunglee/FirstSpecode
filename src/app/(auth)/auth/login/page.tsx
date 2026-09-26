"use client";

/**
 * LoginPage — 이메일/비밀번호 로그인 (PID-00006)
 *
 * 역할:
 *   - 화면 진입 시 아이디 저장값 복원 + 자동 로그인 시도 (FID-00014)
 *   - 이메일·비밀번호 입력 후 로그인 (FID-00015)
 *   - 5회 실패 또는 잠금 상태 시 잠금 안내 영역 표시 (FID-00016)
 *   - 잠금 해제 메일 발송 (FID-00017)
 *   - Google 소셜 로그인 버튼 (UW-00003) — GitHub 는 보류
 *
 * 화면 껍데기는 AuthCard(가입 화면과 동일 톤), 2단 레이아웃은 (auth)/layout.tsx.
 * 2026-09-24 hex 하드코딩 카드 → DS 토큰 기반 AuthCard 로 이전 (로직 변경 없음).
 *
 * URL: /auth/login
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import { refreshAccessToken } from "@/lib/authRefreshClient";
import {
  clearStoredRefreshTokens,
  storeAccessToken,
} from "@/lib/authTokenStorage";
import {
  AUTH_COOKIE_MODE_HEADER,
  AUTH_COOKIE_MODE_VALUE,
} from "@/lib/authCookiePolicy";
import { sanitizeInternalRedirect } from "@/lib/safeRedirect";
import { AuthCard } from "../../_components/AuthCard";
import { GoogleIcon } from "../../_components/GoogleIcon";

const LS_SAVED_EMAIL    = "lc_saved_email";

function formatLockTime(isoString: string): string {
  const d  = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // entry=1 — 대시보드가 "로그인 직후 1회" 착지 분기(내 홈페이지 쿠키 → 없으면 PM 직무 기본값)를
  // 수행하는 마커. redirect 파라미터로 특정 목적지가 이미 지정된 경우(초대 수락 등)는 그대로 존중.
  // 외부 URL·javascript: 스킴은 기본값으로 대체 (오픈 리다이렉트 방지)
  const redirectTo = sanitizeInternalRedirect(searchParams.get("redirect"));

  const [email,         setEmail]         = useState("");
  const [password,      setPassword]      = useState("");
  const [rememberEmail, setRememberEmail] = useState(false);
  const [autoLogin,     setAutoLogin]     = useState(false);
  const [showPw,        setShowPw]        = useState(false);

  const [submitError,    setSubmitError]    = useState("");
  const [isLocked,       setIsLocked]       = useState(false);
  const [lockExpiredAt,  setLockExpiredAt]  = useState("");
  const [isSubmitting,   setIsSubmitting]   = useState(false);
  const [isSendingUnlock,setIsSendingUnlock]= useState(false);
  const [isAutoLogging,  setIsAutoLogging]  = useState(false);
  const [socialLoading,  setSocialLoading]  = useState<"google"|"github"|null>(null);

  // ── FID-00014 자동 로그인 ─────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedEmail = localStorage.getItem(LS_SAVED_EMAIL);
    if (savedEmail) { setEmail(savedEmail); setRememberEmail(true); }

    setIsAutoLogging(true);
    refreshAccessToken("local")
      .then((accessToken) => {
        if (!accessToken) return;
        router.replace(redirectTo);
      })
      .catch(() => {})
      .finally(() => { setIsAutoLogging(false); });
  }, [redirectTo, router]);

  // ── FID-00015 로그인 실행 ─────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");
    if (!email.trim())    { setSubmitError("이메일을 입력해 주세요."); return; }
    if (!password.trim()) { setSubmitError("비밀번호를 입력해 주세요."); return; }

    setIsSubmitting(true);
    try {
      const res  = await fetch("/api/auth/login", {
        method:  "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          [AUTH_COOKIE_MODE_HEADER]: AUTH_COOKIE_MODE_VALUE,
        },
        body:    JSON.stringify({ email, password, rememberMe: autoLogin }),
      });
      const body = await res.json();

      if (res.ok) {
        if (!storeAccessToken(body.data.accessToken)) {
          setSubmitError("브라우저에 로그인 정보를 저장할 수 없습니다.");
          return;
        }
        clearStoredRefreshTokens();
        if (rememberEmail) { localStorage.setItem(LS_SAVED_EMAIL, email); }
        else               { localStorage.removeItem(LS_SAVED_EMAIL); }
        router.replace(redirectTo);

      } else if (res.status === 423) {
        setIsLocked(true);
        setLockExpiredAt(body.lockExpiredAt ?? "");
        setPassword("");

      } else if (res.status === 403) {
        setSubmitError("이메일 인증이 완료되지 않았습니다. 인증 메일을 확인해 주세요.");

      } else {
        setSubmitError(body.message ?? "이메일 또는 비밀번호가 올바르지 않습니다.");
      }
    } catch {
      setSubmitError("로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── 소셜 로그인 ───────────────────────────────────────────────
  async function handleSocialLogin(provider: "google" | "github") {
    if (socialLoading) return;
    setSocialLoading(provider);
    try {
      const qs = new URLSearchParams({ 
        redirect: redirectTo
      });
      const res  = await fetch(`/api/auth/social/${provider}/authorize?${qs}`);
      const body = await res.json();
      if (!res.ok) { setSubmitError(body.message ?? "소셜 로그인 초기화에 실패했습니다."); return; }
      window.location.href = body.data.url;
    } catch {
      setSubmitError("소셜 로그인 초기화 중 오류가 발생했습니다.");
      setSocialLoading(null);
    }
  }

  // ── FID-00017 잠금 해제 메일 발송 ────────────────────────────
  async function handleSendUnlockEmail() {
    if (isSendingUnlock) return;
    setIsSendingUnlock(true);
    try {
      await apiFetch("/api/auth/unlock/email", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
      });
      router.push(`/auth/login/locked?email=${encodeURIComponent(email)}`);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "메일 발송 중 오류가 발생했습니다.");
    } finally {
      setIsSendingUnlock(false);
    }
  }

  if (isAutoLogging) {
    return (
      <AuthCard title="Welcome back" subtitle="자동 로그인 중...">
        <div className="sp-auth-loading"><div className="sp-spinner" /></div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Welcome back" subtitle="SPECODE 계정으로 로그인하세요.">

      {/* 소셜 로그인 — 미가입자는 콜백이 REGISTER_REQUIRED 로 판정해 가입 완료 화면으로 보낸다 */}
      <button
        type="button"
        className="sp-auth-social-btn"
        onClick={() => handleSocialLogin("google")}
        disabled={!!socialLoading || isLocked}
      >
        <GoogleIcon />
        {socialLoading === "google" ? "연결 중..." : "Google 로 계속"}
      </button>
      {/* GitHub 로그인은 당장 제공하지 않는다 (2026-09-24). 다시 열 때 위 버튼과 같은 형태로 provider="github" 를 추가 */}

      <div className="sp-auth-divider">또는</div>

      {/* 로그인 폼 */}
      <form onSubmit={handleSubmit} noValidate>

        {/* 이메일 */}
        <div className="sp-field">
          <label className="sp-label" htmlFor="login-email">이메일</label>
          <input
            id="login-email"
            className="sp-input"
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setSubmitError(""); }}
            disabled={isLocked || isSubmitting}
            autoComplete="email"
          />
        </div>

        {/* 비밀번호 */}
        <div className="sp-field">
          <label className="sp-label" htmlFor="login-pw">비밀번호</label>
          <div className="sp-input-wrap">
            <input
              id="login-pw"
              className="sp-input"
              type={showPw ? "text" : "password"}
              placeholder="비밀번호 입력"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setSubmitError(""); }}
              disabled={isLocked || isSubmitting}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="sp-input-action sp-auth-pw-toggle"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "비밀번호 숨기기" : "비밀번호 표시"}
            >
              {showPw ? "숨김" : "표시"}
            </button>
          </div>
        </div>

        {/* 로그인 유지 + 비밀번호 찾기 */}
        <div className="sp-auth-row">
          <label className="sp-checkbox-wrap">
            <input
              className="sp-checkbox"
              type="checkbox"
              checked={autoLogin}
              onChange={(e) => setAutoLogin(e.target.checked)}
              disabled={isLocked}
            />
            <span>로그인 유지</span>
          </label>
          <Link href="/auth/password/request" className="sp-auth-link">비밀번호 찾기</Link>
        </div>

        {/* 에러 메시지 */}
        {submitError && <div className="sp-auth-error">{submitError}</div>}

        {/* 계정 잠금 안내 (FID-00016) */}
        {isLocked && (
          <div className="sp-auth-lock">
            <p className="sp-auth-lock-title">🔒 계정이 잠금되었습니다.</p>
            <p className="sp-auth-lock-desc">
              5회 연속 실패로 1시간 동안 로그인이 제한됩니다.
              {lockExpiredAt && <> 해제 시각: <strong>{formatLockTime(lockExpiredAt)}</strong></>}
            </p>
            <button
              type="button"
              className="sp-btn sp-btn-danger sp-btn-full"
              onClick={handleSendUnlockEmail}
              disabled={isSendingUnlock}
            >
              {isSendingUnlock ? "발송 중..." : "잠금 해제 메일 발송"}
            </button>
          </div>
        )}

        {/* 로그인 버튼 */}
        <button
          type="submit"
          className="sp-btn sp-btn-primary sp-btn-lg sp-btn-full"
          disabled={isLocked || isSubmitting}
        >
          {isSubmitting ? "로그인 중..." : "로그인"}
        </button>
      </form>

      {/* 하단 링크 */}
      <p className="sp-auth-foot">
        계정이 없으신가요? <Link href="/auth/register">회원가입</Link>
      </p>

    </AuthCard>
  );
}
