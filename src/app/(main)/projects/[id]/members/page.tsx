"use client";

/**
 * MembersPage — 멤버 목록 (PID-00022, PID-00024, PID-00025, PID-00026)
 *
 * 역할:
 *   - ACTIVE 멤버 목록 조회 (FID-00072, FID-00083)
 *   - 인라인 역할 드롭다운으로 즉시 변경 (FID-00073)
 *   - 멤버 강제 제거 — OWNER/ADMIN이 OWNER 아닌 멤버 제거 (FID-00084)
 *   - 프로젝트 탈퇴 — 역할·상황별 멀티스텝 (FID-00085~089)
 *
 * 주요 기술:
 *   - TanStack Query: 멤버 목록, 탈퇴 분기 조건 조회
 *   - useMutation: 역할 변경, 제거, 탈퇴, OWNER 양도
 */

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type Member = {
  memberId:       string;
  name:           string | null;
  email:          string;
  role:           string;
  joinedAt:       string;
  lastAccessedAt: string | null;
  hasWork:        boolean;
};

type MembersResponse = {
  members:    Member[];
  totalCount: number;
  myRole:     string;
  ownerCount: number;
};

type LeaveCheckResponse = {
  myRole:              string;
  memberCount:         number;
  hasData:             boolean;
  transferableMembers: { memberId: string; name: string | null; email: string; role: string }[];
};

// ── 상수 ─────────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: "OWNER",     label: "OWNER" },
  { value: "ADMIN",     label: "관리자" },
  { value: "PM",        label: "PM" },
  { value: "DESIGNER",  label: "디자이너" },
  { value: "DEVELOPER", label: "개발자" },
  { value: "VIEWER",    label: "뷰어" },
];

const ROLE_LABEL: Record<string, string> = {
  OWNER:     "OWNER",
  ADMIN:     "관리자",
  PM:        "PM",
  DESIGNER:  "디자이너",
  DEVELOPER: "개발자",
  VIEWER:    "뷰어",
  MEMBER:    "멤버",
};

const ROLE_COLOR: Record<string, { bg: string; color: string }> = {
  OWNER:     { bg: "#fff3e0", color: "#e65100" },
  ADMIN:     { bg: "#e8eaf6", color: "#3949ab" },
  PM:        { bg: "#e8f5e9", color: "#2e7d32" },
  DESIGNER:  { bg: "#fce4ec", color: "#c62828" },
  DEVELOPER: { bg: "#e3f2fd", color: "#1565c0" },
  VIEWER:    { bg: "#f5f5f5", color: "#616161" },
  MEMBER:    { bg: "#f5f5f5", color: "#616161" },
};

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function MembersPage() {
  return (
    <Suspense fallback={null}>
      <MembersPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function MembersPageInner() {
  const params      = useParams<{ id: string }>();
  const router      = useRouter();
  const projectId   = params.id;
  const queryClient = useQueryClient();

  // 강제 제거 다이얼로그 상태
  const [removingMember, setRemovingMember] = useState<Member | null>(null);
  // 탈퇴 다이얼로그 열림 여부
  const [leaveOpen, setLeaveOpen] = useState(false);

  // ── 멤버 목록 조회 ─────────────────────────────────────────────────────────
  const { data, isLoading, error } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn:  () =>
      authFetch<{ data: MembersResponse }>(`/api/projects/${projectId}/members`)
        .then((r) => r.data),
  });

  // ── 역할 변경 ──────────────────────────────────────────────────────────────
  const roleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      authFetch(`/api/projects/${projectId}/members/${memberId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 멤버 강제 제거 ─────────────────────────────────────────────────────────
  const removeMutation = useMutation({
    mutationFn: (memberId: string) =>
      authFetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("멤버가 제거되었습니다.");
      setRemovingMember(null);
      queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 로딩 / 에러 ────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ padding: "40px 32px", color: "#888" }}>
        멤버 목록을 불러오는 중...
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: "40px 32px", color: "#e53935" }}>
        {(error as Error).message}
      </div>
    );
  }
  if (!data) return null;

  const { members, totalCount, myRole, ownerCount } = data;
  const canChangeRole = myRole === "OWNER" || myRole === "ADMIN";
  const canRemove     = myRole === "OWNER" || myRole === "ADMIN";

  const roleOptions = myRole === "OWNER"
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((o) => o.value !== "OWNER");

  return (
    <div style={{ padding: "32px", maxWidth: 900 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => router.back()}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 20, color: "#666", padding: "0 4px",
          }}
        >
          ←
        </button>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)" }}>
          멤버 목록
        </h1>
      </div>

      {/* 총 멤버 수 */}
      <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 <strong>{totalCount}</strong>명
      </p>

      {/* 멤버 테이블 */}
      <div style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
      }}>
        {/* 헤더 */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 160px 110px 120px",
          padding: "12px 20px",
          background: "var(--color-bg-muted)",
          borderBottom: "1px solid var(--color-border)",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          gap: 16,
        }}>
          <span>이름 / 이메일</span>
          <span>역할</span>
          <span>합류일</span>
          <span>액션</span>
        </div>

        {/* 바디 */}
        {members.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#aaa", fontSize: 14 }}>
            멤버가 없습니다.
          </div>
        ) : (
          members.map((member) => {
            const isMe        = member.memberId === getMemberId(data);
            const isLastOwner = member.role === "OWNER" && ownerCount <= 1;
            const isDisabled  = !canChangeRole || isLastOwner;
            const rc          = ROLE_COLOR[member.role] ?? ROLE_COLOR["MEMBER"];

            return (
              <div
                key={member.memberId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 160px 110px 120px",
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--color-border)",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                {/* 이름 / 이메일 */}
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {member.name ?? "(이름 없음)"}
                    {isMe && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: "#888" }}>(나)</span>
                    )}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {member.email}
                  </p>
                </div>

                {/* 역할 드롭다운 / 배지 */}
                <div>
                  {isDisabled ? (
                    <span style={{
                      display: "inline-block",
                      padding: "4px 12px",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 700,
                      background: rc.bg,
                      color: rc.color,
                    }}>
                      {ROLE_LABEL[member.role] ?? member.role}
                    </span>
                  ) : (
                    <select
                      value={member.role}
                      disabled={roleMutation.isPending}
                      onChange={(e) => {
                        const newRole = e.target.value;
                        if (newRole !== member.role) {
                          roleMutation.mutate({ memberId: member.memberId, role: newRole });
                        }
                      }}
                      style={{
                        padding: "5px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--color-border)",
                        fontSize: 13,
                        background: "var(--color-bg-card)",
                        color: "var(--color-text-primary)",
                        cursor: "pointer",
                        width: "100%",
                      }}
                    >
                      {roleOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 합류일 */}
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  {formatDate(member.joinedAt)}
                </span>

                {/* 액션 버튼 */}
                <div style={{ display: "flex", gap: 6 }}>
                  {/* 본인 행: 탈퇴 버튼 */}
                  {isMe && (
                    <button
                      onClick={() => setLeaveOpen(true)}
                      style={secondaryBtnStyle}
                    >
                      탈퇴
                    </button>
                  )}
                  {/* 타인 행: OWNER/ADMIN이고 대상이 OWNER 아니면 제거 버튼 */}
                  {!isMe && canRemove && member.role !== "OWNER" && (
                    <button
                      onClick={() => setRemovingMember(member)}
                      style={dangerBtnStyle}
                    >
                      제거
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {!canChangeRole && (
        <p style={{ marginTop: 12, fontSize: 12, color: "#aaa" }}>
          역할 변경은 OWNER 또는 관리자만 가능합니다.
        </p>
      )}

      {/* 강제 제거 확인 다이얼로그 (PID-00025) */}
      {removingMember && (
        <RemoveConfirmDialog
          member={removingMember}
          isPending={removeMutation.isPending}
          onConfirm={() => removeMutation.mutate(removingMember.memberId)}
          onClose={() => setRemovingMember(null)}
        />
      )}

      {/* 탈퇴 확인 다이얼로그 (PID-00026) */}
      {leaveOpen && (
        <LeaveDialog
          projectId={projectId}
          onClose={() => setLeaveOpen(false)}
          onLeft={() => {
            setLeaveOpen(false);
            router.push("/projects");
          }}
        />
      )}
    </div>
  );
}

// ── getMemberId 헬퍼 ─────────────────────────────────────────────────────────
// 클라이언트에서 내 memberId를 AT payload에서 읽는 간단한 방법
// — authFetch 응답이 아닌 JWT 쿠키/스토리지에서 읽어야 하지만,
//   현재 구조에서는 API 응답에 myMemberId가 없으므로 localStorage에서 읽거나
//   members 중 isMe를 알 수 없음.
// 대신 API에서 myMemberId를 반환하도록 수정하거나 AT를 디코딩한다.
// 여기서는 실용적으로 AT를 클라이언트에서 decode (서명 검증 없이).
function getMemberId(_data: MembersResponse): string {
  try {
    // authFetch는 sessionStorage의 "access_token"을 사용
    const at = sessionStorage.getItem("access_token") ?? "";
    if (!at) return "";
    const payload = JSON.parse(atob(at.split(".")[1]));
    return payload.mberId ?? payload.sub ?? "";
  } catch {
    return "";
  }
}

// ── 버튼 스타일 ──────────────────────────────────────────────────────────────

const secondaryBtnStyle: React.CSSProperties = {
  padding: "5px 14px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "5px 14px",
  borderRadius: 6,
  border: "1px solid #ef5350",
  background: "#fff5f5",
  color: "#e53935",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

// ── 다이얼로그 공통 오버레이 ─────────────────────────────────────────────────

function DialogOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "var(--color-bg-card)",
        borderRadius: "var(--radius-lg)",
        padding: "28px 32px",
        width: 420,
        maxWidth: "90vw",
        boxShadow: "0 8px 32px rgba(0,0,0,0.24)",
      }}>
        {children}
      </div>
    </div>
  );
}

// ── PID-00025 멤버 강제 제거 확인 ─────────────────────────────────────────────

function RemoveConfirmDialog({
  member, isPending, onConfirm, onClose,
}: {
  member:     Member;
  isPending:  boolean;
  onConfirm:  () => void;
  onClose:    () => void;
}) {
  return (
    <DialogOverlay>
      <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
        멤버를 제거하시겠습니까?
      </h2>

      <div style={{
        padding: "12px 16px",
        background: "var(--color-bg-muted)",
        borderRadius: "var(--radius-md)",
        marginBottom: 16,
      }}>
        <p style={{ margin: "0 0 4px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {member.name ?? "(이름 없음)"}{" "}
          <span style={{ color: "#888", fontWeight: 400 }}>({member.email})</span>
        </p>
        <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
          역할: {ROLE_LABEL[member.role] ?? member.role}
        </p>
      </div>

      <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
        제거된 멤버는 즉시 접근이 차단되며 작성한 데이터는 유지됩니다.
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} disabled={isPending} style={secondaryBtnStyle}>
          취소
        </button>
        <button
          onClick={onConfirm}
          disabled={isPending}
          style={{ ...dangerBtnStyle, padding: "7px 20px", fontSize: 13 }}
        >
          {isPending ? "처리 중..." : "제거"}
        </button>
      </div>
    </DialogOverlay>
  );
}

// ── PID-00026 프로젝트 탈퇴 확인 (멀티스텝) ──────────────────────────────────

type LeaveStep =
  | "loading"
  | "member"             // 일반 멤버
  | "owner-transfer-1"   // OWNER · 팀원 있음 · STEP1
  | "owner-transfer-2"   // OWNER · 팀원 있음 · STEP2
  | "owner-alone-data"   // OWNER · 혼자 · 데이터 있음 (3회 재확인)
  | "owner-alone-clean"; // OWNER · 혼자 · 데이터 없음

function LeaveDialog({
  projectId, onClose, onLeft,
}: {
  projectId: string;
  onClose:   () => void;
  onLeft:    () => void;
}) {
  const [step, setStep]               = useState<LeaveStep>("loading");
  const [checkData, setCheckData]     = useState<LeaveCheckResponse | null>(null);
  const [selectedId, setSelectedId]   = useState<string>("");
  const [confirmCount, setConfirm]    = useState(0);

  // 탈퇴 분기 조건 조회
  useQuery({
    queryKey: ["leave-check", projectId],
    queryFn:  () =>
      authFetch<{ data: LeaveCheckResponse }>(
        `/api/projects/${projectId}/members/leave-check`
      ).then((r) => {
        const d = r.data;
        setCheckData(d);

        if (d.myRole !== "OWNER") {
          setStep("member");
        } else if (d.memberCount > 1) {
          setStep("owner-transfer-1");
        } else if (d.hasData) {
          setStep("owner-alone-data");
        } else {
          setStep("owner-alone-clean");
        }

        return d;
      }),
  });

  // 일반 탈퇴
  const leaveMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/members/me`, { method: "DELETE" }),
    onSuccess: onLeft,
    onError:   (err: Error) => toast.error(err.message),
  });

  // OWNER 양도 후 탈퇴
  const transferMutation = useMutation({
    mutationFn: (newOwnerId: string) =>
      authFetch(`/api/projects/${projectId}/members/transfer-and-leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerId }),
      }),
    onSuccess: onLeft,
    onError:   (err: Error) => toast.error(err.message),
  });

  // 프로젝트 삭제 (OWNER 혼자)
  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: onLeft,
    onError:   (err: Error) => toast.error(err.message),
  });

  const isPending =
    leaveMutation.isPending ||
    transferMutation.isPending ||
    deleteMutation.isPending;

  // ── 스텝별 렌더링 ────────────────────────────────────────────────
  if (step === "loading") {
    return (
      <DialogOverlay>
        <p style={{ textAlign: "center", color: "#888", padding: "24px 0" }}>
          확인 중...
        </p>
      </DialogOverlay>
    );
  }

  // 일반 멤버
  if (step === "member") {
    return (
      <DialogOverlay>
        <h2 style={dialogTitleStyle}>프로젝트에서 탈퇴하시겠습니까?</h2>
        <p style={dialogDescStyle}>탈퇴 후에는 프로젝트에 접근할 수 없습니다. 작성한 데이터는 유지됩니다.</p>
        <DialogButtons
          cancelLabel="취소" confirmLabel={isPending ? "처리 중..." : "탈퇴"}
          confirmDanger isPending={isPending}
          onCancel={onClose}
          onConfirm={() => leaveMutation.mutate()}
        />
      </DialogOverlay>
    );
  }

  // OWNER · 팀원 있음 · STEP1: 양도 대상 선택
  if (step === "owner-transfer-1") {
    return (
      <DialogOverlay>
        <h2 style={dialogTitleStyle}>OWNER를 양도할 멤버를 선택해 주세요.</h2>
        <div style={{ maxHeight: 240, overflowY: "auto", margin: "16px 0" }}>
          {(checkData?.transferableMembers ?? []).map((m) => (
            <label
              key={m.memberId}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 6, cursor: "pointer",
                background: selectedId === m.memberId ? "var(--color-bg-muted)" : "transparent",
              }}
            >
              <input
                type="radio"
                name="newOwner"
                value={m.memberId}
                checked={selectedId === m.memberId}
                onChange={() => setSelectedId(m.memberId)}
              />
              <span style={{ fontSize: 14, color: "var(--color-text-primary)" }}>
                {m.name ?? "(이름 없음)"}
              </span>
              <span style={{ fontSize: 12, color: "#888" }}>
                ({ROLE_LABEL[m.role] ?? m.role})
              </span>
            </label>
          ))}
        </div>
        <DialogButtons
          cancelLabel="취소" confirmLabel="다음"
          isPending={false}
          onCancel={onClose}
          onConfirm={() => {
            if (!selectedId) {
              toast.error("양도할 멤버를 선택해 주세요.");
              return;
            }
            setStep("owner-transfer-2");
          }}
        />
      </DialogOverlay>
    );
  }

  // OWNER · 팀원 있음 · STEP2: 최종 확인
  if (step === "owner-transfer-2") {
    const target = checkData?.transferableMembers.find((m) => m.memberId === selectedId);
    return (
      <DialogOverlay>
        <h2 style={dialogTitleStyle}>OWNER 양도 후 탈퇴</h2>
        <p style={dialogDescStyle}>
          <strong>{target?.name ?? "(이름 없음)"}</strong>에게 OWNER를 양도하고
          프로젝트에서 탈퇴하시겠습니까?
        </p>
        <DialogButtons
          cancelLabel="이전" confirmLabel={isPending ? "처리 중..." : "양도 후 탈퇴"}
          confirmDanger isPending={isPending}
          onCancel={() => setStep("owner-transfer-1")}
          onConfirm={() => transferMutation.mutate(selectedId)}
        />
      </DialogOverlay>
    );
  }

  // OWNER · 혼자 · 데이터 있음: 3회 재확인
  if (step === "owner-alone-data") {
    return (
      <DialogOverlay>
        <h2 style={{ ...dialogTitleStyle, color: "#e53935" }}>⚠ 마지막 멤버입니다.</h2>
        <p style={dialogDescStyle}>
          탈퇴 시 프로젝트 전체가 삭제됩니다. 복구할 수 없습니다.
        </p>
        <p style={{
          textAlign: "right", fontSize: 13, color: "#e53935", marginBottom: 20,
        }}>
          {confirmCount}/3회 확인
        </p>
        <DialogButtons
          cancelLabel="취소"
          confirmLabel={isPending && confirmCount >= 3 ? "삭제 중..." : "확인"}
          confirmDanger isPending={isPending}
          onCancel={onClose}
          onConfirm={() => {
            const next = confirmCount + 1;
            if (next < 3) {
              setConfirm(next);
            } else {
              deleteMutation.mutate();
            }
          }}
        />
      </DialogOverlay>
    );
  }

  // OWNER · 혼자 · 데이터 없음: 즉시 삭제
  if (step === "owner-alone-clean") {
    return (
      <DialogOverlay>
        <h2 style={dialogTitleStyle}>프로젝트를 삭제하고 탈퇴하시겠습니까?</h2>
        <p style={dialogDescStyle}>
          다른 멤버가 없어 프로젝트가 함께 삭제됩니다.
        </p>
        <DialogButtons
          cancelLabel="취소" confirmLabel={isPending ? "처리 중..." : "삭제 후 탈퇴"}
          confirmDanger isPending={isPending}
          onCancel={onClose}
          onConfirm={() => deleteMutation.mutate()}
        />
      </DialogOverlay>
    );
  }

  return null;
}

// ── 다이얼로그 공통 버튼 ──────────────────────────────────────────────────────

function DialogButtons({
  cancelLabel, confirmLabel, confirmDanger, isPending, onCancel, onConfirm,
}: {
  cancelLabel:    string;
  confirmLabel:   string;
  confirmDanger?: boolean;
  isPending:      boolean;
  onCancel:       () => void;
  onConfirm:      () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
      <button onClick={onCancel} disabled={isPending} style={secondaryBtnStyle}>
        {cancelLabel}
      </button>
      <button
        onClick={onConfirm}
        disabled={isPending}
        style={
          confirmDanger
            ? { ...dangerBtnStyle, padding: "7px 20px", fontSize: 13 }
            : { ...secondaryBtnStyle, padding: "7px 20px", fontWeight: 600 }
        }
      >
        {confirmLabel}
      </button>
    </div>
  );
}

const dialogTitleStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 16,
  fontWeight: 700,
  color: "var(--color-text-primary)",
};

const dialogDescStyle: React.CSSProperties = {
  margin: "0 0 20px",
  fontSize: 14,
  color: "var(--color-text-secondary)",
  lineHeight: 1.6,
};
