"use client";

/**
 * RequirementDetailPage — 요구사항 상세·편집 (PID-00031)
 *
 * 역할:
 *   - 신규: reqId = "new" → POST (FID-00103 신규)
 *   - 수정: reqId 존재 → GET 로드(FID-00102) → PUT (FID-00103 수정 + 이력)
 *   - 원문·현행화 편집 (FID-00104)
 *   - 첨부파일 업로드·다운로드·삭제 (FID-00106~108)
 */

import { Suspense, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { renderMarkdown } from "@/lib/renderMarkdown";
import RichEditor from "@/components/ui/RichEditor";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type HistoryItem = {
  historyId:    string;
  versionNo:    string;
  versionType:  "INTERNAL" | "CONFIRMED";
  comment:      string;
  changedAt:    string;
  changerEmail: string;
};

type DiffContent = {
  historyId: string;
  versionNo: string;
  orgnlCn:   string;
  curncyCn:  string;
  specCn:    string;
};

type DiffResult = {
  v1Content: DiffContent;
  v2Content: DiffContent;
};

type TaskOption = {
  taskId:   string;
  name:     string;
  category: string;
};

type RequirementDetail = {
  requirementId:   string;
  displayId:       string;
  name:            string;
  priority:        string;
  source:          string;
  rfpPage:         string;
  originalContent: string;
  currentContent:  string;
  analysisMemo:    string;
  detailSpec:      string;
  taskId:          string | null;
};

type AttachedFile = {
  fileId:     string;
  fileName:   string;
  fileSize:   number;
  extension:  string;
  uploadedAt: string;
};

type SaveBody = {
  taskId?:          string;
  name:             string;
  priority:         string;
  source:           string;
  rfpPage:          string;
  originalContent:  string;
  currentContent:   string;
  analysisMemo:     string;
  detailSpec:       string;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function RequirementDetailPage() {
  return (
    <Suspense fallback={null}>
      <RequirementDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function RequirementDetailPageInner() {
  const params      = useParams<{ id: string; reqId: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const projectId   = params.id;
  const reqId       = params.reqId;
  const isNew       = reqId === "new";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<SaveBody>({
    taskId:          undefined,
    name:            "",
    priority:        "MEDIUM",
    source:          "RFP",
    rfpPage:         "",
    originalContent: "",
    currentContent:  "",
    analysisMemo:    "",
    detailSpec:      "",
  });

  // 원문·현행화 탭 — 기본값: 현행화
  const [contentTab, setContentTab] = useState<"original" | "current">("current");

  // 마크다운 탭 상태 (분석메모 / 상세명세 각각)
  const [analyzeTab, setAnalyzeTab] = useState<"edit" | "preview">("edit");
  const [specTab,    setSpecTab]    = useState<"edit" | "preview">("edit");

  // 변경 이력 팝업 상태
  const [historyOpen,    setHistoryOpen]    = useState(false);
  const [diffTarget,     setDiffTarget]     = useState<HistoryItem | null>(null);
  const [confirmTarget,  setConfirmTarget]  = useState<HistoryItem | null>(null);
  const [deleteTarget,   setDeleteTarget]   = useState<HistoryItem | null>(null);

  // 파일 업로드 input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 과업 목록 조회 (taskId 선택용) ─────────────────────────────────────────
  const { data: tasksData } = useQuery({
    queryKey: ["tasks-for-select", projectId],
    queryFn:  () =>
      authFetch<{ data: { tasks: TaskOption[] } }>(
        `/api/projects/${projectId}/tasks`
      ).then((r) => r.data.tasks),
  });
  const taskOptions = tasksData ?? [];

  // ── 기존 요구사항 로드 (수정 모드) ─────────────────────────────────────────
  const { isLoading: isDetailLoading } = useQuery({
    queryKey: ["requirement", projectId, reqId],
    queryFn:  () =>
      authFetch<{ data: RequirementDetail }>(
        `/api/projects/${projectId}/requirements/${reqId}`
      ).then((r) => {
        const d = r.data;
        setForm({
          taskId:          d.taskId ?? undefined,
          name:            d.name,
          priority:        d.priority,
          source:          d.source,
          rfpPage:         d.rfpPage,
          // 기존 마크다운이면 HTML로 변환 (RichEditor는 HTML 저장)
          originalContent: d.originalContent && !d.originalContent.includes("<")
            ? renderMarkdown(d.originalContent) : (d.originalContent ?? ""),
          currentContent:  d.currentContent && !d.currentContent.includes("<")
            ? renderMarkdown(d.currentContent)  : (d.currentContent  ?? ""),
          analysisMemo:    d.analysisMemo,
          detailSpec:      d.detailSpec,
        });
        return d;
      }),
    enabled: !isNew,
  });

  // ── 첨부파일 목록 조회 ──────────────────────────────────────────────────────
  const { data: filesData, refetch: refetchFiles } = useQuery({
    queryKey: ["req-files", projectId, reqId],
    queryFn:  () =>
      authFetch<{ data: { items: AttachedFile[] } }>(
        `/api/projects/${projectId}/requirements/${reqId}/files`
      ).then((r) => r.data.items),
    enabled: !isNew,
  });
  const files = filesData ?? [];

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: SaveBody) =>
      isNew
        ? authFetch(`/api/projects/${projectId}/requirements`, {
            method: "POST",
            body:   JSON.stringify(body),
          })
        : authFetch(`/api/projects/${projectId}/requirements/${reqId}`, {
            method: "PUT",
            body:   JSON.stringify(body),
          }),
    onSuccess: () => {
      toast.success(isNew ? "요구사항이 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] });
      router.push(`/projects/${projectId}/requirements`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 변경 이력 조회 ─────────────────────────────────────────────────────────
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ["req-history", projectId, reqId],
    queryFn:  () =>
      authFetch<{ data: { items: HistoryItem[]; totalCount: number } }>(
        `/api/projects/${projectId}/requirements/${reqId}/history`
      ).then((r) => r.data),
    enabled: !isNew && historyOpen,
  });
  const historyItems = historyData?.items ?? [];

  // ── 이력 삭제 뮤테이션 ──────────────────────────────────────────────────────
  const deleteHistMutation = useMutation({
    mutationFn: (historyId: string) =>
      authFetch(`/api/projects/${projectId}/requirements/${reqId}/history/${historyId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("이력이 삭제되었습니다.");
      setDeleteTarget(null);
      refetchHistory();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 파일 삭제 뮤테이션 ──────────────────────────────────────────────────────
  const deleteFileMutation = useMutation({
    mutationFn: (fileId: string) =>
      authFetch(
        `/api/projects/${projectId}/requirements/${reqId}/files/${fileId}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      toast.success("파일이 삭제되었습니다.");
      refetchFiles();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 입력 핸들러 ────────────────────────────────────────────────────────────
  function handleChange(field: keyof SaveBody, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSave() {
    if (!form.name.trim()) {
      toast.error("요구사항명을 입력해 주세요.");
      return;
    }
    if (!form.priority) {
      toast.error("우선순위를 선택해 주세요.");
      return;
    }
    if (!form.source) {
      toast.error("출처를 선택해 주세요.");
      return;
    }
    saveMutation.mutate(form);
  }

  // ── 파일 업로드 ─────────────────────────────────────────────────────────────
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    // authFetch는 Content-Type: application/json을 강제하므로
    // 파일 업로드는 직접 fetch 사용 (브라우저가 multipart boundary 자동 설정)
    const at =
      typeof window !== "undefined"
        ? (sessionStorage.getItem("access_token") ?? "")
        : "";

    const formData = new FormData();
    for (const file of Array.from(selectedFiles)) {
      formData.append("files", file);
    }

    try {
      const res = await fetch(
        `/api/projects/${projectId}/requirements/${reqId}/files`,
        {
          method:  "POST",
          headers: at ? { Authorization: `Bearer ${at}` } : {},
          body:    formData,
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? "파일 업로드에 실패했습니다.");
      }
      toast.success("파일이 업로드되었습니다.");
      refetchFiles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "파일 업로드 중 오류가 발생했습니다.");
    } finally {
      // input 초기화 (같은 파일 재선택 가능하도록)
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── 파일 다운로드 ───────────────────────────────────────────────────────────
  function handleDownload(file: AttachedFile) {
    const at =
      typeof window !== "undefined"
        ? (sessionStorage.getItem("access_token") ?? "")
        : "";

    // <a> 태그를 동적 생성하여 다운로드 트리거
    const url = `/api/projects/${projectId}/requirements/${reqId}/files/${file.fileId}/download`;
    fetch(url, { headers: at ? { Authorization: `Bearer ${at}` } : {} })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.fileName;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => toast.error("파일 다운로드에 실패했습니다."));
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (!isNew && isDetailLoading) {
    return (
      <div style={{ padding: "40px 32px", color: "#888" }}>
        요구사항 정보를 불러오는 중...
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1400 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <button
          onClick={() => router.push(`/projects/${projectId}/requirements`)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)" }}
        >
          ←
        </button>
        <div style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>
          {isNew ? "요구사항 추가" : "요구사항 편집"}
        </div>
        {/* 변경 이력 팝업 버튼 — 신규 모드에서는 비표시 */}
        {!isNew && (
          <button
            onClick={() => setHistoryOpen(true)}
            style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 16px" }}
          >
            이력
          </button>
        )}
        {/* 취소 / 저장 — 헤더 우측 */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/requirements`)}
            disabled={saveMutation.isPending}
            style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 16px" }}
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            style={{ ...primaryBtnStyle, fontSize: 13, padding: "7px 20px" }}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* 2단 레이아웃: 왼쪽(기본정보+원문·현행화) / 오른쪽(분석메모·상세명세+근거파일) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 24, alignItems: "start" }}>

        {/* ── 왼쪽 컬럼 ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* ── AR-00043 기본 정보 ────────────────────────────────────────────── */}
          <Section title="기본 정보">
            {/* 상위 과업 선택 */}
            <FormField label="상위 과업">
              <select
                value={form.taskId ?? ""}
                onChange={(e) => handleChange("taskId", e.target.value || "")}
                style={inputStyle}
              >
                <option value="">미분류</option>
                {taskOptions.map((t) => (
                  <option key={t.taskId} value={t.taskId}>{t.name}</option>
                ))}
              </select>
            </FormField>

            {/* 요구사항명 */}
            <FormField label="요구사항명" required>
              <input
                type="text"
                value={form.name}
                placeholder="요구사항명을 입력하세요"
                onChange={(e) => handleChange("name", e.target.value)}
                style={inputStyle}
              />
            </FormField>

            {/* 우선순위 + 출처 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <FormField label="우선순위" required>
                <select
                  value={form.priority}
                  onChange={(e) => handleChange("priority", e.target.value)}
                  style={inputStyle}
                >
                  <option value="HIGH">높음 (HIGH)</option>
                  <option value="MEDIUM">중간 (MEDIUM)</option>
                  <option value="LOW">낮음 (LOW)</option>
                </select>
              </FormField>
              <FormField label="출처" required>
                <select
                  value={form.source}
                  onChange={(e) => handleChange("source", e.target.value)}
                  style={inputStyle}
                >
                  <option value="RFP">RFP</option>
                  <option value="ADD">추가</option>
                  <option value="CHANGE">변경</option>
                </select>
              </FormField>
              <FormField label="RFP 페이지 번호">
                <input
                  type="text"
                  value={form.rfpPage}
                  placeholder="예: p.23"
                  onChange={(e) => handleChange("rfpPage", e.target.value)}
                  style={inputStyle}
                />
              </FormField>
            </div>
          </Section>

          {/* ── AR-00044 원문·현행화 ──────────────────────────────────────────── */}
          <Section title="원문·현행화">
            {/* 탭 헤더 */}
            <div style={{ display: "flex", gap: 16, borderBottom: "1px solid var(--color-border)", marginBottom: 12 }}>
              {(["original", "current"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setContentTab(tab)}
                  style={{
                    padding:      "8px 6px",
                    border:       "none",
                    borderBottom: contentTab === tab ? "2px solid var(--color-primary, #1976d2)" : "2px solid transparent",
                    background:   "transparent",
                    color:        contentTab === tab ? "var(--color-primary, #1976d2)" : "var(--color-text-secondary)",
                    fontSize:     14,
                    fontWeight:   contentTab === tab ? 600 : 500,
                    cursor:       "pointer",
                    transition:   "all 0.2s ease",
                    marginBottom: -1,
                  }}
                >
                  {tab === "original" ? "원문 (RFP·계약서)" : "현행화 (협의·변경 뱐영)"}
                </button>
              ))}
            </div>

            {/* 에디터 본체 */}
            <div>
              {contentTab === "current" ? (
                <RichEditor
                  value={form.currentContent}
                  onChange={(html) => handleChange("currentContent", html)}
                  placeholder="협의 또는 변경 사항이 반영된 최신 내용을 입력하세요"
                  minHeight={338}
                />
              ) : (
                <RichEditor
                  value={form.originalContent}
                  onChange={(html) => handleChange("originalContent", html)}
                  placeholder="RFP 또는 계약서의 원문 그대로 입력하세요"
                  minHeight={338}
                />
              )}
            </div>
          </Section>

          {/* ── AR-00046 첨부파일 (수정 모드에서만) ────────────────────────── */}
          {!isNew && (
            <Section title="근거 파일">
              {files.length === 0 ? (
                <p style={{ fontSize: 13, color: "#aaa", margin: 0 }}>첨부파일이 없습니다.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {files.map((file) => (
                    <div
                      key={file.fileId}
                      style={{
                        display:      "flex",
                        alignItems:   "center",
                        gap:          12,
                        padding:      "8px 12px",
                        border:       "1px solid var(--color-border)",
                        borderRadius: 6,
                        background:   "var(--color-bg-muted)",
                      }}
                    >
                      <span style={{ flex: 1, fontSize: 13, wordBreak: "break-all" }}>
                        📎 {file.fileName}
                        <span style={{ color: "#aaa", marginLeft: 8, fontSize: 12 }}>
                          ({formatFileSize(file.fileSize)})
                        </span>
                      </span>
                      <button
                        onClick={() => handleDownload(file)}
                        style={{ ...secondaryBtnStyle, fontSize: 12, padding: "4px 10px" }}
                      >
                        다운로드
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`'${file.fileName}' 파일을 삭제하시겠습니까?`)) {
                            deleteFileMutation.mutate(file.fileId);
                          }
                        }}
                        disabled={deleteFileMutation.isPending}
                        style={{ ...dangerBtnStyle, fontSize: 12 }}
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 파일 첨부 버튼 */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={handleFileUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={secondaryBtnStyle}
              >
                + 파일 첨부
              </button>
            </Section>
          )}
        </div>

        {/* ── 오른쪽 컬럼 ───────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* ── AR-00045 분석메모·상세명세 ──────────────────────────────────── */}
          <Section title="분석 메모 · 상세 명세">
            {/* 분석 메모 */}
            <FormField label="분석 메모">
              <MarkdownEditor
                value={form.analysisMemo}
                tab={analyzeTab}
                onTabChange={setAnalyzeTab}
                onChange={(v) => handleChange("analysisMemo", v)}
                placeholder={`## 분석 내용\n\n- 항목1\n- 항목2`}
                rows={14}
              />
            </FormField>

            {/* 상세 명세 */}
            <FormField label="상세 명세">
              <MarkdownEditor
                value={form.detailSpec}
                tab={specTab}
                onTabChange={setSpecTab}
                onChange={(v) => handleChange("detailSpec", v)}
                placeholder={`## 기능 상세\n\n- 항목1\n- 항목2`}
                rows={18}
              />
            </FormField>
          </Section>
        </div>
      </div>

      {/* ── 변경 이력 팝업 ──────────────────────────────────────────────────── */}
      {historyOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setHistoryOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "90vw", maxWidth: 900, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "24px 28px", maxHeight: "85vh", display: "flex", flexDirection: "column" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>변경 이력</span>
              <button type="button" onClick={() => setHistoryOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#888" }}>×</button>
            </div>
            <div style={{ marginBottom: 12, fontSize: 13, color: "var(--color-text-secondary)" }}>총 {historyItems.length}건</div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {historyItems.length === 0 ? (
                <p style={{ color: "#aaa", fontSize: 13 }}>변경 이력이 없습니다.</p>
              ) : (
                <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "80px 70px 160px 1fr 1fr 190px", gap: 8, padding: "8px 14px", background: "var(--color-bg-muted)", fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid var(--color-border)" }}>
                    <div>버전</div><div>구분</div><div>변경일시</div><div>변경자</div><div>코멘트</div><div>액션</div>
                  </div>
                  {historyItems.map((item, idx) => (
                    <div key={item.historyId} style={{ display: "grid", gridTemplateColumns: "80px 70px 160px 1fr 1fr 190px", gap: 8, padding: "10px 14px", alignItems: "center", background: "var(--color-bg-card)", borderTop: idx === 0 ? "none" : "1px solid var(--color-border)" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{item.versionNo}</div>
                      <div>
                        <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: item.versionType === "CONFIRMED" ? "#e3f2fd" : "#f3e5f5", color: item.versionType === "CONFIRMED" ? "#1565c0" : "#6a1b9a" }}>
                          {item.versionType === "CONFIRMED" ? "확정" : "내부"}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                        {new Date(item.changedAt).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.changerEmail || "-"}</div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.comment || "-"}</div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => setDiffTarget(item)} style={{ ...histGhostBtn }}>Diff</button>
                        {item.versionType === "INTERNAL" && (
                          <>
                            <button onClick={() => setConfirmTarget(item)} style={{ ...histGhostBtn, color: "#1565c0", borderColor: "#1565c0" }}>확정</button>
                            <button onClick={() => setDeleteTarget(item)} style={{ ...histGhostBtn, color: "#e53935", borderColor: "#e53935" }}>삭제</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Diff 뷰어 팝업 */}
      {diffTarget && (
        <ReqDiffViewerPopup
          projectId={projectId}
          reqId={reqId}
          items={historyItems}
          initialItem={diffTarget}
          onClose={() => setDiffTarget(null)}
        />
      )}

      {/* 확정 팝업 */}
      {confirmTarget && (
        <ReqConfirmPopup
          projectId={projectId}
          reqId={reqId}
          item={confirmTarget}
          items={historyItems}
          onClose={() => setConfirmTarget(null)}
          onSuccess={() => {
            setConfirmTarget(null);
            refetchHistory();
          }}
        />
      )}

      {/* 삭제 확인 팝업 */}
      {deleteTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setDeleteTarget(null)}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", minWidth: 360, maxWidth: 460, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>이력을 삭제하시겠습니까?</h3>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: "var(--color-text-secondary)" }}>{deleteTarget.versionNo} 버전을 삭제합니다.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} disabled={deleteHistMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 13 }}>취소</button>
              <button onClick={() => deleteHistMutation.mutate(deleteTarget.historyId)} disabled={deleteHistMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 13, background: "#e53935", color: "#fff", border: "none" }}>
                {deleteHistMutation.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border:       "1px solid var(--color-border)",
        borderRadius: 8,
        padding:      "20px 24px",
        background:   "var(--color-bg-card)",
        display:      "flex",
        flexDirection: "column",
        gap:          16,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function FormField({
  label, required, children,
}: {
  label:    string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
        {label}
        {required && <span style={{ color: "#e53935", marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

// ── 마크다운 에디터 (편집/미리보기 탭) ──────────────────────────────────────

function MarkdownEditor({
  value, tab, onTabChange, onChange, placeholder, rows,
}: {
  value:        string;
  tab:          "edit" | "preview";
  onTabChange:  (t: "edit" | "preview") => void;
  onChange:     (v: string) => void;
  placeholder:  string;
  rows:         number;
}) {
  return (
    <div>
      {/* 탭 */}
      <div style={{ display: "flex", gap: 16, borderBottom: "1px solid var(--color-border)", marginBottom: 12 }}>
        {(["edit", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTabChange(t)}
            style={{
              padding:      "6px 4px",
              border:       "none",
              borderBottom: tab === t ? "2px solid var(--color-primary, #1976d2)" : "2px solid transparent",
              background:   "transparent",
              color:        tab === t ? "var(--color-primary, #1976d2)" : "var(--color-text-secondary)",
              fontSize:     13,
              fontWeight:   tab === t ? 600 : 500,
              cursor:       "pointer",
              transition:   "all 0.2s ease",
              marginBottom: -1,
            }}
          >
            {t === "edit" ? "편집" : "미리보기"}
          </button>
        ))}
      </div>

      {tab === "edit" ? (
        <textarea
          value={value}
          placeholder={placeholder}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          style={{
            ...inputStyle,
            resize:      "vertical",
            fontFamily:  "monospace",
            fontSize:    13,
            borderRadius: 6,
          }}
        />
      ) : (
        <div
          className="sp-markdown"
          style={{
            ...inputStyle,
            minHeight:    rows * 24,
            maxHeight:    600,
            borderRadius: 6,
            padding:      "12px 16px",
            overflowY:    "auto",
          }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) || "<p style='color:#aaa;font-size:13px'>내용 없음</p>" }}
        />
      )}
    </div>
  );
}


// ── 파일 크기 포맷 ───────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024)         return `${bytes} B`;
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Diff 뷰어 팝업 ────────────────────────────────────────────────────────────

function ReqDiffViewerPopup({
  projectId, reqId, items, initialItem, onClose,
}: {
  projectId:   string;
  reqId:       string;
  items:       HistoryItem[];
  initialItem: HistoryItem;
  onClose:     () => void;
}) {
  const initialIdx = items.findIndex((i) => i.historyId === initialItem.historyId);
  const prevItem   = items[initialIdx + 1];
  const [v1Id, setV1Id] = useState<string>(prevItem?.historyId ?? items[items.length - 1]?.historyId ?? "");
  const [v2Id, setV2Id] = useState<string>(initialItem.historyId);
  const sameSelected    = v1Id === v2Id;

  const { data, isLoading } = useQuery({
    queryKey: ["req-history-diff", projectId, reqId, v1Id, v2Id],
    queryFn:  () =>
      authFetch<{ data: DiffResult }>(
        `/api/projects/${projectId}/requirements/${reqId}/history/diff?v1=${v1Id}&v2=${v2Id}`
      ).then((r) => r.data),
    enabled: !!v1Id && !!v2Id && !sameSelected,
  });

  const selStyle: React.CSSProperties = { padding: "7px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 13 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", overflowY: "auto", justifyContent: "center" }}
      onClick={onClose}>
      <div
        style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", width: "90vw", maxWidth: 1100, margin: "40px auto", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>버전 비교 (Diff)</h3>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, fontSize: 13 }}>닫기</button>
        </div>
        <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "center" }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>좌측 버전</label>
            <select value={v1Id} onChange={(e) => setV1Id(e.target.value)} style={selStyle}>
              {items.map((i) => <option key={i.historyId} value={i.historyId}>{i.versionNo} ({i.versionType === "CONFIRMED" ? "확정" : "내부"})</option>)}
            </select>
          </div>
          <div style={{ marginTop: 16, fontSize: 18, color: "var(--color-text-secondary)" }}>↔</div>
          <div>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>우측 버전</label>
            <select value={v2Id} onChange={(e) => setV2Id(e.target.value)} style={selStyle}>
              {items.map((i) => <option key={i.historyId} value={i.historyId}>{i.versionNo} ({i.versionType === "CONFIRMED" ? "확정" : "내부"})</option>)}
            </select>
          </div>
        </div>
        {sameSelected && <div style={{ padding: "16px 0", textAlign: "center", color: "#f57c00", fontSize: 14 }}>서로 다른 버전을 선택해 주세요.</div>}
        {isLoading && !sameSelected && <div style={{ padding: "16px 0", textAlign: "center", color: "#888" }}>로딩 중...</div>}
        {data && !sameSelected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {([
              { label: "원문 (orgnl_cn)",     l: data.v1Content.orgnlCn,  r: data.v2Content.orgnlCn  },
              { label: "현행화 (curncy_cn)",  l: data.v1Content.curncyCn, r: data.v2Content.curncyCn },
              { label: "상세 명세 (spec_cn)", l: data.v1Content.specCn,   r: data.v2Content.specCn   },
            ] as { label: string; l: string; r: string }[]).map(({ label, l, r }) => (
              <ReqDiffSection key={label} label={label} leftText={l} rightText={r}
                leftVersion={data.v1Content.versionNo} rightVersion={data.v2Content.versionNo} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReqDiffSection({ label, leftText, rightText, leftVersion, rightVersion }: {
  label: string; leftText: string; rightText: string; leftVersion: string; rightVersion: string;
}) {
  const leftLines  = leftText.split("\n");
  const rightLines = rightText.split("\n");
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--color-text-secondary)" }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ borderRight: "1px solid var(--color-border)" }}>
          <div style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>{leftVersion} (이전)</div>
          <pre style={{ margin: 0, padding: "10px 12px", fontSize: 12, lineHeight: 1.6, fontFamily: "inherit", whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 48, background: "transparent" }}>
            {leftLines.map((line, i) => {
              const inRight = rightLines.includes(line);
              return <span key={i} style={{ display: "block", background: !inRight && line ? "rgba(229,57,53,0.12)" : "transparent", color: !inRight && line ? "#c62828" : "inherit", textDecoration: !inRight && line ? "line-through" : "none" }}>{line || " "}</span>;
            })}
          </pre>
        </div>
        <div>
          <div style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>{rightVersion} (이후)</div>
          <pre style={{ margin: 0, padding: "10px 12px", fontSize: 12, lineHeight: 1.6, fontFamily: "inherit", whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 48, background: "transparent" }}>
            {rightLines.map((line, i) => {
              const inLeft = leftLines.includes(line);
              return <span key={i} style={{ display: "block", background: !inLeft && line ? "rgba(46,125,50,0.12)" : "transparent", color: !inLeft && line ? "#2e7d32" : "inherit" }}>{line || " "}</span>;
            })}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── 확정 팝업 ─────────────────────────────────────────────────────────────────

function ReqConfirmPopup({ projectId, reqId, item, items, onClose, onSuccess }: {
  projectId: string; reqId: string; item: HistoryItem; items: HistoryItem[];
  onClose: () => void; onSuccess: () => void;
}) {
  const [comment, setComment] = useState("");
  const lastConfirmedVersion  = items
    .filter((i) => i.versionType === "CONFIRMED")
    .map((i) => parseInt(i.versionNo.replace("V", ""), 10))
    .filter((n) => !isNaN(n))
    .reduce((max, n) => Math.max(max, n), 1);
  const nextVersion = `V${lastConfirmedVersion + 1}`;

  const confirmMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/requirements/${reqId}/history/${item.historyId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      }),
    onSuccess: () => {
      toast.success(`${nextVersion}으로 확정되었습니다.`);
      onSuccess();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", minWidth: 360, maxWidth: 480, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>버전 확정</h3>
        <p style={{ margin: "0 0 8px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          <strong style={{ color: "var(--color-text-primary)" }}>{item.versionNo}</strong>
          {" → "}
          <strong style={{ color: "#1565c0" }}>{nextVersion}</strong>
          {" 으로 확정합니다."}
        </p>
        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
          확정 코멘트 <span style={{ fontWeight: 400, color: "#888" }}>(선택)</span>
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="확정 사유를 입력해 주세요..."
          rows={4}
          style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} disabled={confirmMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 13 }}>취소</button>
          <button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 13, background: "var(--color-primary, #1976d2)", color: "#fff", border: "none" }}>
            {confirmMutation.isPending ? "처리 중..." : "확정"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "8px 12px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  boxSizing:    "border-box",
  outline:      "none",
};

const primaryBtnStyle: React.CSSProperties = {
  padding:      "8px 24px",
  borderRadius: 6,
  border:       "none",
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  fontSize:     14,
  fontWeight:   600,
  cursor:       "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding:      "8px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  cursor:       "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding:      "4px 10px",
  borderRadius: 4,
  border:       "1px solid #e53935",
  background:   "transparent",
  color:        "#e53935",
  fontSize:     13,
  cursor:       "pointer",
};

const histGhostBtn: React.CSSProperties = {
  padding:      "2px 8px",
  borderRadius: 4,
  border:       "1px solid var(--color-border)",
  background:   "none",
  color:        "var(--color-text-secondary)",
  fontSize:     11,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};
