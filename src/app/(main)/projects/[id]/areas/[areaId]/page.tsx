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

import { Suspense, useState, useEffect, useRef } from "react";
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
import PrdDownloadDialog from "@/components/ui/PrdDownloadDialog";
import AiTaskDetailDialog from "@/components/ui/AiTaskDetailDialog";
import AiTaskHistoryDialog from "@/components/ui/AiTaskHistoryDialog";
import AiImplementCard from "@/components/ui/AiImplementCard";
import ExcalidrawDialog from "@/components/ui/ExcalidrawDialog";
import { useAppStore } from "@/store/appStore";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type AiTaskInfo = { aiTaskId: string; status: string };

type AreaDetail = {
  areaId:      string;
  displayId:   string;
  name:        string;
  description: string;
  type:        string;
  sortOrder:   number;
  screenId:    string | null;
  screenName:  string;
  unitWorkId:  string | null;
  layoutData:     string | null;
  commentCn:      string;
  excalidrawData: object | null;
  aiTasks:        Record<string, AiTaskInfo>;
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
  const [displayIdInput, setDisplayIdInput] = useState("");
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
  const [prdOpen,           setPrdOpen]           = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyViewOpen,   setHistoryViewOpen]   = useState(false);

  // ── 설명 예시 팝업 상태 ────────────────────────────────────────────────────
  const [descExampleOpen, setDescExampleOpen] = useState(false);

  // ── AI 작업 드롭다운 패널 ─────────────────────────────────────────────────
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [helpOpen,    setHelpOpen]    = useState(false);
  const aiPanelRef = useRef<HTMLDivElement>(null);

  // ── AI 태스크 상세/이력 팝업 ──────────────────────────────────────────────
  const [aiDetailTaskId,    setAiDetailTaskId]    = useState<string | null>(null);
  const [aiHistoryTaskType, setAiHistoryTaskType] = useState<string | null>(null);

  // ── AI 컨펌 상태 ──────────────────────────────────────────────────────────
  const [aiConfirm,  setAiConfirm]  = useState<{ taskType: string; label: string } | null>(null);
  const [taskPrompt, setTaskPrompt] = useState<{ tmplId: string; tmplNm: string } | null | "loading" | "none">(null);

  // AI 패널 외부 클릭 시 닫기
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // AiImplementCard 내부 팝업이 열려있으면 외부 클릭 감지 무시
      const target = e.target as HTMLElement;
      if (target.closest('[data-impl-overlay]')) return;
      if (aiPanelRef.current && !aiPanelRef.current.contains(e.target as Node)) {
        setAiPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function openPromptConfirm(taskType: string, label: string) {
    if (!description.trim()) { toast.error("설명을 먼저 입력해 주세요."); return; }
    setTaskPrompt("loading");
    setAiConfirm({ taskType, label });
    try {
      const res = await authFetch<{ data: Array<{ tmplId: string; tmplNm: string; defaultYn: string }> }>(
        `/api/projects/${projectId}/prompt-templates?taskType=${taskType}&refType=AREA&useYn=Y`
      );
      const list = res.data ?? [];
      const preferred = list.find((t) => t.defaultYn === "Y") ?? list[0] ?? null;
      setTaskPrompt(preferred ? { tmplId: preferred.tmplId, tmplNm: preferred.tmplNm } : "none");
    } catch {
      setTaskPrompt("none");
    }
  }

  // ── Excalidraw 데이터 상태 ─────────────────────────────────────────────────
  const [excalidrawData, setExcalidrawData] = useState<object | null>(null);

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

  // GNB 브레드크럼 설정 — 단위업무 > 화면 > 영역 > 기능 목록
  useEffect(() => {
    if (isNew) {
      setBreadcrumb([
        { label: "영역 관리", href: `/projects/${projectId}/areas` },
        { label: "신규 등록" },
      ]);
    } else if (data) {
      const d = data as unknown as {
        unitWorkId?: string | null; unitWorkDisplayId?: string | null; unitWorkName?: string;
        screenId?: string | null;   screenDisplayId?: string | null;
      };
      const items = [
        // 단위업무
        ...(d.unitWorkId && d.unitWorkName
          ? [{ label: `${d.unitWorkDisplayId ?? ""} ${d.unitWorkName}`.trim(), href: `/projects/${projectId}/unit-works/${d.unitWorkId}` }]
          : []),
        // 화면
        ...(d.screenId && data.screenName
          ? [{ label: `${d.screenDisplayId ?? ""} ${data.screenName}`.trim(), href: `/projects/${projectId}/screens/${d.screenId}` }]
          : []),
        // 영역 (현재 페이지)
        { label: `${data.displayId} ${data.name}` },
        // 하위 기능 목록
        { label: "기능 목록", href: `/projects/${projectId}/functions?areaId=${areaId}` },
      ];
      setBreadcrumb(items);
    }
    return () => setBreadcrumb([]);
  }, [projectId, areaId, isNew, data, setBreadcrumb]);

  // 상세 데이터로 폼 초기화
  useEffect(() => {
    if (data) {
      setName(data.name);
      setDisplayIdInput(data.displayId ?? "");
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
        displayId:   displayIdInput.trim() || undefined,
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

  // ── 삭제 뮤테이션 ─────────────────────────────────────────────────────────
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/areas/${areaId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("영역이 삭제되었습니다.");
      router.push(`/projects/${projectId}/areas`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Excalidraw 저장 뮤테이션 ──────────────────────────────────────────────
  const excalidrawSaveMutation = useMutation({
    mutationFn: (excData: object) =>
      authFetch(`/api/projects/${projectId}/areas/${areaId}/excalidraw`, {
        method: "PATCH",
        body:   JSON.stringify({ data: excData }),
      }),
    onSuccess: () => {
      toast.success("Excalidraw 설계가 저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["area", projectId, areaId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });



  // ── 영역 AI 요청 뮤테이션 ─────────────────────────────────────────────────
  const aiMutation = useMutation({
    mutationFn: ({ taskType }: { taskType: string }) =>
      authFetch(`/api/projects/${projectId}/areas/${areaId}/ai`, {
        method: "POST",
        body: JSON.stringify({ taskType, coment_cn: asciiComment.trim() }),
      }),
    onSuccess: (_res, vars) => {
      const labels: Record<string, string> = {
        INSPECT: "영역 AI 점검 요청이 접수되었습니다.",
        DESIGN:  "AI 설계 요청이 접수되었습니다.",
        IMPACT:  "AI 영향도 분석 요청이 접수되었습니다.",
      };
      toast.success(labels[vars.taskType] ?? "AI 요청이 접수되었습니다.");
      // 상태 갱신을 위해 상세 재조회
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

      {/* ── PRD 다운로드 팝업 ── */}
      <PrdDownloadDialog
        open={prdOpen}
        onClose={() => setPrdOpen(false)}
        projectId={projectId}
        availableLevels={["UNIT_WORK", "SCREEN", "AREA"]}
        defaultLevel="AREA"
        unitWorkId={data?.unitWorkId}
        screenId={data?.screenId}
        areaId={areaId}
      />

      {/* ── 이력 조회 팝업 ── */}
      <SettingsHistoryDialog
        open={historyViewOpen}
        onClose={() => setHistoryViewOpen(false)}
        projectId={projectId}
        itemName="영역 설명"
        currentValue={description}
        title="버전 이력 비교"
        refTblNm="tb_ds_area"
        refId={areaId}
      />

      {/* ── AI 점검 도움말 팝업 ─────────────────────────────────────── */}
      {helpOpen && (() => {
        const help = AREA_AI_HELP;
        return (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400 }}
            onClick={() => setHelpOpen(false)}
          >
            <div
              style={{ background: "var(--color-bg-card)", borderRadius: 12, padding: "24px 28px", minWidth: 420, maxWidth: 560, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
                  {help.title}
                </span>
                <button
                  onClick={() => setHelpOpen(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1, padding: "0 2px" }}
                >
                  ×
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {help.sections.map((sec) => (
                  <div key={sec.heading}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {sec.heading}
                    </div>
                    <div style={{
                      fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.7,
                      background: "var(--color-bg-muted)", borderRadius: 8, padding: "10px 14px",
                      whiteSpace: "pre-line",
                    }}>
                      {sec.body}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── AI 태스크 상세 팝업 ─────────────────────────────────────── */}
      {aiDetailTaskId && (
        <AiTaskDetailDialog
          projectId={projectId}
          taskId={aiDetailTaskId}
          onClose={() => setAiDetailTaskId(null)}
        />
      )}

      {/* ── AI 태스크 이력 팝업 ─────────────────────────────────────── */}
      {aiHistoryTaskType && !isNew && (
        <AiTaskHistoryDialog
          projectId={projectId}
          refType="AREA"
          refId={areaId}
          taskType={aiHistoryTaskType as "INSPECT"}
          onClose={() => setAiHistoryTaskType(null)}
        />
      )}

      {/* 삭제 확인 다이얼로그 */}
      {deleteConfirmOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setDeleteConfirmOpen(false)}
        >
          <div
            style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "28px 32px", width: 380, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>영역 삭제</div>
            <div style={{ fontSize: 14, color: "var(--color-text-secondary)", marginBottom: 24, lineHeight: 1.6 }}>
              <strong>{data?.name}</strong> 영역을 삭제하시겠습니까?<br />
              하위 기능도 함께 삭제될 수 있습니다.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setDeleteConfirmOpen(false)} style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 16px" }}>취소</button>
              <button
                onClick={() => { deleteMutation.mutate(); setDeleteConfirmOpen(false); }}
                disabled={deleteMutation.isPending}
                style={{ ...dangerBtnStyle, fontSize: 13, padding: "7px 20px" }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 요청 확인 다이얼로그 */}
      {aiConfirm !== null && (
        <div
          data-impl-overlay="ai-confirm"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            style={{ width: "100%", maxWidth: (aiConfirm.taskType === "INSPECT" || aiConfirm.taskType === "DESIGN") ? 520 : 420, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 12, boxShadow: "0 12px 48px rgba(0,0,0,0.25)", padding: "32px 36px" }}
            onClick={(e) => e.stopPropagation()}
          >
            {(aiConfirm.taskType === "INSPECT" || aiConfirm.taskType === "DESIGN") ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <span style={{ fontSize: 24 }}>✦</span>
                  <div>
                    <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
                      {aiConfirm.label} 요청
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
                      작성하신 설명 내용을 기반으로 AI에게 {aiConfirm.taskType === "DESIGN" ? "설계를" : "점검을"} 요청합니다.
                    </p>
                  </div>
                </div>

                <div style={{ marginBottom: 20, padding: "14px 16px", background: "rgba(103,80,164,0.06)", border: "1px solid rgba(103,80,164,0.18)", borderRadius: 8 }}>
                  {taskPrompt === "loading" ? (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>프롬프트 템플릿 조회 중...</p>
                  ) : taskPrompt === "none" || taskPrompt === null ? (
                    <div>
                      <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#c62828" }}>⚠ 프롬프트 템플릿을 찾지 못했습니다.</p>
                      <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.7 }}>
                        <strong>AI 요청 코멘트를 직접 작성하신 후</strong><br />AI에게 요청하시겠습니까?
                      </p>
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>✅ 프롬프트 템플릿 찾았습니다</p>
                      <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 700, color: "rgba(103,80,164,1)" }}>{taskPrompt.tmplNm}</p>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>해당 프롬프트와 함께 전달하도록 하겠습니다.</p>
                    </>
                  )}
                </div>

                <div style={{ marginBottom: 24, fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                  <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--color-text-primary)" }}>전달되는 내용</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {taskPrompt && taskPrompt !== "loading" && taskPrompt !== "none" && (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>시스템 프롬프트</span>
                        <span>{taskPrompt.tmplNm}</span>
                      </div>
                    )}
                    {/* INSPECT: 전체설계(단위업무+화면+다른영역) / 점검내용(현재영역+기능) 구분 안내 */}
                    {aiConfirm.taskType === "INSPECT" && (
                      <>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>전체설계</span>
                          <span>단위업무 · 화면 · 같은 화면의 다른 영역 (기능 상세 제외)</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>점검내용</span>
                          <span>현재 영역 설명 + 영역 내 기능 전체</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>AI 요청 확인</p>
                <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  <strong>{aiConfirm.label}</strong>을 요청하시겠습니까?<br />
                  영역 설명과 AI 요청 코멘트가 함께 전달됩니다.
                </p>
              </>
            )}

            {/* AI 요청 코멘트 입력 */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>
                <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px" }}>코멘트</span>
                AI 요청 코멘트
              </label>
              <textarea
                value={asciiComment}
                onChange={(e) => setAsciiComment(e.target.value)}
                placeholder="AI 요청 시 참고할 추가 지시사항을 입력해 주세요"
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 13, resize: "vertical", lineHeight: 1.6, outline: "none" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => { setAiConfirm(null); setTaskPrompt(null); }} style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 18px" }}>취소</button>
              {(aiConfirm.taskType === "INSPECT" || aiConfirm.taskType === "DESIGN") && taskPrompt === "none" && (
                <button
                  onClick={() => { aiMutation.mutate({ taskType: aiConfirm.taskType }); setAiConfirm(null); setTaskPrompt(null); }}
                  disabled={aiMutation.isPending || !asciiComment.trim()}
                  style={{ ...primaryBtnStyle, fontSize: 13, padding: "7px 18px", background: asciiComment.trim() ? "#e65100" : "#ccc", cursor: asciiComment.trim() ? "pointer" : "not-allowed" }}
                >
                  코멘트로 처리
                </button>
              )}
              <button
                onClick={() => { aiMutation.mutate({ taskType: aiConfirm.taskType }); setAiConfirm(null); setTaskPrompt(null); }}
                disabled={
                  aiMutation.isPending ||
                  ((aiConfirm.taskType === "INSPECT" || aiConfirm.taskType === "DESIGN") &&
                    (taskPrompt === "loading" || taskPrompt === "none" || taskPrompt === null))
                }
                style={{
                  ...primaryBtnStyle, fontSize: 13, padding: "7px 20px",
                  opacity: ((aiConfirm.taskType === "INSPECT" || aiConfirm.taskType === "DESIGN") &&
                    (taskPrompt === "none" || taskPrompt === null || taskPrompt === "loading")) ? 0.3 : 1,
                  cursor: ((aiConfirm.taskType === "INSPECT" || aiConfirm.taskType === "DESIGN") &&
                    (taskPrompt === "none" || taskPrompt === null || taskPrompt === "loading")) ? "not-allowed" : "pointer",
                }}
              >
                요청
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 타이틀 행 — full-width 배경, 좌: ← 타이틀 | 우: AI버튼·Excalidraw·취소·저장 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        {/* 좌: 뒤로 + 타이틀 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/areas`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "영역 신규 등록" : `영역 편집 (${data?.displayId ?? ""})`}
          </span>
        </div>

        {/* 스페이서 */}
        <div style={{ flex: 1 }} />

        {/* 우: AI 버튼 + 구분선 + Excalidraw + 취소·저장 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <style>{`@keyframes _spin{to{transform:rotate(360deg)}}`}</style>

          {/* 디자인 설계 (Excalidraw) */}
          {!isNew && (
            <ExcalidrawDialog
              value={excalidrawData}
              onSave={(d) => excalidrawSaveMutation.mutate(d)}
              saving={excalidrawSaveMutation.isPending}
            />
          )}

          {/* ★ AI 작업 드롭다운 버튼 */}
          {!isNew && (
            <>
              <div ref={aiPanelRef} style={{ position: "relative" }}>
                <button
                  onClick={() => setAiPanelOpen((v) => !v)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 14px",
                    borderRadius: 8,
                    border: "1px solid rgba(103,80,164,0.35)",
                    background: aiPanelOpen ? "rgba(103,80,164,0.1)" : "rgba(103,80,164,0.06)",
                    color: "rgba(103,80,164,1)",
                    fontSize: 13, fontWeight: 700,
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  <span>★</span>
                  AI 작업
                  <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
                </button>

                {/* 드롭다운 패널 — AREA_AI_INSPECT_CONFIG 단일 카드 */}
                {aiPanelOpen && (() => {
                  // 변수를 IIFE 내부에서 추출 — JSX return 전에 계산
                  const { taskType, label, desc, icon } = AREA_AI_INSPECT_CONFIG;
                  const inspectInfo   = data?.aiTasks?.[taskType];
                  const isMutPending  = aiMutation.isPending && aiMutation.variables?.taskType === taskType;
                  const isSpinning    = isMutPending || !!(inspectInfo && ["PENDING", "IN_PROGRESS"].includes(inspectInfo.status));
                  const dotColor      = inspectInfo ? (AREA_AI_STATUS_DOT[inspectInfo.status] ?? "#ccc") : "#ccc";
                  const statusLabel   = isMutPending && !inspectInfo
                    ? "대기 중..."
                    : inspectInfo ? (AREA_AI_STATUS_LABEL[inspectInfo.status] ?? inspectInfo.status) : "-";

                  return (
                    <div style={{
                      position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 300,
                      background: "var(--color-bg-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
                      padding: "14px 16px",
                      width: 470,
                    }}>
                      <style>{`
                        .ai-area-card { transition: background 0.15s, border-color 0.15s; }
                        .ai-area-card:hover { background: rgba(103,80,164,0.07) !important; border-color: rgba(103,80,164,0.3) !important; }
                        .ai-area-btn { transition: background 0.12s, color 0.12s, border-color 0.12s; }
                        .ai-area-btn:hover:not(:disabled) { background: var(--color-bg-muted) !important; color: var(--color-text-primary) !important; border-color: rgba(103,80,164,0.35) !important; }
                        .ai-area-btn-run:hover:not(:disabled) { background: rgba(103,80,164,0.18) !important; }
                      `}</style>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>AI 작업 현황</span>
                        <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{data?.displayId ?? ""}</span>
                      </div>

                      {/* 카드 */}
                      <div className="ai-area-card" style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 14px", borderRadius: 8,
                        border: "1px solid var(--color-border)",
                        background: "var(--color-bg-muted)",
                      }}>
                        {/* 아이콘 */}
                        <div style={{
                          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: icon.bg, fontSize: 18,
                        }}>
                          {icon.emoji}
                        </div>

                        {/* 레이블 + 설명 */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: 5 }}>
                            {label}
                            <button
                              onClick={(e) => { e.stopPropagation(); setHelpOpen(true); }}
                              title="도움말"
                              style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 16, height: 16, borderRadius: "50%",
                                border: "1px solid var(--color-border)",
                                background: "var(--color-bg-card)",
                                color: "var(--color-text-secondary)",
                                fontSize: 10, fontWeight: 700,
                                cursor: "pointer", flexShrink: 0,
                                lineHeight: 1, padding: 0,
                              }}
                            >
                              ?
                            </button>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2, lineHeight: 1.4, whiteSpace: "pre-line" }}>
                            {desc}
                          </div>
                        </div>

                        {/* 상태 + 버튼 */}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                            <span style={{ fontSize: 11, color: dotColor, fontWeight: 600, whiteSpace: "nowrap" }}>
                              {statusLabel}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 4 }}>
                            {inspectInfo && (
                              <button
                                className="ai-area-btn"
                                onClick={() => setAiDetailTaskId(inspectInfo.aiTaskId)}
                                title="내용 보기"
                                style={areaAiMiniBtn}
                              >
                                내용
                              </button>
                            )}
                            <button
                              className="ai-area-btn ai-area-btn-run"
                              onClick={() => openPromptConfirm(taskType, label)}
                              disabled={isSpinning || aiMutation.isPending}
                              style={{
                                ...areaAiMiniBtn,
                                background: "rgba(103,80,164,0.1)",
                                color: "rgba(103,80,164,0.95)",
                                border: "1px solid rgba(103,80,164,0.3)",
                                fontWeight: 700,
                                cursor: isSpinning ? "not-allowed" : "pointer",
                                opacity: isSpinning ? 0.5 : 1,
                              }}
                            >
                              {inspectInfo ? "재 요청" : "실행"}
                            </button>
                            {inspectInfo && (
                              <button
                                className="ai-area-btn"
                                onClick={() => setAiHistoryTaskType(taskType)}
                                title="이력 목록"
                                style={{ ...areaAiMiniBtn, fontSize: 13, padding: "2px 6px", lineHeight: 1 }}
                              >
                                ☰
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* AI 구현 — 공통 컴포넌트 */}
                      <div style={{ marginTop: 8 }}>
                        <AiImplementCard
                          projectId={projectId}
                          refType="AREA"
                          refId={areaId}
                          implInfo={data?.aiTasks?.["IMPLEMENT"] ?? null}
                          onInvalidate={() => queryClient.invalidateQueries({ queryKey: ["area", projectId, areaId] })}
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          )}

          {/* PRD 다운로드 */}
          {!isNew && (
            <button
              onClick={() => setPrdOpen(true)}
              title="PRD 다운로드"
              style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 12px" }}
            >
              PRD ↓
            </button>
          )}

          {/* 구분선 */}
          {!isNew && <div style={{ width: 1, height: 20, background: "var(--color-border)" }} />}

          {/* 삭제 */}
          {!isNew && (
            <button
              onClick={() => setDeleteConfirmOpen(true)}
              style={{ ...dangerBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
            >
              삭제
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 16 }}>
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

            {/* 영역명 + 표시 ID + 정렬순서 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 150px 80px", gap: 16 }}>
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
                <label style={{ ...labelStyle, display: "inline-flex", alignItems: "center", gap: 4 }}>표시 ID<DisplayIdHelp /></label>
                <input
                  type="text"
                  value={displayIdInput}
                  onChange={(e) => setDisplayIdInput(e.target.value)}
                  placeholder="자동 생성"
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

          {/* ── 레이아웃 + 첨부파일 (수정 모드에서만) ── */}
          {!isNew && (
            <>
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

          {/* AR-00073 요약 정보 — 삭제됨 */}

          {/* ── AR-00074 기능 목록 ────────────────────────────────────── */}
          {!isNew && (
            <section style={sectionStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>기능 목록</span>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    총 {data?.functions.length ?? 0}개
                  </span>
                </div>
                <button
                  onClick={() => router.push(`/projects/${projectId}/functions/new?areaId=${areaId}`)}
                  style={{
                    padding: "4px 12px", borderRadius: 5, border: "1px solid var(--color-border)",
                    background: "var(--color-bg-card)", color: "var(--color-primary, #1976d2)",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  + 추가
                </button>
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
                    <div style={{ textAlign: "center" }}>설/구/테</div>
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
                      <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
                        (<span style={{ color: "#1565c0" }}>{fn.designRt ?? 0}</span>
                        /<span style={{ color: "#2e7d32" }}>{fn.implRt ?? 0}</span>
                        /<span style={{ color: "#6a1b9a" }}>{fn.testRt ?? 0}</span>)
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

// ── 표시 ID 도움말 ───────────────────────────────────────────────────────────

function DisplayIdHelp() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="도움말"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 16, height: 16, borderRadius: "50%",
          border: "1.5px solid var(--color-text-secondary)",
          background: "transparent", color: "var(--color-text-secondary)",
          fontSize: 10, fontWeight: 700, cursor: "pointer", padding: 0, lineHeight: 1,
        }}
      >?</button>
      {open && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}
          onClick={() => setOpen(false)}
        >
          <div style={{ background: "var(--color-bg-card)", borderRadius: 12, padding: "24px 28px", minWidth: 400, maxWidth: 520, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>표시 ID</span>
              <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.8, whiteSpace: "pre-line" }}>
              {"명칭 대신 화면에 표시되는 고유 식별자입니다.\n비워 두면 자동으로 생성됩니다.\n\n예시)\n• 단위업무: UW-00001\n• 화면: SCR-00001\n• 영역: AR-00001\n• 기능: FN-00001"}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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

const FUNC_GRID_TEMPLATE = "60px 1fr 100px 100px 100px";

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

const dangerBtnStyle: React.CSSProperties = {
  padding:      "8px 16px",
  borderRadius: 6,
  border:       "1px solid #f5c6cb",
  background:   "var(--color-bg-card)",
  color:        "#c62828",
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

// 영역 AI 점검 도움말 — 프롬프트 기반 정확한 설명
const AREA_AI_HELP = {
  title: "영역 AI 점검 — 6가지 관점 설계 검토",
  sections: [
    {
      heading: "무엇을 하나요?",
      body: "현재 영역과 하위 기능 전체를 대상으로 설계 품질을 6가지 관점에서 점검합니다.\n\n① 영역-기능 항목 대조 — 영역 구성 항목의 UI 요소와 FID가 1:1 대응하는지\n② 기능 명세 완전성 — API 경로, Input/Output, 처리 로직, 에러 처리 정의 여부\n③ 참조 테이블 정합성 — 처리 로직에서 사용하는 테이블이 모두 나열되었는지\n④ 권한 반영 여부 — 권한별 403 에러 처리 및 UI 숨김/비활성화 명시 여부\n⑤ 화면 흐름 연결성 — 이동 버튼과 전달 파라미터가 전체 설계와 일치하는지\n⑥ API 경로 일관성 — RESTful 컨벤션 및 동일 리소스 CRUD 경로 일관성",
    },
    {
      heading: "잘 쓰려면",
      body: "영역 설명란에 내용을 먼저 채워야 합니다.\n하위 기능들의 설명(description)도 함께 전달되므로,\n기능별 설명이 충실할수록 점검 결과가 정확합니다.",
    },
    {
      heading: "AI에 전달되는 데이터",
      body: "Top-down + Bottom-up 양방향으로 수집합니다.\n\n[점검 대상] (Bottom-up)\n✔ 현재 영역 (AR) — 영역 설명 포함\n✔ 영역 하위 기능 전체 (FID) — 각 기능의 설명 포함\n\n[맥락 참조] (Top-down)\n✔ 단위업무 (직계 상위 1개)\n✔ 화면 (직계 상위 1개)\n✔ 같은 화면의 다른 영역들 — 영역명·유형만 (기능 상세 미포함)\n\n✘ 다른 화면의 영역·기능은 포함되지 않습니다.\n✘ 다른 영역의 하위 기능 상세는 포함되지 않습니다.",
    },
  ],
};

// 영역 AI 점검 카드 설정 — 드롭다운 패널에서 사용
const AREA_AI_INSPECT_CONFIG = {
  taskType: "INSPECT",
  label:    "영역 AI 점검",
  desc:     "같은 화면의 다른 영역 맥락 기반\n설계 정합성 6가지 관점 점검",
  icon:     { bg: "#e8f5e9", emoji: "✓" },
};

// 상태별 도트 색상
const AREA_AI_STATUS_DOT: Record<string, string> = {
  PENDING:     "#f57c00",
  IN_PROGRESS: "#1565c0",
  DONE:        "#2e7d32",
  APPLIED:     "#6a1b9a",
  REJECTED:    "#c62828",
  FAILED:      "#c62828",
  TIMEOUT:     "#757575",
};

// 상태별 한글 레이블
const AREA_AI_STATUS_LABEL: Record<string, string> = {
  PENDING:     "대기 중",
  IN_PROGRESS: "처리 중",
  DONE:        "완료",
  APPLIED:     "적용됨",
  REJECTED:    "반려",
  FAILED:      "실패",
  TIMEOUT:     "시간 초과",
};

// AI 카드 내 미니 버튼 공통 스타일
const areaAiMiniBtn: React.CSSProperties = {
  padding: "3px 8px", borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)",
  fontSize: 11, cursor: "pointer",
  whiteSpace: "nowrap",
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
