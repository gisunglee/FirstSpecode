"use client";

/**
 * EmailVerifyPage — 이메일 변경 인증 안내 (PID-00013)
 *
 * 역할:
 *   - 변경 요청한 새 이메일 표시
 *   - 인증 메일 재발송 (60초 쿨타임)
 *   - 이메일 없으면 /settings/profile 로 리다이렉트
 *
 * URL: /settings/profile/email/verify?email=<new-email>
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

export default function EmailVerifyPage() {
  return (
    <Suspense fallback={null}>
      <EmailVerifyInner />
    </Suspense>
  );
}

function EmailVerifyInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const email        = searchParams.get("email") ?? "";

  const [cooldown,  setCooldown]  = useState(0);
  const [resending, setResending] = useState(false);

  // 이메일 없으면 프로필로 리다이렉트
  useEffect(() => {
    if (!email) router.replace("/settings/profile");
  }, [email, router]);

  // 쿨타임 카운트다운
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    setResending(true);
    try {
      const at  = sessionStorage.getItem("access_token") ?? "";
      const res = await fetch("/api/member/profile/email/resend", {
        method:  "POST",
        headers: { Authorization: `Bearer ${at}` },
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.message ?? "재발송 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."); return; }
      toast.success("인증 메일을 재발송했습니다.");
      setCooldown(60);
    } finally {
      setResending(false);
    }
  };

  if (!email) return null;

  return (
    <div style={{ padding: "32px", maxWidth: 480 }}>
      {/* 안내 카드 */}
      <div
        style={{
          padding:      24,
          border:       "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          background:   "var(--color-bg-secondary)",
          display:      "flex",
          flexDirection: "column",
          gap:          16,
        }}
      >
        {/* 이메일 아이콘 + 주소 */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <span style={{ fontSize: 24 }}>✉️</span>
          <div>
            <p style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>{email}</p>
            <p style={{ marginTop: 4, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
              으로 인증 메일을 발송했습니다.
            </p>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--color-border)" }} />

        {/* 안내 문구 */}
        <ul style={{ margin: 0, padding: "0 0 0 20px", display: "flex", flexDirection: "column", gap: 6 }}>
          <li style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            메일함을 확인하고 인증 링크를 클릭해 주세요.
          </li>
          <li style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            스팸함도 확인해 주세요.
          </li>
          <li style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            인증 링크는 <strong>1시간</strong> 동안 유효합니다.
          </li>
          <li style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            인증 완료 전까지 기존 이메일이 유지됩니다.
          </li>
        </ul>

        {/* 재발송 버튼 */}
        <button
          className="sp-btn sp-btn-secondary"
          onClick={handleResend}
          disabled={resending || cooldown > 0}
          style={{ width: "100%", marginTop: 4 }}
        >
          {resending
            ? "발송 중..."
            : cooldown > 0
            ? `재발송 (${cooldown}초 후 가능)`
            : "인증 메일 재발송"}
        </button>
      </div>

      {/* 프로필로 돌아가기 */}
      <button
        className="sp-btn sp-btn-ghost"
        onClick={() => router.push("/settings/profile")}
        style={{ marginTop: 16, width: "100%" }}
      >
        ← 프로필 설정으로 돌아가기
      </button>
    </div>
  );
}
