"use client";

/**
 * AdminUserDetailPage — 사용자 상세 (/admin/users/[mberId])
 *
 * 역할:
 *   - 사용자 기본 정보 + 참여 프로젝트 목록
 *   - 시스템 관리자 임명/해임 버튼 (사유 입력 모달 포함)
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
  planExpiresAt: string | null;
  status:        string;
  isSystemAdmin: boolean;
  joinedAt:      string;
  modifiedAt:    string | null;
  withdrawnAt:   string | null;
  projects: Array<{
    projectId: string;
    name:      string;
    role:      string;
    job:       string;
    joinedAt:  string;
  }>;
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

  const { data: user, isLoading } = useQuery<UserDetail>({
    queryKey: ["admin", "users", mberId],
    queryFn: () =>
      authFetch<{ data: UserDetail }>(`/api/admin/users/${mberId}`).then((r) => r.data),
  });

  // 임명/해임 모달 상태
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason]       = useState("");

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

  if (isLoading) {
    return <div style={{ padding: 20, color: "var(--color-text-tertiary)" }}>불러오는 중…</div>;
  }
  if (!user) {
    return <div style={{ padding: 20, color: "var(--color-error)" }}>사용자를 찾을 수 없습니다.</div>;
  }

  // 자기 자신은 변경 불가 (서버도 거부)
  const isSelf = meProfile?.mberId === user.mberId;
  const nextRole: "SUPER_ADMIN" | null = user.isSystemAdmin ? null : "SUPER_ADMIN";
  const actionLabel = user.isSystemAdmin ? "시스템 관리자 해임" : "시스템 관리자 임명";

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
              <InfoItem label="플랜"   value={user.plan} />
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
              disabled={isSelf}
              title={isSelf ? "자기 자신의 역할은 변경할 수 없습니다." : undefined}
            >
              {actionLabel}
            </button>
          </div>
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
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
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
                ? "해임 즉시 대상자의 모든 활성 지원 세션이 종료됩니다."
                : "임명되면 전체 관리 기능에 접근할 수 있게 됩니다."}
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
