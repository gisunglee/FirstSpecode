"use client";

/**
 * ScreenDetailPage — 화면 상세·편집 (PID-00044)
 *
 * 역할:
 *   - 신규: screenId = "new" → POST (FID-00147 신규)
 *   - 수정: screenId 존재 → GET 로드(FID-00146) → PUT (FID-00147 수정 + 이력)
 *   - 하단 영역 목록 조회 (AR-00066, FID-00148) — 수정 모드에서만 표시
 *   - 영역 상세 이동 (FID-00149)
 *
 * 주요 기술:
 *   - TanStack Query: 상세 조회 및 캐시 무효화
 *   - useSearchParams: new 모드 시 unitWorkId pre-select 지원
 */

import { Suspense, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type UnitWorkOption = {
  unitWorkId: string;
  displayId:  string;
  name:       string;
};

type AreaRow = {
  areaId:    string;
  displayId: string;
  name:      string;
  type:      string;
  sortOrder: number;
};

type ScreenDetail = {
  screenId:     string;
  displayId:    string;
  name:         string;
  description:  string;
  displayCode:  string;
  type:         string;
  categoryL:    string;
  categoryM:    string;
  categoryS:    string;
  unitWorkId:   string | null;
  unitWorkName: string;
  areas:        AreaRow[];
};

type SaveBody = {
  unitWorkId?:  string;
  name:         string;
  displayCode:  string;
  type:         string;
  categoryL:    string;
  categoryM:    string;
  categoryS:    string;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function ScreenDetailPage() {
  return (
    <Suspense fallback={null}>
      <ScreenDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function ScreenDetailPageInner() {
  const params       = useParams<{ id: string; screenId: string }>();
  const searchParams = useSearchParams();
  const router       = useRouter();
  const queryClient  = useQueryClient();
  const projectId    = params.id;
  const screenId     = params.screenId;
  const isNew        = screenId === "new";

  // useSearchParams()는 Suspense 안에서만 동작 — 페이지 래퍼에서 보장됨
  const presetUnitWorkId = searchParams.get("unitWorkId") ?? "";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<SaveBody>({
    unitWorkId:  presetUnitWorkId || undefined,
    name:        "",
    displayCode: "",
    type:        "LIST",
    categoryL:   "",
    categoryM:   "",
    categoryS:   "",
  });

  // ── 단위업무 목록 조회 (단위업무 선택용) ─────────────────────────────────────
  const { data: uwData } = useQuery({
    queryKey: ["unit-works-for-select", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: UnitWorkOption[] } }>(
        `/api/projects/${projectId}/unit-works`
      ).then((r) => r.data.items),
  });
  const uwOptions = uwData ?? [];

  // ── 기존 화면 로드 (수정 모드) ─────────────────────────────────────────────
  const { data: detail, isLoading: isDetailLoading } = useQuery({
    queryKey: ["screen", projectId, screenId],
    queryFn:  () =>
      authFetch<{ data: ScreenDetail }>(
        `/api/projects/${projectId}/screens/${screenId}`
      ).then((r) => {
        const d = r.data;
        setForm({
          unitWorkId:  d.unitWorkId ?? undefined,
          name:        d.name,
          displayCode: d.displayCode,
          type:        d.type,
          categoryL:   d.categoryL,
          categoryM:   d.categoryM,
          categoryS:   d.categoryS,
        });
        return d;
      }),
    enabled: !isNew,
  });

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: SaveBody) =>
      isNew
        ? authFetch(`/api/projects/${projectId}/screens`, {
            method: "POST",
            body:   JSON.stringify(body),
          })
        : authFetch(`/api/projects/${projectId}/screens/${screenId}`, {
            method: "PUT",
            body:   JSON.stringify(body),
          }),
    onSuccess: () => {
      toast.success(isNew ? "화면이 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["screens", projectId] });
      router.push(`/projects/${projectId}/screens`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleChange(field: keyof SaveBody, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSave() {
    if (!form.name.trim()) {
      toast.error("화면명을 입력해 주세요.");
      return;
    }
    saveMutation.mutate(form);
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (!isNew && isDetailLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>화면 정보를 불러오는 중...</div>;
  }

  return (
    <div style={{ padding: "32px", maxWidth: 1000 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <button
          onClick={() => router.push(`/projects/${projectId}/screens`)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#666" }}
        >
          ←
        </button>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>
          {isNew ? "화면 등록" : "화면 편집"}
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/screens`)}
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

      {/* AR-00065 기본 정보 폼 */}
      <Section title="기본 정보">
        {/* 상위 단위업무 선택 */}
        <FormField label="상위 단위업무">
          <select
            value={form.unitWorkId ?? ""}
            onChange={(e) => handleChange("unitWorkId", e.target.value)}
            style={inputStyle}
          >
            <option value="">미분류</option>
            {uwOptions.map((uw) => (
              <option key={uw.unitWorkId} value={uw.unitWorkId}>
                {uw.displayId} — {uw.name}
              </option>
            ))}
          </select>
        </FormField>

        {/* 화면명 */}
        <FormField label="화면명" required>
          <input
            type="text"
            value={form.name}
            placeholder="화면명을 입력하세요"
            onChange={(e) => handleChange("name", e.target.value)}
            style={inputStyle}
          />
        </FormField>

        {/* 표시코드 + 화면 유형 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FormField label="표시코드">
            <input
              type="text"
              value={form.displayCode}
              placeholder="예: MBR_LIST"
              onChange={(e) => handleChange("displayCode", e.target.value)}
              style={inputStyle}
            />
          </FormField>
          <FormField label="화면 유형">
            <select
              value={form.type}
              onChange={(e) => handleChange("type", e.target.value)}
              style={inputStyle}
            >
              <option value="LIST">LIST</option>
              <option value="DETAIL">DETAIL</option>
              <option value="INPUT">INPUT</option>
              <option value="POPUP">POPUP</option>
              <option value="TAB">TAB</option>
              <option value="REPORT">REPORT</option>
            </select>
          </FormField>
        </div>

        {/* 메뉴 분류 (대/중/소) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <FormField label="대분류">
            <input
              type="text"
              value={form.categoryL}
              placeholder="예: 회원 관리"
              onChange={(e) => handleChange("categoryL", e.target.value)}
              style={inputStyle}
            />
          </FormField>
          <FormField label="중분류">
            <input
              type="text"
              value={form.categoryM}
              placeholder="예: 회원 정보"
              onChange={(e) => handleChange("categoryM", e.target.value)}
              style={inputStyle}
            />
          </FormField>
          <FormField label="소분류">
            <input
              type="text"
              value={form.categoryS}
              placeholder="예: 목록 조회"
              onChange={(e) => handleChange("categoryS", e.target.value)}
              style={inputStyle}
            />
          </FormField>
        </div>
      </Section>

      {/* AR-00066 하단 영역 목록 (수정 모드에서만, FID-00148) */}
      {!isNew && detail && (
        <div style={{ marginTop: 24 }}>
          <AreaListSection
            areas={detail.areas}
            projectId={projectId}
            screenId={screenId}
            router={router}
          />
        </div>
      )}
    </div>
  );
}

// ── AR-00066 영역 목록 섹션 ───────────────────────────────────────────────────

function AreaListSection({
  areas, projectId, screenId, router,
}: {
  areas:     AreaRow[];
  projectId: string;
  screenId:  string;
  router:    ReturnType<typeof useRouter>;
}) {
  return (
    <Section title={`영역 목록 (총 ${areas.length}개)`}>
      {areas.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#aaa" }}>등록된 영역이 없습니다.</p>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
          {/* 헤더 */}
          <div style={areaGridHeaderStyle}>
            <div>순서</div>
            <div>영역명</div>
            <div>유형</div>
          </div>
          {/* 행 */}
          {areas.map((area, idx) => (
            <div
              key={area.areaId}
              style={{
                ...areaGridRowStyle,
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
              }}
            >
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {area.sortOrder}
              </div>
              {/* 영역명 클릭 → 영역 상세 (FID-00149) */}
              <div>
                <button
                  onClick={() => router.push(`/projects/${projectId}/areas/${area.areaId}`)}
                  style={linkBtnStyle}
                >
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginRight: 6 }}>
                    {area.displayId}
                  </span>
                  {area.name}
                </button>
              </div>
              <div>
                <span style={areaTypeBadgeStyle(area.type)}>{area.type}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 영역 목록 페이지로 이동 */}
      <div style={{ marginTop: 12 }}>
        <button
          onClick={() => router.push(`/projects/${projectId}/areas?screenId=${screenId}`)}
          style={{ ...secondaryBtnStyle, fontSize: 13 }}
        >
          영역 목록 관리 →
        </button>
      </div>
    </Section>
  );
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border:         "1px solid var(--color-border)",
        borderRadius:   8,
        padding:        "20px 24px",
        background:     "var(--color-bg-card)",
        display:        "flex",
        flexDirection:  "column",
        gap:            16,
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

function areaTypeBadgeStyle(type: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    SEARCH:      { bg: "#e3f2fd", color: "#1565c0" },
    GRID:        { bg: "#e8f5e9", color: "#2e7d32" },
    FORM:        { bg: "#fff3e0", color: "#e65100" },
    INFO_CARD:   { bg: "#f3e5f5", color: "#6a1b9a" },
    TAB:         { bg: "#e0f2f1", color: "#00695c" },
    FULL_SCREEN: { bg: "#fce4ec", color: "#880e4f" },
  };
  const c = colors[type] ?? { bg: "#f5f5f5", color: "#555" };
  return {
    display:      "inline-block",
    padding:      "2px 8px",
    borderRadius: 4,
    fontSize:     11,
    fontWeight:   600,
    background:   c.bg,
    color:        c.color,
  };
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

const linkBtnStyle: React.CSSProperties = {
  background:     "none",
  border:         "none",
  cursor:         "pointer",
  color:          "var(--color-primary, #1976d2)",
  fontSize:       14,
  padding:        0,
  textAlign:      "left",
  textDecoration: "underline",
};

const areaGridHeaderStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "60px 1fr 120px",
  gap:                 12,
  padding:             "8px 14px",
  background:          "var(--color-bg-muted)",
  fontSize:            12,
  fontWeight:          600,
  color:               "var(--color-text-secondary)",
  borderBottom:        "1px solid var(--color-border)",
};

const areaGridRowStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "60px 1fr 120px",
  gap:                 12,
  padding:             "10px 14px",
  alignItems:          "center",
  background:          "var(--color-bg-card)",
};
