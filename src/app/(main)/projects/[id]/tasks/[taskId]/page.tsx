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
import { useAppStore } from "@/store/appStore";
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

  const { setBreadcrumb } = useAppStore();

  // ── 기존 과업 로드 (수정 모드) ──────────────────────────────────────────────
  const { isLoading, data: taskDetail } = useQuery({
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

  // ── 복사 뮤테이션 ──────────────────────────────────────────────────────────
  const copyMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/tasks/${taskId}/copy`, { method: "POST" }),
    onSuccess: () => {
      toast.success("복사되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      router.push(`/projects/${projectId}/tasks`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 상태 + 뮤테이션 ──────────────────────────────────────────────────
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteType, setDeleteType] = useState<"ALL" | "TASK_ONLY">("ALL");

  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(
        `/api/projects/${projectId}/tasks/${taskId}?deleteType=${deleteType}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      router.push(`/projects/${projectId}/tasks`);
    },
    onError: (err: Error) => toast.error(err.message),
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

  // ── GNB 브레드크럼 ─────────────────────────────────────────────────────────
  // 분석 계층 네비: [과업 목록] > [현재 과업] > [요구사항 목록(하위로 이동)]
  // - 과업과 요구사항은 1:N 관계. 현재 과업 하위 요구사항으로 바로 이동할 수 있도록
  //   마지막에 "요구사항 목록" 링크를 둔다.
  // - 신규 등록 모드에서는 하위로 이동할 맥락이 없으므로 링크를 생략한다.
  useEffect(() => {
    const items = [
      // 상위: 과업 목록
      { label: "과업", href: `/projects/${projectId}/tasks` },
      // 현재: 과업 상세 (href 없음 = 현재 위치 표시)
      { label: isNew ? "신규 등록" : (taskDetail?.displayId ?? "편집") },
      // 하위: 요구사항 목록 (수정 모드에서만 노출)
      ...(isNew
        ? []
        : [{ label: "요구사항 목록", href: `/projects/${projectId}/requirements` }]),
    ];
    setBreadcrumb(items);
    return () => setBreadcrumb([]);
  }, [projectId, isNew, taskDetail?.displayId, setBreadcrumb]);

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (!isNew && isLoading) {
    return (
      <div style={{ padding: "40px 32px", color: "#888" }}>
        과업 정보를 불러오는 중...
      </div>
    );
  }

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 타이틀 바 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/tasks`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#666", lineHeight: 1, padding: "2px 4px" }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "과업 추가" : "과업 수정"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/tasks`)}
            disabled={saveMutation.isPending}
            style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
          >
            취소
          </button>
          {!isNew && (
            <button
              onClick={() => copyMutation.mutate()}
              disabled={copyMutation.isPending || saveMutation.isPending}
              style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
            >
              {copyMutation.isPending ? "복사 중..." : "복사"}
            </button>
          )}
          {!isNew && (
            <button
              onClick={() => { setDeleteType("ALL"); setDeleteDialogOpen(true); }}
              disabled={saveMutation.isPending}
              style={{ fontSize: 12, padding: "5px 14px", borderRadius: 6, border: "1px solid #e53935", background: "transparent", color: "#e53935", cursor: "pointer" }}
            >
              삭제
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <div style={{ padding: "0 24px 24px", maxWidth: 760 }}>
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
              style={selectStyle}
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

      {/* 삭제 확인 다이얼로그 */}
      {deleteDialogOpen && (
        <div
          onClick={() => setDeleteDialogOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", minWidth: 340, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "var(--color-text-primary)" }}>과업 삭제</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20 }}>
              <strong>{form.name}</strong> 과업을 삭제합니다.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {(["ALL", "TASK_ONLY"] as const).map((type) => (
                <label key={type} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                  <input
                    type="radio"
                    name="deleteType"
                    value={type}
                    checked={deleteType === type}
                    onChange={() => setDeleteType(type)}
                  />
                  {type === "ALL" ? "전체 삭제 (연결된 요구사항 포함)" : "과업만 삭제"}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setDeleteDialogOpen(false)}
                style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
              >
                취소
              </button>
              <button
                onClick={() => { setDeleteDialogOpen(false); deleteMutation.mutate(); }}
                disabled={deleteMutation.isPending}
                style={{ fontSize: 13, padding: "6px 16px", borderRadius: 6, border: "none", background: "#e53935", color: "#fff", cursor: "pointer", fontWeight: 600 }}
              >
                {deleteMutation.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
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

// select 전용 — 브라우저 기본 화살표를 제거하고 커스텀 화살표로 대체
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  paddingRight:       "32px",
  appearance:         "none",
  WebkitAppearance:   "none",
  backgroundImage:    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 10px center",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 24px",
  borderRadius: 6,
  border: "1px solid transparent",
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
