"use client";

/**
 * EmailCompleteHandlerPage — 이메일 변경 인증 완료 처리
 *
 * 역할:
 *   - URL의 token 파라미터로 GET /api/member/profile/email/complete 호출
 *   - 성공: '이메일이 변경되었습니다' 토스트 + 기본정보 탭으로 이동
 *   - 실패(EXPIRED): 인증 안내 화면으로 이동 (재발송 가능)
 *   - 실패(그 외): 에러 메시지 표시
 *
 * URL: /settings/profile/email/complete?token=<verifyToken>
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

export default function EmailCompletePage() {
  return (
    <Suspense fallback={null}>
      <EmailCompleteInner />
    </Suspense>
  );
}

function EmailCompleteInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get("token") ?? "";

  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setError("유효하지 않은 인증 링크입니다.");
      return;
    }

    fetch(`/api/member/profile/email/complete?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json();

        if (!res.ok) {
          // 만료된 경우 — 프로필 이메일 변경 안내로 이동 (재발송 가능)
          if (body.code === "EXPIRED") {
            router.replace(`/settings/profile/email/verify?email=`);
            return;
          }
          setError(body.message ?? "이메일 변경 처리에 실패했습니다.");
          return;
        }

        toast.success("이메일이 변경되었습니다.");
        router.replace("/settings/profile?tab=basic");
      })
      .catch(() => {
        setError("이메일 변경 처리 중 오류가 발생했습니다.");
      });
  }, [token, router]);

  if (error) {
    return (
      <div style={{ padding: 32, maxWidth: 400 }}>
        <div
          style={{
            padding:      "12px 14px",
            background:   "var(--color-error-subtle)",
            border:       "1px solid var(--color-error-border)",
            borderRadius: "var(--radius-md)",
            color:        "var(--color-error)",
            fontSize:     "var(--text-sm)",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
        <button
          className="sp-btn sp-btn-secondary"
          onClick={() => router.push("/settings/profile")}
          style={{ width: "100%" }}
        >
          프로필 설정으로 이동
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, color: "var(--color-text-tertiary)" }}>
      이메일 변경 처리 중...
    </div>
  );
}
