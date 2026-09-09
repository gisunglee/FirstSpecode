"use client";

/**
 * SessionExpiredModal — 세션 만료 시 화면 위에서 재로그인하는 모달
 *
 * 역할:
 *   - authFetch(세션 최종 만료) / 다른 탭의 AUTH_CLEARED(로그아웃·만료) 알림을 받아 표시
 *   - 화면을 떠나지 않으므로 작성 중인 입력값(폼·웹에디터)이 그대로 유지된다
 *   - Google 로그인: OAuth 를 **새 탭**에서 진행 → 이 탭으로 돌아오면(focus)
 *     브라우저가 공유하는 새 RT 쿠키로 자동 복구되어 모달이 닫힌다
 *   - 이메일/비밀번호: 그 자리에서 재로그인 (POST /api/auth/login, HttpOnly RT 쿠키 모드)
 *   - 복구된 계정이 이전 계정과 다르면(다른 탭에서 다른 계정으로 로그인) 화면 데이터가
 *     어긋나므로 대시보드로 새로 이동한다
 *   - 재로그인 후 요청을 자동 재시도하지는 않는다 → 사용자가 저장 버튼을 다시 누른다
 *
 * 마운트 위치: MainLayout (모든 (main) 화면에 정확히 1개)
 *
 * 주요 기술:
 *   - authSessionEvents 구독 (lib → UI 단방향)
 *   - authRefreshClient.refreshAccessTokenResult 로 쿠키 기반 복구 확인
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  subscribeSessionExpired,
  type SessionExpiredReason,
} from "@/lib/authSessionEvents";
import { refreshAccessTokenResult } from "@/lib/authRefreshClient";
import {
  clearStoredRefreshTokens,
  getStoredAccessToken,
  storeAccessToken,
} from "@/lib/authTokenStorage";
import { accessTokenMemberId } from "@/lib/authSessionPolicy";
import {
  AUTH_COOKIE_MODE_HEADER,
  AUTH_COOKIE_MODE_VALUE,
} from "@/lib/authCookiePolicy";
import { formatAuthTrace, readAuthTrace } from "@/lib/authTrace";

// 로그인 페이지(/auth/login)가 "아이디 저장"으로 쓰는 키와 동일 — 이메일 자동 채움용
const LS_SAVED_EMAIL = "lc_saved_email";

// MainLayout 내부 요소들이 z-index 2000 까지 쓰므로 그보다 위에 올린다
const OVERLAY_Z_INDEX = 3000;

// 소셜 로그인 새 탭이 끝나면 착지할 곳 — 원래 탭은 focus 복귀 시 쿠키로 스스로 복구된다
const SOCIAL_LOGIN_LANDING = "/dashboard";

const REASON_MESSAGE: Record<SessionExpiredReason, string> = {
  expired:      "로그인 세션이 만료되었습니다.",
  unauthorized: "로그인 정보가 없습니다.",
  cleared:      "다른 탭에서 로그아웃되었거나 세션이 종료되었습니다.",
};

export default function SessionExpiredModal() {
  const [open,         setOpen]         = useState(false);
  const [reason,       setReason]       = useState<SessionExpiredReason>("expired");
  // 종료 직전 이 탭이 쓰던 계정 — 복구 후 같은 계정인지 비교
  const [prevMemberId, setPrevMemberId] = useState<string | null>(null);
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [socialOpening, setSocialOpening] = useState(false);
  const [checking,     setChecking]     = useState(false);
  const [error,        setError]        = useState("");
  // 진단용 — 종료 판정 근거 (사용자 문의 시 캡처해서 전달받는 용도)
  const [detail,       setDetail]       = useState("");
  // 진단용 — 이 탭의 최근 인증 판단 기록 (authTrace). 모달이 열릴 때 스냅샷을 찍어 둔다
  const [trace,        setTrace]        = useState("");

  // ── 세션 종료 알림 구독 ─────────────────────────────────────────────────────
  useEffect(() => {
    return subscribeSessionExpired((event) => {
      setReason(event.reason);
      setDetail(event.detail ?? (event.reason === "cleared" ? "다른 탭의 AUTH_CLEARED 알림" : ""));
      const snapshot = formatAuthTrace(readAuthTrace());
      setTrace(snapshot);
      // 콘솔에도 남겨 DevTools 에서 복사할 수 있게 한다
      if (snapshot) console.warn("[auth] 세션 종료 판정 직전 기록:\n" + snapshot);
      // 동시 다발 알림(여러 API 401)에서 첫 알림의 계정을 유지 — 뒤 알림은 이미 지워져 null
      setPrevMemberId((prev) => prev ?? event.previousMemberId);
      setError("");
      setPassword("");
      // 로그인 페이지의 "아이디 저장" 값이 있으면 이메일을 미리 채워 입력 부담을 줄인다
      try {
        const saved = localStorage.getItem(LS_SAVED_EMAIL);
        if (saved) setEmail((prev) => prev || saved);
      } catch {
        // 저장소 접근이 막힌 브라우저에서는 빈 칸으로 둔다
      }
      setOpen(true);
    });
  }, []);

  // ── 복구 완료 처리 — 계정이 바뀌었으면 화면을 새로 불러온다 ──────────────────
  // 공유 RT 쿠키 특성상 다른 탭에서 다른 계정으로 로그인하면 이 탭도 그 계정의 AT 를 받는다.
  // 그 상태로 저장하면 이전 계정 화면의 데이터가 새 계정으로 저장되므로 반드시 끊어준다.
  const finishRecovery = useCallback((message: string) => {
    const nextMemberId = accessTokenMemberId(getStoredAccessToken());
    if (prevMemberId && nextMemberId && prevMemberId !== nextMemberId) {
      toast.info("다른 계정으로 로그인되어 화면을 새로 불러옵니다.");
      window.location.href = SOCIAL_LOGIN_LANDING;
      return;
    }
    setOpen(false);
    setPrevMemberId(null);
    setPassword("");
    setError("");
    toast.success(message);
  }, [prevMemberId]);

  // ── 쿠키 기반 복구 확인 — 새 탭 로그인 후 돌아왔을 때 / "다시 확인" 버튼 ───────
  // 브라우저가 공유하는 HttpOnly RT 쿠키가 새로 발급됐다면 갱신이 성공한다.
  const checkSession = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const result = await refreshAccessTokenResult();
      if (result.status === "success") {
        finishRecovery("로그인이 복구되었습니다. 저장을 다시 눌러 주세요.");
      } else if (result.status === "transient") {
        setError("로그인 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.");
      }
      // terminal 이면 아직 로그인 전 — 조용히 모달 유지
    } finally {
      setChecking(false);
    }
  }, [checking, finishRecovery]);

  // 모달이 열린 동안 탭이 다시 포커스되면(새 탭 로그인 후 복귀) 자동 확인
  useEffect(() => {
    if (!open) return;
    const onFocus = () => { void checkSession(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [open, checkSession]);

  // ── Google 로그인 (새 탭) ───────────────────────────────────────────────────
  // OAuth 는 전체 페이지 이동이 필수라 이 탭에서 하면 작성 내용이 사라진다 → 새 탭에서 진행.
  // 팝업 차단 회피: window.open 은 클릭 핸들러에서 동기로 먼저 열고, URL 은 나중에 채운다.
  async function handleGoogleLogin() {
    if (socialOpening) return;
    setError("");
    setSocialOpening(true);
    const popup = window.open("about:blank", "_blank");
    try {
      const qs  = new URLSearchParams({ redirect: SOCIAL_LOGIN_LANDING });
      const res = await fetch(`/api/auth/social/google/authorize?${qs}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body?.data?.url !== "string") {
        popup?.close();
        setError(typeof body?.message === "string" ? body.message : "Google 로그인을 시작할 수 없습니다.");
        return;
      }
      if (popup) popup.location.href = body.data.url;
      else window.open(body.data.url, "_blank");  // 팝업이 차단됐으면 한 번 더 시도
    } catch {
      popup?.close();
      setError("Google 로그인 시작 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSocialOpening(false);
    }
  }

  // ── 이메일/비밀번호 재로그인 ────────────────────────────────────────────────
  // 로그인 페이지(FID-00015)와 같은 API·쿠키 모드를 쓴다. 성공 시 새 세션의 AT 를
  // 이 탭에 저장하고 모달을 닫는다. 다른 탭은 각자 공유 쿠키로 복구된다.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim())    { setError("이메일을 입력해 주세요."); return; }
    if (!password.trim()) { setError("비밀번호를 입력해 주세요."); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method:      "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          [AUTH_COOKIE_MODE_HEADER]: AUTH_COOKIE_MODE_VALUE,
        },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok) {
        if (!storeAccessToken(body?.data?.accessToken)) {
          setError("브라우저에 로그인 정보를 저장할 수 없습니다.");
          return;
        }
        clearStoredRefreshTokens();
        finishRecovery("다시 로그인되었습니다. 저장을 다시 눌러 주세요.");
        return;
      }

      if (res.status === 423) {
        setError("계정이 잠겼습니다. 새 탭의 로그인 페이지에서 잠금 해제 메일을 요청해 주세요.");
      } else if (res.status === 403) {
        setError("이메일 인증이 완료되지 않았습니다. 인증 메일을 확인해 주세요.");
      } else {
        setError(typeof body?.message === "string" ? body.message : "이메일 또는 비밀번호가 올바르지 않습니다.");
      }
    } catch {
      setError("로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const busy = submitting || checking || socialOpening;

  return (
    <div
      className="sp-overlay"
      style={{ zIndex: OVERLAY_Z_INDEX }}
      role="presentation"
    >
      <div
        className="sp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-expired-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sp-modal-header">
          <div id="session-expired-title" className="sp-modal-title">다시 로그인이 필요합니다</div>
          {/* 닫기 허용 — 내용을 복사해 두려는 사용자를 막지 않는다. 다음 저장 시 다시 열린다 */}
          <button
            type="button"
            className="sp-modal-close"
            aria-label="닫기"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="sp-modal-body">
            <p style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              {REASON_MESSAGE[reason]}
            </p>
            <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-sm)", color: "var(--color-text-primary)", lineHeight: 1.5, fontWeight: 600 }}>
              작성 중인 내용은 이 화면에 그대로 남아 있습니다. 다시 로그인한 뒤 저장을 다시 눌러 주세요.
            </p>

            {/* 소셜 로그인 — 로그인 페이지와 동일하게 Google 만 노출 (GitHub 은 로그인 페이지에서도 비활성) */}
            <button
              type="button"
              className="sp-btn sp-btn-secondary sp-btn-full"
              onClick={() => void handleGoogleLogin()}
              disabled={busy}
              style={{ marginBottom: "var(--space-3)" }}
            >
              <GoogleIcon />
              {socialOpening ? "새 탭 여는 중..." : "Google로 다시 로그인 (새 탭)"}
            </button>
            <p style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", lineHeight: 1.5 }}>
              새 탭에서 로그인을 마치고 이 화면으로 돌아오면 자동으로 복구됩니다.
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", margin: "0 0 var(--space-3)", color: "var(--color-text-tertiary)", fontSize: "var(--text-xs)" }}>
              <span style={{ flex: 1, borderTop: "1px solid var(--color-border)" }} />
              또는 이메일로 로그인
              <span style={{ flex: 1, borderTop: "1px solid var(--color-border)" }} />
            </div>

            <div className="sp-field">
              <input
                className="sp-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일"
                autoComplete="username"
                disabled={busy}
              />
            </div>
            <div className="sp-field">
              <input
                className="sp-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호"
                autoComplete="current-password"
                disabled={busy}
              />
            </div>

            {error && (
              <p role="alert" style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--color-error)" }}>
                {error}
              </p>
            )}
          </div>

          {detail && (
            <p style={{ margin: 0, padding: "0 16px 8px", fontSize: "var(--text-xs)", color: "var(--color-text-disabled)", fontFamily: "var(--font-mono)" }}>
              사유: {detail}
            </p>
          )}
          {trace && (
            <details style={{ margin: 0, padding: "0 16px 8px" }}>
              <summary style={{ cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--color-text-disabled)" }}>
                자세히 (판단 기록)
              </summary>
              <pre style={{ margin: "var(--space-2) 0 0", maxHeight: 160, overflow: "auto", fontSize: "var(--text-xs)", lineHeight: 1.4, color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {trace}
              </pre>
            </details>
          )}

          <div className="sp-modal-footer">
            <button
              type="button"
              className="sp-btn sp-btn-ghost"
              onClick={() => void checkSession()}
              disabled={busy}
            >
              {checking ? "확인 중..." : "다시 확인"}
            </button>
            <button
              type="submit"
              className="sp-btn sp-btn-primary"
              disabled={busy}
            >
              {submitting ? "로그인 중..." : "이메일로 로그인"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// 로그인 페이지의 GoogleIcon 과 동일한 공식 4색 로고 (16px)
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
