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
import SettingsHistoryDialog from "@/components/ui/SettingsHistoryDialog";
import PrdDownloadDialog from "@/components/ui/PrdDownloadDialog";
import { useAppStore } from "@/store/appStore";

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
  layoutData:   string | null;
  displayCode:  string;
  type:         string;
  sortOrder:    number;
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
  description:  string;
  displayCode:  string;
  type:         string;
  sortOrder:    number;
  categoryL:    string;
  categoryM:    string;
  categoryS:    string;
  layoutData?:  string;
  saveHistory?: boolean;
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
  const { setBreadcrumb } = useAppStore();
  const projectId    = params.id;
  const screenId     = params.screenId;
  const isNew        = screenId === "new";

  // useSearchParams()는 Suspense 안에서만 동작 — 페이지 래퍼에서 보장됨
  const presetUnitWorkId = searchParams.get("unitWorkId") ?? "";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<SaveBody>({
    unitWorkId:  presetUnitWorkId || undefined,
    name:        "",
    description: "",
    displayCode: "",
    type:        "LIST",
    sortOrder:   0,
    categoryL:   "",
    categoryM:   "",
    categoryS:   "",
  });

  // 레이아웃 에디터 상태 (기본: 빈 배열)
  const [layoutRows, setLayoutRows] = useState<LayoutRow[]>([]);

  // 화면 설명 예시 팝업
  const [descExampleOpen, setDescExampleOpen] = useState(false);
  const [descTab, setDescTab] = useState<"edit" | "preview">("edit");

  // 설명 변경 이력 저장 여부 확인 다이얼로그
  const [prdOpen,           setPrdOpen]           = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  // 이력 조회 팝업 (SettingsHistoryDialog)
  const [historyViewOpen, setHistoryViewOpen] = useState(false);

  // 이력 저장 시 원본 설명 추적용
  const [originalDescription, setOriginalDescription] = useState("");

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
          description: d.description ?? "",
          displayCode: d.displayCode,
          type:        d.type,
          sortOrder:   d.sortOrder,
          categoryL:   d.categoryL,
          categoryM:   d.categoryM,
          categoryS:   d.categoryS,
        });
        // 설명 변경 감지를 위해 원본 값 보관
        setOriginalDescription(d.description ?? "");
        // 저장된 레이아웃 데이터 복원
        if (d.layoutData) {
          try { setLayoutRows(JSON.parse(d.layoutData)); } catch { /* 잘못된 JSON 무시 */ }
        }
        return d;
      }),
    enabled: !isNew,
  });

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: SaveBody) =>
      isNew
        ? authFetch<{ data: { screenId: string } }>(`/api/projects/${projectId}/screens`, {
            method: "POST",
            body:   JSON.stringify(body),
          })
        : authFetch<{ data: { screenId: string } }>(`/api/projects/${projectId}/screens/${screenId}`, {
            method: "PUT",
            body:   JSON.stringify(body),
          }),
    onSuccess: (res, variables) => {
      toast.success(isNew ? "화면이 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["screens", projectId] });
      if (isNew && res?.data?.screenId) {
        // 신규 등록 후 생성된 화면 상세로 이동
        router.replace(`/projects/${projectId}/screens/${res.data.screenId}`);
      } else {
        // 수정 후 현재 페이지 데이터 갱신 (상세에 그대로 유지)
        queryClient.invalidateQueries({ queryKey: ["screen", projectId, screenId] });
        // 저장 완료 후 원본 설명을 현재 값으로 갱신
        setOriginalDescription(variables.description ?? "");
        if (variables.saveHistory) {
          // 이력 목록 캐시 무효화
          queryClient.invalidateQueries({ queryKey: ["settings-history", projectId] });
        }
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleChange(field: keyof SaveBody, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function doSave(saveHistory: boolean) {
    saveMutation.mutate({
      ...form,
      layoutData:  layoutRows.length > 0 ? JSON.stringify(layoutRows) : undefined,
      saveHistory: saveHistory || undefined,
    });
    setHistoryDialogOpen(false);
  }

  function handleSave() {
    if (!form.name.trim()) {
      toast.error("화면명을 입력해 주세요.");
      return;
    }
    // 수정 모드에서 설명이 변경된 경우 이력 저장 여부 확인
    const descriptionChanged = !isNew && form.description.trim() !== originalDescription.trim();
    if (descriptionChanged) {
      setHistoryDialogOpen(true);
      return;
    }
    doSave(false);
  }

  // GNB 브레드크럼 설정 — 마운트 시 설정, 언마운트 시 초기화
  useEffect(() => {
    const items = [
      { label: "화면 설계", href: `/projects/${projectId}/screens` },
      ...(detail?.unitWorkName ? [{ label: detail.unitWorkName }] : []),
      { label: isNew ? "신규 등록" : (detail?.displayId ?? "편집") },
    ];
    setBreadcrumb(items);
    return () => setBreadcrumb([]);
  }, [projectId, isNew, detail?.unitWorkName, detail?.displayId, setBreadcrumb]);

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (!isNew && isDetailLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>화면 정보를 불러오는 중...</div>;
  }

  return (
    <div style={{ padding: 0 }}>
      {/* 타이틀 행 — full-width 배경 */}
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
            onClick={() => router.push(`/projects/${projectId}/screens`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "화면 신규 등록" : `${detail?.displayId ?? ""} 화면 편집`}
          </span>
        </div>
        {/* 우: PRD 다운로드 + 취소·저장 */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {!isNew && (
            <button
              onClick={() => setPrdOpen(true)}
              style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 12px" }}
            >
              PRD 다운로드
            </button>
          )}
          <button
            onClick={() => router.push(`/projects/${projectId}/screens`)}
            disabled={saveMutation.isPending}
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
      {/* 2-컬럼 레이아웃: 기본 정보 | 화면 설명 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 28, alignItems: "start" }}>

        {/* 왼쪽: 기본 정보 + 영역 목록 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* AR-00065 기본 정보 폼 */}
          <Section title="기본 정보" hideTitle>
            {/* 상위 단위업무 선택 */}
            <FormField label="상위 단위업무">
              <select
                value={form.unitWorkId ?? ""}
                onChange={(e) => handleChange("unitWorkId", e.target.value)}
                style={selectStyle}
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

            {/* 표시코드 + 화면 유형 + 정렬 순서 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 16 }}>
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
                  style={selectStyle}
                >
                  <option value="LIST">LIST</option>
                  <option value="DETAIL">DETAIL</option>
                  <option value="INPUT">INPUT</option>
                  <option value="POPUP">POPUP</option>
                  <option value="TAB">TAB</option>
                  <option value="REPORT">REPORT</option>
                </select>
              </FormField>
              <FormField label="정렬 순서">
                <input
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, sortOrder: parseInt(e.target.value) || 0 }))
                  }
                  style={inputStyle}
                />
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

          {/* 레이아웃 에디터 — 기본 정보 아래 */}
          <Section title="레이아웃 구성" hideTitle small>
            <ScreenLayoutEditor
              title="레이아웃 구성"
              value={layoutRows}
              onChange={setLayoutRows}
              areas={detail?.areas.map((a) => ({
                areaId:    a.areaId,
                displayId: a.displayId,
                name:      a.name,
              }))}
            />
          </Section>

          {/* AR-00066 영역 목록 (수정 모드에서만, FID-00148) */}
          {!isNew && detail && (
            <AreaListSection
              areas={detail.areas}
              projectId={projectId}
              screenId={screenId}
              router={router}
            />
          )}
        </div>

        {/* 오른쪽: 화면 설명 (마크다운) */}
        <Section
          title="화면 설명"
          small
          headerLeft={<MarkdownTabButtons tab={descTab} onTabChange={setDescTab} />}
          headerRight={
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setDescExampleOpen(true)}
                style={ghostSmBtnStyle}
              >
                예시
              </button>
              <button
                type="button"
                onClick={() =>
                  handleChange(
                    "description",
                    DESCRIPTION_TEMPLATE(detail?.displayId ?? "PID-XXXXX", form.name)
                  )
                }
                style={ghostSmBtnStyle}
              >
                템플릿 삽입
              </button>
              {!isNew && (
                <button
                  type="button"
                  onClick={() => setHistoryViewOpen(true)}
                  style={ghostSmBtnStyle}
                >
                  🕐 변경 이력
                </button>
              )}
            </div>
          }
        >
          <MarkdownEditor
            value={form.description}
            onChange={(md) => handleChange("description", md)}
            placeholder="화면 내용 및 세부 설계를 작성하세요."
            rows={26}
            tab={descTab}
            onTabChange={setDescTab}
          />
        </Section>

        {/* 화면 설명 예시 팝업 */}
        {descExampleOpen && (
          <ScreenExamplePopup onClose={() => setDescExampleOpen(false)} />
        )}

      {/* 설명 변경 이력 저장 여부 확인 다이얼로그 */}
      {historyDialogOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setHistoryDialogOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 420, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "24px 28px" }}
          >
            <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
              변경 이력 저장
            </p>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              화면 설명이 변경되었습니다.<br />
              변경 이력을 함께 저장하시겠습니까?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setHistoryDialogOpen(false)}
                style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => doSave(false)}
                disabled={saveMutation.isPending}
                style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
              >
                이력 없이 저장
              </button>
              <button
                type="button"
                onClick={() => doSave(true)}
                disabled={saveMutation.isPending}
                style={{ ...primaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
              >
                이력과 함께 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRD 다운로드 팝업 */}
      <PrdDownloadDialog
        open={prdOpen}
        onClose={() => setPrdOpen(false)}
        projectId={projectId}
        availableLevels={["UNIT_WORK", "SCREEN"]}
        defaultLevel="SCREEN"
        unitWorkId={detail?.unitWorkId}
        screenId={screenId}
      />

      {/* 설명 변경 이력 조회 팝업 */}
      <SettingsHistoryDialog
        open={historyViewOpen}
        onClose={() => setHistoryViewOpen(false)}
        projectId={projectId}
        itemName="화면 설명"
        currentValue={form.description}
        title="화면 설명 변경 이력"
      />

      </div>
      </div>
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
    <Section
      title={`영역 목록 (총 ${areas.length}개)`}
      small
      headerRight={
        <button
          onClick={() => router.push(`/projects/${projectId}/areas?screenId=${screenId}`)}
          style={{ ...secondaryBtnStyle, fontSize: 12, padding: "4px 12px" }}
        >
          영역 목록 관리 →
        </button>
      }
    >
      {areas.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#aaa" }}>등록된 영역이 없습니다.</p>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
          {/* 헤더 */}
          <div style={areaGridHeaderStyle}>
            <div>순서</div>
            <div>영역명</div>
            <div style={{ textAlign: "right" }}>유형</div>
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
              <div style={{ textAlign: "right" }}>
                <span style={areaTypeBadgeStyle(area.type)}>{area.type}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────────────────

function Section({
  title, headerLeft, headerRight, children, small = false, hideTitle = false,
}: {
  title:         string;
  headerLeft?:   React.ReactNode;
  headerRight?:  React.ReactNode;
  children:      React.ReactNode;
  /** 타이틀을 작은 uppercase 레이블로 표시 */
  small?:        boolean;
  /** 타이틀 행 자체를 숨김 */
  hideTitle?:    boolean;
}) {
  return (
    <div
      style={{
        border:        "1px solid var(--color-border)",
        borderRadius:  8,
        padding:       small ? "14px 16px" : "20px 24px",
        background:    "var(--color-bg-card)",
        display:       "flex",
        flexDirection: "column",
        gap:           small ? 10 : 16,
      }}
    >
      {!hideTitle && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* 타이틀 + 타이틀 옆 왼쪽 요소 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {small ? (
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {title}
              </span>
            ) : (
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
                {title}
              </h2>
            )}
            {headerLeft}
          </div>
          {headerRight}
        </div>
      )}
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
  padding:      "8px 24px",
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
  gridTemplateColumns: "44px 1fr 100px",
  gap:                 12,
  padding:             "8px 14px",
  background:          "var(--color-bg-muted)",
  fontSize:            12,
  fontWeight:          600,
  color:               "var(--color-text-secondary)",
  borderBottom:        "1px solid var(--color-border)",
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

const areaGridRowStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: "44px 1fr 100px",
  gap:                 12,
  padding:             "10px 14px",
  alignItems:          "center",
  background:          "var(--color-bg-card)",
};

// ── 화면 설명 예시 / 템플릿 ────────────────────────────────────────────────────

const DESCRIPTION_EXAMPLE = `## [PID-00001] 게시판 목록

### 화면 개요

| 항목 | 내용 |
|:-----|:-----|
| **비즈니스 목적** | 프로젝트 내 공지사항을 한눈에 확인하고, 제목·유형·기간 조건으로 필요한 글을 빠르게 찾는다. |
| **진입 경로** | 메뉴 클릭, 등록/수정 완료 후 리다이렉트 |

### 영역 목록

| 영역ID | 영역명 | 유형 | 설명 |
|:-------|:-------|:-----|:-----|
| AR-00001 | 검색 영역 | SEARCH_FORM | 유형·기간·제목 조건 검색 |
| AR-00002 | 목록 영역 | DATA_GRID | 게시글 목록 표시, 페이징, 글쓰기 버튼 |

### 영역 간 흐름

- 화면 진입 시 → 검색 조건 초기화 → 자동 조회 → 목록 표시
- 검색 버튼 클릭 → 검색 조건으로 재조회 → 목록 갱신 (1페이지 초기화)
- 행 클릭 → PID-00002 상세 화면 이동`;

const DESCRIPTION_TEMPLATE = (displayId: string, name: string) =>
`## [${displayId}] ${name}

### 화면 개요

| 항목 | 내용 |
|:-----|:-----|
| **비즈니스 목적** |  |
| **진입 경로** |  |

### 영역 목록

| 영역ID | 영역명 | 유형 | 설명 |
|:-------|:-------|:-----|:-----|
|  |  |  |  |

### 영역 간 흐름

- `;

// ── 예시 팝업 CSS ─────────────────────────────────────────────────────────────

const SCREEN_EXAMPLE_CSS = [
  ".sc-example h2,.sc-example h3{font-size:14px;font-weight:700;margin:16px 0 8px}",
  ".sc-example table{border-collapse:collapse;width:100%;margin-bottom:12px}",
  ".sc-example th,.sc-example td{border:1px solid #e0e0e0;padding:5px 10px;font-size:12px}",
  ".sc-example th{background:#f5f5f5;font-weight:600}",
  ".sc-example pre{background:#f5f5f5;padding:10px 14px;border-radius:6px;font-size:12px;overflow-x:auto}",
  ".sc-example code{font-family:monospace}",
  ".sc-example ul{padding-left:18px;margin:4px 0}",
].join(" ");

// ── 예시 팝업 컴포넌트 ────────────────────────────────────────────────────────

function ScreenExamplePopup({ onClose }: { onClose: () => void }) {
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
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--color-border)", gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700, flexShrink: 0 }}>화면 설명 예시</span>
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
        {/* 본문 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {tab === "raw" ? (
            <pre style={{ margin: 0, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--color-text-primary)", fontFamily: "monospace" }}>
              {DESCRIPTION_EXAMPLE}
            </pre>
          ) : (
            <>
              <style dangerouslySetInnerHTML={{ __html: SCREEN_EXAMPLE_CSS }} />
              <div
                className="sc-example"
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
