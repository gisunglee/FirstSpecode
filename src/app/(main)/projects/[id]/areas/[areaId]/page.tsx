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
import { marked } from "marked";

function markedParse(md: string): string {
  const result = marked.parse(md, { async: false });
  return typeof result === "string" ? result : "";
}
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";
import { ScreenLayoutEditor, type LayoutRow } from "@/components/ui/ScreenLayoutEditor";
import AreaAttachFiles from "@/components/ui/AreaAttachFiles";
import SettingsHistoryDialog from "@/components/ui/SettingsHistoryDialog";
import { useAppStore } from "@/store/appStore";

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
  layoutData:     string | null;
  commentCn:      string;
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
  const { setBreadcrumb } = useAppStore();
  const projectId    = params.id;
  const areaId       = params.areaId;
  const isNew        = areaId === "new";

  // URL 파라미터 — 신규 시 화면 미리 선택
  const presetScreenId = searchParams.get("screenId") ?? "";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [name,        setName]        = useState("");
  const [type,        setType]        = useState("GRID");
  const [description, setDescription] = useState("");
  const [descTab, setDescTab] = useState<"edit" | "preview">("edit");
  const [sortOrder,   setSortOrder]   = useState<number>(0);
  const [screenId,    setScreenId]    = useState(presetScreenId);

  // ── 레이아웃 상태 ───────────────────────────────────────────────────────────
  const [layoutRows, setLayoutRows] = useState<LayoutRow[]>([]);

  // ── AI 상태 ────────────────────────────────────────────────────────────────
  const [asciiComment, setAsciiComment] = useState("");

  // 원본 설명 추적 — 변경 여부 비교용
  const [originalDescription, setOriginalDescription] = useState("");

  // 이력 저장 다이얼로그 / 이력 조회 팝업 상태
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyViewOpen,   setHistoryViewOpen]   = useState(false);

  // ── 설명 예시 팝업 상태 ────────────────────────────────────────────────────
  const [descExampleOpen, setDescExampleOpen] = useState(false);

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

  // GNB 브레드크럼 설정 — 마운트 시 설정, 언마운트 시 초기화
  useEffect(() => {
    const items = [
      { label: "영역 관리", href: `/projects/${projectId}/areas` },
      ...(data?.screenName ? [{ label: data.screenName }] : []),
      { label: isNew ? "신규 등록" : (data?.displayId ?? "편집") },
    ];
    setBreadcrumb(items);
    return () => setBreadcrumb([]);
  }, [projectId, isNew, data?.screenName, data?.displayId, setBreadcrumb]);

  // 상세 데이터로 폼 초기화
  useEffect(() => {
    if (data) {
      setName(data.name);
      setType(data.type);
      setDescription(data.description);
      setSortOrder(data.sortOrder);
      setScreenId(data.screenId ?? "");
      setAsciiComment(data.commentCn ?? "");
      setExcalidrawData(data.excalidrawData);
      // 원본 설명 저장 — 변경 여부 비교용
      setOriginalDescription(data.description ?? "");
      if (data.layoutData) {
        try { setLayoutRows(JSON.parse(data.layoutData)); } catch { /* 잘못된 JSON 무시 */ }
      }
    }
  }, [data]);

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation<{ data: { areaId?: string } }, Error, { saveHistory?: boolean }>({
    mutationFn: ({ saveHistory } = {}) => {
      const body = {
        screenId:    screenId || null,
        name:        name.trim(),
        type,
        description: description.trim(),
        sortOrder:   sortOrder || 0,
        layoutData:  layoutRows.length > 0 ? JSON.stringify(layoutRows) : undefined,
        commentCn:   asciiComment,
        saveHistory,
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
    onSuccess: (res, variables) => {
      toast.success(isNew ? "영역이 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["areas", projectId] });
      setHistoryDialogOpen(false);
      // 저장 후 원본 설명 갱신
      setOriginalDescription(description.trim());
      if (isNew && res.data.areaId) {
        router.replace(`/projects/${projectId}/areas/${res.data.areaId}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ["area", projectId, areaId] });
        if (variables.saveHistory) {
          queryClient.invalidateQueries({ queryKey: ["settings-history", projectId] });
        }
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave() {
    if (!name.trim()) { toast.error("영역명을 입력해 주세요."); return; }

    // 수정 모드이고 설명이 변경된 경우 → 이력 저장 여부 다이얼로그
    if (!isNew && description.trim() !== originalDescription) {
      setHistoryDialogOpen(true);
      return;
    }

    saveMutation.mutate({});
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



  // ── 로딩 ───────────────────────────────────────────────────────
  if (!isNew && isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  const descriptionChanged = !isNew && description.trim() !== originalDescription;

  return (
    <div style={{ padding: 0 }}>

      {/* ── 이력 저장 다이얼로그 ── */}
      {historyDialogOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setHistoryDialogOpen(false)}
        >
          <div
            style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "28px 32px", width: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 6 }}>변경 이력 저장</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20 }}>아래 항목의 변경 내용을 이력으로 남길 수 있습니다.</div>
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: "12px 16px", marginBottom: 24, display: "flex", alignItems: "center", gap: 10, background: "var(--color-bg-base)" }}>
              <input type="checkbox" checked={descriptionChanged} readOnly style={{ width: 15, height: 15, accentColor: "var(--color-primary, #1976d2)", cursor: "default" }} />
              <span style={{ fontSize: 14, color: "var(--color-text-primary)" }}>설명</span>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setHistoryDialogOpen(false)} disabled={saveMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 16px" }}>취소</button>
              <button onClick={() => saveMutation.mutate({ saveHistory: false })} disabled={saveMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 16px" }}>이력 없이 저장</button>
              <button onClick={() => saveMutation.mutate({ saveHistory: true })} disabled={saveMutation.isPending} style={{ ...primaryBtnStyle, fontSize: 13, padding: "7px 20px" }}>
                {saveMutation.isPending ? "저장 중..." : "이력과 함께 저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 이력 조회 팝업 ── */}
      <SettingsHistoryDialog
        open={historyViewOpen}
        onClose={() => setHistoryViewOpen(false)}
        projectId={projectId}
        itemName="영역 설명"
        currentValue={description}
        title="버전 이력 비교"
      />

      {/* 타이틀 행 — full-width 배경, 좌: ← 타이틀 | 우: Excalidraw·취소·저장 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        {/* 좌: 뒤로 + 타이틀 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/areas`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "영역 신규 등록" : `${data?.displayId ?? ""} 영역 편집`}
          </span>
        </div>
        {/* 우: 버튼 그룹 */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {!isNew && (
            <button
              onClick={() => setExcalidrawOpen(true)}
              style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 12px" }}
            >
              Excalidraw ↗
            </button>
          )}
          <button
            onClick={() => router.push(`/projects/${projectId}/areas`)}
            style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
      {/* 2-컬럼 레이아웃 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 24, alignItems: "start" }}>

        {/* 왼쪽 컬럼: 기본 정보 + AI코멘트 + 레이아웃 + 첨부파일 + 요약 + 기능목록 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* ── AR-00069 기본 정보 폼 ─────────────────────────────────── */}
          <section style={sectionStyle}>

            {/* 소속 화면 + 유형 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>소속 화면</label>
                <select
                  value={screenId}
                  onChange={(e) => setScreenId(e.target.value)}
                  style={selectStyle}
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
                <label style={labelStyle}>유형</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  style={selectStyle}
                >
                  {AREA_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 영역명 + 정렬순서 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 16 }}>
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
                <label style={labelStyle}>정렬순서</label>
                <input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                  style={inputStyle}
                />
              </div>
            </div>

          </section>

          {/* ── AI 요청 코멘트 + 레이아웃 + 첨부파일 (수정 모드에서만) ── */}
          {!isNew && (
            <>
              <section style={rightSectionStyle}>
                <label style={rightLabelStyle}>AI 요청 코멘트</label>
                <textarea
                  value={asciiComment}
                  onChange={(e) => setAsciiComment(e.target.value)}
                  placeholder="AI에게 추가 지시사항을 입력하세요"
                  rows={6}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </section>

              <section style={rightSectionStyle}>
                <ScreenLayoutEditor
                  title="레이아웃 구성"
                  value={layoutRows}
                  onChange={setLayoutRows}
                  columnLabelPlaceholder="구성 요소명"
                />
              </section>

              <section style={rightSectionStyle}>
                <label style={rightLabelStyle}>첨부파일</label>
                <AreaAttachFiles basePath={`/api/projects/${projectId}/areas/${areaId}`} />
              </section>
            </>
          )}

          {/* ── AR-00073 요약 정보 ─────────────────────────────────────── */}
          {!isNew && data?.summary && (
            <section style={{ ...sectionStyle, background: "var(--color-bg-muted)", padding: "12px 16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", textAlign: "center", fontSize: 13 }}>
                <div style={{ borderRight: "1px solid var(--color-border)" }}>
                  <div style={{ color: "var(--color-text-secondary)", marginBottom: 4 }}>기능 수</div>
                  <strong style={{ fontSize: 18 }}>{data.summary.functionCount}</strong>
                </div>
                <div style={{ borderRight: "1px solid var(--color-border)" }}>
                  <div style={{ color: "var(--color-text-secondary)", marginBottom: 4 }}>설계율</div>
                  <strong style={{ fontSize: 18, color: data.summary.designRate >= 80 ? "#2e7d32" : "#e65100" }}>
                    {data.summary.designRate}%
                  </strong>
                </div>
                <div>
                  <div style={{ color: "var(--color-text-secondary)", marginBottom: 4 }}>구현율</div>
                  <strong style={{ fontSize: 18, color: data.summary.implRate >= 80 ? "#1565c0" : "#555" }}>
                    {data.summary.implRate}%
                  </strong>
                </div>
              </div>
            </section>
          )}

          {/* ── AR-00074 기능 목록 ────────────────────────────────────── */}
          {!isNew && (
            <section style={sectionStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>기능 목록</span>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
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

        {/* 오른쪽 컬럼: 설명 (마크다운) */}
        <div>
          <section style={sectionStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>설명</label>
                <MarkdownTabButtons tab={descTab} onTabChange={setDescTab} />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => setDescExampleOpen(true)} style={ghostSmBtnStyle}>
                  예시
                </button>
                <button
                  type="button"
                  onClick={() => setDescription(DESCRIPTION_TEMPLATE(data?.displayId ?? "AR-XXXXX", name))}
                  style={ghostSmBtnStyle}
                >
                  템플릿 삽입
                </button>
                {!isNew && (
                  <button
                    type="button"
                    onClick={() => setHistoryViewOpen(true)}
                    style={{ ...ghostSmBtnStyle, display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                    변경 이력
                  </button>
                )}
              </div>
            </div>
            <MarkdownEditor
              value={description}
              onChange={setDescription}
              placeholder="영역 역할·설명"
              rows={28}
              tab={descTab}
              onTabChange={setDescTab}
            />
          </section>
        </div>

      </div>
      </div>

      {/* 설명 예시 팝업 */}
      {descExampleOpen && (
        <AreaExamplePopup onClose={() => setDescExampleOpen(false)} />
      )}

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
  { value: "SEARCH",      label: "검색 조건" },
  { value: "GRID",        label: "데이터 목록" },
  { value: "FORM",        label: "입력 폼" },
  { value: "INFO_CARD",   label: "정보 카드" },
  { value: "TAB",         label: "탭" },
  { value: "FULL_SCREEN", label: "전체화면" },
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

// 우측 컬럼 전용 — 타이틀 없이 작은 레이블만
const rightSectionStyle: React.CSSProperties = {
  padding:       "14px 16px",
  border:        "1px solid var(--color-border)",
  borderRadius:  8,
  background:    "var(--color-bg-card)",
  display:       "flex",
  flexDirection: "column",
  gap:           10,
};

const rightLabelStyle: React.CSSProperties = {
  fontSize:   12,
  fontWeight: 600,
  color:      "var(--color-text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
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
  border:       "1px solid transparent",
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

const ghostSmBtnStyle: React.CSSProperties = {
  padding:      "3px 9px",
  borderRadius: 5,
  border:       "1px solid var(--color-border)",
  background:   "none",
  color:        "var(--color-text-secondary)",
  fontSize:     12,
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

// ── 설명 예시 / 템플릿 ──────────────────────────────────────────────────────

const DESCRIPTION_EXAMPLE = `### 영역: [AR-00003] 상세 영역

**유형:** DETAIL_VIEW

**UI 구조**

\`\`\`text
+───────────────────────────────────────────────────+
│ [공지] 시스템 점검 안내                              │
│ 작성자: 관리자 │ 등록일: 2026-03-15 14:30 │ 조회: 121 │
│───────────────────────────────────────────────────│
│                                                   │
│ (마크다운 렌더링된 본문 내용)                         │
│                                                   │
│───────────────────────────────────────────────────│
│ 📎 첨부파일                                        │
│   점검안내서.pdf (2.1MB)  [다운로드]                 │
│   일정표.xlsx (340KB)     [다운로드]                │
│───────────────────────────────────────────────────│
│                              [목록]  [수정]  [삭제] │
+───────────────────────────────────────────────────+
\`\`\`

**구성 항목**

| 항목명 | UI 타입 | 비고 |
|:-------|:--------|:-----|
| 유형 배지 | badge | NOTICE(빨강) / NORMAL(회색) |
| 제목 | heading (h2) | |
| 작성자 | text | |
| 등록일 | datetime | yyyy-MM-dd HH:mm |
| 조회수 | number | |
| 본문 | markdown render | 마크다운 → HTML 렌더링 |
| 첨부파일 목록 | file list | 파일명(크기) + 다운로드 버튼 |
| 목록 버튼 | button (default) | → PID-00001 (검색조건 유지) |
| 수정 버튼 | button (primary) | → PID-00003, 작성자/관리자만 표시 |
| 삭제 버튼 | button (danger) | 확인 후 논리삭제, 작성자/관리자만 표시 |`;

const DESCRIPTION_TEMPLATE = (displayId: string, name: string) =>
`### 영역: [${displayId}] ${name} | 테이블명 그룹코드 | cm/pj/rq/ds

**유형:**

**UI 구조**
\`\`\`
+─────────────────────────────────+
│                                 │
+─────────────────────────────────+
\`\`\`

**구성 항목**

| 항목명 | UI 타입 | 비고 |
|:-------|:--------|:-----|
|  |  |  |`;

// ── 예시 팝업 CSS ─────────────────────────────────────────────────────────────

const AREA_EXAMPLE_CSS = [
  ".ar-example h2,.ar-example h3{font-size:14px;font-weight:700;margin:16px 0 8px}",
  ".ar-example table{border-collapse:collapse;width:100%;margin-bottom:12px}",
  ".ar-example th,.ar-example td{border:1px solid #e0e0e0;padding:5px 10px;font-size:12px}",
  ".ar-example th{background:#f5f5f5;font-weight:600}",
  ".ar-example pre{background:#f5f5f5;padding:10px 14px;border-radius:6px;font-size:12px;overflow-x:auto}",
  ".ar-example code{font-family:monospace}",
  ".ar-example ul{padding-left:18px;margin:4px 0}",
].join(" ");

// ── 예시 팝업 컴포넌트 ────────────────────────────────────────────────────────

function AreaExamplePopup({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"raw" | "preview">("preview");
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(DESCRIPTION_EXAMPLE).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  const tabBtn = (t: "raw" | "preview", label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        padding: "4px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        borderRadius: 5, border: "none",
        background: tab === t ? "var(--color-primary, #1976d2)" : "transparent",
        color: tab === t ? "#fff" : "var(--color-text-secondary)",
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--color-bg-card)", borderRadius: 10, width: "min(780px, 92vw)", maxHeight: "84vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--color-border)", gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700, flexShrink: 0 }}>영역 설명 예시</span>
          <div style={{ display: "flex", gap: 2, background: "var(--color-bg-muted)", padding: "3px", borderRadius: 7 }}>
            {tabBtn("preview", "미리보기")}
            {tabBtn("raw", "원문")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            <button
              onClick={handleCopy}
              style={{
                padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                borderRadius: 5, border: "1px solid var(--color-border)",
                background: copied ? "#e8f5e9" : "var(--color-bg-base)",
                color: copied ? "#2e7d32" : "var(--color-text-secondary)",
                transition: "all 0.2s",
              }}
            >
              {copied ? "✓ 복사됨" : "복사"}
            </button>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--color-text-secondary)", lineHeight: 1 }}>×</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {tab === "raw" ? (
            <pre style={{ margin: 0, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--color-text-primary)", fontFamily: "monospace" }}>
              {DESCRIPTION_EXAMPLE}
            </pre>
          ) : (
            <>
              <style dangerouslySetInnerHTML={{ __html: AREA_EXAMPLE_CSS }} />
              <div
                className="ar-example"
                style={{ fontSize: 13, lineHeight: 1.8, color: "var(--color-text-primary)" }}
                dangerouslySetInnerHTML={{ __html: markedParse(DESCRIPTION_EXAMPLE) }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
