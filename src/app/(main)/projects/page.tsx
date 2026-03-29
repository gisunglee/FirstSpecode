"use client";

/**
 * ProjectsPage — 프로젝트 목록 (PID-00015)
 *
 * 역할:
 *   - 내가 속한 프로젝트 목록 조회 및 표시 (FID-00053)
 *   - 프로젝트명 클릭 시 해당 프로젝트로 진입 (FID-00054)
 *   - 설정 아이콘 클릭 시 프로젝트 설정 이동 (FID-00055)
 *   - 프로젝트 생성 POPUP 포함 (PID-00016, FID-00056)
 *
 * 주요 기술:
 *   - TanStack Query: 목록 조회 + 생성 후 캐시 무효화
 *   - sp-* 디자인 시스템 클래스
 */

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";

// ── 타입 ──────────────────────────────────────────────────────────────────
type ProjectItem = {
  projectId:  string;
  name:       string;
  clientName: string | null;
  startDate:  string | null;
  endDate:    string | null;
  myRole:     string;
};

type ProjectsResponse = {
  data: { items: ProjectItem[]; totalCount: number };
};

// ── 날짜 포맷 ─────────────────────────────────────────────────────────────
function formatDate(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

// ── 역할 배지 색상 ────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const isOwner = role === "OWNER";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 8px",
        fontSize: "var(--text-xs)",
        fontWeight: 600,
        borderRadius: "var(--radius-full)",
        background: isOwner ? "var(--color-brand-subtle)" : "var(--color-bg-elevated)",
        color:      isOwner ? "var(--color-brand)"        : "var(--color-text-secondary)",
        border:     `1px solid ${isOwner ? "var(--color-brand-border)" : "var(--color-border)"}`,
      }}
    >
      {isOwner ? "OWNER" : "MEMBER"}
    </span>
  );
}

// ── 생성 POPUP ───────────────────────────────────────────────────────────
function CreateProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [startDate,   setStartDate]   = useState("");
  const [endDate,     setEndDate]     = useState("");
  const [clientName,  setClientName]  = useState("");

  const mutation = useMutation({
    mutationFn: (body: object) =>
      authFetch<{ data: { projectId: string } }>("/api/projects", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      toast.success("프로젝트가 생성되었습니다.");
      onCreated(res.data.projectId);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("프로젝트명을 입력해 주세요."); return; }
    if (startDate && endDate && endDate < startDate) {
      toast.error("종료일은 시작일 이후여야 합니다."); return;
    }
    mutation.mutate({ name, description, startDate: startDate || undefined, endDate: endDate || undefined, clientName });
  }

  return (
    // 배경 오버레이 — 외부 클릭으로 닫히지 않음 (의도치 않은 입력 손실 방지)
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480,
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-xl)",
          padding: "24px",
        }}
      >
        <h2 style={{ margin: "0 0 20px", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)" }}>
          프로젝트 생성
        </h2>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 프로젝트명 */}
          <div>
            <label className="sp-label">프로젝트명 <span style={{ color: "var(--color-error)" }}>*</span></label>
            <input
              className="sp-input"
              placeholder="프로젝트명을 입력하세요"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* 설명 */}
          <div>
            <label className="sp-label">설명</label>
            <textarea
              className="sp-input"
              placeholder="프로젝트 설명 (선택)"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ resize: "vertical" }}
            />
          </div>

          {/* 기간 */}
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="sp-label">시작일</label>
              <input className="sp-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="sp-label">종료일</label>
              <input className="sp-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          {/* 고객사명 */}
          <div>
            <label className="sp-label">고객사명</label>
            <input
              className="sp-input"
              placeholder="고객사명 (선택)"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>

          {/* 버튼 */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
            <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="sp-btn sp-btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? "생성 중..." : "생성"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────
export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsPageInner />
    </Suspense>
  );
}

function ProjectsPageInner() {
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { setCurrentProjectId } = useAppStore();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery<ProjectsResponse>({
    queryKey: ["projects"],
    queryFn: () => authFetch<ProjectsResponse>("/api/projects"),
    staleTime: 2 * 60 * 1000,
  });

  const items = data?.data?.items ?? [];

  function handleProjectClick(projectId: string) {
    // 프로젝트 선택 후 대시보드로 진입
    setCurrentProjectId(projectId);
    router.push("/dashboard");
  }

  function handleCreated(projectId: string) {
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["projects", "my"] });
    setCreateOpen(false);
    // 생성된 프로젝트를 현재 프로젝트로 선택 후 설정 화면으로 이동
    // setCurrentProjectId를 먼저 호출해야 GNB 셀렉터에 바로 반영됨
    setCurrentProjectId(projectId);
    router.push(`/projects/${projectId}/settings`);
  }

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          프로젝트 목록
        </div>
        <button className="sp-btn sp-btn-primary" style={{ fontSize: 12, padding: "5px 14px" }} onClick={() => setCreateOpen(true)}>
          + 프로젝트 생성
        </button>
      </div>

      <div style={{ padding: "0 24px 24px", maxWidth: 900 }}>
      {/* 총 건수 */}
      <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)" }}>
        {isLoading ? "로딩 중..." : `총 ${items.length}건`}
      </div>

      {/* 목록 */}
      {isLoading ? (
        <div style={{ padding: "48px 0", textAlign: "center", color: "var(--color-text-tertiary)" }}>
          로딩 중...
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: "64px 0", textAlign: "center",
            border: "1px dashed var(--color-border)",
            borderRadius: "var(--radius-card)",
            color: "var(--color-text-tertiary)",
            fontSize: "var(--text-sm)",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
          아직 프로젝트가 없습니다. 새 프로젝트를 생성해 보세요.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", overflow: "hidden" }}>
          {/* 테이블 헤더 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 140px 200px 80px 36px",
              padding: "8px 16px",
              background: "var(--color-bg-elevated)",
              borderBottom: "1px solid var(--color-border)",
              fontSize: "var(--text-xs)",
              color: "var(--color-text-tertiary)",
              fontWeight: 600,
              gap: 12,
            }}
          >
            <span>프로젝트명</span>
            <span>고객사</span>
            <span>기간</span>
            <span>역할</span>
            <span />
          </div>

          {/* 목록 행 */}
          {items.map((item, i) => (
            <div
              key={item.projectId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 140px 200px 80px 36px",
                padding: "10px 16px",
                borderBottom: i < items.length - 1 ? "1px solid var(--color-border-subtle)" : "none",
                alignItems: "center",
                gap: 12,
                background: "var(--color-bg-card)",
              }}
            >
              {/* 프로젝트명 (클릭 시 진입) */}
              <button
                onClick={() => handleProjectClick(item.projectId)}
                style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  textAlign: "left", fontWeight: 600,
                  fontSize: "var(--text-md)", color: "var(--color-brand)",
                  textDecoration: "underline",
                }}
              >
                {item.name}
              </button>

              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                {item.clientName ?? "-"}
              </span>

              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                {(item.startDate || item.endDate)
                  ? `${formatDate(item.startDate)} ~ ${formatDate(item.endDate)}`
                  : "-"}
              </span>

              <RoleBadge role={item.myRole} />

              {/* 설정 아이콘 */}
              <button
                onClick={() => router.push(`/projects/${item.projectId}/settings`)}
                title="프로젝트 설정"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 16, color: "var(--color-text-tertiary)", padding: "2px 4px",
                  borderRadius: "var(--radius-sm)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-primary)"; e.currentTarget.style.background = "var(--color-bg-elevated)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-tertiary)"; e.currentTarget.style.background = "none"; }}
              >
                ⚙
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 생성 POPUP */}
      {createOpen && (
        <CreateProjectDialog onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
      )}
      </div>
    </div>
  );
}
