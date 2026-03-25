"use client";

/**
 * UnitWorkDetailPage — 단위업무 상세·편집 (PID-00041)
 *
 * 역할:
 *   - 신규: unitWorkId = "new" → POST (FID-00130 신규)
 *   - 수정: unitWorkId 존재 → GET 로드(FID-00130 조회) → PUT (FID-00130 수정)
 *   - 진행률·기간 등 전체 필드 편집
 *
 * 주요 기술:
 *   - TanStack Query: 상세 조회 및 캐시 무효화
 *   - useSearchParams: new 모드 시 reqId pre-select 지원
 */

import { Suspense, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type RequirementOption = {
  requirementId: string;
  displayId:     string;
  name:          string;
};

type UnitWorkDetail = {
  unitWorkId:     string;
  displayId:      string;
  name:           string;
  description:    string;
  assignMemberId: string | null;
  startDate:      string | null;
  endDate:        string | null;
  progress:       number;
  reqId:          string;
  reqDisplayId:   string;
  reqName:        string;
  screens: {
    screenId:  string;
    displayId: string;
    name:      string;
    type:      string;
    urlPath:   string;
  }[];
};

type SaveBody = {
  reqId:           string;
  name:            string;
  description:     string;
  assignMemberId?: string;
  startDate?:      string;
  endDate?:        string;
  progress:        number;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function UnitWorkDetailPage() {
  return (
    <Suspense fallback={null}>
      <UnitWorkDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function UnitWorkDetailPageInner() {
  const params        = useParams<{ id: string; unitWorkId: string }>();
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const queryClient   = useQueryClient();
  const projectId     = params.id;
  const unitWorkId    = params.unitWorkId;
  const isNew         = unitWorkId === "new";

  // useSearchParams()는 Suspense 안에서만 동작 — 페이지 래퍼에서 보장됨
  // new 모드: URL의 reqId 파라미터로 상위 요구사항 pre-select
  const presetReqId = searchParams.get("reqId") ?? "";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<SaveBody>({
    reqId:       presetReqId,
    name:        "",
    description: "",
    progress:    0,
  });

  // ── 요구사항 목록 조회 (reqId 선택용) ───────────────────────────────────────
  const { data: reqData } = useQuery({
    queryKey: ["requirements-for-select", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: RequirementOption[] } }>(
        `/api/projects/${projectId}/requirements`
      ).then((r) => r.data.items),
  });
  const reqOptions = reqData ?? [];

  // ── 기존 단위업무 로드 (수정 모드) ─────────────────────────────────────────
  const { isLoading: isDetailLoading } = useQuery({
    queryKey: ["unit-work", projectId, unitWorkId],
    queryFn:  () =>
      authFetch<{ data: UnitWorkDetail }>(
        `/api/projects/${projectId}/unit-works/${unitWorkId}`
      ).then((r) => {
        const d = r.data;
        setForm({
          reqId:           d.reqId,
          name:            d.name,
          description:     d.description,
          assignMemberId:  d.assignMemberId ?? undefined,
          startDate:       d.startDate ?? undefined,
          endDate:         d.endDate ?? undefined,
          progress:        d.progress,
        });
        return d;
      }),
    enabled: !isNew,
  });

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: SaveBody) =>
      isNew
        ? authFetch(`/api/projects/${projectId}/unit-works`, {
            method: "POST",
            body:   JSON.stringify(body),
          })
        : authFetch(`/api/projects/${projectId}/unit-works/${unitWorkId}`, {
            method: "PUT",
            body:   JSON.stringify(body),
          }),
    onSuccess: () => {
      toast.success(isNew ? "단위업무가 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["unit-works", projectId] });
      router.push(`/projects/${projectId}/unit-works`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 입력 핸들러 ────────────────────────────────────────────────────────────
  function handleChange(field: keyof SaveBody, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSave() {
    if (!form.reqId) {
      toast.error("상위 요구사항을 선택해 주세요.");
      return;
    }
    if (!form.name.trim()) {
      toast.error("단위업무명을 입력해 주세요.");
      return;
    }
    saveMutation.mutate(form);
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (!isNew && isDetailLoading) {
    return (
      <div style={{ padding: "40px 32px", color: "#888" }}>
        단위업무 정보를 불러오는 중...
      </div>
    );
  }

  return (
    <div style={{ padding: "32px", maxWidth: 900 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <button
          onClick={() => router.push(`/projects/${projectId}/unit-works`)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#666" }}
        >
          ←
        </button>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>
          {isNew ? "단위업무 등록" : "단위업무 편집"}
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/unit-works`)}
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
        {/* 상위 요구사항 선택 */}
        <FormField label="상위 요구사항" required>
          <select
            value={form.reqId}
            onChange={(e) => handleChange("reqId", e.target.value)}
            style={inputStyle}
          >
            <option value="">요구사항을 선택하세요</option>
            {reqOptions.map((r) => (
              <option key={r.requirementId} value={r.requirementId}>
                {r.displayId} — {r.name}
              </option>
            ))}
          </select>
        </FormField>

        {/* 단위업무명 */}
        <FormField label="단위업무명" required>
          <input
            type="text"
            value={form.name}
            placeholder="단위업무명을 입력하세요"
            onChange={(e) => handleChange("name", e.target.value)}
            style={inputStyle}
          />
        </FormField>

        {/* 설명 */}
        <FormField label="설명">
          <textarea
            value={form.description}
            placeholder="단위업무 설명 (선택)"
            rows={4}
            onChange={(e) => handleChange("description", e.target.value)}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
        </FormField>

        {/* 기간 + 진행률 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <FormField label="시작일">
            <input
              type="date"
              value={form.startDate ?? ""}
              onChange={(e) => handleChange("startDate", e.target.value)}
              style={inputStyle}
            />
          </FormField>
          <FormField label="종료일">
            <input
              type="date"
              value={form.endDate ?? ""}
              onChange={(e) => handleChange("endDate", e.target.value)}
              style={inputStyle}
            />
          </FormField>
          <FormField label="진행률 (%)">
            <input
              type="number"
              min={0}
              max={100}
              value={form.progress}
              onChange={(e) => handleChange("progress", parseInt(e.target.value) || 0)}
              style={inputStyle}
            />
          </FormField>
        </div>

        {/* 진행률 바 (시각적 피드백) */}
        <div>
          <div style={{ height: 6, background: "var(--color-bg-muted)", borderRadius: 3, overflow: "hidden" }}>
            <div
              style={{
                height:     "100%",
                width:      `${form.progress}%`,
                background: form.progress === 100 ? "#2e7d32" : "var(--color-primary, #1976d2)",
                transition: "width 0.3s",
                borderRadius: 3,
              }}
            />
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4 }}>
            {form.progress}%
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────────────────

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

// ── 스타일 ────────────────────────────────────────────────────────────────────

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
