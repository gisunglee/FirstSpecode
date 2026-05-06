"use client";

/**
 * ProjectSettingsPage — 프로젝트 설정 (PID-00023, UW-00012)
 *
 * 역할:
 *   - [기본정보] 탭: 프로젝트명·발주처·기간 수정 (FID-00075, FID-00076)
 *   - [AI설정] 탭: API 키 CRUD + AI 호출 방식 변경 (FID-00077~FID-00081)
 *   - 프로젝트 복사·삭제 (FID-00060, FID-00062)
 *   - OWNER/ADMIN 전용 페이지
 *
 * 주요 기술:
 *   - TanStack Query: 프로젝트·AI설정·변경이력 조회
 *   - useMutation: 저장·복사·삭제·API키 CRUD
 */

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────
type ProjectDetail = {
  projectId:   string;
  name:        string;
  description: string | null;
  startDate:   string | null;
  endDate:     string | null;
  clientName:  string | null;
  myRole:      string;
};

type ApiKeyItem = { keyId: string; provider: string; maskedKey: string };

type AiSettings = {
  apiKeys:    ApiKeyItem[];
  callMethod: "DIRECT" | "QUEUE";
};

type Tab = "basic" | "ai" | "document";

type DocumentSettings = {
  copyrightHolder:   string | null;
  docVersionDefault: string | null;
  approverName:      string | null;
};

// ── 복사 확인 POPUP ──────────────────────────────────────────────────────
function CopyDialog({
  projectName, onCancel, onConfirm, isPending,
}: { projectName: string; onCancel: () => void; onConfirm: () => void; isPending: boolean }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "var(--color-bg-card)", border: "1px solid var(--color-border-strong)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-xl)", padding: "28px 24px" }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>📋</div>
        <h3 style={{ margin: "0 0 10px", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)" }}>프로젝트를 복사하시겠습니까?</h3>
        <p style={{ margin: "0 0 20px", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
          <strong>'{projectName}'</strong>의 분석·설계 모든 정보가 복사됩니다.<br />
          복사본은 <strong>'{projectName} (복사본)'</strong>으로 생성되며,<br />멤버는 복사되지 않습니다.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="sp-btn sp-btn-secondary" onClick={onCancel} disabled={isPending}>취소</button>
          <button className="sp-btn sp-btn-primary" onClick={onConfirm} disabled={isPending}>{isPending ? "복사 중..." : "복사"}</button>
        </div>
      </div>
    </div>
  );
}

// ── 삭제 확인 POPUP (PID-00018) ──────────────────────────────────────────
//
// 2026-05-06 동작 변경:
//   삭제는 즉시 제거가 아닌 "soft delete" 로 동작한다.
//   - 보관 기간(기본 14일) 동안 OWNER 가 복구 가능 (휴지통 화면 예정)
//   - 보관 기간이 지나면 별도 배치(또는 어드민)가 영구 삭제
//   - 다른 멤버에게는 즉시 보이지 않게 처리됨
//
//   문구도 그에 맞춰 "즉시 영구 삭제" 가 아닌 "삭제 처리(복구 가능)"로 정확화.
function DeleteDialog({
  projectName, onCancel, onConfirm, isPending,
}: { projectName: string; onCancel: () => void; onConfirm: () => void; isPending: boolean }) {
  const [inputName, setInputName] = useState("");
  const confirmed = inputName === projectName;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: "var(--color-bg-card)", border: "1px solid var(--color-border-strong)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-xl)", padding: "28px 24px" }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
        <h3 style={{ margin: "0 0 10px", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text-heading)" }}>프로젝트를 삭제하시겠습니까?</h3>
        <p style={{ margin: "0 0 8px", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
          <strong>'{projectName}'</strong>을 삭제하면 다른 멤버에게 즉시 보이지 않게 되고,<br />
          보관 기간이 지나면 영구 삭제됩니다. 그 전까지는 복구할 수 있습니다.
        </p>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 6, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            확인을 위해 프로젝트명 <strong style={{ color: "var(--color-text-primary)" }}>{projectName}</strong> 을 입력하세요
          </label>
          <input className="sp-input" placeholder={projectName} value={inputName} onChange={(e) => setInputName(e.target.value)} autoFocus
            style={{ borderColor: inputName ? (confirmed ? "var(--color-success, #22c55e)" : "var(--color-error)") : undefined }} />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="sp-btn sp-btn-secondary" onClick={onCancel} disabled={isPending}>취소</button>
          <button onClick={onConfirm} disabled={!confirmed || isPending} style={{ padding: "6px 16px", fontSize: "var(--text-sm)", fontWeight: 600, background: confirmed ? "var(--color-error)" : "var(--color-bg-elevated)", color: confirmed ? "#fff" : "var(--color-text-tertiary)", border: `1px solid ${confirmed ? "var(--color-error)" : "var(--color-border)"}`, borderRadius: "var(--radius-btn)", cursor: confirmed ? "pointer" : "not-allowed" }}>
            {isPending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────
export default function ProjectSettingsPage() {
  return <Suspense fallback={null}><ProjectSettingsInner /></Suspense>;
}

function ProjectSettingsInner() {
  const router      = useRouter();
  const params      = useParams();
  const queryClient = useQueryClient();
  const projectId   = params.id as string;

  const [activeTab,  setActiveTab]  = useState<Tab>("basic");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copyOpen,   setCopyOpen]   = useState(false);

  // ── 프로젝트 조회 ───────────────────────────────────────────────────
  const { data: projData, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => authFetch<{ data: ProjectDetail }>(`/api/projects/${projectId}`).then((r) => r.data),
    staleTime: 60_000,
  });

  const project   = projData ?? null;
  const myRole    = project?.myRole ?? null;
  const canEdit   = myRole === "OWNER" || myRole === "ADMIN";
  const isOwner   = myRole === "OWNER";

  // ── 권한 가드 ──────────────────────────────────────────────────────
  // 멤버 페이지와 동일 패턴 — 권한 없는 사용자가 진입하면 토스트 안내 후
  // 과업 페이지로 이동. project 로딩 중에는 myRole 이 null 이므로 판정 보류.
  // (`/projects/{id}` 는 page.tsx 가 없어 404 — 모든 멤버에게 열린 /tasks 로 보낸다.)
  useEffect(() => {
    if (project && !canEdit) {
      toast.info("프로젝트 설정 권한이 없어 기본 페이지로 이동합니다.");
      router.replace(`/projects/${projectId}/tasks`);
    }
  }, [project, canEdit, projectId, router]);

  // ── 복사 뮤테이션 ───────────────────────────────────────────────────
  const copyMutation = useMutation({
    mutationFn: () => authFetch<{ data: { newProjectId: string } }>(`/api/projects/${projectId}/copy`, { method: "POST" }),
    onSuccess: (res) => {
      toast.success("프로젝트가 복사되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${res.data.newProjectId}/settings`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 뮤테이션 (soft delete) ─────────────────────────────────────
  //
  // API 가 안전 토큰(confirm:'DELETE')을 요구한다 — 모달 통과(프로젝트명
  // 입력)와 별개로 본문 토큰까지 검사하는 이중 보호. 모달은 의도 확인,
  // 토큰은 실수로 발사되는 호출 자체를 차단한다.
  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: { hardDeleteAt?: string; retentionDays?: number } }>(
        `/api/projects/${projectId}`,
        {
          method:  "DELETE",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ confirm: "DELETE" }),
        }
      ),
    onSuccess: (res) => {
      // 보관 기간이 응답에 들어오면 사용자가 안심할 수 있도록 토스트에 함께 안내.
      const days = res?.data?.retentionDays;
      toast.success(
        days
          ? `프로젝트가 삭제 처리되었습니다. ${days}일 후 영구 삭제됩니다 (그 전까지 복구 가능).`
          : "프로젝트가 삭제 처리되었습니다."
      );
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push("/projects");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div style={{ padding: "28px 32px", color: "var(--color-text-tertiary)" }}>로딩 중...</div>;
  if (!project)  return <div style={{ padding: "28px 32px", color: "var(--color-error)" }}>프로젝트를 찾을 수 없습니다.</div>;
  // 권한 없을 시 위 useEffect 가 redirect 처리. redirect 가 적용되기 전 한 프레임 동안의
  // 빈 화면 방지를 위해 안내 텍스트만 잠깐 표시 (인라인 메시지 분기에서 redirect 분기로 통일).
  if (!canEdit)  return <div style={{ padding: "28px 32px", color: "var(--color-text-secondary)" }}>이동 중...</div>;

  const tabStyle = (tab: Tab): React.CSSProperties => ({
    padding: "8px 18px",
    fontSize: "var(--text-sm)",
    fontWeight: activeTab === tab ? 700 : 500,
    color: activeTab === tab ? "var(--color-brand)" : "var(--color-text-secondary)",
    background: "none",
    border: "none",
    borderBottom: activeTab === tab ? "2px solid var(--color-brand)" : "2px solid transparent",
    cursor: "pointer",
  });

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => router.push("/projects")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#666", lineHeight: 1, padding: "2px 4px" }}>
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>프로젝트 설정</span>
        </div>
      </div>

      <div style={{ padding: "0 24px 24px", maxWidth: 680 }}>
      {/* AR-00032 탭 네비게이션 (FID-00074) */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", marginBottom: 12 }}>
        <button style={tabStyle("basic")}    onClick={() => setActiveTab("basic")}>기본정보</button>
        <button style={tabStyle("ai")}       onClick={() => setActiveTab("ai")}>AI설정</button>
        <button style={tabStyle("document")} onClick={() => setActiveTab("document")}>문서설정</button>
      </div>

      {/* 탭 콘텐츠 */}
      {activeTab === "basic" && (
        <>
          <BasicInfoTab projectId={projectId} project={project} isOwner={isOwner} queryClient={queryClient} />

          {/* 멤버 관리 및 초대 바로가기 — 기본정보 탭에서만 노출 (FID-00074) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 28, marginBottom: 20 }}>
            <NavCard
              title="멤버 관리"
              description="참여 인원 목록 및 역할을 관리합니다"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
              onClick={() => router.push(`/projects/${projectId}/members`)}
              color="var(--color-brand)"
            />
            <NavCard
              title="초대 및 현황"
              description="새 멤버 초대 및 승인 대기를 확인합니다"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg>}
              onClick={() => router.push(`/projects/${projectId}/members/invitations`)}
              color="var(--color-success, #22c55e)"
            />
          </div>

          {/* 액션 영역 — 기본정보 탭에서만 노출. 프로젝트 삭제는 OWNER 전용 */}
          <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button className="sp-btn sp-btn-secondary" onClick={() => setCopyOpen(true)} disabled={copyMutation.isPending}>프로젝트 복사</button>
            {isOwner && (
              <button disabled={deleteMutation.isPending} onClick={() => setDeleteOpen(true)} style={{ padding: "6px 16px", fontSize: "var(--text-sm)", fontWeight: 600, background: "var(--color-error-subtle, rgba(239,68,68,0.08))", color: "var(--color-error)", border: "1px solid var(--color-error)", borderRadius: "var(--radius-btn)", cursor: "pointer" }}>
                프로젝트 삭제
              </button>
            )}
          </div>
        </>
      )}
      {activeTab === "ai"       && <AiSettingsTab projectId={projectId} />}
      {activeTab === "document" && <DocumentSettingsTab projectId={projectId} />}

      {copyOpen && (
        <CopyDialog projectName={project.name} onCancel={() => setCopyOpen(false)} onConfirm={() => { setCopyOpen(false); copyMutation.mutate(); }} isPending={copyMutation.isPending} />
      )}
      {deleteOpen && (
        <DeleteDialog projectName={project.name} onCancel={() => setDeleteOpen(false)} onConfirm={() => deleteMutation.mutate()} isPending={deleteMutation.isPending} />
      )}
      </div>
    </div>
  );
}

// ── AR-00033 기본정보 탭 (FID-00075, FID-00076) ───────────────────────────
function BasicInfoTab({
  projectId, project, isOwner, queryClient,
}: {
  projectId: string;
  project: ProjectDetail;
  isOwner: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [name,        setName]        = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [startDate,   setStartDate]   = useState(project.startDate?.slice(0, 10) ?? "");
  const [endDate,     setEndDate]     = useState(project.endDate?.slice(0, 10) ?? "");
  const [clientName,  setClientName]  = useState(project.clientName ?? "");

  const saveMutation = useMutation({
    mutationFn: (body: object) =>
      authFetch(`/api/projects/${projectId}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("프로젝트명을 입력해 주세요."); return; }
    if (startDate && endDate && endDate < startDate) { toast.error("종료일은 시작일 이후여야 합니다."); return; }
    saveMutation.mutate({ name, description, startDate: startDate || undefined, endDate: endDate || undefined, clientName });
  }

  const ro = !isOwner;
  return (
    <form onSubmit={handleSave}>
      <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label className="sp-label">프로젝트명 <span style={{ color: "var(--color-error)" }}>*</span></label>
          <input className="sp-input" value={name} onChange={(e) => setName(e.target.value)} readOnly={ro} />
        </div>
        <div>
          <label className="sp-label">설명</label>
          <textarea className="sp-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} readOnly={ro} style={{ resize: "vertical" }} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="sp-label">시작일</label>
            <input className="sp-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} readOnly={ro} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="sp-label">종료일</label>
            <input className="sp-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} readOnly={ro} />
          </div>
        </div>
        <div>
          <label className="sp-label">발주처</label>
          <input className="sp-input" value={clientName} onChange={(e) => setClientName(e.target.value)} readOnly={ro} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" className="sp-btn sp-btn-primary" disabled={ro || saveMutation.isPending}>
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ── AR-00034 AI설정 탭 — 현재 "준비 중" 상태 ───────────────────────────────
//
// [2026-05-04] 일시 비활성화 사유:
//   - tb_pj_project_api_key 에 저장되는 키는 어디서도 읽지 않고(decryptApiKey 호출자 0건),
//     실제 AI 요청은 외부 워커(Claude Code/Python)가 자기 키로 처리한다.
//   - ai_call_mthd_code(DIRECT/QUEUE) 도 분기 로직이 없어 토글이 무의미하다.
//   → 사용자 혼동을 막기 위해 UI 만 "준비 중" 안내로 교체.
//   → 데이터/테이블/API/이력 기록은 모두 보존 — 미래 워커가 프로젝트 단위 키를 읽도록
//     확장될 때 아래 AiSettingsTabLive 를 export 만 바꿔 복원하면 된다.
function AiSettingsTab({ projectId: _projectId }: { projectId: string }) {
  // _projectId : 미래 복원 시 사용. 현재 placeholder 에서는 참조하지 않음.
  return (
    <div
      style={{
        background:    "var(--color-bg-card)",
        border:        "1px solid var(--color-border)",
        borderRadius:  "var(--radius-card)",
        padding:       "48px 24px",
        textAlign:     "center",
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 12 }}>🛠️</div>
      <h3
        style={{
          margin:    "0 0 8px",
          fontSize:  "var(--text-lg)",
          fontWeight: 700,
          color:     "var(--color-text-heading)",
        }}
      >
        준비 중입니다
      </h3>
      <p
        style={{
          margin:    "0 auto",
          maxWidth:  420,
          fontSize:  "var(--text-sm)",
          color:     "var(--color-text-secondary)",
          lineHeight: 1.7,
        }}
      >
        AI API 키 관리와 호출 방식 설정 기능은 곧 제공될 예정입니다.<br />
        현재 AI 요청은 시스템 기본 설정으로 처리됩니다.
      </p>
    </div>
  );
}

// ── AR-00034 AI설정 탭 — 실제 구현 (현재 비활성, 복원용 보존) ──────────────
//
// 복원 방법:
//   1) 위 AiSettingsTab 의 본문을 <AiSettingsTabLive projectId={_projectId} /> 로 교체
//   2) 또는 위 함수를 통째로 지우고 이 함수의 이름을 AiSettingsTab 으로 되돌림
//
// 관련 백엔드 라우트(보존 중):
//   - GET/PUT /api/projects/[id]/settings/ai
//   - POST    /api/projects/[id]/settings/api-keys
//   - PUT/DELETE /api/projects/[id]/settings/api-keys/[keyId]
function AiSettingsTabLive({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();

  // 인라인 상태
  const [showAddForm,  setShowAddForm]  = useState(false);
  const [newProvider,  setNewProvider]  = useState("");
  const [newKey,       setNewKey]       = useState("");
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editKey,      setEditKey]      = useState("");
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const [callMethod,   setCallMethod]   = useState<"DIRECT" | "QUEUE">("DIRECT");
  const [methodLoaded, setMethodLoaded] = useState(false);

  // AI 설정 조회 (FID-00077)
  const { data: aiData, isLoading } = useQuery({
    queryKey: ["ai-settings", projectId],
    queryFn: () =>
      authFetch<{ data: AiSettings }>(`/api/projects/${projectId}/settings/ai`).then((r) => r.data),
  });

  // 처음 로드될 때 callMethod 초기화
  if (aiData && !methodLoaded) {
    setCallMethod(aiData.callMethod);
    setMethodLoaded(true);
  }

  const apiKeys = aiData?.apiKeys ?? [];

  // API 키 등록 (FID-00078)
  const addKeyMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/settings/api-keys`, {
        method: "POST", body: JSON.stringify({ provider: newProvider, apiKey: newKey }),
      }),
    onSuccess: () => {
      toast.success("API 키가 등록되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-settings", projectId] });

      setShowAddForm(false); setNewProvider(""); setNewKey("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // API 키 수정 (FID-00079)
  const editKeyMutation = useMutation({
    mutationFn: (keyId: string) =>
      authFetch(`/api/projects/${projectId}/settings/api-keys/${keyId}`, {
        method: "PUT", body: JSON.stringify({ apiKey: editKey }),
      }),
    onSuccess: () => {
      toast.success("API 키가 수정되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-settings", projectId] });

      setEditingId(null); setEditKey("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // API 키 삭제 (FID-00080)
  const delKeyMutation = useMutation({
    mutationFn: (keyId: string) =>
      authFetch(`/api/projects/${projectId}/settings/api-keys/${keyId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("API 키가 삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["ai-settings", projectId] });

      setConfirmDelId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // AI 호출 방식 저장 (FID-00081)
  const saveMethodMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/settings/ai`, {
        method: "PUT", body: JSON.stringify({ callMethod }),
      }),
    onSuccess: () => {
      toast.success("저장되었습니다.");

    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>로딩 중...</div>;

  const cardStyle: React.CSSProperties = {
    background: "var(--color-bg-card)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-card)",
    padding: "20px",
    marginBottom: 16,
  };

  return (
    <div>
      {/* API 키 섹션 */}
      <div style={cardStyle}>
        <h3 style={{ margin: "0 0 8px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-heading)" }}>AI API 키</h3>

        {/* 키 목록 */}
        {apiKeys.length === 0 && !showAddForm && (
          <p style={{ margin: "0 0 12px", fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>등록된 API 키가 없습니다.</p>
        )}
        {apiKeys.map((k) => (
          <div key={k.keyId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--color-border-subtle)" }}>
            {editingId === k.keyId ? (
              // 인라인 수정 폼
              <>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, minWidth: 80 }}>{k.provider}</span>
                <input className="sp-input" placeholder="새 API 키 입력" value={editKey} onChange={(e) => setEditKey(e.target.value)} style={{ flex: 1, fontSize: "var(--text-sm)" }} />
                <button className="sp-btn sp-btn-primary" style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }} onClick={() => editKeyMutation.mutate(k.keyId)} disabled={!editKey.trim() || editKeyMutation.isPending}>저장</button>
                <button className="sp-btn sp-btn-secondary" style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }} onClick={() => { setEditingId(null); setEditKey(""); }}>취소</button>
              </>
            ) : confirmDelId === k.keyId ? (
              // 인라인 삭제 확인
              <>
                <span style={{ flex: 1, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  <strong>{k.provider}</strong> 키를 삭제하시겠습니까?
                </span>
                <button className="sp-btn sp-btn-primary" style={{ fontSize: "var(--text-xs)", padding: "4px 10px", background: "var(--color-error)", borderColor: "var(--color-error)" }} onClick={() => delKeyMutation.mutate(k.keyId)} disabled={delKeyMutation.isPending}>확인</button>
                <button className="sp-btn sp-btn-secondary" style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }} onClick={() => setConfirmDelId(null)}>아니오</button>
              </>
            ) : (
              // 기본 표시
              <>
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, minWidth: 80 }}>{k.provider}</span>
                <span style={{ flex: 1, fontSize: "var(--text-sm)", fontFamily: "monospace", color: "var(--color-text-secondary)" }}>{k.maskedKey}</span>
                <button className="sp-btn sp-btn-secondary" style={{ fontSize: "var(--text-xs)", padding: "4px 10px" }} onClick={() => { setEditingId(k.keyId); setEditKey(""); }}>수정</button>
                <button style={{ fontSize: "var(--text-xs)", padding: "4px 10px", background: "none", border: "1px solid var(--color-error)", color: "var(--color-error)", borderRadius: "var(--radius-btn)", cursor: "pointer" }} onClick={() => setConfirmDelId(k.keyId)}>삭제</button>
              </>
            )}
          </div>
        ))}

        {/* 인라인 등록 폼 */}
        {showAddForm ? (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 14 }}>
            <div style={{ flex: "0 0 120px" }}>
              <label className="sp-label" style={{ fontSize: "var(--text-xs)" }}>프로바이더</label>
              <input className="sp-input" placeholder="Claude" value={newProvider} onChange={(e) => setNewProvider(e.target.value)} style={{ fontSize: "var(--text-sm)" }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="sp-label" style={{ fontSize: "var(--text-xs)" }}>API 키</label>
              <input className="sp-input" placeholder="sk-ant-..." value={newKey} onChange={(e) => setNewKey(e.target.value)} type="password" style={{ fontSize: "var(--text-sm)" }} />
            </div>
            <button className="sp-btn sp-btn-primary" style={{ fontSize: "var(--text-xs)", padding: "8px 12px" }} onClick={() => addKeyMutation.mutate()} disabled={!newProvider.trim() || !newKey.trim() || addKeyMutation.isPending}>등록</button>
            <button className="sp-btn sp-btn-secondary" style={{ fontSize: "var(--text-xs)", padding: "8px 12px" }} onClick={() => { setShowAddForm(false); setNewProvider(""); setNewKey(""); }}>취소</button>
          </div>
        ) : (
          <button className="sp-btn sp-btn-secondary" style={{ marginTop: 14, fontSize: "var(--text-sm)" }} onClick={() => setShowAddForm(true)}>+ 키 등록</button>
        )}
      </div>

      {/* AI 호출 방식 섹션 */}
      <div style={cardStyle}>
        <h3 style={{ margin: "0 0 8px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-heading)" }}>AI 호출 방식</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {[
            { value: "DIRECT", label: "Claude API 직접 호출", desc: "등록된 API 키로 직접 요청합니다." },
            { value: "QUEUE",  label: "Claude Code 큐 기반",  desc: "큐를 통해 순차 처리합니다." },
          ].map((opt) => (
            <label key={opt.value} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="radio" name="callMethod" value={opt.value} checked={callMethod === opt.value} onChange={() => setCallMethod(opt.value as "DIRECT" | "QUEUE")} style={{ marginTop: 3 }} />
              <div>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-text-primary)" }}>{opt.label}</div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)" }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="sp-btn sp-btn-primary" onClick={() => saveMethodMutation.mutate()} disabled={saveMethodMutation.isPending}>
            {saveMethodMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 문서 설정 탭 (출력 docx 양식 기본값) ─────────────────────────────────────
// 입력 항목:
//   - 기본 승인자 (PM)  — 표지/변경이력 표의 "승인자" 칸에 자동 채워짐. 외부 PM 도 OK
//                        (자유 텍스트 — 멤버 select 가 아닌 이유는 멤버 명단에 없는
//                         고객사 PM 도 들어갈 수 있어야 하기 때문).
//   - 저작권 문구       — 표지/바닥글에 들어가는 "Copyright ⓒ ..." 문구
//   - 기본 문서 버전    — 표지/변경이력 표 첫 행의 "v1.0" 같은 라벨
//
// 모두 비워두면 export 핸들러가 코드 fallback 사용 — 입력란 placeholder 가 그 fallback 값을 보여줌.

// 입력란 아래 안내 문구 공통 스타일 — 같은 패턴이 3곳 반복되어 상수로 추출
// color 는 secondary — placeholder/회색 텍스트와 구분되어 잘 읽히도록
const fieldHintStyle: React.CSSProperties = {
  margin:     "6px 0 0",
  fontSize:   "var(--text-xs)",
  color:      "var(--color-text-secondary)",
  lineHeight: 1.6,
};

// 안내 문구 안의 예시 텍스트(코드체) — 발주처명·버전 라벨 같은 예시 강조
const hintCodeStyle: React.CSSProperties = {
  background:   "var(--color-bg-elevated)",
  padding:      "1px 6px",
  borderRadius: 3,
  fontFamily:   "var(--font-mono, monospace)",
  fontSize:     "0.95em",
  color:        "var(--color-text-primary)",
};

function DocumentSettingsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["document-settings", projectId],
    queryFn: () =>
      authFetch<{ data: DocumentSettings }>(`/api/projects/${projectId}/settings/document`).then((r) => r.data),
  });

  // 폼 상태 — 입력값은 모두 string (빈 문자열 → 저장 시 null 로 변환)
  const [approverName,      setApproverName]      = useState("");
  const [copyrightHolder,   setCopyrightHolder]   = useState("");
  const [docVersionDefault, setDocVersionDefault] = useState("");
  const [loaded, setLoaded] = useState(false);

  // 처음 로드된 데이터를 폼 상태에 한 번만 반영 — 사용자 편집 중에 덮어쓰지 않도록
  if (data && !loaded) {
    setApproverName(data.approverName ?? "");
    setCopyrightHolder(data.copyrightHolder ?? "");
    setDocVersionDefault(data.docVersionDefault ?? "");
    setLoaded(true);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/settings/document`, {
        method: "PUT",
        // 빈 문자열은 명시적으로 null 로 — 사용자가 지우면 fallback 으로 돌아가도록
        body: JSON.stringify({
          approverName:      approverName      || null,
          copyrightHolder:   copyrightHolder   || null,
          docVersionDefault: docVersionDefault || null,
        }),
      }),
    onSuccess: () => {
      toast.success("저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["document-settings", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>로딩 중...</div>;

  return (
    <div>
      <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--color-text-heading)" }}>출력 문서 양식 기본값</h3>
        <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          프로젝트의 모든 산출물 문서(.docx) 출력 시 표지·바닥글·변경이력 표에
          <strong> 공통으로 사용되는 기본값</strong>입니다.
          요구사항 명세서뿐 아니라 향후 추가될 단위업무·화면 등 모든 산출물에 동일하게 적용됩니다.
          비워두면 시스템 기본값으로 출력됩니다.
        </p>

        <div>
          <label className="sp-label">기본 승인자 (PM)</label>
          <input
            className="sp-input"
            placeholder="(미지정)"
            value={approverName}
            onChange={(e) => setApproverName(e.target.value)}
            maxLength={100}
          />
          <p style={fieldHintStyle}>
            <strong>적용 위치:</strong> 표지의 &ldquo;승인자&rdquo; 행, 변경이력 표 우측 끝 &ldquo;승인자&rdquo; 컬럼.<br />
            보통 프로젝트 PM 또는 검수 책임자 이름. 멤버가 아닌
            <strong> 외부 PM(고객사 측, 컨소시엄 PM 등) 이름도 자유 입력 가능</strong>합니다.
            추후 산출물별 발행 기능 도입 시에도 이 값이 발행 모달의 승인자 기본값으로 활용됩니다.
          </p>
        </div>

        <div>
          <label className="sp-label">저작권 문구</label>
          <input
            className="sp-input"
            placeholder="Copyright ⓒ SPECODE"
            value={copyrightHolder}
            onChange={(e) => setCopyrightHolder(e.target.value)}
            maxLength={255}
          />
          <p style={fieldHintStyle}>
            <strong>적용 위치:</strong> 모든 출력 문서의 <strong>각 페이지 바닥글 우측</strong>에 공통 표시.<br />
            발주처·컨소시엄명·구축사 등을 자유롭게 입력하세요.
            예) <code style={hintCodeStyle}>Copyright ⓒ (주)바른아이오</code>
          </p>
        </div>

        <div>
          <label className="sp-label">기본 문서 버전</label>
          <input
            className="sp-input"
            placeholder="v1.0"
            value={docVersionDefault}
            onChange={(e) => setDocVersionDefault(e.target.value)}
            maxLength={50}
          />
          <p style={fieldHintStyle}>
            <strong>적용 위치:</strong> 표지의 &ldquo;문서 버전&rdquo; 행, 변경이력 표 첫 행 &ldquo;버전&rdquo; 컬럼.<br />
            <strong>최초 발행 버전</strong>으로 사용됩니다. 표기는 자유 — 예) <code style={hintCodeStyle}>v1.0</code>, <code style={hintCodeStyle}>1.0.0</code>, <code style={hintCodeStyle}>v0.1</code>
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="sp-btn sp-btn-primary"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * NavCard — 프로젝트 설정 내 이동용 카드 컴포넌트
 */
function NavCard({
  title,
  description,
  icon,
  onClick,
  color,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  color?: string;
}) {
  const [isHover, setIsHover] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "20px 24px",
        background: isHover ? "var(--color-bg-elevated)" : "var(--color-bg-card)",
        border: "1px solid",
        borderColor: isHover ? color ?? "var(--color-brand)" : "var(--color-border)",
        borderRadius: "var(--radius-lg)",
        cursor: "pointer",
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        boxShadow: isHover ? "var(--shadow-md)" : "none",
        transform: isHover ? "translateY(-1px)" : "none",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: isHover ? (color ?? "var(--color-brand)") : "var(--color-bg-muted)",
          color: isHover ? "#fff" : (color ?? "var(--color-brand)"),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.2s",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", letterSpacing: "-0.01em" }}>{description}</div>
      </div>
      <div style={{ color: "var(--color-text-tertiary)", fontSize: 18, opacity: isHover ? 1 : 0.3, transition: "opacity 0.2s", paddingLeft: 4 }}>
        ›
      </div>
    </div>
  );
}

