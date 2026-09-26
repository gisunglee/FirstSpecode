"use client";

/**
 * SocialRegisterPage — 소셜 신규 가입 완료 (REGISTER_REQUIRED 후속, 2026-09-24)
 *
 * 역할:
 *   - 콜백이 넘긴 Provider 이메일·이름을 보여주고, 이름은 고칠 수 있게 한다
 *   - 이용약관·개인정보 필수 동의 (ConsentFields)
 *   - [가입 완료] → POST /api/auth/social/register (socialToken + 이름 + 동의) → 토큰 저장 → 대시보드
 *   - [로그인으로 돌아가기] → 로그인 화면
 *
 * 왜 이 화면이 있나: 구글 클릭 즉시 계정이 생기던 흐름에는 약관 동의를 넣을 자리가 없었고,
 * Provider 이름이 서비스 표시명으로 그대로 들어가 사용자가 확인할 기회가 없었다.
 *
 * URL: /auth/social/register  (쿼리 없음)
 *      토큰·이메일·이름·provider·redirect 는 콜백 화면이 sessionStorage 에 넣어 준다(socialHandoff).
 *      URL 에 실으면 브라우저 기록·접근 로그에 계정 생성 권한이 있는 토큰이 남기 때문.
 *      이메일·이름은 표시용 — 서버는 서명된 token 안의 값만 믿는다.
 */

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearStoredRefreshTokens, storeAccessToken } from "@/lib/authTokenStorage";
import { readSocialHandoff, clearSocialHandoff } from "@/lib/socialHandoff";
import { sanitizeInternalRedirect } from "@/lib/safeRedirect";
import { AUTH_COOKIE_MODE_HEADER, AUTH_COOKIE_MODE_VALUE } from "@/lib/authCookiePolicy";
import { MEMBER_NAME_MAX_LENGTH } from "@/lib/memberName";
import { AuthCard } from "../../../_components/AuthCard";
import { GoogleIcon } from "../../../_components/GoogleIcon";
import { ConsentFields, type ConsentState } from "../../../_components/ConsentFields";

const PROVIDER_LABEL: Record<string, string> = { google: "Google", github: "GitHub" };

export default function SocialRegisterPage() {
  return (
    <Suspense fallback={null}>
      <SocialRegisterInner />
    </Suspense>
  );
}

function SocialRegisterInner() {
  const router = useRouter();
  // sessionStorage 는 서버 렌더 시 없으므로 마운트 후에 읽는다
  const [handoff, setHandoff] = useState<ReturnType<typeof readSocialHandoff> | undefined>(undefined);
  useEffect(() => { setHandoff(readSocialHandoff("REGISTER")); }, []);

  const socialToken = handoff?.token    ?? "";
  const email       = handoff?.email    ?? "";
  const provider    = handoff?.provider ?? "";
  const redirectTo  = sanitizeInternalRedirect(handoff?.redirectTo);

  // 이름 기본값: Provider 이름 → 없으면 이메일 앞자리. 사용자가 고칠 수 있다.
  const [name, setName] = useState("");
  const [nameSeeded, setNameSeeded] = useState(false);
  useEffect(() => {
    if (handoff && !nameSeeded) {
      setName(handoff.name || handoff.email.split("@")[0] || "");
      setNameSeeded(true);
    }
  }, [handoff, nameSeeded]);
  const [consent, setConsent] = useState<ConsentState>({ agreeTerms: false, agreePrivacy: false });

  const [nameError,    setNameError]    = useState("");
  const [consentError, setConsentError] = useState("");
  const [submitError,  setSubmitError]  = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 전달 데이터가 없으면 로그인으로 복귀 (직접 URL 진입·다른 탭·토큰 유실). undefined 는 아직 읽는 중.
  useEffect(() => {
    if (handoff === null) router.replace("/auth/login");
  }, [handoff, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setSubmitError("");
    setNameError("");
    setConsentError("");

    let hasError = false;
    const trimmed = name.trim();
    if (!trimmed) { setNameError("이름을 입력해 주세요."); hasError = true; }
    else if (trimmed.length > MEMBER_NAME_MAX_LENGTH) { setNameError(`이름은 ${MEMBER_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`); hasError = true; }
    if (!consent.agreeTerms || !consent.agreePrivacy) { setConsentError("필수 항목에 모두 동의해 주세요."); hasError = true; }
    if (hasError) return;

    setIsSubmitting(true);
    try {
      // 콜백·연동 화면과 같은 방식 — RT 는 HttpOnly 쿠키, AT 만 탭 저장소
      const res = await fetch("/api/auth/social/register", {
        method:      "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          [AUTH_COOKIE_MODE_HEADER]: AUTH_COOKIE_MODE_VALUE,
        },
        body: JSON.stringify({
          socialToken,
          name:         trimmed,
          agreeTerms:   consent.agreeTerms,
          agreePrivacy: consent.agreePrivacy,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSubmitError(body.message ?? "가입 처리 중 오류가 발생했습니다.");
        return;
      }
      if (!storeAccessToken(body.data.accessToken)) {
        setSubmitError("브라우저에 로그인 정보를 저장할 수 없습니다.");
        return;
      }
      clearStoredRefreshTokens();
      clearSocialHandoff();
      router.replace(redirectTo);
    } catch {
      setSubmitError("가입 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!handoff) return null;

  return (
    <AuthCard title="거의 다 됐어요" subtitle="이름을 확인하고 약관에 동의하면 가입이 완료됩니다.">

      {/* 어떤 계정으로 가입하는지 — 읽기 전용 */}
      <div className="sp-auth-identity">
        {provider === "google" && <GoogleIcon />}
        <div>
          <div className="sp-auth-identity-email">{email}</div>
          <div className="sp-auth-identity-via">{PROVIDER_LABEL[provider] ?? "소셜"} 계정으로 가입</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="sp-field">
          <label className="sp-label" htmlFor="soc-name">이름 <span className="sp-label-req">필수</span></label>
          <input
            id="soc-name"
            className={`sp-input${nameError ? " is-err" : ""}`}
            type="text"
            value={name}
            maxLength={MEMBER_NAME_MAX_LENGTH}
            onChange={(e) => { setName(e.target.value); setNameError(""); }}
            autoComplete="name"
            disabled={isSubmitting}
          />
          {nameError
            ? <div className="sp-hint is-err">{nameError}</div>
            : <div className="sp-hint">프로젝트 멤버·담당자·댓글 등 서비스 안에서 이 이름으로 표시됩니다. 프로필에서 언제든 바꿀 수 있어요.</div>}
        </div>

        <ConsentFields
          value={consent}
          onChange={(next) => { setConsent(next); setConsentError(""); }}
          disabled={isSubmitting}
          error={consentError}
        />

        {submitError && <div className="sp-auth-error">{submitError}</div>}

        <button type="submit" className="sp-btn sp-btn-primary sp-btn-lg sp-btn-full" disabled={isSubmitting}>
          {isSubmitting ? "가입 중..." : "가입 완료"}
        </button>
      </form>

      <p className="sp-auth-foot">
        다른 계정으로 하시겠어요?{" "}
        <Link href="/auth/login" onClick={() => clearSocialHandoff()}>로그인으로 돌아가기</Link>
      </p>
    </AuthCard>
  );
}
