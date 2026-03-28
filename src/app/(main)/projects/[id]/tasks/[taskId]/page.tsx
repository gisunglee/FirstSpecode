"use client";

/**
 * TaskDetailPage — 과업 상세·편집 (PID-00029)
 *
 * 역할:
 *   - 신규: taskId = "new" → POST (FID-00097 신규)
 *   - 수정: taskId 존재 → GET 로드(FID-00096) → PUT (FID-00097 수정)
 *   - 세부내용: RichEditor(TipTap) WYSIWYG — 클립보드 이미지 붙여넣기 지원
 */

import { Suspense, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { renderMarkdown } from "@/lib/renderMarkdown";
import RichEditor from "@/components/ui/RichEditor";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type TaskDetail = {
  taskId:     string;
  displayId:  string;
  name:       string;
  category:   string;
  definition: string | null;
  content:    string | null;
  outputInfo: string | null;
  rfpPage:    string | null;
};

type SaveBody = {
  name:       string;
  category:   string;
  definition: string;
  content:    string;
  outputInfo: string;
  rfpPage:    string;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function TaskDetailPage() {
  return (
    <Suspense fallback={null}>
      <TaskDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function TaskDetailPageInner() {
  const params      = useParams<{ id: string; taskId: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const projectId   = params.id;
  const taskId      = params.taskId;
  const isNew       = taskId === "new";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<SaveBody>({
    name: "", category: "NEW_DEV",
    definition: "", content: "", outputInfo: "", rfpPage: "",
  });

  // ── 기존 과업 로드 (수정 모드) ──────────────────────────────────────────────
  const { isLoading } = useQuery({
    queryKey: ["task", projectId, taskId],
    queryFn:  () =>
      authFetch<{ data: TaskDetail }>(
        `/api/projects/${projectId}/tasks/${taskId}`
      ).then((r) => {
        const d = r.data;
        // content가 기존 마크다운이면 HTML로 변환 후 에디터에 주입
        // HTML 여부: '<' 포함 여부로 판별 (TipTap은 항상 HTML 저장)
        const rawContent = d.content ?? "";
        const content = rawContent && !rawContent.includes("<")
          ? renderMarkdown(rawContent)
          : rawContent;
        setForm({
          name:       d.name,
          category:   d.category,
          definition: d.definition ?? "",
          content,
          outputInfo: d.outputInfo ?? "",
          rfpPage:    d.rfpPage ?? "",
        });
        return d;
      }),
    enabled: !isNew,
  });

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: SaveBody) =>
      isNew
        ? authFetch(`/api/projects/${projectId}/tasks`, {
            method: "POST",
            body: JSON.stringify(body),
          })
        : authFetch(`/api/projects/${projectId}/tasks/${taskId}`, {
            method: "PUT",
            body: JSON.stringify(body),
          }),
    onSuccess: () => {
      toast.success(isNew ? "과업이 생성되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      router.push(`/projects/${projectId}/tasks`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 입력 핸들러 ────────────────────────────────────────────────────────────
  function handleChange(field: keyof SaveBody, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSave() {
    if (!form.name.trim()) {
      toast.error("과업명을 입력해 주세요.");
      return;
    }
    if (!form.category) {
      toast.error("카테고리를 선택해 주세요.");
      return;
    }
    saveMutation.mutate(form);
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (!isNew && isLoading) {
    return (
      <div style={{ padding: "40px 32px", color: "#888" }}>
        과업 정보를 불러오는 중...
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 24px", maxWidth: 760 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <button
          onClick={() => router.push(`/projects/${projectId}/tasks`)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#666" }}
        >
          ←
        </button>
        <div style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>
          {isNew ? "과업 추가" : "과업 수정"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/tasks`)}
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

      {/* 폼 */}
      <div
        style={{
          border:        "1px solid var(--color-border)",
          borderRadius:  8,
          padding:       "24px 28px",
          background:    "var(--color-bg-card)",
          display:       "flex",
          flexDirection: "column",
          gap:           20,
        }}
      >

        {/* 과업명 */}
        <FormField label="과업명" required>
          <input
            type="text"
            value={form.name}
            placeholder="과업명을 입력하세요"
            onChange={(e) => handleChange("name", e.target.value)}
            style={inputStyle}
          />
        </FormField>

        {/* 카테고리 + RFP 페이지 번호 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FormField label="카테고리" required>
            <select
              value={form.category}
              onChange={(e) => handleChange("category", e.target.value)}
              style={inputStyle}
            >
              <option value="NEW_DEV">신규개발</option>
              <option value="IMPROVE">기능개선</option>
              <option value="MAINTAIN">유지보수</option>
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

        {/* 정의 */}
        <FormField label="정의">
          <textarea
            value={form.definition}
            placeholder="과업 범위를 간략히 설명하세요"
            rows={3}
            onChange={(e) => handleChange("definition", e.target.value)}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </FormField>

        {/* 세부내용 — WYSIWYG 에디터 (클립보드 이미지 붙여넣기 지원) */}
        <FormField label="세부내용">
          <RichEditor
            value={form.content}
            onChange={(html) => handleChange("content", html)}
            placeholder="내용을 입력하세요. 이미지는 클립보드에서 바로 붙여넣기 가능합니다."
            minHeight={280}
          />
        </FormField>

        {/* 산출물 */}
        <FormField label="산출물">
          <textarea
            value={form.outputInfo}
            placeholder="예: 화면설계서, ERD, API 명세서"
            rows={3}
            onChange={(e) => handleChange("outputInfo", e.target.value)}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </FormField>

      </div>
    </div>
  );
}

// ── FormField 래퍼 ───────────────────────────────────────────────────────────

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

// ── 간단한 마크다운 → HTML 변환기 (FID-00098) ────────────────────────────────
// 외부 라이브러리 없이 기본 마크다운 요소만 지원:

// ── 스타일 ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 14,
  boxSizing: "border-box",
  outline: "none",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 24px",
  borderRadius: 6,
  border: "none",
  background: "var(--color-primary, #1976d2)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 14,
  cursor: "pointer",
};
