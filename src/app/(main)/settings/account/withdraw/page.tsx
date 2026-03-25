"use client";

/**
 * WithdrawPage — 회원 탈퇴 (PID-00014)
 *
 * 역할:
 *   STEP 1 (소유 프로젝트 있을 때): 프로젝트 목록 → [양도하기] / [삭제 후 탈퇴]
 *   STEP 2: 본인 재인증 (비밀번호 or 소셜)
 *   DIALOG: 소유 프로젝트 없을 때 확인 다이얼로그
 *
 * URL: /settings/account/withdraw
 *      ?socialToken=... (소셜 재인증 후 콜백에서 복귀 시)
 */

import { useCallback, useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

type OwnedProject = { projectId: string; projectName: string };
type Step = "loading" | "dialog" | "owned" | "reauth" | "done";

export default function WithdrawPage() {
  return (
    <Suspense fallback={null}>
      <WithdrawInner />
    </Suspense>
  );
}

function WithdrawInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  // 소셜 재인증 후 콜백에서 받은 socialToken
  const socialTokenFromCallback = searchParams.get("socialToken") ?? "";

  const [step,          setStep]          = useState<Step>("loading");
  const [ownedProjects, setOwnedProjects] = useState<OwnedProject[]>([]);
  const [hasPassword,   setHasPassword]   = useState(false);
  const [socialProviders, setSocialProviders] = useState<{ google: boolean; github: boolean }>({ google: false, github: false });

  // 소유 프로젝트 조회
  const loadOwnedProjects = useCallback(async () => {
    const at = sessionStorage.getItem("access_token") ?? "";

    const [projectsRes, profileRes] = await Promise.all([
      fetch("/api/member/me/owned-projects",  { headers: { Authorization: `Bearer ${at}` } }),
      fetch("/api/member/profile",            { headers: { Authorization: `Bearer ${at}` } }),
    ]);

    if (!projectsRes.ok || !profileRes.ok) {
      toast.error("정보를 불러오는 중 오류가 발생했습니다.");
      router.push("/settings/profile");
      return;
    }

    const { data: projectData } = await projectsRes.json();
    const { data: profileData } = await profileRes.json();

    setHasPassword(profileData.hasPassword);
    setSocialProviders(profileData.hasSocialAccounts);

    if (projectData.totalCount > 0) {
      setOwnedProjects(projectData.projects);
      setStep("owned");
    } else {
      setStep("dialog");
    }
  }, [router]);

  useEffect(() => {
    // 소셜 재인증 후 돌아온 경우 → 바로 STEP 2로 이동해서 탈퇴 처리
    if (socialTokenFromCallback) {
      handleWithdraw(undefined, socialTokenFromCallback);
      return;
    }
    loadOwnedProjects();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 탈퇴 API 호출 ────────────────────────────────────────────────────
  const [withdrawing, setWithdrawing] = useState(false);

  const handleWithdraw = async (password?: string, socialToken?: string) => {
    setWithdrawing(true);
    try {
      const at  = sessionStorage.getItem("access_token") ?? "";
      const res = await fetch("/api/member/me", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${at}` },
        body:    JSON.stringify({
          ...(password    ? { password }    : {}),
          ...(socialToken ? { socialToken } : {}),
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        toast.error(body.message ?? "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }

      // 로컬 토큰 제거
      sessionStorage.removeItem("access_token");
      sessionStorage.removeItem("refresh_token");

      setStep("done");
      setTimeout(() => router.replace("/auth/login"), 2000);

    } finally {
      setWithdrawing(false);
    }
  };

  // ── 소셜 재인증 시작 ──────────────────────────────────────────────────
  const handleSocialReauth = async (provider: "google" | "github") => {
    const at  = sessionStorage.getItem("access_token") ?? "";
    const res = await fetch(`/api/auth/social/${provider}/authorize?action=withdraw`, {
      headers: { Authorization: `Bearer ${at}` },
    });
    const body = await res.json();
    if (!res.ok) { toast.error(body.message ?? "소셜 인증 요청에 실패했습니다."); return; }
    window.location.href = body.data.url;
  };

  // ── 렌더 ──────────────────────────────────────────────────────────────

  if (step === "loading") {
    return <div style={{ padding: 32, color: "var(--color-text-tertiary)" }}>불러오는 중...</div>;
  }

  if (step === "done") {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--color-text-secondary)" }}>
        탈퇴가 완료되었습니다. 로그인 화면으로 이동합니다...
      </div>
    );
  }

  return (
    <div style={{ padding: "32px", maxWidth: 520 }}>
      <h2 style={{ fontSize: "var(--text-xl)", fontWeight: 600, marginBottom: 8 }}>회원 탈퇴</h2>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", marginBottom: 32 }}>
        탈퇴 즉시 계정이 비활성화되며 이전 데이터는 복구할 수 없습니다.
      </p>

      {/* STEP 1 — 소유 프로젝트 처리 */}
      {step === "owned" && (
        <OwnedProjectsStep
          projects={ownedProjects}
          onReload={loadOwnedProjects}
          onNext={() => setStep("reauth")}
          onCancel={() => router.push("/settings/profile")}
        />
      )}

      {/* STEP 2 — 재인증 */}
      {step === "reauth" && (
        <ReauthStep
          hasPassword={hasPassword}
          socialProviders={socialProviders}
          withdrawing={withdrawing}
          onWithdraw={handleWithdraw}
          onSocialReauth={handleSocialReauth}
          onBack={() => setStep(ownedProjects.length > 0 ? "owned" : "dialog")}
        />
      )}

      {/* DIALOG — 소유 프로젝트 없음 */}
      {step === "dialog" && (
        <NoProjectDialog
          withdrawing={withdrawing}
          hasPassword={hasPassword}
          socialProviders={socialProviders}
          onConfirm={() => setStep("reauth")}
          onCancel={() => router.push("/settings/profile")}
        />
      )}
    </div>
  );
}

// ─── STEP 1: 소유 프로젝트 처리 ──────────────────────────────────────────
function OwnedProjectsStep({
  projects,
  onReload,
  onNext,
  onCancel,
}: {
  projects:  OwnedProject[];
  onReload:  () => void;
  onNext:    () => void;
  onCancel:  () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <p style={{ fontWeight: 600, fontSize: "var(--text-base)", marginBottom: 12 }}>
          소유 프로젝트 ({projects.length}개)
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {projects.map((p) => (
            <div
              key={p.projectId}
              style={{
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                padding:        "10px 14px",
                border:         "1px solid var(--color-border)",
                borderRadius:   "var(--radius-md)",
                background:     "var(--color-bg-secondary)",
              }}
            >
              <span style={{ fontSize: "var(--text-sm)" }}>{p.projectName}</span>
              <button
                className="sp-btn sp-btn-secondary"
                style={{ fontSize: "var(--text-xs)" }}
                onClick={() => {
                  // 양도 후 돌아왔을 때 목록 재조회
                  window.addEventListener("focus", onReload, { once: true });
                  window.open(`/project/${p.projectId}/settings`, "_blank");
                }}
              >
                양도하기 →
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 경고 메시지 */}
      <div
        style={{
          padding:      "10px 14px",
          background:   "var(--color-warning-subtle)",
          border:       "1px solid var(--color-warning-border)",
          borderRadius: "var(--radius-md)",
          fontSize:     "var(--text-sm)",
          color:        "var(--color-warning)",
        }}
      >
        ⚠️ 양도하지 않은 프로젝트는 탈퇴 시 전체 삭제됩니다.
      </div>

      <button className="sp-btn sp-btn-danger" onClick={onNext} style={{ width: "100%" }}>
        삭제 후 탈퇴 진행
      </button>
      <button
        className="sp-btn sp-btn-ghost"
        onClick={onCancel}
        style={{ width: "100%", textAlign: "center" }}
      >
        취소
      </button>
    </div>
  );
}

// ─── STEP 2: 재인증 ──────────────────────────────────────────────────────
function ReauthStep({
  hasPassword,
  socialProviders,
  withdrawing,
  onWithdraw,
  onSocialReauth,
  onBack,
}: {
  hasPassword:    boolean;
  socialProviders: { google: boolean; github: boolean };
  withdrawing:    boolean;
  onWithdraw:     (password?: string, socialToken?: string) => void;
  onSocialReauth: (provider: "google" | "github") => void;
  onBack:         () => void;
}) {
  const [password,    setPassword]    = useState("");
  const [showPw,      setShowPw]      = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
        본인 확인 후 탈퇴가 진행됩니다.
      </p>

      {hasPassword ? (
        <>
          <div>
            <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, marginBottom: 6 }}>
              현재 비밀번호
            </label>
            <div style={{ position: "relative" }}>
              <input
                className="sp-input"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="현재 비밀번호를 입력해 주세요"
                style={{ width: "100%", paddingRight: 40 }}
              />
              <button type="button" onClick={() => setShowPw((v) => !v)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: 14 }}>
                {showPw ? "숨김" : "표시"}
              </button>
            </div>
          </div>

          <button
            className="sp-btn sp-btn-danger"
            onClick={() => {
              if (!password.trim()) { toast.error("비밀번호를 입력해 주세요."); return; }
              onWithdraw(password);
            }}
            disabled={withdrawing}
            style={{ width: "100%" }}
          >
            {withdrawing ? "탈퇴 처리 중..." : "탈퇴 확인"}
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
            소셜 계정으로 본인을 확인해 주세요.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {socialProviders.google && (
              <button
                className="sp-btn sp-btn-secondary"
                onClick={() => onSocialReauth("google")}
                disabled={withdrawing}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                <span style={{ fontWeight: 700, fontSize: 13 }}>G</span>
                Google로 본인 확인
              </button>
            )}
            {socialProviders.github && (
              <button
                className="sp-btn sp-btn-secondary"
                onClick={() => onSocialReauth("github")}
                disabled={withdrawing}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                <span style={{ fontWeight: 700, fontSize: 13 }}>GH</span>
                GitHub로 본인 확인
              </button>
            )}
          </div>
        </>
      )}

      <button className="sp-btn sp-btn-ghost" onClick={onBack} style={{ width: "100%", textAlign: "center" }}>
        ← 이전으로
      </button>
    </div>
  );
}

// ─── DIALOG: 소유 프로젝트 없음 ──────────────────────────────────────────
function NoProjectDialog({
  withdrawing,
  hasPassword,
  socialProviders,
  onConfirm,
  onCancel,
}: {
  withdrawing:     boolean;
  hasPassword:     boolean;
  socialProviders: { google: boolean; github: boolean };
  onConfirm:       () => void;
  onCancel:        () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          padding:      "20px",
          border:       "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          background:   "var(--color-bg-secondary)",
        }}
      >
        <p style={{ fontWeight: 600, fontSize: "var(--text-base)", marginBottom: 10 }}>
          정말 탈퇴하시겠습니까?
        </p>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
          탈퇴 즉시 계정이 비활성화되며 이전 데이터는 복구할 수 없습니다.
        </p>
      </div>

      {/* 소셜 전용 계정이면 재인증 필요 */}
      {!hasPassword && (socialProviders.google || socialProviders.github) ? (
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
          탈퇴를 위해 다음 단계에서 본인 확인이 필요합니다.
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="sp-btn sp-btn-danger"
          onClick={onConfirm}
          disabled={withdrawing}
          style={{ flex: 1 }}
        >
          {withdrawing ? "탈퇴 처리 중..." : "탈퇴하기"}
        </button>
        <button className="sp-btn sp-btn-secondary" onClick={onCancel} style={{ flex: 1 }}>
          취소
        </button>
      </div>
    </div>
  );
}
