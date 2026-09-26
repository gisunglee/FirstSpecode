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
import ExcelDownloadButton from "@/components/common/ExcelDownloadButton";
import ProjectAbbrChip from "@/components/ui/ProjectAbbrChip";
import PlanLimitDialog, { isPlanLimitError, isOpenProjectLimitError, toPlanLimitInfo, type PlanLimitInfo } from "@/components/common/PlanLimitDialog";
import ProjectSwapDialog, { type ProjectSwapInfo } from "@/components/common/ProjectSwapDialog";
import {
  parseProjectAbbrInput,
  PROJECT_ABBR_MAX_LEN,
  PROJECT_ABBR_PLACEHOLDER,
} from "@/lib/constants/projectAbbr";

// ── 타입 ──────────────────────────────────────────────────────────────────
type ProjectItem = {
  projectId:    string;
  name:         string;
  // 약어/이니셜 — 표시용 부제. 미설정 프로젝트는 null
  abbreviation: string | null;
  clientName:   string | null;
  startDate:    string | null;
  endDate:      string | null;
  myRole:       string;
  /** 결제 잠금 — 자물쇠 배지. 소유자면 "활성화" 버튼 (정책 §1-6) */
  locked:       boolean;
  isOwner:      boolean;
  /** 편집 멤버 수 — 내 소유 프로젝트만 채워진다. 교체 시 "누구의 편집이 막히는지" 경고에 쓴다 */
  editorCount:  number | null;
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
  onLimit,
}: {
  onClose: () => void;
  onCreated: (projectId: string) => void;
  /** FREE 소유 프로젝트 상한(PLAN_LIMIT_PROJECT)에 걸리면 안내 정보를 넘긴다 — 부모가 BASIC 안내 모달로 전환 */
  onLimit: (limit: PlanLimitInfo) => void;
}) {
  const [name,         setName]         = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [description,  setDescription]  = useState("");
  const [startDate,    setStartDate]    = useState("");
  const [endDate,      setEndDate]      = useState("");
  const [clientName,   setClientName]   = useState("");

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
    // 플랜 상한은 토스트가 아니라 요금제 안내 모달로 — 왜 막혔는지와 해결 경로를 같이 보여준다
    onError: (err: Error) => (isPlanLimitError(err) ? onLimit(toPlanLimitInfo(err)) : toast.error(err.message)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("프로젝트명을 입력해 주세요."); return; }
    const abbrParsed = parseProjectAbbrInput(abbreviation, { required: true });
    if ("error" in abbrParsed) { toast.error(abbrParsed.error); return; }
    if (startDate && endDate && endDate < startDate) {
      toast.error("종료일은 시작일 이후여야 합니다."); return;
    }
    mutation.mutate({
      name,
      abbreviation: abbrParsed.value as string,
      description,
      startDate: startDate || undefined,
      endDate:   endDate   || undefined,
      clientName,
    });
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

          <div>
            <label className="sp-label">
              약어 <span style={{ color: "var(--color-error)" }}>*</span>
            </label>
            <input
              className="sp-input"
              placeholder={PROJECT_ABBR_PLACEHOLDER}
              value={abbreviation}
              onChange={(e) => setAbbreviation(e.target.value)}
              maxLength={PROJECT_ABBR_MAX_LEN}
            />
            <p style={{ margin: "4px 0 0", fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>
              영문/숫자 2~10자. 문서 출력(표지·머리말·파일명)과 목록 부제에 사용됩니다.
            </p>
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
  // FREE 상한 안내 모달 문구 — null 이면 닫힘
  const [limit, setLimit] = useState<PlanLimitInfo | null>(null);
  const [swap, setSwap]   = useState<ProjectSwapInfo | null>(null);

  const { data, isLoading } = useQuery<ProjectsResponse>({
    queryKey: ["projects"],
    queryFn: () => authFetch<ProjectsResponse>("/api/projects"),
    staleTime: 60 * 1000, // 1분
  });

  const items = data?.data?.items ?? [];

  /** 활성화·교체 성공 후 공통 처리 — 잠금 상태가 바뀌면 목록과 내 역할 캐시를 다시 읽어야 한다 */
  function afterUnlock(message: string) {
    toast.success(message);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["my-role"] });
  }

  /**
   * 잠금 해제 실패 처리 — 사유마다 할 일이 다르다 (정책 §1-6).
   *   FREE_PROJECTS → 다른 프로젝트를 닫으면 되므로 교체 다이얼로그
   *   FREE_EDITORS  → 편집 멤버를 줄여야 하므로 멤버 관리로 보내는 안내
   *   SEATS         → 좌석 추가 안내
   * 토스트로 띄우면 "무엇을 하라"는 안내가 몇 초 뒤 사라져 행동으로 이어지지 않는다.
   */
  function handleUnlockError(err: Error, target: ProjectItem) {
    if (isOpenProjectLimitError(err)) {
      // 닫아야 할 대상은 목록이 이미 갖고 있다 — 내가 소유하고 잠기지 않은 프로젝트
      const openOwned = items.filter((p) => p.isOwner && !p.locked && p.projectId !== target.projectId);
      if (openOwned.length > 0) {
        setSwap({
          open:  { projectId: target.projectId, name: target.name },
          close: openOwned.map((p) => ({ projectId: p.projectId, name: p.name, editorCount: p.editorCount ?? 1 })),
        });
        return;
      }
      // 목록에 안 보이는 프로젝트가 열려 있는 경우(캐시 지연 등) — 안내만 하고 목록을 새로 읽는다
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
    if (isPlanLimitError(err)) { setLimit(toPlanLimitInfo(err, target.projectId)); return; }
    toast.error(err.message);
  }

  // 잠긴 프로젝트 "활성화" — 서버가 상한(FREE 편집자 소유자 1명·열린 프로젝트 1개 / 구독 좌석)을 판정한다.
  const unlockMutation = useMutation({
    mutationFn: (target: ProjectItem) =>
      authFetch<{ data: { unlocked: boolean } }>(`/api/projects/${target.projectId}/unlock`, { method: "POST" }),
    onSuccess: () => afterUnlock("프로젝트가 활성화되었습니다."),
    onError:   (err: Error, target) => handleUnlockError(err, target),
  });

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", position: "sticky", top: 0, zIndex: 10, background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          프로젝트 목록
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ExcelDownloadButton
            href="/api/projects/export"
            entityKey="projects"
          />
          <button className="sp-btn sp-btn-primary" style={{ fontSize: 12, padding: "5px 14px" }} onClick={() => setCreateOpen(true)}>
            + 프로젝트 생성
          </button>
        </div>
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
          {/* 테이블 헤더 — 멤버 목록 등 다른 페이지와 동일 표준
              (bg-muted + text-secondary) — elevated/tertiary 조합은 다크에서
              글자가 배경과 비슷한 톤이 되어 헤더가 거의 안 보였음 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 140px 200px 80px 64px",
              padding: "8px 16px",
              background: "var(--color-bg-muted)",
              borderBottom: "1px solid var(--color-border)",
              fontSize: "var(--text-xs)",
              color: "var(--color-text-secondary)",
              fontWeight: 600,
              gap: 12,
            }}
          >
            <span>프로젝트명</span>
            <span>고객사</span>
            <span>기간</span>
            <span style={{ textAlign: "center" }}>역할</span>
            <span />
          </div>

          {/* 목록 행 */}
          {items.map((item, i) => (
            <div
              key={item.projectId}
              onClick={() => {
                setCurrentProjectId(item.projectId);
                router.push(`/projects/${item.projectId}/settings`);
              }}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 140px 200px 80px 64px",
                padding: "10px 16px",
                borderBottom: i < items.length - 1 ? "1px solid var(--color-border-subtle)" : "none",
                alignItems: "center",
                gap: 12,
                background: "var(--color-bg-card)",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    fontSize:     "var(--text-base)",
                    color:        "var(--color-text-primary)",
                    overflow:     "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace:   "nowrap",
                  }}
                >
                  {item.name}
                </span>
                <ProjectAbbrChip value={item.abbreviation} />
                {item.locked && (
                  <span
                    className="sp-badge sp-badge-warning"
                    title="구독 종료로 읽기 전용 잠금 — 조회는 되고 편집·생성·초대·업로드는 막힙니다"
                    style={{ flexShrink: 0 }}
                  >
                    🔒 잠김
                  </span>
                )}
              </span>

              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-primary)" }}>
                {item.clientName ?? "-"}
              </span>

              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-primary)" }}>
                {(item.startDate || item.endDate)
                  ? `${formatDate(item.startDate)} ~ ${formatDate(item.endDate)}`
                  : "-"}
              </span>

              <div style={{ textAlign: "center" }}><RoleBadge role={item.myRole} /></div>

              {/* 잠긴 프로젝트 — 소유자에게 "활성화" 버튼 (멤버 상한 이하면 즉시 해제) */}
              {item.locked && item.isOwner ? (
                <button
                  className="sp-btn sp-btn-primary sp-btn-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    unlockMutation.mutate(item);
                  }}
                  disabled={unlockMutation.isPending}
                  title="소유자 혼자 편집하고, 열려 있는 다른 소유 프로젝트가 없으면 바로 활성화됩니다"
                  style={{ whiteSpace: "nowrap", justifySelf: "end" }}
                >
                  활성화
                </button>
              ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentProjectId(item.projectId);
                  router.push(`/projects/${item.projectId}/settings`);
                }}
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
              )}
            </div>
          ))}
        </div>
      )}

      </div>

      {/* 생성 POPUP */}
      {createOpen && (
        <CreateProjectDialog
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
          onLimit={(info) => { setCreateOpen(false); setLimit(info); }}
        />
      )}

      {/* FREE 상한 안내 — 요금제 페이지로 유도 */}
      <PlanLimitDialog limit={limit} onClose={() => setLimit(null)} />

      {/* 열린 프로젝트 교체 — FREE 는 한 번에 1개만 열 수 있어 A 를 닫고 B 를 연다 (정책 §1-6) */}
      <ProjectSwapDialog
        info={swap}
        onClose={() => setSwap(null)}
        onDone={() => { setSwap(null); afterUnlock("열린 프로젝트를 바꿨습니다."); }}
        onRejected={(err) => {
          // 교체가 롤백된 경우 — 아무것도 닫히지 않았다. 남은 사유를 그대로 안내한다
          queryClient.invalidateQueries({ queryKey: ["projects"] });
          if (isPlanLimitError(err)) setLimit(toPlanLimitInfo(err, swap?.open.projectId));
          else toast.error(err.message);
        }}
      />
    </div>
  );
}
