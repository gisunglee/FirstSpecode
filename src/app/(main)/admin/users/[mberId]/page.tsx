"use client";

/**
 * AdminUserDetailPage — 사용자 상세 (/admin/users/[mberId])
 *
 * 역할:
 *   - 사용자 기본 정보 + 참여 프로젝트 목록
 *   - 시스템 관리자 임명/해임 및 계정 접근 보안 조치 (사유·감사 로그 포함)
 *
 * 설계:
 *   - 자기 자신은 임명/해임 버튼 비활성화 (서버도 403)
 *   - 변경 후 쿼리 무효화 → 목록·프로필·훅 모두 최신화
 */

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useIsSystemAdmin } from "@/hooks/useMyRole";

type UserDetail = {
  mberId:        string;
  email:         string | null;
  name:          string | null;
  profileImage:  string | null;
  plan:          string;
  effectivePlan: string;
  planExpiresAt: string | null;
  status:        string;
  isSystemAdmin: boolean;
  joinedAt:      string;
  modifiedAt:    string | null;
  withdrawnAt:   string | null;
  authMethods: {
    hasPassword: boolean;
    socialProviders: string[];
  };
  security: {
    activeLock: {
      status: string;
      reason: string | null;
      failCount: number;
      expiresAt: string | null;
    } | null;
    activeSessionCount: number;
    activeRefreshTokenCount: number;
    activeMcpKeyCount: number;
    activeSupportSessionCount: number;
    lastLoginAttempt: {
      success: boolean;
      failureReason: string | null;
      ipAddress: string | null;
      attemptedAt: string;
    } | null;
  };
  projects: Array<{
    projectId: string;
    name:      string;
    role:      string;
    job:       string;
    joinedAt:  string;
  }>;
};

type AccessAction = "SUSPEND" | "UNSUSPEND" | "UNLOCK" | "FORCE_LOGOUT" | "REVOKE_MCP_KEYS";

const ACCESS_ACTION_META: Record<AccessAction, { label: string; description: string; danger: boolean }> = {
  SUSPEND: {
    label: "계정 정지",
    description: "계정을 정지하고 모든 로그인 세션·Refresh Token·MCP 키를 즉시 폐기합니다.",
    danger: true,
  },
  UNSUSPEND: {
    label: "정지 해제",
    description: "계정을 다시 활성화합니다. 기존 세션과 폐기된 키는 복구되지 않습니다.",
    danger: false,
  },
  UNLOCK: {
    label: "로그인 잠금 해제",
    description: "현재 로그인 실패 잠금을 해제합니다.",
    danger: false,
  },
  FORCE_LOGOUT: {
    label: "전체 기기 로그아웃",
    description: "모든 기기의 로그인 세션·Refresh Token과 관리자 지원 세션을 무효화합니다.",
    danger: true,
  },
  REVOKE_MCP_KEYS: {
    label: "MCP 키 전체 폐기",
    description: "사용자의 활성 MCP 키를 모두 폐기합니다. 키 원문은 복구할 수 없습니다.",
    danger: true,
  },
};

type Props = { params: Promise<{ mberId: string }> };

export default function AdminUserDetailPage({ params }: Props) {
  const { mberId } = use(params);
  const queryClient = useQueryClient();

  // 내 프로필 — 자기 자신 편집 차단 판정용
  const { data: meProfile } = useQuery<{ mberId?: string }>({
    queryKey: ["member", "profile"],
    queryFn: () =>
      authFetch<{ data: { mberId?: string } }>("/api/member/profile").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: user, isLoading, isError, error } = useQuery<UserDetail>({
    queryKey: ["admin", "users", mberId],
    queryFn: () =>
      authFetch<{ data: UserDetail }>(`/api/admin/users/${mberId}`).then((r) => r.data),
  });

  // 임명/해임 모달 상태
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason]       = useState("");
  const [accessAction, setAccessAction] = useState<AccessAction | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { role: "SUPER_ADMIN" | null; reason: string }) =>
      authFetch(`/api/admin/users/${mberId}/system-role`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(input),
      }),
    onSuccess: () => {
      // 상세 + 목록 + 감사 로그 + 대상자 프로필(본인이 당사자면) 모두 갱신
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
      queryClient.invalidateQueries({ queryKey: ["member", "profile"] });
      toast.success("시스템 역할이 변경되었습니다.");
      setModalOpen(false);
      setReason("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const accessMutation = useMutation({
    mutationFn: (input: { action: AccessAction; reason: string }) =>
      authFetch(`/api/admin/users/${mberId}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
      toast.success("사용자 접근 상태가 변경되었습니다.");
      setAccessAction(null);
      setReason("");
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  if (isLoading) {
    return <div style={{ padding: 20, color: "var(--color-text-tertiary)" }}>불러오는 중…</div>;
  }
  if (isError) {
    return <div style={{ padding: 20, color: "var(--color-error)" }}>{error.message}</div>;
  }
  if (!user) {
    return <div style={{ padding: 20, color: "var(--color-error)" }}>사용자를 찾을 수 없습니다.</div>;
  }

  // 자기 자신은 변경 불가 (서버도 거부)
  const isSelf = meProfile?.mberId === user.mberId;
  const nextRole: "SUPER_ADMIN" | null = user.isSystemAdmin ? null : "SUPER_ADMIN";
  const actionLabel = user.isSystemAdmin ? "시스템 관리자 해임" : "시스템 관리자 임명";
  const displayedPlan = user.plan === user.effectivePlan
    ? user.plan
    : `${user.effectivePlan} (${user.plan} 만료)`;
  const statusAction: AccessAction | null =
    user.status === "ACTIVE" ? "SUSPEND" :
    user.status === "SUSPENDED" ? "UNSUSPEND" : null;

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {/* 상단: 뒤로가기 */}
      <div>
        <Link
          href="/admin/users"
          style={{
            fontSize: "var(--text-sm)",
            color:    "var(--color-text-tertiary)",
            textDecoration: "none",
          }}
        >
          ← 사용자 목록
        </Link>
      </div>

      {/* 기본 정보 카드 */}
      <section
        style={{
          background:   "var(--color-bg-card)",
          border:       "1px solid var(--color-border)",
          borderRadius: "var(--radius-card)",
          padding:      20,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          {/* 아바타 */}
          <div
            style={{
              width: 56, height: 56, borderRadius: "var(--radius-full)",
              background: user.profileImage ? "transparent" : "var(--color-brand-subtle)",
              border: "1px solid var(--color-brand-border)",
              color: "var(--color-brand)",
              fontSize: 22, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden", flexShrink: 0,
            }}
          >
            {user.profileImage
              ? <img src={user.profileImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : (user.name?.[0] ?? user.email?.[0] ?? "?").toUpperCase()}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: "var(--text-lg)", color: "var(--color-text-heading)" }}>
                {user.name ?? "(이름 없음)"}
              </h2>
              {user.isSystemAdmin && (
                <span
                  style={{
                    fontSize:    "var(--text-xs)",
                    fontWeight:  700,
                    padding:     "2px 10px",
                    borderRadius:"var(--radius-sm)",
                    background:  "var(--color-warning-subtle)",
                    color:       "var(--color-warning)",
                    border:      "1px solid var(--color-warning-border)",
                  }}
                >
                  SUPER_ADMIN
                </span>
              )}
              {isSelf && (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                  (나)
                </span>
              )}
            </div>
            <div style={{ marginTop: 4, color: "var(--color-text-secondary)", fontSize: "var(--text-sm)" }}>
              {user.email ?? "(이메일 없음)"}
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 20, flexWrap: "wrap", fontSize: "var(--text-xs)" }}>
              <InfoItem label="상태"   value={user.status} />
              <InfoItem label="플랜"   value={displayedPlan} />
              {user.planExpiresAt && (
                <InfoItem label="플랜 만료일" value={new Date(user.planExpiresAt).toLocaleDateString("ko-KR")} />
              )}
              <InfoItem label="가입일" value={new Date(user.joinedAt).toLocaleDateString("ko-KR")} />
              <InfoItem label="프로젝트" value={String(user.projects.length)} />
              {user.withdrawnAt && (
                <InfoItem label="탈퇴일" value={new Date(user.withdrawnAt).toLocaleDateString("ko-KR")} />
              )}
            </div>
          </div>

          {/* 액션 버튼 */}
          <div>
            <button
              className={user.isSystemAdmin ? "sp-btn sp-btn-danger" : "sp-btn sp-btn-primary"}
              onClick={() => setModalOpen(true)}
              disabled={isSelf || (!user.isSystemAdmin && user.status !== "ACTIVE")}
              title={
                isSelf
                  ? "자기 자신의 역할은 변경할 수 없습니다."
                  : (!user.isSystemAdmin && user.status !== "ACTIVE")
                    ? "활성 사용자만 시스템 관리자로 임명할 수 있습니다."
                    : undefined
              }
            >
              {actionLabel}
            </button>
          </div>
        </div>
      </section>

      {/* 계정 접근 및 인증 보안 */}
      <section
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-card)",
          padding: "var(--space-5)",
        }}
      >
        <h3 style={{ margin: 0, marginBottom: "var(--space-4)", fontSize: "var(--text-md)", color: "var(--color-text-heading)" }}>
          계정 접근 및 인증 보안
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(calc(var(--space-12) * 3), 1fr))", gap: "var(--space-4)" }}>
          <InfoItem
            label="로그인 수단"
            value={[
              ...(user.authMethods.hasPassword ? ["비밀번호"] : []),
              ...user.authMethods.socialProviders.map((provider) => provider.toUpperCase()),
            ].join(", ") || "없음"}
          />
          <InfoItem
            label="활성 세션 / 로그인 토큰"
            value={`${user.security.activeSessionCount}개 / ${user.security.activeRefreshTokenCount}개`}
          />
          <InfoItem label="활성 MCP 키" value={`${user.security.activeMcpKeyCount}개`} />
          <InfoItem label="관리자 지원 세션" value={`${user.security.activeSupportSessionCount}개`} />
          <InfoItem
            label="최근 로그인 시도"
            value={user.security.lastLoginAttempt
              ? `${user.security.lastLoginAttempt.success ? "성공" : "실패"} · ${new Date(user.security.lastLoginAttempt.attemptedAt).toLocaleString("ko-KR")}`
              : "기록 없음"}
          />
        </div>

        {user.security.activeLock && (
          <div
            style={{
              marginTop: "var(--space-4)",
              padding: "var(--space-3)",
              border: "1px solid var(--color-warning-border)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-warning-subtle)",
              color: "var(--color-warning)",
              fontSize: "var(--text-sm)",
            }}
          >
            로그인 잠금 중 · 실패 {user.security.activeLock.failCount}회
            {user.security.activeLock.reason ? ` · ${user.security.activeLock.reason}` : ""}
            {user.security.activeLock.expiresAt
              ? ` · ${new Date(user.security.activeLock.expiresAt).toLocaleString("ko-KR")}까지`
              : ""}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-5)" }}>
          {statusAction && (
            <button
              className={statusAction === "SUSPEND" ? "sp-btn sp-btn-danger" : "sp-btn sp-btn-primary"}
              onClick={() => setAccessAction(statusAction)}
              disabled={isSelf || user.isSystemAdmin}
              title={user.isSystemAdmin ? "시스템 관리자 역할을 먼저 해임해 주세요." : undefined}
            >
              {ACCESS_ACTION_META[statusAction].label}
            </button>
          )}
          {user.security.activeLock && (
            <button className="sp-btn sp-btn-secondary" onClick={() => setAccessAction("UNLOCK")} disabled={isSelf}>
              {ACCESS_ACTION_META.UNLOCK.label}
            </button>
          )}
          {(user.security.activeSessionCount > 0 ||
            user.security.activeRefreshTokenCount > 0 ||
            user.security.activeSupportSessionCount > 0) && (
            <button className="sp-btn sp-btn-danger" onClick={() => setAccessAction("FORCE_LOGOUT")} disabled={isSelf}>
              {ACCESS_ACTION_META.FORCE_LOGOUT.label}
            </button>
          )}
          {user.security.activeMcpKeyCount > 0 && (
            <button className="sp-btn sp-btn-danger" onClick={() => setAccessAction("REVOKE_MCP_KEYS")} disabled={isSelf}>
              {ACCESS_ACTION_META.REVOKE_MCP_KEYS.label}
            </button>
          )}
        </div>
      </section>

      {/* 참여 프로젝트 */}
      <section>
        <h3 style={{ fontSize: "var(--text-md)", marginBottom: 12, color: "var(--color-text-heading)" }}>
          참여 프로젝트 ({user.projects.length})
        </h3>
        {user.projects.length === 0 ? (
          <div
            style={{
              padding:    24,
              textAlign:  "center",
              fontSize:   "var(--text-sm)",
              color:      "var(--color-text-tertiary)",
              background: "var(--color-bg-elevated)",
              border:     "1px solid var(--color-border)",
              borderRadius: "var(--radius-card)",
            }}
          >
            참여 중인 프로젝트가 없습니다.
          </div>
        ) : (
          <div
            style={{
              background:   "var(--color-bg-card)",
              border:       "1px solid var(--color-border)",
              borderRadius: "var(--radius-card)",
              overflow:     "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
              <thead>
                <tr style={{ background: "var(--color-bg-elevated)", borderBottom: "1px solid var(--color-border)" }}>
                  <Th>프로젝트</Th>
                  <Th>역할</Th>
                  <Th>직무</Th>
                  <Th>합류일</Th>
                </tr>
              </thead>
              <tbody>
                {user.projects.map((p) => (
                  <tr key={p.projectId} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <Td>
                      <Link
                        href={`/admin/projects?search=${encodeURIComponent(p.name)}`}
                        style={{ color: "var(--color-text-primary)", textDecoration: "none" }}
                      >
                        {p.name}
                      </Link>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
                        {p.projectId}
                      </div>
                    </Td>
                    <Td>{p.role}</Td>
                    <Td>{p.job}</Td>
                    <Td>{new Date(p.joinedAt).toLocaleDateString("ko-KR")}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 임명/해임 모달 */}
      {modalOpen && (
        <div
          onClick={() => !mutation.isPending && setModalOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "var(--color-bg-overlay)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 480, maxWidth: "92vw",
              background:   "var(--color-bg-card)",
              border:       "1px solid var(--color-border-strong)",
              borderRadius: "var(--radius-card)",
              padding:      24,
              boxShadow:    "var(--shadow-lg)",
            }}
          >
            <h2 style={{ margin: 0, marginBottom: 8, fontSize: "var(--text-lg)", color: "var(--color-text-heading)" }}>
              {actionLabel}
            </h2>
            <div style={{ marginBottom: 16, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
              대상: <strong>{user.email ?? user.name ?? user.mberId}</strong>
              <br/>
              {user.isSystemAdmin
                ? "해임 즉시 대상자의 모든 로그인·지원 세션이 종료됩니다."
                : "임명 후 기존 로그인 세션은 종료되며, 다시 로그인해야 관리 기능에 접근할 수 있습니다."}
            </div>

            <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 4 }}>
              사유 <span style={{ color: "var(--color-error)" }}>*</span>
            </label>
            <textarea
              className="sp-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                user.isSystemAdmin
                  ? "예) 퇴사 처리 — 2026-04-30"
                  : "예) 신규 운영팀장 합류 — 지원 업무 담당"
              }
              rows={3}
              maxLength={500}
              autoFocus
              style={{ width: "100%", resize: "vertical" }}
            />

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button
                className="sp-btn sp-btn-ghost"
                onClick={() => { setModalOpen(false); setReason(""); }}
                disabled={mutation.isPending}
              >
                취소
              </button>
              <button
                className={user.isSystemAdmin ? "sp-btn sp-btn-danger" : "sp-btn sp-btn-primary"}
                onClick={() => {
                  if (!reason.trim()) { toast.error("사유를 입력해 주세요."); return; }
                  mutation.mutate({ role: nextRole, reason: reason.trim() });
                }}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "처리 중…" : actionLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {accessAction && (
        <AccessActionModal
          action={accessAction}
          target={user.email ?? user.name ?? user.mberId}
          reason={reason}
          pending={accessMutation.isPending}
          onReasonChange={setReason}
          onCancel={() => {
            setAccessAction(null);
            setReason("");
          }}
          onConfirm={() => {
            if (!reason.trim()) {
              toast.error("사유를 입력해 주세요.");
              return;
            }
            accessMutation.mutate({ action: accessAction, reason: reason.trim() });
          }}
        />
      )}
    </div>
  );
}

function AccessActionModal({
  action,
  target,
  reason,
  pending,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  action: AccessAction;
  target: string;
  reason: string;
  pending: boolean;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const meta = ACCESS_ACTION_META[action];

  return (
    <div
      className="sp-overlay"
      onClick={() => !pending && onCancel()}
    >
      <div
        className="sp-modal"
        onClick={(event) => event.stopPropagation()}
        style={{ padding: "var(--space-6)" }}
      >
        <h2 style={{ margin: 0, marginBottom: "var(--space-2)", fontSize: "var(--text-lg)", color: "var(--color-text-heading)" }}>
          {meta.label}
        </h2>
        <p style={{ margin: 0, marginBottom: "var(--space-4)", color: "var(--color-text-secondary)", fontSize: "var(--text-sm)" }}>
          대상: <strong>{target}</strong><br />
          {meta.description}
        </p>
        <label style={{ display: "block", marginBottom: "var(--space-1)", fontSize: "var(--text-sm)", fontWeight: 600 }}>
          사유 <span style={{ color: "var(--color-error)" }}>*</span>
        </label>
        <textarea
          className="sp-input"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          rows={3}
          maxLength={500}
          autoFocus
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
          <button className="sp-btn sp-btn-ghost" onClick={onCancel} disabled={pending}>취소</button>
          <button
            className={meta.danger ? "sp-btn sp-btn-danger" : "sp-btn sp-btn-primary"}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "처리 중…" : meta.label}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 보조 컴포넌트 ─────────────────────────────────────────────────────

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ color: "var(--color-text-tertiary)" }}>{label}</span>
      <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{
      padding: "10px 12px", textAlign: "left",
      fontSize: "var(--text-xs)", fontWeight: 600,
      color: "var(--color-text-tertiary)",
      textTransform: "uppercase", letterSpacing: "0.04em",
    }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: "10px 12px", color: "var(--color-text-primary)", verticalAlign: "top" }}>
      {children}
    </td>
  );
}
