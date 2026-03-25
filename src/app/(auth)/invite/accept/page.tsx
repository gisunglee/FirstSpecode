"use client";

/**
 * InviteAcceptPage — 초대 수락 (PID-00021)
 *
 * 역할:
 *   - URL의 token으로 초대 정보 조회 (FID-00069)
 *   - 로그인 상태: [수락하기] 버튼으로 합류 처리 (FID-00070)
 *   - 미로그인 상태: 로그인/회원가입 링크 표시
 *   - 미가입자: inviteToken 파라미터 포함하여 회원가입 이동 (FID-00071)
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { apiFetch } from "@/lib/apiFetch";
import { authFetch } from "@/lib/authFetch";

type InvitationInfo = {
  projectId:    string;
  projectName:  string;
  role:         string;
  inviterEmail: string | null;
  expiresAt:    string;
};

const ROLE_LABEL: Record<string, string> = { OWNER: "OWNER", ADMIN: "관리자", MEMBER: "멤버" };

export default function InviteAcceptPage() {
  return <Suspense fallback={null}><InviteAcceptInner /></Suspense>;
}

function InviteAcceptInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const token        = searchParams.get("token") ?? "";

  const [info,       setInfo]       = useState<InvitationInfo | null>(null);
  const [errorMsg,   setErrorMsg]   = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [accepting,  setAccepting]  = useState(false);

  useEffect(() => {
    if (!token) { setErrorMsg("초대 링크가 올바르지 않습니다."); setLoading(false); return; }

    // 로그인 상태 확인
    const at = sessionStorage.getItem("access_token");
    setIsLoggedIn(!!at);

    // 초대 정보 조회 (인증 불필요)
    apiFetch<{ data: InvitationInfo }>(`/api/invitations/${token}`)
      .then((res) => setInfo(res.data))
      .catch((err: Error) => setErrorMsg(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAccept() {
    setAccepting(true);
    try {
      const res = await authFetch<{ data: { projectId: string } }>(
        `/api/invitations/${token}/accept`,
        { method: "POST" }
      );
      toast.success("프로젝트에 합류했습니다!");
      router.push("/dashboard");
      // 합류한 프로젝트를 현재 프로젝트로 설정하면 더 좋지만 여기선 단순 이동
      void res;
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setAccepting(false);
    }
  }

  // ── 공통 카드 스타일 ────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: "#ffffff",
    borderRadius: 20,
    boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
    padding: "40px 36px",
    textAlign: "center",
  };

  if (loading) {
    return (
      <div style={card}>
        <p style={{ color: "#888" }}>초대 정보를 확인 중입니다...</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div style={card}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 700, color: "#111" }}>
          초대 링크 오류
        </h2>
        <p style={{ color: "#666", marginBottom: 24 }}>{errorMsg}</p>
        <Link href="/auth/login" style={{ color: "#4a56d4", textDecoration: "none", fontWeight: 600 }}>
          로그인 화면으로 이동
        </Link>
      </div>
    );
  }

  if (!info) return null;

  return (
    <div style={card}>
      {/* 로고 */}
      <div style={{
        width: 52, height: 52, borderRadius: 14, margin: "0 auto 20px",
        background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 24,
      }}>
        ⚡
      </div>

      <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: "#111" }}>
        프로젝트 초대
      </h2>
      <p style={{ margin: "0 0 24px", fontSize: 14, color: "#888" }}>
        아래 프로젝트에 초대되었습니다
      </p>

      {/* 초대 정보 */}
      <div style={{
        background: "#f8f9fc", borderRadius: 12, padding: "20px",
        textAlign: "left", marginBottom: 24,
      }}>
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: "0 0 2px", fontSize: 12, color: "#888", fontWeight: 600 }}>프로젝트</p>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111" }}>{info.projectName}</p>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: 12, color: "#888", fontWeight: 600 }}>역할</p>
            <span style={{
              display: "inline-block", padding: "2px 10px",
              background: "#e8ebff", color: "#4a56d4",
              borderRadius: 20, fontSize: 13, fontWeight: 700,
            }}>
              {ROLE_LABEL[info.role] ?? info.role}
            </span>
          </div>
          {info.inviterEmail && (
            <div>
              <p style={{ margin: "0 0 2px", fontSize: 12, color: "#888", fontWeight: 600 }}>초대자</p>
              <p style={{ margin: 0, fontSize: 13, color: "#444" }}>{info.inviterEmail}</p>
            </div>
          )}
        </div>
      </div>

      {/* 로그인 상태에 따라 분기 */}
      {isLoggedIn ? (
        <button
          onClick={handleAccept}
          disabled={accepting}
          style={{
            width: "100%", padding: "14px",
            background: "linear-gradient(135deg, #4a56d4 0%, #6366f1 100%)",
            color: "#fff", border: "none", borderRadius: 10,
            fontSize: 15, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 4px 12px rgba(74,86,212,0.35)",
            opacity: accepting ? 0.7 : 1,
          }}
        >
          {accepting ? "처리 중..." : "수락하기"}
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: "0 0 8px", fontSize: 14, color: "#666" }}>
            수락하려면 먼저 로그인하세요.
          </p>
          <Link
            href={`/auth/login?redirect=/invite/accept?token=${token}`}
            style={{
              display: "block", padding: "12px",
              background: "linear-gradient(135deg, #4a56d4 0%, #6366f1 100%)",
              color: "#fff", borderRadius: 10, textDecoration: "none",
              fontSize: 15, fontWeight: 700, textAlign: "center",
            }}
          >
            로그인
          </Link>
          <Link
            href={`/auth/register?inviteToken=${token}`}
            style={{
              display: "block", padding: "12px",
              background: "#f0f0f0", color: "#333",
              borderRadius: 10, textDecoration: "none",
              fontSize: 14, fontWeight: 600, textAlign: "center",
            }}
          >
            계정이 없으신가요? 회원가입
          </Link>
        </div>
      )}
    </div>
  );
}
