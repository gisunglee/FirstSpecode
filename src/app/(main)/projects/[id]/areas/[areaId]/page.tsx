"use client";

/**
 * AreaDetailPage — 영역 상세·편집 (PID-00047)
 *
 * 역할:
 *   - 영역 상세 조회 (FID-00153)
 *   - 영역 생성/수정 (FID-00154)
 *   - AI ASCII 변환 요청 (FID-00156)
 *   - Excalidraw 설계 POPUP (PID-00048 / FID-00157, 00165)
 *   - 목업 생성 요청 (FID-00158)
 *   - 요약 정보 표시 (FID-00162)
 *   - 하단 기능 목록 (FID-00163, 00164)
 *
 * 주요 기술:
 *   - TanStack Query: 상세 조회 및 뮤테이션
 *   - areaId === "new"이면 신규 모드, 그 외 수정 모드
 *   - Excalidraw 팝업은 동적 import (SSR 비활성화) — 미설치 시 stub 표시
 */

import { Suspense, useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type AreaDetail = {
  areaId:      string;
  displayId:   string;
  name:        string;
  description: string;
  type:        string;
  sortOrder:   number;
  screenId:    string | null;
  screenName:  string;
  excalidrawData: object | null;
  summary: {
    functionCount: number;
    designRate:    number;
    implRate:      number;
  };
  functions: {
    funcId:    string;
    displayId: string;
    name:      string;
    status:    string;
    priority:  string;
    sortOrder: number;
  }[];
};

type ScreenOption = {
  screenId:   string;
  displayId:  string;
  name:       string;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function AreaDetailPage() {
  return (
    <Suspense fallback={null}>
      <AreaDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function AreaDetailPageInner() {
  const params       = useParams<{ id: string; areaId: string }>();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const queryClient  = useQueryClient();
  const projectId    = params.id;
  const areaId       = params.areaId;
  const isNew        = areaId === "new";

  // URL 파라미터 — 신규 시 화면 미리 선택
  const presetScreenId = searchParams.get("screenId") ?? "";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [name,        setName]        = useState("");
  const [type,        setType]        = useState("GRID");
  const [description, setDescription] = useState("");
  const [sortOrder,   setSortOrder]   = useState<number>(0);
  const [screenId,    setScreenId]    = useState(presetScreenId);

  // ── AI 상태 ────────────────────────────────────────────────────────────────
  const [asciiComment,  setAsciiComment]  = useState("");
  const [mockupComment, setMockupComment] = useState("");

  // ── Excalidraw 팝업 상태 ───────────────────────────────────────────────────
  const [excalidrawOpen,  setExcalidrawOpen]  = useState(false);
  const [excalidrawData,  setExcalidrawData]  = useState<object | null>(null);

  // ── 화면 목록 조회 (screenId 선택용) ──────────────────────────────────────
  const { data: screensData } = useQuery({
    queryKey: ["screens", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: ScreenOption[] } }>(
        `/api/projects/${projectId}/screens`
      ).then((r) => r.data),
  });
  const screenOptions = screensData?.items ?? [];

  // ── 영역 상세 조회 (수정 모드) ────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["area", projectId, areaId],
    queryFn:  () =>
      authFetch<{ data: AreaDetail }>(`/api/projects/${projectId}/areas/${areaId}`)
        .then((r) => r.data),
    // 신규 모드이면 조회 안 함
    enabled: !isNew,
  });

  // 상세 데이터로 폼 초기화
  useEffect(() => {
    if (data) {
      setName(data.name);
      setType(data.type);
      setDescription(data.description);
      setSortOrder(data.sortOrder);
      setScreenId(data.screenId ?? "");
      setExcalidrawData(data.excalidrawData);
    }
  }, [data]);

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation<{ data: { areaId?: string } }, Error, void>({
    mutationFn: () => {
      const body = {
        screenId:    screenId || null,
        name:        name.trim(),
        type,
        description: description.trim(),
        sortOrder:   sortOrder || 0,
      };
      if (isNew) {
        return authFetch<{ data: { areaId?: string } }>(`/api/projects/${projectId}/areas`, {
          method: "POST",
          body:   JSON.stringify(body),
        });
      }
      return authFetch<{ data: { areaId?: string } }>(`/api/projects/${projectId}/areas/${areaId}`, {
        method: "PUT",
        body:   JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      toast.success(isNew ? "영역이 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["areas", projectId] });
      if (isNew && res.data.areaId) {
        router.replace(`/projects/${projectId}/areas/${res.data.areaId}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ["area", projectId, areaId] });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave() {
    if (!name.trim()) { toast.error("영역명을 입력해 주세요."); return; }
    saveMutation.mutate();
  }

  // ── Excalidraw 저장 뮤테이션 ──────────────────────────────────────────────
  const excalidrawSaveMutation = useMutation({
    mutationFn: (excData: object) =>
      authFetch(`/api/projects/${projectId}/areas/${areaId}/excalidraw`, {
        method: "PATCH",
        body:   JSON.stringify({ data: excData }),
      }),
    onSuccess: () => {
      toast.success("Excalidraw 설계가 저장되었습니다.");
      setExcalidrawOpen(false);
      queryClient.invalidateQueries({ queryKey: ["area", projectId, areaId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── AI ASCII 변환 요청 ─────────────────────────────────────────
  const asciiMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/areas/${areaId}/ai/ascii`, {
        method: "POST",
        body:   JSON.stringify({ comment: asciiComment }),
      }),
    onSuccess: () => {
      toast.success("AI ASCII 변환 요청이 접수되었습니다.");
      setAsciiComment("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 목업 생성 요청 ─────────────────────────────────────────
  const mockupMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/areas/${areaId}/ai/mockup`, {
        method: "POST",
        body:   JSON.stringify({ comment: mockupComment }),
      }),
    onSuccess: () => {
      toast.success("목업 생성이 요청되었습니다.");
      setMockupComment("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 로딩 ───────────────────────────────────────────────────────
  if (!isNew && isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: "32px" }}>
      {/* 헤더 — 뒤로가기 + 제목 + 취소/저장 한 줄 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <button
          onClick={() => router.push(`/projects/${projectId}/areas`)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)" }}
        >
          ←
        </button>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>
          {isNew ? "영역 신규 등록" : `${data?.displayId ?? ""} 영역 편집`}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/areas`)}
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

      {/* 2-컬럼 레이아웃 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 28, alignItems: "start" }}>

        {/* 왼쪽 컬럼: 기본 정보 폼 + 요약 + 기능 목록 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* ── AR-00069 기본 정보 폼 ─────────────────────────────────── */}
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>기본 정보</h3>

            <div style={formGroupStyle}>
              <label style={labelStyle}>상위 화면</label>
              <select
                value={screenId}
                onChange={(e) => setScreenId(e.target.value)}
                style={inputStyle}
              >
                <option value="">미분류 (화면 없음)</option>
                {screenOptions.map((s) => (
                  <option key={s.screenId} value={s.screenId}>
                    {s.displayId} {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>영역명 <span style={{ color: "#e53935" }}>*</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="영역명을 입력하세요"
                style={inputStyle}
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>유형</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                style={inputStyle}
              >
                {AREA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>설명</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="영역 역할·설명"
                rows={4}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>정렬순서</label>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                style={{ ...inputStyle, width: 100 }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button
                onClick={handleSave}
                style={primaryBtnStyle}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "저장 중..." : "저장"}
              </button>
            </div>
          </section>

          {/* ── AR-00073 요약 정보 ─────────────────────────────────────── */}
          {!isNew && data?.summary && (
            <section style={{ ...sectionStyle, background: "var(--color-bg-muted)", borderRadius: 8 }}>
              <div style={{ display: "flex", gap: 32, fontSize: 14 }}>
                <div>
                  <span style={{ color: "var(--color-text-secondary)" }}>기능 수: </span>
                  <strong>{data.summary.functionCount}</strong>
                </div>
                <div>
                  <span style={{ color: "var(--color-text-secondary)" }}>설계율: </span>
                  <strong style={{ color: data.summary.designRate >= 80 ? "#2e7d32" : "#e65100" }}>
                    {data.summary.designRate}%
                  </strong>
                </div>
                <div>
                  <span style={{ color: "var(--color-text-secondary)" }}>구현율: </span>
                  <strong style={{ color: data.summary.implRate >= 80 ? "#1565c0" : "#555" }}>
                    {data.summary.implRate}%
                  </strong>
                </div>
              </div>
            </section>
          )}

          {/* ── AR-00074 하단 기능 목록 ───────────────────────────────── */}
          {!isNew && (
            <section style={sectionStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>기능 목록</h3>
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                  총 {data?.functions.length ?? 0}개
                </span>
              </div>

              {!data?.functions.length ? (
                <div style={{ padding: "32px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
                  등록된 기능이 없습니다.
                </div>
              ) : (
                <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
                  <div style={funcGridHeaderStyle}>
                    <div>순서</div>
                    <div>기능명</div>
                    <div>우선순위</div>
                    <div>상태</div>
                  </div>
                  {data.functions.map((fn, idx) => (
                    <div
                      key={fn.funcId}
                      style={{
                        ...funcGridRowStyle,
                        borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                      }}
                    >
                      <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                        {fn.sortOrder}
                      </div>
                      <div>
                        <button
                          onClick={() => router.push(`/projects/${projectId}/functions/${fn.funcId}`)}
                          style={linkBtnStyle}
                        >
                          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginRight: 6 }}>
                            {fn.displayId}
                          </span>
                          {fn.name}
                        </button>
                      </div>
                      <div>
                        <span style={priorityBadgeStyle(fn.priority)}>{fn.priority}</span>
                      </div>
                      <div>
                        <span style={statusBadgeStyle(fn.status)}>{STATUS_LABELS[fn.status] ?? fn.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* 오른쪽 컬럼: AI 도구 (수정 모드에서만) */}
        {!isNew && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* ── AR-00070 화면 설계 이미지 / AI ASCII 변환 ─────────────── */}
            <section style={sectionStyle}>
              <h3 style={sectionTitleStyle}>화면 설계 이미지 / AI ASCII 변환</h3>
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 12px" }}>
                이미지 업로드 후 AI ASCII 변환을 요청할 수 있습니다.
              </p>
              <div style={formGroupStyle}>
                <label style={labelStyle}>AI 요청 코멘트</label>
                <textarea
                  value={asciiComment}
                  onChange={(e) => setAsciiComment(e.target.value)}
                  placeholder="AI에게 추가 지시사항을 입력하세요"
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => asciiMutation.mutate()}
                  style={secondaryBtnStyle}
                  disabled={asciiMutation.isPending}
                >
                  {asciiMutation.isPending ? "요청 중..." : "AI ASCII 변환 요청"}
                </button>
              </div>
            </section>

            {/* ── AR-00071 화면 설계 도구 ──────────────────────────────── */}
            <section style={sectionStyle}>
              <h3 style={sectionTitleStyle}>화면 설계 도구</h3>
              <div style={{ marginBottom: 16 }}>
                <button
                  onClick={() => setExcalidrawOpen(true)}
                  style={primaryBtnStyle}
                >
                  Excalidraw로 설계하기 ↗
                </button>
                {excalidrawData && (
                  <span style={{ marginLeft: 12, fontSize: 13, color: "#2e7d32" }}>
                    ✓ 설계 데이터 있음
                  </span>
                )}
              </div>

              <h3 style={{ ...sectionTitleStyle, marginTop: 8 }}>목업 생성</h3>
              <div style={formGroupStyle}>
                <label style={labelStyle}>AI 요청 코멘트</label>
                <textarea
                  value={mockupComment}
                  onChange={(e) => setMockupComment(e.target.value)}
                  placeholder="목업 생성 지시사항"
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => mockupMutation.mutate()}
                  style={secondaryBtnStyle}
                  disabled={mockupMutation.isPending}
                >
                  {mockupMutation.isPending ? "요청 중..." : "목업 생성 요청"}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* ── PID-00048 Excalidraw 팝업 ─────────────────────────────────────── */}
      {excalidrawOpen && (
        <ExcalidrawPopup
          initialData={excalidrawData}
          onSave={(d) => excalidrawSaveMutation.mutate(d)}
          onClose={() => setExcalidrawOpen(false)}
          isSaving={excalidrawSaveMutation.isPending}
        />
      )}
    </div>
  );
}

// ── PID-00048 Excalidraw 팝업 ────────────────────────────────────────────────

function ExcalidrawPopup({
  initialData, onSave, onClose, isSaving,
}: {
  initialData: object | null;
  onSave:      (data: object) => void;
  onClose:     () => void;
  isSaving:    boolean;
}) {
  // Excalidraw 패키지가 미설치 상태이므로 JSON 직접 편집 방식으로 stub 구현
  // 실제 서비스에서는 @excalidraw/excalidraw 패키지 동적 import로 교체 예정
  const [jsonText, setJsonText] = useState(
    initialData ? JSON.stringify(initialData, null, 2) : ""
  );
  const [parseError, setParseError] = useState("");

  function handleSave() {
    // 빈 캔버스 저장도 허용 (빈 문자열이면 빈 객체 저장)
    const text = jsonText.trim();
    if (!text) {
      onSave({});
      return;
    }
    try {
      const parsed = JSON.parse(text);
      setParseError("");
      onSave(parsed);
    } catch {
      setParseError("올바른 JSON 형식이 아닙니다.");
    }
  }

  return (
    <div style={{ ...overlayStyle, zIndex: 2000 }} onClick={onClose}>
      <div
        style={{
          background:   "var(--color-bg-card)",
          borderRadius: 10,
          padding:      "28px 32px",
          width:        "min(700px, 90vw)",
          boxShadow:    "0 8px 32px rgba(0,0,0,0.28)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Excalidraw 설계</h3>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, fontSize: 13 }}>닫기</button>
        </div>

        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>
          Excalidraw 패키지 연동 전 임시 JSON 편집 화면입니다.
          <br />
          Excalidraw 라이브러리 설치 후 실제 캔버스로 교체될 예정입니다.
        </p>

        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder={"Excalidraw JSON 데이터를 붙여넣거나 직접 입력하세요.\n비워두면 빈 캔버스로 저장됩니다."}
          rows={14}
          style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
        />

        {parseError && (
          <p style={{ color: "#e53935", fontSize: 13, margin: "8px 0 0" }}>{parseError}</p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={secondaryBtnStyle} disabled={isSaving}>취소</button>
          <button
            onClick={handleSave}
            style={primaryBtnStyle}
            disabled={isSaving}
          >
            {isSaving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 상수 ─────────────────────────────────────────────────────────────────────

const AREA_TYPES = [
  { value: "SEARCH",      label: "SEARCH — 검색 조건" },
  { value: "GRID",        label: "GRID — 데이터 목록" },
  { value: "FORM",        label: "FORM — 입력 폼" },
  { value: "INFO_CARD",   label: "INFO_CARD — 정보 카드" },
  { value: "TAB",         label: "TAB — 탭" },
  { value: "FULL_SCREEN", label: "FULL_SCREEN — 전체화면" },
];

const STATUS_LABELS: Record<string, string> = {
  NONE:        "미착수",
  DESIGN_DONE: "설계완료",
  IMPL_DONE:   "구현완료",
};

function priorityBadgeStyle(priority: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    HIGH:   { bg: "#fce4ec", color: "#880e4f" },
    MEDIUM: { bg: "#fff3e0", color: "#e65100" },
    LOW:    { bg: "#e8f5e9", color: "#2e7d32" },
  };
  const c = colors[priority] ?? { bg: "#f5f5f5", color: "#555" };
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

function statusBadgeStyle(status: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    NONE:        { bg: "#f5f5f5",  color: "#555" },
    DESIGN_DONE: { bg: "#e3f2fd", color: "#1565c0" },
    IMPL_DONE:   { bg: "#e8f5e9", color: "#2e7d32" },
  };
  const c = colors[status] ?? { bg: "#f5f5f5", color: "#555" };
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

const sectionStyle: React.CSSProperties = {
  padding:       "20px 24px",
  border:        "1px solid var(--color-border)",
  borderRadius:  8,
  background:    "var(--color-bg-card)",
  display:       "flex",
  flexDirection: "column",
  gap:           16,
};

const sectionTitleStyle: React.CSSProperties = {
  margin:     0,
  fontSize:   15,
  fontWeight: 700,
};

const formGroupStyle: React.CSSProperties = {};

const labelStyle: React.CSSProperties = {
  display:      "block",
  marginBottom: 6,
  fontSize:     13,
  fontWeight:   600,
  color:        "var(--color-text-secondary)",
};

const inputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "8px 12px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  fontSize:     14,
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  boxSizing:    "border-box",
};

const FUNC_GRID_TEMPLATE = "60px 1fr 100px 100px";

const funcGridHeaderStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: FUNC_GRID_TEMPLATE,
  gap:                 12,
  padding:             "10px 16px",
  background:          "var(--color-bg-muted)",
  fontSize:            12,
  fontWeight:          600,
  color:               "var(--color-text-secondary)",
  borderBottom:        "1px solid var(--color-border)",
  alignItems:          "center",
};

const funcGridRowStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: FUNC_GRID_TEMPLATE,
  gap:                 12,
  padding:             "12px 16px",
  alignItems:          "center",
  background:          "var(--color-bg-card)",
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

const primaryBtnStyle: React.CSSProperties = {
  padding:      "8px 20px",
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

const overlayStyle: React.CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(0,0,0,0.45)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  zIndex:         1000,
};
