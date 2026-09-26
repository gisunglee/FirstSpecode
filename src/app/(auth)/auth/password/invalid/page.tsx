"use client";

/**
 * PasswordInvalidPage — 재설정 링크 오류 (PID-00011)
 *
 * 역할:
 *   - URL reason 파라미터(EXPIRED/USED/INVALID)에 따라 안내 메시지 표시 (FID-00033)
 *   - EXPIRED일 때만 [재발송 요청] 버튼 활성 → 재설정 요청 화면 이동 (FID-00034)
 *   - [로그인으로 돌아가기] 링크 (FID-00035)
 *
 * 화면 껍데기는 AuthCard, 2단 레이아웃은 (auth)/layout.tsx 가 담당한다.
 *
 * URL: /auth/password/invalid?reason=EXPIRED|USED|INVALID
 */

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { AuthCard } from "../../../_components/AuthCard";

export default function PasswordInvalidPage() {
  return (
    <Suspense fallback={null}>
      <PasswordInvalidInner />
    </Suspense>
  );
}

// reason별 안내 메시지 정의
const REASON_MESSAGES: Record<string, string> = {
  EXPIRED: "재설정 링크가 만료되었습니다. 재발송을 요청해 주세요.",
  USED:    "이미 사용된 링크입니다. 새로 요청이 필요하면 재발송을 요청해 주세요.",
  INVALID: "유효하지 않은 링크입니다. 링크를 다시 확인해 주세요.",
};

function PasswordInvalidInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const rawReason    = searchParams.get("reason") ?? "";

  // 알 수 없는 reason은 INVALID로 처리
  const reason  = (["EXPIRED", "USED", "INVALID"].includes(rawReason) ? rawReason : "INVALID") as keyof typeof REASON_MESSAGES;
  const message = REASON_MESSAGES[reason];

  // EXPIRED일 때만 재발송 버튼 활성
  const canResend = reason === "EXPIRED";

  return (
    <AuthCard title="링크를 사용할 수 없어요">

      {/* ── AR-00014 오류 안내 (FID-00033) ── */}
      <div className="sp-auth-error">{message}</div>

      {/* FID-00034 재발송 요청 (EXPIRED만 활성) */}
      <button
        type="button"
        className="sp-btn sp-btn-primary sp-btn-lg sp-btn-full"
        onClick={() => router.push("/auth/password/request")}
        disabled={!canResend}
      >
        재발송 요청
      </button>

      {/* FID-00035 로그인으로 돌아가기 */}
      <p className="sp-auth-foot">
        <Link href="/auth/login">로그인으로 돌아가기</Link>
      </p>
    </AuthCard>
  );
}
