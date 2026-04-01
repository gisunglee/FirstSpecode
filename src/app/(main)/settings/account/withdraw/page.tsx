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
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import { useQueryClient } from "@tanstack/react-query";

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
  const queryClient  = useQueryClient();
  const searchParams = useSearchParams();

  // 소셜 재인증 후 콜백에서 받은 socialToken
  const socialTokenFromCallback = searchParams.get("socialToken") ?? "";

  const [step,          setStep]          = useState<Step>("loading");
  const [ownedProjects, setOwnedProjects] = useState<OwnedProject[]>([]);
  const [hasPassword,   setHasPassword]   = useState(false);
  const [socialProviders, setSocialProviders] = useState<{ google: boolean; github: boolean }>({ google: false, github: false });

  // 양도 다이얼로그용
  const [transferTarget, setTransferTarget] = useState<OwnedProject | null>(null);

  const loadOwnedProjects = useCallback(async () => {
    try {
      const projectsRes = await authFetch<{ data: { totalCount: number; projects: OwnedProject[] } }>("/api/member/me/owned-projects");
      const profileRes = await authFetch<{ data: { hasPassword: boolean; hasSocialAccounts: { google: boolean; github: boolean } } }>("/api/member/profile");

      setHasPassword(profileRes.data.hasPassword);
      setSocialProviders(profileRes.data.hasSocialAccounts);

      if (profileRes.data.hasPassword === undefined) {
         // Fallback if profile API doesn't return expected structure
      }

      if (projectsRes.data.totalCount > 0) {
        setOwnedProjects(projectsRes.data.projects);
        setStep("owned");
      } else {
        setStep("dialog");
      }
    } catch (err) {
      toast.error("정보를 불러오는 중 오류가 발생했습니다.");
      console.error(err);
      router.push("/settings/profile");
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
    <div style={{ padding: 0 }}>
      {/* 헤더 (다른 페이지와 통일) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>회원 탈퇴</div>
      </div>

      <div style={{ padding: "0 24px 24px", maxWidth: 640 }}>
        <div style={{ width: "100%", maxWidth: 520, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)", padding: "32px 32px" }}>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", marginBottom: 32, textAlign: "center", lineHeight: 1.6 }}>
            탈퇴 즉시 계정이 비활성화되며<br />이전 데이터는 복구할 수 없습니다.
          </p>

          {/* STEP 1 — 소유 프로젝트 처리 */}
          {step === "owned" && (
            <OwnedProjectsStep
              projects={ownedProjects}
              onReload={loadOwnedProjects}
              onTransferClick={(p) => setTransferTarget(p)}
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

          {/* 취소 링크 (하단 공통) */}
          <div style={{ marginTop: 24, textAlign: "center" }}>
            <button onClick={() => router.push("/settings/profile")} style={{ background: "none", border: "none", color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)", textDecoration: "underline", cursor: "pointer" }}>
              탈퇴 취소하고 돌아가기
            </button>
          </div>
        </div>
      </div>

      {transferTarget && (
        <TransferDialog
          project={transferTarget}
          onClose={() => setTransferTarget(null)}
          onSuccess={() => {
            setTransferTarget(null);
            // 캐시 무효화 (GNB 등 연동된 모든 프로젝트 목록 갱신)
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            queryClient.invalidateQueries({ queryKey: ["projects", "my"] });
            queryClient.invalidateQueries({ queryKey: ["my-role"] });
            
            loadOwnedProjects();
            
            // 만약 현재 작업 중인 프로젝트를 양도한 것이라면 목록으로 이동
            const state = useAppStore.getState();
            if (state.currentProjectId === transferTarget.projectId) {
              state.setCurrentProjectId("");
              router.push("/projects");
            }
          }}
        />
      )}
    </div>
  );
}

// ─── STEP 1: 소유 프로젝트 처리 ──────────────────────────────────────────
function OwnedProjectsStep({
  projects,
  onReload,
  onTransferClick,
  onNext,
  onCancel,
}: {
  projects:  OwnedProject[];
  onReload:  () => void;
  onTransferClick: (p: OwnedProject) => void;
  onNext:    () => void;
  onCancel:  () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <p style={{ fontWeight: 600, fontSize: "var(--text-base)", marginBottom: 12, color: "var(--color-text-primary)" }}>
          현재 소유 중인 프로젝트 ({projects.length}개)
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {projects.map((p) => (
            <div
              key={p.projectId}
              style={{
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                padding:        "12px 16px",
                border:         "1px solid var(--color-border)",
                borderRadius:   "var(--radius-md)",
                background:     "var(--color-bg-muted)",
              }}
            >
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, color: "var(--color-text-primary)" }}>{p.projectName}</span>
              <button
                className="sp-btn sp-btn-secondary"
                style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }}
                onClick={() => onTransferClick(p)}
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
          padding:      "12px 16px",
          background:   "var(--color-warning-subtle, rgba(245,158,11,0.08))",
          border:       "1px solid var(--color-warning-border, rgba(245,158,11,0.2))",
          borderRadius: "var(--radius-md)",
          fontSize:     "var(--text-sm)",
          color:        "var(--color-warning, #d97706)",
          lineHeight:   1.5,
          display:      "flex",
          gap:          8,
        }}
      >
        <span>⚠️</span>
        <div>양도하지 않은 프로젝트는 탈퇴 시 <strong>모두 삭제</strong>됩니다.</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        <button className="sp-btn sp-btn-danger" onClick={onNext} style={{ width: "100%", padding: "10px" }}>
          삭제 후 탈퇴 진행
        </button>
      </div>
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

// ─── DIALOG: 프로젝트 양도 (NEW) ──────────────────────────────────────────
function TransferDialog({
  project,
  onClose,
  onSuccess,
}: {
  project:   OwnedProject;
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<{ memberId: string; name: string; email: string; role: string }[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);

  // 멤버 조회
  useEffect(() => {
    authFetch<{ data: { members: any[] } }>(`/api/projects/${project.projectId}/members`)
      .then((res) => {
        // 본인 제외 활성 멤버만 (이미 API에서 ACTIVE만 주지만 혹시 모름)
        const others = res.data.members.filter((m: any) => m.role !== "OWNER");
        setMembers(others);
      })
      .catch(() => toast.error("멤버 목록을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [project.projectId]);

  const handleTransfer = async () => {
    if (!selectedId) return;
    const target = members.find(m => m.memberId === selectedId);
    if (!window.confirm(`'${target?.name || target?.email}' 님에게 프로젝트 소유권을 양도시겠습니까?`)) return;

    setBusy(true);
    try {
      await authFetch(`/api/projects/${project.projectId}/members/transfer-and-leave`, {
        method: "POST",
        body: JSON.stringify({ newOwnerId: selectedId }),
      });
      toast.success("소유권 양도가 완료되었습니다.");
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "양도 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, background: "var(--color-bg-card)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-xl)", padding: 24 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: "var(--text-lg)", fontWeight: 700 }}>프로젝트 소유권 양도</h3>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", marginBottom: 20 }}>
          <strong>'{project.projectName}'</strong> 프로젝트를 양도받을 팀원을 선택해 주세요.
        </p>

        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-tertiary)" }}>멤버 목록 로딩 중...</div>
        ) : members.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-tertiary)" }}>
            양도 가능한 멤버가 없습니다.<br />(관리자/일반 멤버가 있어야 양도 가능)
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 300, overflowY: "auto", marginBottom: 20 }}>
            {members.map(m => (
              <label key={m.memberId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", cursor: "pointer", background: selectedId === m.memberId ? "var(--color-bg-elevated)" : "transparent" }}>
                <input type="radio" name="member" value={m.memberId} checked={selectedId === m.memberId} onChange={() => setSelectedId(m.memberId)} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{m.name || "이름 없음"}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>{m.email}</div>
                </div>
              </label>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="sp-btn sp-btn-secondary" style={{ flex: 1 }} onClick={onClose} disabled={busy}>취소</button>
          <button className="sp-btn sp-btn-primary" style={{ flex: 1 }} onClick={handleTransfer} disabled={!selectedId || busy}>
            {busy ? "처리 중..." : "양도하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
