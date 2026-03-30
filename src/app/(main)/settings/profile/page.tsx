"use client";

/**
 * ProfileSettingsPage — 프로필 설정 (PID-00012)
 *
 * 역할:
 *   - 기본정보 탭: 프로필 이미지·이름 변경, 이메일 변경 요청
 *   - 보안 탭: 비밀번호 변경 (소셜 전용 계정은 현재 비밀번호 미표시)
 *   - 소셜연동 탭: Google·GitHub 연동·해제
 *
 * URL: /settings/profile?tab=basic|security|social
 */

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

// ─── 타입 ────────────────────────────────────────────────────────────────
type Tab = "basic" | "security" | "social";

interface ProfileData {
  name:         string;
  email:        string;
  profileImage: string | null;
  hasPassword:  boolean;
  hasSocialAccounts: { google: boolean; github: boolean };
}

// ─── 공통 헬퍼: AT 포함 fetch ────────────────────────────────────────────
function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const at = sessionStorage.getItem("access_token") ?? "";
  return fetch(url, {
    ...options,
    headers: {
      ...(options?.headers ?? {}),
      Authorization: `Bearer ${at}`,
    },
  });
}

// ─── 페이지 진입점 (Suspense 래핑) ───────────────────────────────────────
export default function ProfileSettingsPage() {
  return (
    <Suspense fallback={null}>
      <ProfileSettingsInner />
    </Suspense>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────
function ProfileSettingsInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const tabParam     = searchParams.get("tab") as Tab | null;

  const [activeTab,  setActiveTab]  = useState<Tab>(tabParam ?? "basic");
  const [profile,    setProfile]    = useState<ProfileData | null>(null);
  const [loading,    setLoading]    = useState(true);

  // 연동 완료 토스트 (콜백 페이지에서 ?linked=1로 이동 시)
  useEffect(() => {
    if (searchParams.get("linked") === "1") {
      toast.success("소셜 계정이 연동되었습니다.");
      router.replace("/settings/profile?tab=social");
    }
  }, [searchParams, router]);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await authFetch("/api/member/profile");
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 401) { router.push("/auth/login"); return; }
        toast.error(body.message ?? "프로필 조회에 실패했습니다.");
        return;
      }
      setProfile(body.data);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  if (loading) return <div style={{ padding: 32, color: "var(--color-text-tertiary)" }}>불러오는 중...</div>;
  if (!profile) return null;

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>프로필 설정</div>
      </div>

      <div style={{ padding: "0 24px 24px", maxWidth: 640 }}>
      {/* 탭 네비게이션 */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--color-border)", marginBottom: 32 }}>
        {(["basic", "security", "social"] as Tab[]).map((tab) => {
          const labels: Record<Tab, string> = { basic: "기본정보", security: "보안", social: "소셜연동" };
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding:      "8px 16px",
                background:   "transparent",
                border:       "none",
                borderBottom: activeTab === tab ? "2px solid var(--color-primary)" : "2px solid transparent",
                color:        activeTab === tab ? "var(--color-primary)" : "var(--color-text-secondary)",
                fontWeight:   activeTab === tab ? 600 : 400,
                fontSize:     "var(--text-sm)",
                cursor:       "pointer",
                marginBottom: -1,
              }}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {/* 탭 콘텐츠 카드 */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "24px 28px", background: "var(--color-bg-card)" }}>
        {activeTab === "basic"    && <BasicTab    profile={profile} onRefresh={fetchProfile} />}
        {activeTab === "security" && <SecurityTab hasPassword={profile.hasPassword} />}
        {activeTab === "social"   && <SocialTab   social={profile.hasSocialAccounts} hasPassword={profile.hasPassword} onRefresh={fetchProfile} />}
      </div>

      {/* 위험 영역 */}
      <div style={{ marginTop: 16, padding: "16px 20px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-bg-card)" }}>
        <Link
          href="/settings/account/withdraw"
          style={{ fontSize: "var(--text-sm)", color: "var(--color-error)", textDecoration: "none" }}
        >
          회원 탈퇴
        </Link>
      </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 기본정보 탭
// ─────────────────────────────────────────────────────────────────────────
function BasicTab({ profile, onRefresh }: { profile: ProfileData; onRefresh: () => void }) {
  const router = useRouter();

  // 이름 변경
  const [name,        setName]        = useState(profile.name);
  const [nameSaving,  setNameSaving]  = useState(false);

  const handleSaveName = async () => {
    if (!name.trim()) { toast.error("이름을 입력해 주세요."); return; }
    setNameSaving(true);
    try {
      const res  = await authFetch("/api/member/profile/name", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.message ?? "이름 변경에 실패했습니다."); return; }
      toast.success("이름이 변경되었습니다.");
    } finally {
      setNameSaving(false);
    }
  };

  // 이미지 업로드
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imgUrl, setImgUrl] = useState(profile.profileImage);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      toast.error("jpg, png 형식만 업로드 가능합니다.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("이미지는 최대 2MB까지 업로드 가능합니다.");
      return;
    }

    const form = new FormData();
    form.append("image", file);
    const res  = await authFetch("/api/member/profile/image", { method: "PUT", body: form });
    const body = await res.json();
    if (!res.ok) { toast.error(body.message ?? "이미지 업로드에 실패했습니다."); return; }
    setImgUrl(body.data.imageUrl);
    toast.success("프로필 이미지가 변경되었습니다.");
  };

  // 이메일 변경 요청
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [newEmail,      setNewEmail]      = useState("");
  const [emailSending,  setEmailSending]  = useState(false);

  const handleEmailChange = async () => {
    if (!newEmail.trim()) { toast.error("이메일을 입력해 주세요."); return; }
    setEmailSending(true);
    try {
      const res  = await authFetch("/api/member/profile/email/change", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ newEmail }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.message ?? "이메일 변경 요청에 실패했습니다."); return; }
      router.push(`/settings/profile/email/verify?email=${encodeURIComponent(newEmail)}`);
    } finally {
      setEmailSending(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* 프로필 이미지 */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 80, height: 80, borderRadius: "50%",
            background:  "var(--color-bg-tertiary)",
            border:      "2px solid var(--color-border)",
            overflow:    "hidden",
            flexShrink:  0,
          }}
        >
          {imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt="프로필" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-tertiary)", fontSize: 32 }}>
              👤
            </div>
          )}
        </div>
        <div>
          <button className="sp-btn sp-btn-secondary" onClick={() => fileInputRef.current?.click()}>
            이미지 변경
          </button>
          <p style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
            jpg, png · 최대 2MB
          </p>
        </div>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" hidden onChange={handleImageChange} />
      </div>

      {/* 이름 변경 */}
      <div>
        <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, marginBottom: 6 }}>이름</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="sp-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름을 입력해 주세요"
            style={{ flex: 1 }}
          />
          <button className="sp-btn sp-btn-primary" onClick={handleSaveName} disabled={nameSaving}>
            {nameSaving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* 이메일 변경 */}
      <div>
        <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, marginBottom: 6 }}>이메일</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="sp-input"
            value={profile.email}
            readOnly
            style={{ flex: 1, color: "var(--color-text-secondary)", background: "var(--color-bg-secondary)" }}
          />
          <button
            className="sp-btn sp-btn-secondary"
            onClick={() => setShowEmailForm((v) => !v)}
          >
            변경 요청
          </button>
        </div>

        {showEmailForm && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              className="sp-input"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="새 이메일 주소를 입력해 주세요"
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="sp-btn sp-btn-secondary" onClick={() => { setShowEmailForm(false); setNewEmail(""); }}>
                취소
              </button>
              <button className="sp-btn sp-btn-primary" onClick={handleEmailChange} disabled={emailSending}>
                {emailSending ? "발송 중..." : "인증 메일 발송"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 보안 탭
// ─────────────────────────────────────────────────────────────────────────
function SecurityTab({ hasPassword }: { hasPassword: boolean }) {
  const [currentPw,   setCurrentPw]   = useState("");
  const [newPw,       setNewPw]       = useState("");
  const [confirmPw,   setConfirmPw]   = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving,      setSaving]      = useState(false);

  const PASSWORD_POLICY = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;

  const handleSubmit = async () => {
    if (!newPw) { toast.error("새 비밀번호를 입력해 주세요."); return; }
    if (!PASSWORD_POLICY.test(newPw)) {
      toast.error("비밀번호는 영문·숫자·특수문자를 포함한 8자 이상이어야 합니다.");
      return;
    }
    if (newPw !== confirmPw) { toast.error("비밀번호가 일치하지 않습니다."); return; }

    setSaving(true);
    try {
      const at = sessionStorage.getItem("access_token") ?? "";
      const rt = sessionStorage.getItem("refresh_token") ?? "";
      const res = await fetch("/api/member/profile/password", {
        method:  "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${at}` },
        body:    JSON.stringify({
          currentPassword:     hasPassword ? currentPw : undefined,
          newPassword:         newPw,
          currentRefreshToken: rt || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.message ?? "비밀번호 변경에 실패했습니다."); return; }
      toast.success("비밀번호가 변경되었습니다.");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 400 }}>
      {hasPassword && (
        <div>
          <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, marginBottom: 6 }}>현재 비밀번호</label>
          <div style={{ position: "relative" }}>
            <input
              className="sp-input"
              type={showCurrent ? "text" : "password"}
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="현재 비밀번호"
              style={{ width: "100%", paddingRight: 40 }}
            />
            <button type="button" onClick={() => setShowCurrent((v) => !v)}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: 14 }}>
              {showCurrent ? "숨김" : "표시"}
            </button>
          </div>
        </div>
      )}

      <div>
        <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, marginBottom: 6 }}>새 비밀번호</label>
        <div style={{ position: "relative" }}>
          <input
            className="sp-input"
            type={showNew ? "text" : "password"}
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="영문·숫자·특수문자 8자 이상"
            style={{ width: "100%", paddingRight: 40 }}
          />
          <button type="button" onClick={() => setShowNew((v) => !v)}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: 14 }}>
            {showNew ? "숨김" : "표시"}
          </button>
        </div>
        <p style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
          영문·숫자·특수문자를 포함한 8자 이상
        </p>
      </div>

      <div>
        <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, marginBottom: 6 }}>비밀번호 확인</label>
        <div style={{ position: "relative" }}>
          <input
            className="sp-input"
            type={showConfirm ? "text" : "password"}
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="새 비밀번호를 다시 입력해 주세요"
            style={{ width: "100%", paddingRight: 40 }}
          />
          <button type="button" onClick={() => setShowConfirm((v) => !v)}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: 14 }}>
            {showConfirm ? "숨김" : "표시"}
          </button>
        </div>
        {confirmPw && newPw !== confirmPw && (
          <p style={{ marginTop: 4, fontSize: "var(--text-xs)", color: "var(--color-error)" }}>비밀번호가 일치하지 않습니다.</p>
        )}
      </div>

      <button className="sp-btn sp-btn-primary" onClick={handleSubmit} disabled={saving} style={{ alignSelf: "flex-start" }}>
        {saving ? "변경 중..." : "비밀번호 변경"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 소셜연동 탭
// ─────────────────────────────────────────────────────────────────────────
function SocialTab({
  social,
  hasPassword,
  onRefresh,
}: {
  social:      { google: boolean; github: boolean };
  hasPassword: boolean;
  onRefresh:   () => void;
}) {
  const [loading, setLoading] = useState<"google" | "github" | null>(null);

  // 소셜 계정 추가 연동 — authorize URL 취득 → 리다이렉트
  const handleLink = async (provider: "google" | "github") => {
    setLoading(provider);
    try {
      const at  = sessionStorage.getItem("access_token") ?? "";
      const res = await fetch(`/api/auth/social/${provider}/authorize?action=add`, {
        headers: { Authorization: `Bearer ${at}` },
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.message ?? "연동 요청에 실패했습니다."); return; }
      window.location.href = body.data.url;
    } finally {
      setLoading(null);
    }
  };

  // 연동 해제
  const handleUnlink = async (provider: "google" | "github") => {
    setLoading(provider);
    try {
      const at  = sessionStorage.getItem("access_token") ?? "";
      const res = await fetch("/api/member/social/unlink", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${at}` },
        body:    JSON.stringify({ provider }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.message ?? "연동 해제에 실패했습니다."); return; }
      toast.success("연동이 해제되었습니다.");
      onRefresh();
    } finally {
      setLoading(null);
    }
  };

  // 해제 버튼 비활성화 조건: 비밀번호 없고 연동된 소셜이 1개뿐이면 마지막 수단
  const linkedCount = (social.google ? 1 : 0) + (social.github ? 1 : 0);
  const isLastMethod = !hasPassword && linkedCount <= 1;

  const providers: { key: "google" | "github"; label: string; icon: string }[] = [
    { key: "google", label: "Google", icon: "G" },
    { key: "github", label: "GitHub", icon: "GH" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {providers.map(({ key, label, icon }) => {
        const linked       = social[key];
        const isThisLast   = isLastMethod && linked;
        const isDisabled   = loading !== null || isThisLast;

        return (
          <div
            key={key}
            style={{
              display:       "flex",
              alignItems:    "center",
              justifyContent: "space-between",
              padding:       "16px",
              border:        "1px solid var(--color-border)",
              borderRadius:  "var(--radius-md)",
              background:    "var(--color-bg-secondary)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background:     "var(--color-bg-tertiary)",
                border:         "1px solid var(--color-border)",
                display:        "flex",
                alignItems:     "center",
                justifyContent: "center",
                fontSize:       "var(--text-xs)",
                fontWeight:     700,
                color:          "var(--color-text-secondary)",
              }}>
                {icon}
              </div>
              <div>
                <p style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>{label}</p>
                <p style={{ fontSize: "var(--text-xs)", color: linked ? "var(--color-success)" : "var(--color-text-tertiary)" }}>
                  {linked ? "연동됨" : "미연동"}
                </p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {isThisLast && (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>마지막 로그인 수단</span>
              )}
              {linked ? (
                <button
                  className="sp-btn sp-btn-danger"
                  onClick={() => handleUnlink(key)}
                  disabled={!!isDisabled}
                  style={{ fontSize: "var(--text-sm)" }}
                >
                  {loading === key ? "해제 중..." : "해제"}
                </button>
              ) : (
                <button
                  className="sp-btn sp-btn-secondary"
                  onClick={() => handleLink(key)}
                  disabled={loading !== null}
                  style={{ fontSize: "var(--text-sm)" }}
                >
                  {loading === key ? "연결 중..." : "연동하기"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
