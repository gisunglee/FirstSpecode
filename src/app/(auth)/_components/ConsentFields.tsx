"use client";

/**
 * ConsentFields — 가입 폼 공용 약관·개인정보 동의 체크박스 (필수 2건)
 *
 * 역할:
 *   - 이용약관 / 개인정보 수집·이용 동의 체크박스 + 약관 화면 링크(새 탭)
 *   - 이메일 가입(auth/register)·소셜 가입 완료(auth/social/register)가 같은 UI 를 쓴다
 *   - 최종 검증은 서버(src/lib/consent.ts validateRequiredConsents)가 한다. 여기는 입력 UI 만.
 *
 * 마케팅 수신 동의 같은 선택 항목은 두지 않는다 — 마케팅 메일을 보내지 않기로 했으므로(2026-09-24).
 */

import Link from "next/link";
import { CONSENT_PAGE_PATH } from "@/lib/consent";

export type ConsentState = { agreeTerms: boolean; agreePrivacy: boolean };

export function ConsentFields({
  value,
  onChange,
  disabled,
  error,
}: {
  value:     ConsentState;
  onChange:  (next: ConsentState) => void;
  disabled?: boolean;
  error?:    string;
}) {
  return (
    <div className="sp-auth-consent">
      <label className="sp-checkbox-wrap">
        <input
          className="sp-checkbox"
          type="checkbox"
          checked={value.agreeTerms}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, agreeTerms: e.target.checked })}
        />
        <span>
          <span className="req">[필수]</span>{" "}
          <Link href={CONSENT_PAGE_PATH.TERMS} target="_blank" rel="noopener noreferrer">이용약관</Link>에 동의합니다
        </span>
      </label>
      <label className="sp-checkbox-wrap">
        <input
          className="sp-checkbox"
          type="checkbox"
          checked={value.agreePrivacy}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, agreePrivacy: e.target.checked })}
        />
        <span>
          <span className="req">[필수]</span>{" "}
          <Link href={CONSENT_PAGE_PATH.PRIVACY} target="_blank" rel="noopener noreferrer">개인정보 수집·이용</Link>에 동의합니다
        </span>
      </label>
      {error && <div className="sp-hint is-err">{error}</div>}
    </div>
  );
}
