"use client";

/**
 * UnitWorkDetailPage — 단위업무 상세·편집 (PID-00041)
 *
 * 역할:
 *   - 신규: unitWorkId = "new" → POST (FID-00130 신규)
 *   - 수정: unitWorkId 존재 → GET 로드(FID-00130 조회) → PUT (FID-00130 수정)
 *   - 진행률·기간 등 전체 필드 편집
 *   - 설명 변경 시 이력 저장 여부 선택 다이얼로그
 *   - 설명 변경 이력 조회 팝업
 *
 * 주요 기술:
 *   - TanStack Query: 상세 조회 및 캐시 무효화
 *   - useSearchParams: new 모드 시 reqId pre-select 지원
 */

import { Suspense, useState, useEffect } from "react";
import { marked } from "marked";

// marked는 동기/비동기 모두 지원 — 여기선 동기 string 반환만 사용
function markedParse(md: string): string {
  const result = marked.parse(md, { async: false });
  return typeof result === "string" ? result : "";
}
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";
import SettingsHistoryDialog from "@/components/ui/SettingsHistoryDialog";
import ProgressTracker from "@/components/ui/ProgressTracker";
import { useAppStore } from "@/store/appStore";

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
  sortOrder:      number;
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
  sortOrder:       number;
  saveHistory?:    boolean;
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
  const { setBreadcrumb } = useAppStore();
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
    sortOrder:   0,
  });

  // 원본 설명 추적: 이력 저장 여부 판단용 (수정 모드에서만 의미 있음)
  const [originalDescription, setOriginalDescription] = useState<string>("");

  // 이력 저장 다이얼로그 상태
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  // 이력 조회 팝업 상태
  const [historyViewOpen, setHistoryViewOpen] = useState(false);

  // 예시 팝업 상태
  const [exampleOpen, setExampleOpen] = useState(false);
  const [descTab, setDescTab] = useState<"edit" | "preview">("edit");

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
  const { data: detail, isLoading: isDetailLoading } = useQuery({
    queryKey: ["unit-work", projectId, unitWorkId],
    queryFn:  () =>
      authFetch<{ data: UnitWorkDetail }>(
        `/api/projects/${projectId}/unit-works/${unitWorkId}`
      ).then((r) => {
        const d    = r.data;
        const desc = d.description ?? "";
        setForm({
          reqId:           d.reqId,
          name:            d.name,
          description:     desc,
          assignMemberId:  d.assignMemberId ?? undefined,
          startDate:       d.startDate ?? undefined,
          endDate:         d.endDate ?? undefined,
          progress:        d.progress,
          sortOrder:       d.sortOrder,
        });
        // 원본 설명 저장 — 변경 여부 비교용
        setOriginalDescription(desc);
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
    onSuccess: (_, variables) => {
      toast.success("저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["unit-works", projectId] });
      // 저장 후 원본 설명 갱신 — 재수정 시 비교 기준 초기화
      setOriginalDescription(variables.description ?? "");
      setHistoryDialogOpen(false);
      // 이력이 새로 쌓였을 수 있으므로 공통 이력 캐시 무효화
      if (variables.saveHistory) {
        queryClient.invalidateQueries({ queryKey: ["settings-history", projectId] });
      }
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

    // 수정 모드이고 설명이 변경된 경우 → 이력 저장 여부 묻는 다이얼로그 표시
    if (!isNew && form.description !== originalDescription) {
      setHistoryDialogOpen(true);
      return;
    }

    // 신규 or 설명 미변경 → 바로 저장
    saveMutation.mutate(form);
  }

  // GNB 브레드크럼 설정 — 마운트 시 설정, 언마운트 시 초기화
  useEffect(() => {
    const items = [
      { label: "단위업무", href: `/projects/${projectId}/unit-works` },
      ...(detail?.reqName ? [{ label: `${detail.reqDisplayId} ${detail.reqName}` }] : []),
      { label: isNew ? "신규 등록" : (detail?.displayId ?? "편집") },
    ];
    setBreadcrumb(items);
    return () => setBreadcrumb([]);
  }, [projectId, isNew, detail?.reqName, detail?.reqDisplayId, detail?.displayId, setBreadcrumb]);

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (!isNew && isDetailLoading) {
    return (
      <div style={{ padding: "40px 32px", color: "#888" }}>
        단위업무 정보를 불러오는 중...
      </div>
    );
  }

  const descriptionChanged = !isNew && form.description !== originalDescription;

  return (
    <div style={{ padding: 0 }}>

      {/* ── 이력 저장 다이얼로그 ── */}
      {historyDialogOpen && (
        <div
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => setHistoryDialogOpen(false)}
        >
          <div
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              padding: "28px 32px",
              width: 400,
              boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 6 }}>
              변경 이력 저장
            </div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20 }}>
              아래 항목의 변경 내용을 이력으로 남길 수 있습니다.
            </div>

            {/* 체크박스 목록 — 현재는 설명만 */}
            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                padding: "12px 16px",
                marginBottom: 24,
                display: "flex", alignItems: "center", gap: 10,
                background: "var(--color-bg-base)",
              }}
            >
              <input
                type="checkbox"
                id="hist-desc"
                checked={descriptionChanged}
                readOnly
                style={{ width: 15, height: 15, accentColor: "var(--color-primary, #1976d2)", cursor: "default" }}
              />
              <label htmlFor="hist-desc" style={{ fontSize: 14, color: "var(--color-text-primary)", cursor: "default" }}>
                설명
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setHistoryDialogOpen(false)}
                disabled={saveMutation.isPending}
                style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 16px" }}
              >
                취소
              </button>
              <button
                onClick={() => saveMutation.mutate({ ...form, saveHistory: false })}
                disabled={saveMutation.isPending}
                style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 16px" }}
              >
                이력 없이 저장
              </button>
              <button
                onClick={() => saveMutation.mutate({ ...form, saveHistory: true })}
                disabled={saveMutation.isPending}
                style={{ ...primaryBtnStyle, fontSize: 13, padding: "7px 20px" }}
              >
                {saveMutation.isPending ? "저장 중..." : "이력과 함께 저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 예시 팝업 ── */}
      {exampleOpen && (
        <ExamplePopup onClose={() => setExampleOpen(false)} />
      )}

      {/* ── 이력 조회 팝업 (공통 컴포넌트) ── */}
      <SettingsHistoryDialog
        open={historyViewOpen}
        onClose={() => setHistoryViewOpen(false)}
        projectId={projectId}
        itemName="단위업무 설명"
        currentValue={form.description}
        title="버전 이력 비교"
      />

      {/* 타이틀 행 — full-width 배경 */}
      <div style={{
        display:      "flex",
        alignItems:   "center",
        gap:          16,
        padding:      "10px 24px",
        background:   "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        {/* 좌: 뒤로 + 타이틀 + 단계별 진척률 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/unit-works`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1, flexShrink: 0 }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", flexShrink: 0 }}>
            {isNew ? "단위업무 신규 등록" : `${detail?.displayId ?? ""} 단위업무 편집`}
          </span>
          {/* 타이틀과 70px 띄워서 진척률 표시 — 수정 모드에서만 */}
          {!isNew && detail && (
            <div style={{ marginLeft: 70 }}>
              <ProgressTracker
                projectId={projectId}
                refTable="tb_ds_unit_work"
                refId={unitWorkId}
                phases={["analy", "design", "impl", "test"]}
              />
            </div>
          )}
        </div>

        {/* 우: 취소·저장 */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/unit-works`)}
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
      {/* 폼 — 2단 레이아웃 (좌: 메타 정보, 우: 설명) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 20, alignItems: "start" }}>

        {/* ── 왼쪽 카드: 메타 정보 ── */}
        <div
          style={{
            border:        "1px solid var(--color-border)",
            borderRadius:  8,
            background:    "var(--color-bg-card)",
            padding:       "24px 28px",
            display:       "flex",
            flexDirection: "column",
            gap:           20,
          }}
        >
          {/* 상위 요구사항 선택 */}
          <FormField label="상위 요구사항" required>
            {/* position: relative 래퍼로 커스텀 화살표를 right: 10px에 고정 */}
            <div style={{ position: "relative" }}>
              <select
                value={form.reqId}
                onChange={(e) => handleChange("reqId", e.target.value)}
                style={{ ...inputStyle, appearance: "none", paddingRight: 32 }}
              >
                <option value="">요구사항을 선택하세요</option>
                {reqOptions.map((r) => (
                  <option key={r.requirementId} value={r.requirementId}>
                    {r.displayId} — {r.name}
                  </option>
                ))}
              </select>
              <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--color-text-secondary)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </span>
            </div>
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

          {/* 시작일 + 종료일 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
          </div>

          {/* 진행률 + 정렬순서 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
            <FormField label="정렬순서">
              <input
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => handleChange("sortOrder", parseInt(e.target.value) || 0)}
                style={inputStyle}
              />
            </FormField>
          </div>
        </div>

        {/* ── 오른쪽 카드: 설명 ── */}
        <div
          style={{
            border:        "1px solid var(--color-border)",
            borderRadius:  8,
            background:    "var(--color-bg-card)",
            padding:       "24px 28px",
            display:       "flex",
            flexDirection: "column",
            height:        "calc(100vh - 161px)",  // 뷰포트 - (상단바40 + 브레드크럼40 + 타이틀57 + 하단패딩24)
            boxSizing:     "border-box",
          }}
        >
          {/* 라벨 + 탭 버튼 + 기타 버튼 행 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                설명
              </label>
              <MarkdownTabButtons tab={descTab} onTabChange={setDescTab} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* 예시 버튼 */}
              <button
                onClick={() => setExampleOpen(true)}
                style={descSubBtnStyle}
              >
                예시
              </button>
              {/* 템플릿 삽입 버튼 */}
              <button
                onClick={() => handleChange("description", UNIT_WORK_TEMPLATE)}
                style={descSubBtnStyle}
              >
                템플릿 삽입
              </button>
              {/* 변경 이력 버튼 */}
              {!isNew && (
                <button
                  onClick={() => setHistoryViewOpen(true)}
                  style={{ ...descSubBtnStyle, display: "flex", alignItems: "center", gap: 4 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  변경 이력
                </button>
              )}
            </div>
          </div>

          <MarkdownEditor
            value={form.description}
            onChange={(md) => handleChange("description", md)}
            placeholder="단위업무 설명 (선택)"
            tab={descTab}
            onTabChange={setDescTab}
            fullHeight
          />
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

const descSubBtnStyle: React.CSSProperties = {
  padding:      "3px 10px",
  borderRadius: 5,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-base)",
  color:        "var(--color-text-secondary)",
  fontSize:     12,
  cursor:       "pointer",
};

// ── 예시 팝업 컴포넌트 ────────────────────────────────────────────────────────

function ExamplePopup({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"raw" | "preview">("preview");
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(UNIT_WORK_EXAMPLE).then(() => {
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
          <span style={{ fontSize: 15, fontWeight: 700, flexShrink: 0 }}>단위업무 설명 예시</span>
          {/* 탭 */}
          <div style={{ display: "flex", gap: 2, background: "var(--color-bg-muted)", padding: "3px", borderRadius: 7 }}>
            {tabBtn("preview", "미리보기")}
            {tabBtn("raw", "원문")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            {/* 복사 버튼 */}
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
              {UNIT_WORK_EXAMPLE}
            </pre>
          ) : (
            <>
              <style dangerouslySetInnerHTML={{ __html: UW_EXAMPLE_CSS }} />
              <div
                className="uw-example"
                style={{ fontSize: 13, lineHeight: 1.8, color: "var(--color-text-primary)" }}
                dangerouslySetInnerHTML={{ __html: markedParse(UNIT_WORK_EXAMPLE) }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 예시 팝업 CSS (style dangerouslySetInnerHTML 용) ──────────────────────────

const UW_EXAMPLE_CSS = [
  ".uw-example h2{font-size:14px;font-weight:700;margin:16px 0 8px}",
  ".uw-example table{border-collapse:collapse;width:100%;margin-bottom:12px}",
  ".uw-example th,.uw-example td{border:1px solid #e0e0e0;padding:5px 10px;font-size:12px}",
  ".uw-example th{background:#f5f5f5;font-weight:600}",
  ".uw-example pre{background:#f5f5f5;padding:10px 14px;border-radius:6px;font-size:12px;overflow-x:auto}",
  ".uw-example code{font-family:monospace}",
].join(" ");

// ── 단위업무 설명 예시 ─────────────────────────────────────────────────────────

const UNIT_WORK_EXAMPLE = `## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | UW-00001 |
| **단위업무명** | 이메일 회원가입 |
| **비즈니스 목적** | 이메일·비밀번호 입력 및 인증 메일 발송을 통해 신규 회원을 등록한다. |
| **관련 요구사항** | - |
| **기술 스택** | - |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| PID-00003 | 회원가입 | /auth/register | DETAIL | 이메일·비밀번호 입력 및 유효성 검증 후 인증 메일 발송 요청 |
| PID-00004 | 인증 메일 발송 안내 | /auth/register/verify | DETAIL | 인증 메일 발송 완료 안내 및 재발송 요청 처리 |
| PID-00005 | 이메일 인증 완료 | /auth/register/complete | DETAIL | 인증 링크 클릭 후 가입 완료 처리 및 온보딩 페이지 이동 |

## 3. 화면 흐름
\`\`\`
[PID-00003 회원가입] ──(가입 요청 성공)──▶ [PID-00004 인증 메일 발송 안내]
[PID-00004 인증 메일 발송 안내] ──(인증 링크 클릭)──▶ [PID-00005 이메일 인증 완료]
[PID-00005 이메일 인증 완료] ──(3초 후 자동/즉시 이동)──▶ [온보딩 페이지]
[PID-00005 토큰 만료·무효] ──(재발송 안내 버튼)──▶ [PID-00004 인증 메일 발송 안내]
\`\`\`

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| PID-00003 → PID-00004 | email | 가입 요청 성공 후 자동 이동 |
| PID-00004 → PID-00005 | token (URL 파라미터) | 인증 메일 내 링크 클릭 |
| PID-00005 → 온보딩 | - | 3초 카운트다운 후 자동 이동 또는 즉시 이동 |
| PID-00005 → PID-00004 | - | 토큰 만료·무효 시 재발송 안내 버튼 클릭 |

## 4. 권한 정의
| 기능 | 비로그인 | 일반 사용자 | 관리자 |
|:-----|:---------|:-----------|:-------|
| 회원가입 폼 접근 | ✅ | ❌ | ❌ |
| 인증 메일 재발송 | ✅ | ❌ | ❌ |
| 이메일 인증 완료 처리 | ✅ | ❌ | ❌ |

## 5. 상태 정의
| 상태 | 설명 |
|:-----|:-----|
| 미인증 | 가입 요청 후 인증 메일 발송 완료, 아직 인증 링크 미클릭 |
| 인증완료 | 인증 링크 클릭 후 가입 완료 처리된 상태 |
| 인증만료 | 인증 링크 발송 후 1시간 초과로 만료된 상태 |

## 6. 참조 테이블
- <TABLE_SCRIPT:tb_cm_member>
- <TABLE_SCRIPT:tb_cm_email_verification>
- <TABLE_SCRIPT:tb_cm_refresh_token>`;

// ── 단위업무 설명 템플릿 (구조만, 내용 비움) ───────────────────────────────────

const UNIT_WORK_TEMPLATE = `## 1. 개요
| 항목 | 내용 |
|:-----|:-----|
| **단위업무ID** | |
| **단위업무명** | |
| **비즈니스 목적** | |
| **관련 요구사항** | |
| **기술 스택** | |

## 2. 화면 목록
| 화면ID | 화면명 | URL | 유형 | 설명 |
|:-------|:-------|:----|:-----|:-----|
| | | | | |

## 3. 화면 흐름
\`\`\`
[화면A] ──(조건)──▶ [화면B]
\`\`\`

| 이동 | 전달 파라미터 | 동작 |
|:-----|:-------------|:-----|
| → | | |

## 4. 권한 정의
| 기능 | 비로그인 | 일반 사용자 | 관리자 |
|:-----|:---------|:-----------|:-------|
| | | | |

## 5. 상태 정의
| 상태 | 설명 |
|:-----|:-----|
| | |

## 6. 참조 테이블
- <TABLE_SCRIPT:>`;
