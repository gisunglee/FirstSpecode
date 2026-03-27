"use client";

/**
 * RequirementDetailPage — 요구사항 상세·편집 (PID-00031)
 *
 * 역할:
 *   - 신규: reqId = "new" → POST (FID-00103 신규)
 *   - 수정: reqId 존재 → GET 로드(FID-00102) → PUT (FID-00103 수정 + 이력)
 *   - 원문·현행화 편집 (FID-00104)
 *   - AI spec 초안 생성 (FID-00105, stub)
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
        {/* 변경 이력 탭 진입 (PID-00035) — 신규 모드에서는 비활성 */}
        {!isNew && (
          <button
            onClick={() => router.push(`/projects/${projectId}/requirements/${reqId}/history`)}
            style={{
              padding:      "7px 16px",
              borderRadius: 6,
              border:       "1px solid var(--color-border)",
              background:   "var(--color-bg-card)",
              color:        "var(--color-text-primary)",
              fontSize:     13,
              cursor:       "pointer",
            }}
          >
            변경 이력
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
