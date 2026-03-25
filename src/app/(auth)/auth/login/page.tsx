"use client";

/**
 * LoginPage — 이메일/비밀번호 로그인 (PID-00006)
 *
 * 역할:
 *   - 화면 진입 시 아이디 저장값 복원 + 자동 로그인 시도 (FID-00014)
 *   - 이메일·비밀번호 입력 후 로그인 (FID-00015)
 *   - 5회 실패 또는 잠금 상태 시 잠금 안내 영역 표시 (FID-00016)
 *   - 잠금 해제 메일 발송 (FID-00017)
 *   - Google/GitHub 소셜 로그인 버튼 (UW-00003)
 *
 * URL: /auth/login
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

const LS_SAVED_EMAIL    = "lc_saved_email";
const LS_REFRESH_TOKEN  = "lc_refresh_token";

function formatLockTime(isoString: string): string {
  const d  = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// ── 카드 공통 스타일 ────────────────────────────────────────────
const card: React.CSSProperties = {
  background:   "#ffffff",
  borderRadius: "20px",
  padding:      "40px 36px",
  boxShadow:    "0 24px 64px rgba(0,0,0,0.45)",
  color:        "#111827",
};

export default function LoginPage() {
  const router = useRouter();

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

    const storedRT = localStorage.getItem(LS_REFRESH_TOKEN);
    if (!storedRT) return;

    setIsAutoLogging(true);
    fetch("/api/auth/token/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: storedRT }),
    })
      .then(async (res) => {
        if (!res.ok) { localStorage.removeItem(LS_REFRESH_TOKEN); return; }
        const body = await res.json();
        sessionStorage.setItem("access_token", body.data.accessToken);
        localStorage.setItem(LS_REFRESH_TOKEN, body.data.refreshToken);
        router.replace("/dashboard");
      })
      .catch(() => { localStorage.removeItem(LS_REFRESH_TOKEN); })
      .finally(() => { setIsAutoLogging(false); });
  }, [router]);

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
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, password, rememberMe: autoLogin }),
      });
      const body = await res.json();

      if (res.ok) {
        sessionStorage.setItem("access_token", body.data.accessToken);
        if (autoLogin) {
          localStorage.setItem(LS_REFRESH_TOKEN, body.data.refreshToken);
        } else {
          sessionStorage.setItem("refresh_token", body.data.refreshToken);
        }
        if (rememberEmail) { localStorage.setItem(LS_SAVED_EMAIL, email); }
        else               { localStorage.removeItem(LS_SAVED_EMAIL); }
        router.replace("/dashboard");

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
      const res  = await fetch(`/api/auth/social/${provider}/authorize`);
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
      <div style={{ ...card, textAlign: "center" }}>
        <p style={{ color: "#6b7280", fontSize: 14 }}>자동 로그인 중...</p>
      </div>
    );
  }

  return (
    <div style={card}>

      {/* 로고 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 28 }}>
        <div style={{
          width: 52, height: 52,
          background:   "linear-gradient(135deg, #f97316, #ea580c)",
          borderRadius: "14px",
          display:       "flex",
          alignItems:    "center",
          justifyContent:"center",
          fontSize:      26,
          marginBottom:  16,
          boxShadow:     "0 4px 16px rgba(249,115,22,0.35)",
        }}>
          ⚡
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: "0.06em", color: "#111827" }}>
            SPECODE
          </span>
        </div>
        <p style={{ fontSize: 22, fontWeight: 700, color: "#111827", margin: "4px 0 4px" }}>
          Welcome back
        </p>
        <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>
          SPECODE 계정으로 로그인하세요.
        </p>
      </div>

      {/* 소셜 로그인 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => handleSocialLogin("google")}
          disabled={!!socialLoading || isLocked}
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            gap:            10,
            width:          "100%",
            padding:        "11px 16px",
            border:         "1.5px solid #e5e7eb",
            borderRadius:   "10px",
            background:     socialLoading === "google" ? "#f9fafb" : "#ffffff",
            cursor:         "pointer",
            fontSize:       14,
            fontWeight:     500,
            color:          "#374151",
            transition:     "border-color .15s, background .15s",
          }}
          onMouseEnter={(e) => { (e.currentTarget.style.borderColor = "#d1d5db"); (e.currentTarget.style.background = "#f9fafb"); }}
          onMouseLeave={(e) => { (e.currentTarget.style.borderColor = "#e5e7eb"); (e.currentTarget.style.background = "#ffffff"); }}
        >
          <GoogleIcon />
          {socialLoading === "google" ? "연결 중..." : "Google로 계속"}
        </button>

        <button
          type="button"
          onClick={() => handleSocialLogin("github")}
          disabled={!!socialLoading || isLocked}
          style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            gap:            10,
            width:          "100%",
            padding:        "11px 16px",
            border:         "1.5px solid #e5e7eb",
            borderRadius:   "10px",
            background:     socialLoading === "github" ? "#f9fafb" : "#ffffff",
            cursor:         "pointer",
            fontSize:       14,
            fontWeight:     500,
            color:          "#374151",
            transition:     "border-color .15s, background .15s",
          }}
          onMouseEnter={(e) => { (e.currentTarget.style.borderColor = "#d1d5db"); (e.currentTarget.style.background = "#f9fafb"); }}
          onMouseLeave={(e) => { (e.currentTarget.style.borderColor = "#e5e7eb"); (e.currentTarget.style.background = "#ffffff"); }}
        >
          <GitHubIcon />
          {socialLoading === "github" ? "연결 중..." : "GitHub로 계속"}
        </button>
      </div>

      {/* 구분선 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
        <span style={{ fontSize: 12, color: "#9ca3af" }}>또는</span>
        <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
      </div>

      {/* 로그인 폼 */}
      <form onSubmit={handleSubmit} noValidate>

        {/* 이메일 */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
            이메일
          </label>
          <input
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setSubmitError(""); }}
            disabled={isLocked || isSubmitting}
            autoComplete="email"
            style={{
              width:        "100%",
              padding:      "10px 14px",
              border:       "1.5px solid #e5e7eb",
              borderRadius: "10px",
              fontSize:     14,
              color:        "#111827",
              background:   "#ffffff",
              outline:      "none",
              boxSizing:    "border-box",
              transition:   "border-color .15s",
            }}
            onFocus={(e)  => { e.currentTarget.style.borderColor = "#3b82f6"; }}
            onBlur={(e)   => { e.currentTarget.style.borderColor = "#e5e7eb"; }}
          />
        </div>

        {/* 비밀번호 */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
            비밀번호
          </label>
          <div style={{ position: "relative" }}>
            <input
              type={showPw ? "text" : "password"}
              placeholder="비밀번호 입력"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setSubmitError(""); }}
              disabled={isLocked || isSubmitting}
              autoComplete="current-password"
              style={{
                width:        "100%",
                padding:      "10px 40px 10px 14px",
                border:       "1.5px solid #e5e7eb",
                borderRadius: "10px",
                fontSize:     14,
                color:        "#111827",
                background:   "#ffffff",
                outline:      "none",
                boxSizing:    "border-box",
                transition:   "border-color .15s",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "#3b82f6"; }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = "#e5e7eb"; }}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              style={{
                position:   "absolute",
                right:      12,
                top:        "50%",
                transform:  "translateY(-50%)",
                background: "none",
                border:     "none",
                cursor:     "pointer",
                color:      "#9ca3af",
                fontSize:   12,
                padding:    0,
              }}
            >
              {showPw ? "숨김" : "표시"}
            </button>
          </div>
        </div>

        {/* 체크박스 + 비밀번호 찾기 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6b7280", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={autoLogin}
              onChange={(e) => setAutoLogin(e.target.checked)}
              disabled={isLocked}
              style={{ width: 15, height: 15, accentColor: "#3b82f6" }}
            />
            로그인 유지
          </label>
          <Link
            href="/auth/password/request"
            style={{ fontSize: 13, color: "#3b82f6", textDecoration: "none", fontWeight: 500 }}
          >
            비밀번호 찾기
          </Link>
        </div>

        {/* 에러 메시지 */}
        {submitError && (
          <div style={{
            padding:      "10px 12px",
            borderRadius: "8px",
            background:   "#fef2f2",
            border:       "1px solid #fecaca",
            color:        "#dc2626",
            fontSize:     13,
            marginBottom: 16,
          }}>
            {submitError}
          </div>
        )}

        {/* 계정 잠금 안내 */}
        {isLocked && (
          <div style={{
            padding:      "14px",
            borderRadius: "10px",
            background:   "#fef2f2",
            border:       "1px solid #fecaca",
            marginBottom: 16,
          }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#dc2626", marginBottom: 6 }}>
              🔒 계정이 잠금되었습니다.
            </p>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 10 }}>
              5회 연속 실패로 1시간 동안 로그인이 제한됩니다.
              {lockExpiredAt && <> 해제 시각: <strong>{formatLockTime(lockExpiredAt)}</strong></>}
            </p>
            <button
              type="button"
              onClick={handleSendUnlockEmail}
              disabled={isSendingUnlock}
              style={{
                width:        "100%",
                padding:      "8px",
                border:       "1.5px solid #fecaca",
                borderRadius: "8px",
                background:   "#ffffff",
                color:        "#dc2626",
                fontSize:     13,
                fontWeight:   500,
                cursor:       "pointer",
              }}
            >
              {isSendingUnlock ? "발송 중..." : "잠금 해제 메일 발송"}
            </button>
          </div>
        )}

        {/* 로그인 버튼 */}
        <button
          type="submit"
          disabled={isLocked || isSubmitting}
          style={{
            width:        "100%",
            padding:      "12px",
            border:       "none",
            borderRadius: "10px",
            background:   isLocked ? "#9ca3af" : "linear-gradient(135deg, #3b82f6, #2563eb)",
            color:        "#ffffff",
            fontSize:     15,
            fontWeight:   600,
            cursor:       isLocked ? "not-allowed" : "pointer",
            boxShadow:    isLocked ? "none" : "0 4px 14px rgba(59,130,246,0.4)",
            transition:   "opacity .15s",
          }}
          onMouseEnter={(e) => { if (!isLocked) e.currentTarget.style.opacity = "0.9"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
        >
          {isSubmitting ? "로그인 중..." : "로그인"}
        </button>
      </form>

      {/* 하단 링크 */}
      <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "#9ca3af" }}>
        계정이 없으신가요?{" "}
        <Link href="/auth/register" style={{ color: "#3b82f6", fontWeight: 600, textDecoration: "none" }}>
          회원가입
        </Link>
      </p>

    </div>
  );
}

// ── 아이콘 컴포넌트 ───────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908C16.658 14.251 17.64 11.943 17.64 9.2z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#111827" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.216.69.825.573C20.565 21.795 24 17.298 24 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}
