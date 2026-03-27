"use client";

/**
 * ProjectSettingsPage — 프로젝트 설정 (PID-00023, UW-00012)
 *
 * 역할:
 *   - [기본정보] 탭: 프로젝트명·발주처·기간 수정 (FID-00075, FID-00076)
 *   - [AI설정] 탭: API 키 CRUD + AI 호출 방식 변경 (FID-00077~FID-00081)
 *   - [변경이력] 탭: 설정 변경 이력 조회 (FID-00082)
 *   - 프로젝트 복사·삭제 (FID-00060, FID-00062)
 *   - OWNER/ADMIN 전용 페이지
 *
 * 주요 기술:
 *   - TanStack Query: 프로젝트·AI설정·변경이력 조회
 *   - useMutation: 저장·복사·삭제·API키 CRUD
 */

import { Suspense, useState } from "react";
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

type HistoryItem = {
  changedAt:    string;
  changerEmail: string;
  itemName:     string;
  beforeValue:  string | null;
  afterValue:   string | null;
};

type Tab = "basic" | "ai" | "history";

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
          <strong>'{projectName}'</strong>을 삭제하면<br />모든 하위 데이터가 즉시 제거되며 복구할 수 없습니다.
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

  // ── 삭제 뮤테이션 ───────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => authFetch(`/api/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("프로젝트가 삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push("/projects");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <div style={{ padding: "28px 32px", color: "var(--color-text-tertiary)" }}>로딩 중...</div>;
  if (!project)  return <div style={{ padding: "28px 32px", color: "var(--color-error)" }}>프로젝트를 찾을 수 없습니다.</div>;
  if (!canEdit)  return <div style={{ padding: "28px 32px", color: "var(--color-text-secondary)" }}>OWNER 또는 관리자만 접근할 수 있습니다.</div>;

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
    <div style={{ padding: "28px 32px", maxWidth: 680 }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 20 }}>
        <button onClick={() => router.push("/projects")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", padding: 0, marginBottom: 8 }}>
          ← 프로젝트 목록
        </button>
        <h1 style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: 700, color: "var(--color-text-heading)" }}>프로젝트 설정</h1>
      </div>

      {/* AR-00032 탭 네비게이션 (FID-00074) */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", marginBottom: 12 }}>
        <button style={tabStyle("basic")}   onClick={() => setActiveTab("basic")}>기본정보</button>
        <button style={tabStyle("ai")}      onClick={() => setActiveTab("ai")}>AI설정</button>
        <button style={tabStyle("history")} onClick={() => setActiveTab("history")}>변경이력</button>
      </div>

      {/* 탭 콘텐츠 */}
      {activeTab === "basic"   && <BasicInfoTab   projectId={projectId} project={project} isOwner={isOwner} queryClient={queryClient} />}
      {activeTab === "ai"      && <AiSettingsTab  projectId={projectId} />}
      {activeTab === "history" && <HistoryTab     projectId={projectId} />}

      {/* 멤버 관리 바로가기 */}
      <div style={{ display: "flex", gap: 8, marginTop: 24, marginBottom: 16 }}>
        <button onClick={() => router.push(`/projects/${projectId}/members`)} className="sp-btn sp-btn-secondary" style={{ flex: 1 }}>멤버 목록 →</button>
        <button onClick={() => router.push(`/projects/${projectId}/members/invitations`)} className="sp-btn sp-btn-secondary" style={{ flex: 1 }}>멤버 초대 / 초대 현황 →</button>
      </div>

      {/* 액션 영역 */}
      <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button className="sp-btn sp-btn-secondary" onClick={() => setCopyOpen(true)} disabled={copyMutation.isPending}>프로젝트 복사</button>
        <button disabled={!isOwner || deleteMutation.isPending} onClick={() => setDeleteOpen(true)} style={{ padding: "6px 16px", fontSize: "var(--text-sm)", fontWeight: 600, background: isOwner ? "var(--color-error-subtle, rgba(239,68,68,0.08))" : "var(--color-bg-elevated)", color: isOwner ? "var(--color-error)" : "var(--color-text-tertiary)", border: `1px solid ${isOwner ? "var(--color-error)" : "var(--color-border)"}`, borderRadius: "var(--radius-btn)", cursor: isOwner ? "pointer" : "not-allowed", opacity: isOwner ? 1 : 0.5 }} title={!isOwner ? "OWNER만 삭제할 수 있습니다" : ""}>
          프로젝트 삭제
        </button>
      </div>

      {copyOpen && (
        <CopyDialog projectName={project.name} onCancel={() => setCopyOpen(false)} onConfirm={() => { setCopyOpen(false); copyMutation.mutate(); }} isPending={copyMutation.isPending} />
      )}
      {deleteOpen && (
        <DeleteDialog projectName={project.name} onCancel={() => setDeleteOpen(false)} onConfirm={() => deleteMutation.mutate()} isPending={deleteMutation.isPending} />
      )}
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

// ── AR-00034 AI설정 탭 (FID-00077 ~ FID-00081) ───────────────────────────
function AiSettingsTab({ projectId }: { projectId: string }) {
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
      queryClient.invalidateQueries({ queryKey: ["history", projectId] });
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
      queryClient.invalidateQueries({ queryKey: ["history", projectId] });
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
      queryClient.invalidateQueries({ queryKey: ["history", projectId] });
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
      queryClient.invalidateQueries({ queryKey: ["history", projectId] });
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

// ── AR-00035 변경이력 탭 (FID-00082) ─────────────────────────────────────
function HistoryTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["history", projectId],
    queryFn: () =>
      authFetch<{ data: { items: HistoryItem[]; totalCount: number } }>(
        `/api/projects/${projectId}/settings/history`
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];

  if (isLoading) return <div style={{ color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>로딩 중...</div>;

  if (items.length === 0) {
    return (
      <div style={{ padding: "20px 24px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)", background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)" }}>
        변경 이력이 없습니다.
      </div>
    );
  }

  const thStyle: React.CSSProperties = {
    padding: "10px 12px", fontSize: 11, fontWeight: 600,
    color: "var(--color-text-secondary)", textAlign: "left",
    background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)",
  };
  const tdStyle: React.CSSProperties = {
    padding: "10px 12px", fontSize: 12,
    color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border-subtle)",
    verticalAlign: "top",
  };

  return (
    <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 140 }}>변경일시</th>
            <th style={{ ...thStyle, width: 160 }}>변경자</th>
            <th style={{ ...thStyle, width: 100 }}>항목</th>
            <th style={thStyle}>변경 내용</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              <td style={tdStyle}>{new Date(item.changedAt).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
              <td style={{ ...tdStyle, color: "var(--color-text-secondary)" }}>{item.changerEmail}</td>
              <td style={tdStyle}>{item.itemName}</td>
              <td style={tdStyle}>
                {item.beforeValue && item.afterValue
                  ? <span>{item.beforeValue} <span style={{ color: "var(--color-text-tertiary)" }}>→</span> {item.afterValue}</span>
                  : item.afterValue
                    ? <span style={{ color: "var(--color-success, #22c55e)" }}>등록: {item.afterValue}</span>
                    : item.beforeValue
                      ? <span style={{ color: "var(--color-error)" }}>삭제: {item.beforeValue}</span>
                      : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
