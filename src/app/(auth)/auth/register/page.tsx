"use client";

/**
 * RegisterPage — 회원가입 (PID-00003, AR-00001 + AR-00002)
 *
 * 역할:
 *   - Google 로 계속 (소셜 가입 진입 — 콜백이 REGISTER_REQUIRED 면 가입 완료 화면으로)
 *   - 이름·이메일·비밀번호·확인 입력 폼 (FID-00001~00004) — 이름은 2026-09-24 부터 필수
 *   - blur 시 인라인 유효성 검증 + 이메일 중복 확인 API (FID-00002)
 *   - 이용약관·개인정보 필수 동의 (ConsentFields)
 *   - [계정 만들기] → POST /api/auth/register → 인증 메일 발송 안내로 이동 (FID-00005)
 *
 * 화면 껍데기는 AuthCard, 2단 레이아웃은 (auth)/layout.tsx 가 담당한다.
 *
 * URL: /auth/register
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";
import { MEMBER_NAME_MAX_LENGTH } from "@/lib/memberName";
import { AuthCard } from "../../_components/AuthCard";
import { GoogleIcon } from "../../_components/GoogleIcon";
import { ConsentFields, type ConsentState } from "../../_components/ConsentFields";

// 비밀번호 복잡도: 영문+숫자+특수문자 포함 8자 이상 (서버 register 라우트와 동일)
const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const router = useRouter();

  const [name,            setName]            = useState("");
  const [email,           setEmail]           = useState("");
  const [password,        setPassword]        = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [consent,         setConsent]         = useState<ConsentState>({ agreeTerms: false, agreePrivacy: false });

  // 인라인 에러 메시지
  const [nameError,      setNameError]      = useState("");
  const [emailError,     setEmailError]     = useState("");
  const [pwError,        setPwError]        = useState("");
  const [pwConfirmError, setPwConfirmError] = useState("");
  const [consentError,   setConsentError]   = useState("");
  const [submitError,    setSubmitError]    = useState("");

  const [isSubmitting,  setIsSubmitting]  = useState(false);
  const [socialLoading, setSocialLoading] = useState(false);

  // ── Google 로 계속 — authorize URL 취득 후 이동 (로그인 화면과 같은 흐름) ──
  async function handleGoogle() {
    if (socialLoading) return;
    setSocialLoading(true);
    setSubmitError("");
    try {
      const res  = await fetch("/api/auth/social/google/authorize");
      const body = await res.json();
      if (!res.ok) { setSubmitError(body.message ?? "Google 연결에 실패했습니다."); setSocialLoading(false); return; }
      window.location.href = body.data.url;
    } catch {
      setSubmitError("Google 연결 중 오류가 발생했습니다.");
      setSocialLoading(false);
    }
  }

  // ── 이름 검증 ──────────────────────────────────────────────────
  function validateName(): boolean {
    const trimmed = name.trim();
    if (!trimmed) { setNameError("이름을 입력해 주세요."); return false; }
    if (trimmed.length > MEMBER_NAME_MAX_LENGTH) { setNameError(`이름은 ${MEMBER_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`); return false; }
    setNameError("");
    return true;
  }

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
    setConsentError("");

    // 전체 필드 일괄 재검증
    let hasError = !validateName();
    if (!email || !EMAIL_REGEX.test(email)) {
      setEmailError("올바른 이메일 형식을 입력해 주세요."); hasError = true;
    }
    if (!password || !PASSWORD_REGEX.test(password)) {
      setPwError("비밀번호는 영문·숫자·특수문자를 포함한 8자 이상이어야 합니다."); hasError = true;
    }
    if (!passwordConfirm || passwordConfirm !== password) {
      setPwConfirmError("비밀번호가 일치하지 않습니다."); hasError = true;
    }
    if (!consent.agreeTerms || !consent.agreePrivacy) {
      setConsentError("필수 항목에 모두 동의해 주세요."); hasError = true;
    }
    if (hasError) return;

    setIsSubmitting(true);
    try {
      await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:         name.trim(),
          email,
          password,
          agreeTerms:   consent.agreeTerms,
          agreePrivacy: consent.agreePrivacy,
        }),
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

  const busy = isSubmitting || socialLoading;

  return (
    <AuthCard title="계정 만들기" subtitle="무료로 시작하고, 설계부터 함께하세요.">

      {/* 소셜 가입 */}
      <button type="button" className="sp-auth-social-btn" onClick={handleGoogle} disabled={busy}>
        <GoogleIcon />
        {socialLoading ? "연결 중..." : "Google 로 계속"}
      </button>

      <div className="sp-auth-divider">또는 이메일로</div>

      <form onSubmit={handleSubmit} noValidate>

        {/* 이름 — 서비스 안에서 보이는 표시명 */}
        <div className="sp-field">
          <label className="sp-label" htmlFor="reg-name">이름</label>
          <input
            id="reg-name"
            className={`sp-input${nameError ? " is-err" : ""}`}
            type="text"
            placeholder="홍길동"
            value={name}
            maxLength={MEMBER_NAME_MAX_LENGTH}
            onChange={(e) => { setName(e.target.value); setNameError(""); }}
            onBlur={validateName}
            autoComplete="name"
            disabled={busy}
          />
          {nameError
            ? <div className="sp-hint is-err">{nameError}</div>
            : <div className="sp-hint">서비스 안에서 표시되는 이름이에요. 나중에 프로필에서 바꿀 수 있어요.</div>}
        </div>

        {/* 이메일 */}
        <div className="sp-field">
          <label className="sp-label" htmlFor="reg-email">이메일</label>
          <input
            id="reg-email"
            className={`sp-input${emailError ? " is-err" : ""}`}
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailError(""); }}
            onBlur={handleEmailBlur}
            autoComplete="email"
            disabled={busy}
          />
          {emailError && <div className="sp-hint is-err">{emailError}</div>}
        </div>

        {/* 비밀번호 */}
        <div className="sp-field">
          <label className="sp-label" htmlFor="reg-pw">비밀번호</label>
          <input
            id="reg-pw"
            className={`sp-input${pwError ? " is-err" : ""}`}
            type="password"
            placeholder="영문·숫자·특수문자 포함 8자 이상"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setPwError(""); }}
            onBlur={handlePasswordBlur}
            autoComplete="new-password"
            disabled={busy}
          />
          {pwError && <div className="sp-hint is-err">{pwError}</div>}
        </div>

        {/* 비밀번호 확인 */}
        <div className="sp-field">
          <label className="sp-label" htmlFor="reg-pw2">비밀번호 확인</label>
          <input
            id="reg-pw2"
            className={`sp-input${pwConfirmError ? " is-err" : ""}`}
            type="password"
            placeholder="비밀번호를 다시 입력하세요"
            value={passwordConfirm}
            onChange={(e) => { setPasswordConfirm(e.target.value); setPwConfirmError(""); }}
            onBlur={handlePasswordConfirmBlur}
            autoComplete="new-password"
            disabled={busy}
          />
          {pwConfirmError && <div className="sp-hint is-err">{pwConfirmError}</div>}
        </div>

        {/* 약관·개인정보 동의 */}
        <ConsentFields
          value={consent}
          onChange={(next) => { setConsent(next); setConsentError(""); }}
          disabled={busy}
          error={consentError}
        />

        {/* 서버 에러 */}
        {submitError && <div className="sp-auth-error">{submitError}</div>}

        <button type="submit" className="sp-btn sp-btn-primary sp-btn-lg sp-btn-full" disabled={busy}>
          {isSubmitting ? "처리 중..." : "계정 만들기"}
        </button>
      </form>

      {/* AR-00002 로그인 이동 안내 (FID-00006) */}
      <p className="sp-auth-foot">
        이미 계정이 있으신가요? <Link href="/auth/login">로그인</Link>
      </p>
    </AuthCard>
  );
}
