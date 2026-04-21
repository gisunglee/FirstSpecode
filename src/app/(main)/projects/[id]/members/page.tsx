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
import {
  ROLE_CODES, ROLE_LABEL,
  JOB_CODES,  JOB_LABEL,
  type RoleCode, type JobCode,
} from "@/lib/permissions";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type Member = {
  memberId:       string;
  name:           string | null;
  email:          string;
  role:           RoleCode;
  job:            JobCode;
  joinedAt:       string;
  lastAccessedAt: string | null;
  hasWork:        boolean;
};

type MembersResponse = {
  members:    Member[];
  totalCount: number;
  myRole:     RoleCode;
  myJob:      JobCode;
  myMemberId: string;
  ownerCount: number;
};

type LeaveCheckResponse = {
  myRole:              string;
  memberCount:         number;
  hasData:             boolean;
  transferableMembers: { memberId: string; name: string | null; email: string; role: string }[];
};

// ── 상수 ─────────────────────────────────────────────────────────────────────
// 역할·직무 레이블은 permissions.ts 의 ROLE_LABEL / JOB_LABEL 단일 소스 사용

// 역할 드롭다운 옵션 (OWNER 포함 4개)
const ROLE_OPTIONS = ROLE_CODES.map((code) => ({ value: code, label: ROLE_LABEL[code] }));

// 직무 드롭다운 옵션 (7개)
const JOB_OPTIONS  = JOB_CODES.map ((code) => ({ value: code, label: JOB_LABEL [code] }));

const ROLE_COLOR: Record<RoleCode, { bg: string; color: string }> = {
  OWNER:  { bg: "#fff3e0", color: "#e65100" },
  ADMIN:  { bg: "#e8eaf6", color: "#3949ab" },
  MEMBER: { bg: "#f5f5f5", color: "#616161" },
  VIEWER: { bg: "#eceff1", color: "#546e7a" },
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
    mutationFn: ({ memberId, role }: { memberId: string; role: RoleCode }) =>
      authFetch(`/api/projects/${projectId}/members/${memberId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
      // 본인 역할 변경 시 상단 권한 캐시도 갱신
      queryClient.invalidateQueries({ queryKey: ["my-role", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 직무 변경 ──────────────────────────────────────────────────────────────
  const jobMutation = useMutation({
    mutationFn: ({ memberId, job }: { memberId: string; job: JobCode }) =>
      authFetch(`/api/projects/${projectId}/members/${memberId}/job`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ job }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
      queryClient.invalidateQueries({ queryKey: ["my-role",         projectId] });
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

  const { members, totalCount, myRole, myMemberId, ownerCount } = data;
  const canChangeRole = myRole === "OWNER" || myRole === "ADMIN";
  const canChangeJob  = myRole === "OWNER" || myRole === "ADMIN";
  const canRemove     = myRole === "OWNER" || myRole === "ADMIN";

  // OWNER 옵션은 OWNER 본인만 노출 (PRD UW-00010)
  const roleOptions = myRole === "OWNER"
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((o) => o.value !== "OWNER");

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => router.back()}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#666", lineHeight: 1, padding: "2px 4px" }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>멤버 목록</span>
        </div>
      </div>

      <div style={{ padding: "0 24px 24px", maxWidth: 900 }}>
      {/* 총 멤버 수 */}
      <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 <strong>{totalCount}</strong>명
      </div>

      {/* 멤버 테이블 */}
      <div style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
      }}>
        {/* 헤더 — 역할/직무 2개 컬럼 분리 */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 140px 140px 110px 120px",
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
          <span>직무</span>
          <span>합류일</span>
          <span>액션</span>
        </div>

        {/* 바디 */}
        {members.length === 0 ? (
          <div style={{ padding: "20px 24px", textAlign: "center", color: "#aaa", fontSize: 14 }}>
            멤버가 없습니다.
          </div>
        ) : (
          members.map((member) => {
            const isMe          = member.memberId === myMemberId;
            const isLastOwner   = member.role === "OWNER" && ownerCount <= 1;
            const roleDisabled  = !canChangeRole || isLastOwner;
            const jobDisabled   = !canChangeJob;
            const rc            = ROLE_COLOR[member.role] ?? ROLE_COLOR["MEMBER"];

            return (
              <div
                key={member.memberId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 140px 140px 110px 120px",
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
                  {roleDisabled ? (
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
                        const newRole = e.target.value as RoleCode;
                        if (newRole !== member.role) {
                          roleMutation.mutate({ memberId: member.memberId, role: newRole });
                        }
                      }}
                      style={inlineSelectStyle}
                    >
                      {roleOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 직무 드롭다운 / 배지 */}
                <div>
                  {jobDisabled ? (
                    <span style={{
                      display: "inline-block",
                      padding: "4px 10px",
                      borderRadius: 20,
                      fontSize: 12,
                      background: "var(--color-bg-muted)",
                      color: "var(--color-text-secondary)",
                    }}>
                      {JOB_LABEL[member.job] ?? member.job}
                    </span>
                  ) : (
                    <select
                      value={member.job}
                      disabled={jobMutation.isPending}
                      onChange={(e) => {
                        const newJob = e.target.value as JobCode;
                        if (newJob !== member.job) {
                          jobMutation.mutate({ memberId: member.memberId, job: newJob });
                        }
                      }}
                      style={inlineSelectStyle}
                    >
                      {JOB_OPTIONS.map((opt) => (
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
    </div>
  );
}

// ── 버튼·셀렉트 스타일 ────────────────────────────────────────────────────────

// 인라인 드롭다운 공통 스타일 — 역할·직무 양쪽에서 재사용
const inlineSelectStyle: React.CSSProperties = {
  padding: "5px 24px 5px 8px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  fontSize: 13,
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  cursor: "pointer",
  width: 128,
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' stroke='currentColor' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 8px center",
  backgroundSize: "14px",
};

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
      <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
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
                {/* transferableMembers.role 은 API 응답에서 string 으로 옴 → 안전한 폴백 */}
                ({(ROLE_LABEL as Record<string, string>)[m.role] ?? m.role})
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
