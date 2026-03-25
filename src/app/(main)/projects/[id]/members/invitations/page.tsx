"use client";

/**
 * InvitationsPage — 초대 현황 (PID-00020)
 *
 * 역할:
 *   - 초대 현황 목록 조회 (FID-00066)
 *   - 멤버 초대 POPUP (PID-00019, FID-00065)
 *   - 초대 취소 인라인 확인 (FID-00067)
 *   - 초대 재발송 + 60초 쿨타임 (FID-00068)
 */

import { Suspense, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ──────────────────────────────────────────────────────────────────
type InvitationItem = {
  invitationId: string;
  email:        string;
  role:         string;
  status:       string; // PENDING | ACCEPTED | EXPIRED | CANCELLED
  invitedAt:    string;
  expiresAt:    string;
};

type InviteRow = { email: string; role: string };

// ── 헬퍼 ──────────────────────────────────────────────────────────────────
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

const STATUS_LABEL: Record<string, string> = {
  PENDING:   "대기중",
  ACCEPTED:  "수락",
  EXPIRED:   "만료",
  CANCELLED: "취소",
};
const STATUS_COLOR: Record<string, string> = {
  PENDING:   "var(--color-brand)",
  ACCEPTED:  "var(--color-success, #22c55e)",
  EXPIRED:   "var(--color-text-tertiary)",
  CANCELLED: "var(--color-error)",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "1px 8px",
      fontSize: "var(--text-xs)", fontWeight: 600,
      borderRadius: "var(--radius-full)",
      background: `color-mix(in srgb, ${STATUS_COLOR[status] ?? "gray"} 15%, transparent)`,
      color: STATUS_COLOR[status] ?? "var(--color-text-secondary)",
      border: `1px solid color-mix(in srgb, ${STATUS_COLOR[status] ?? "gray"} 30%, transparent)`,
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ── 초대 입력 POPUP (PID-00019) ───────────────────────────────────────────
function InviteDialog({
  projectId,
  onClose,
  onSent,
}: {
  projectId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [rows, setRows] = useState<InviteRow[]>([{ email: "", role: "MEMBER" }]);
  const [errors, setErrors] = useState<string[]>([""]);

  function addRow() {
    setRows((r) => [...r, { email: "", role: "MEMBER" }]);
    setErrors((e) => [...e, ""]);
  }
  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
    setErrors((e) => e.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, field: keyof InviteRow, value: string) {
    setRows((r) => r.map((row, idx) => idx === i ? { ...row, [field]: value } : row));
  }

  const mutation = useMutation({
    mutationFn: (invitations: InviteRow[]) =>
      authFetch<{ data: { results: Array<{ email: string; ok: boolean; error?: string }> } }>(
        `/api/projects/${projectId}/invitations`,
        { method: "POST", body: JSON.stringify({ invitations }) }
      ),
    onSuccess: (res) => {
      const results = res.data.results;
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.success("초대를 발송했습니다.");
        onSent();
      } else {
        // 인라인 에러 표시
        const newErrors = rows.map((row) => {
          const r = failed.find((f) => f.email === row.email);
          return r?.error ?? "";
        });
        setErrors(newErrors);
        const successCount = results.length - failed.length;
        if (successCount > 0) toast.success(`${successCount}건 발송 완료, ${failed.length}건 실패`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const newErrors = rows.map((r) =>
      !r.email.trim() ? "이메일을 입력해 주세요." :
      !emailRegex.test(r.email) ? "올바른 이메일 형식을 입력해 주세요." : ""
    );
    setErrors(newErrors);
    if (newErrors.some((e) => e)) return;
    mutation.mutate(rows);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 520,
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-xl)",
        padding: "24px",
      }}>
        <h2 style={{ margin: "0 0 20px", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)" }}>
          멤버 초대
        </h2>

        <form onSubmit={handleSubmit}>
          {/* 헤더 레이블 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 28px", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontWeight: 600 }}>이메일</span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontWeight: 600 }}>역할</span>
            <span />
          </div>

          {/* 입력 행들 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {rows.map((row, i) => (
              <div key={i}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 28px", gap: 8, alignItems: "center" }}>
                  <input
                    className={`sp-input${errors[i] ? " is-error" : ""}`}
                    type="email"
                    placeholder="email@example.com"
                    value={row.email}
                    onChange={(e) => { updateRow(i, "email", e.target.value); setErrors((err) => err.map((v, idx) => idx === i ? "" : v)); }}
                    style={{ borderColor: errors[i] ? "var(--color-error)" : undefined }}
                  />
                  <select
                    className="sp-input"
                    value={row.role}
                    onChange={(e) => updateRow(i, "role", e.target.value)}
                    style={{ cursor: "pointer" }}
                  >
                    <option value="MEMBER">MEMBER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    disabled={rows.length === 1}
                    style={{
                      background: "none", border: "none", cursor: rows.length === 1 ? "not-allowed" : "pointer",
                      color: rows.length === 1 ? "var(--color-text-tertiary)" : "var(--color-error)",
                      fontSize: 16, padding: 0, lineHeight: 1,
                    }}
                    title="행 삭제"
                  >
                    ×
                  </button>
                </div>
                {errors[i] && (
                  <p style={{ margin: "3px 0 0", fontSize: "var(--text-xs)", color: "var(--color-error)" }}>
                    {errors[i]}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* 행 추가 */}
          <button
            type="button"
            onClick={addRow}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "var(--text-sm)", color: "var(--color-brand)",
              padding: "4px 0", marginBottom: 20,
            }}
          >
            + 초대 추가
          </button>

          {/* 버튼 */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose}>취소</button>
            <button type="submit" className="sp-btn sp-btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? "발송 중..." : "초대 발송"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── 재발송 버튼 (60초 쿨타임) ────────────────────────────────────────────
function ResendButton({ projectId, invitationId, onDone }: { projectId: string; invitationId: string; onDone: () => void }) {
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const mutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/invitations/${invitationId}/resend`, { method: "POST" }),
    onSuccess: () => {
      toast.success("재발송했습니다.");
      setCooldown(60);
      onDone();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (cooldown > 0) {
    return <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>{cooldown}초 후 재발송</span>;
  }
  return (
    <button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="sp-btn sp-btn-secondary"
      style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
    >
      재발송
    </button>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────
export default function InvitationsPage() {
  return <Suspense fallback={null}><InvitationsInner /></Suspense>;
}

function InvitationsInner() {
  const params      = useParams();
  const queryClient = useQueryClient();
  const projectId   = params.id as string;

  const [inviteOpen,    setInviteOpen]    = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null); // invitationId

  const { data, isLoading } = useQuery<{ data: { items: InvitationItem[]; totalCount: number } }>({
    queryKey: ["invitations", projectId],
    queryFn:  () => authFetch(`/api/projects/${projectId}/invitations`),
    staleTime: 30 * 1000,
  });

  const items = data?.data?.items ?? [];

  const cancelMutation = useMutation({
    mutationFn: (invitationId: string) =>
      authFetch(`/api/projects/${projectId}/invitations/${invitationId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("초대를 취소했습니다.");
      setCancelConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["invitations", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["invitations", projectId] });
  }

  return (
    <div style={{ padding: "28px 32px", maxWidth: 860 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: 700, color: "var(--color-text-heading)" }}>초대 현황</h1>
          <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
            {isLoading ? "로딩 중..." : `총 ${items.length}건`}
          </p>
        </div>
        <button className="sp-btn sp-btn-primary" onClick={() => setInviteOpen(true)}>
          + 멤버 초대
        </button>
      </div>

      {/* 목록 */}
      {isLoading ? (
        <div style={{ padding: "48px 0", textAlign: "center", color: "var(--color-text-tertiary)" }}>로딩 중...</div>
      ) : items.length === 0 ? (
        <div style={{
          padding: "64px 0", textAlign: "center",
          border: "1px dashed var(--color-border)", borderRadius: "var(--radius-card)",
          color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)",
        }}>
          초대 내역이 없습니다.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", overflow: "hidden" }}>
          {/* 헤더 */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 80px 80px 100px 100px 160px",
            padding: "8px 16px", gap: 12,
            background: "var(--color-bg-elevated)", borderBottom: "1px solid var(--color-border)",
            fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontWeight: 600,
          }}>
            <span>이메일</span><span>역할</span><span>상태</span>
            <span>초대일</span><span>만료일</span><span>액션</span>
          </div>

          {items.map((item, i) => (
            <div key={item.invitationId} style={{
              display: "grid", gridTemplateColumns: "1fr 80px 80px 100px 100px 160px",
              padding: "10px 16px", gap: 12, alignItems: "center",
              borderBottom: i < items.length - 1 ? "1px solid var(--color-border-subtle)" : "none",
              background: "var(--color-bg-card)",
            }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-primary)" }}>{item.email}</span>
              <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-text-secondary)" }}>{item.role}</span>
              <StatusBadge status={item.status} />
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>{formatDate(item.invitedAt)}</span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>{formatDate(item.expiresAt)}</span>

              {/* 액션 */}
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {cancelConfirm === item.invitationId ? (
                  // 인라인 취소 확인
                  <>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>정말 취소?</span>
                    <button
                      onClick={() => cancelMutation.mutate(item.invitationId)}
                      disabled={cancelMutation.isPending}
                      style={{
                        padding: "2px 8px", fontSize: "var(--text-xs)", fontWeight: 600,
                        background: "var(--color-error)", color: "#fff",
                        border: "none", borderRadius: "var(--radius-btn)", cursor: "pointer",
                      }}
                    >확인</button>
                    <button
                      onClick={() => setCancelConfirm(null)}
                      className="sp-btn sp-btn-secondary"
                      style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
                    >아니오</button>
                  </>
                ) : (
                  <>
                    {item.status === "PENDING" && (
                      <button
                        onClick={() => setCancelConfirm(item.invitationId)}
                        className="sp-btn sp-btn-secondary"
                        style={{ fontSize: "var(--text-xs)", padding: "2px 8px" }}
                      >취소</button>
                    )}
                    {(item.status === "PENDING" || item.status === "EXPIRED") && (
                      <ResendButton projectId={projectId} invitationId={item.invitationId} onDone={refresh} />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 초대 POPUP */}
      {inviteOpen && (
        <InviteDialog
          projectId={projectId}
          onClose={() => setInviteOpen(false)}
          onSent={() => { setInviteOpen(false); refresh(); }}
        />
      )}
    </div>
  );
}
