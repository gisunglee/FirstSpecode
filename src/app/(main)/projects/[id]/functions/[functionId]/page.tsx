"use client";

/**
 * FunctionDetailPage — 기능 상세·편집 (PID-00051)
 *
 * 역할:
 *   - 기능 상세 조회 (FID-00171)
 *   - 기능 생성/수정 + 명세 편집 (FID-00172, 00173)
 *   - AI 명세 누락 검토 요청 (FID-00174)
 *   - 하단 컬럼 매핑 목록 (FID-00178)
 *   - 컬럼 매핑 관리 팝업 (PID-00053 / FID-00181)
 *
 * 주요 기술:
 *   - TanStack Query: 상세 조회 및 뮤테이션
 *   - functionId === "new"이면 신규 모드
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
import SettingsHistoryDialog from "@/components/ui/SettingsHistoryDialog";
import ColMappingDialog from "@/components/ui/ColMappingDialog";
import PrdDownloadDialog from "@/components/ui/PrdDownloadDialog";
import AreaAttachFiles from "@/components/ui/AreaAttachFiles";
import AiTaskFilePicker from "@/components/ui/AiTaskFilePicker";
import AiTaskDetailDialog from "@/components/ui/AiTaskDetailDialog";
import AiImplementCard from "@/components/ui/AiImplementCard";
import AiTaskHistoryDialog from "@/components/ui/AiTaskHistoryDialog";
import ProgressTracker from "@/components/ui/ProgressTracker";
import { useAppStore } from "@/store/appStore";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type AiTaskInfo = { aiTaskId: string; status: string };

type FuncDetail = {
  funcId: string;
  displayId: string;
  name: string;
  description: string;
  commentCn: string;
  type: string;
  status: string;
  priority: string;
  complexity: string;
  effort: string;
  assignMemberId: string | null;
  implStartDate: string;
  implEndDate: string;
  sortOrder: number;
  areaId: string | null;
  areaName: string;
  areaDisplayId: string | null;
  screenId: string | null;
  unitWorkId: string | null;
  // 단위업무 설명 — TABLE_SCRIPT 파싱용
  unitWorkDc: string;
  aiTasks: Record<string, AiTaskInfo>;
};

type AreaOption = { areaId: string; displayId: string; name: string };

type ColMappingItem = {
  mappingId: string;
  usePurpsCn: string;
  ioSeCode: string;
  uiTyCode: string;
  tableName: string;
  colName: string;
  refGrpCode: string;
  sortOrder: number;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function FunctionDetailPage() {
  return (
    <Suspense fallback={null}>
      <FunctionDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function FunctionDetailPageInner() {
  const params = useParams<{ id: string; functionId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { setBreadcrumb } = useAppStore();
  const projectId = params.id;
  const functionId = params.functionId;
  const isNew = functionId === "new";
  const presetAreaId = searchParams.get("areaId") ?? "";

  // ── 설명 예시 팝업 상태 ────────────────────────────────────────────────────
  const [descExampleOpen, setDescExampleOpen] = useState(false);

  // ── 변경 이력 관련 상태 ────────────────────────────────────────────────────
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyViewOpen, setHistoryViewOpen] = useState(false);
  const [originalDescription, setOriginalDescription] = useState("");

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [displayId, setDisplayId] = useState("");
  const [type, setType] = useState("OTHER");
  const [description, setDescription] = useState("");
  const [descTab, setDescTab] = useState<"edit" | "preview">("edit");
  const [priority, setPriority] = useState("MEDIUM");
  const [complexity, setComplexity] = useState("MEDIUM");
  const [effort, setEffort] = useState("");
  const [assignMemberId, setAssignMemberId] = useState("");
  const [implStartDate, setImplStartDate] = useState("");
  const [implEndDate, setImplEndDate] = useState("");
  const [areaId, setAreaId] = useState(presetAreaId);
  const [sortOrder, setSortOrder] = useState(0);

  // ── AI 요청 코멘트 상태 ────────────────────────────────────────────────────
  const [commentCn, setCommentCn] = useState("");


  // ── PRD 다운로드 팝업 ────────────────────────────────────────────────────────
  const [prdOpen, setPrdOpen] = useState(false);

  // ── 삭제 확인 다이얼로그 ─────────────────────────────────────────────────────
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // ── AI 작업 드롭다운 패널 ────────────────────────────────────────────────────
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const aiPanelRef = useRef<HTMLDivElement>(null);

  // ── AI 패널 팝업 상태 ────────────────────────────────────────────────────────
  const [aiDetailTaskId, setAiDetailTaskId] = useState<string | null>(null);
  const [aiHistoryTaskType, setAiHistoryTaskType] = useState<string | null>(null);
  // 단위업무 기간 범위 경고 모달
  const [periodAlert, setPeriodAlert] = useState<{
    messages: string[]; uwId: string; newStart: string | null; newEnd: string | null;
  } | null>(null);

  // ── AI 도움말 팝업 상태 ──────────────────────────────────────────────────────
  const [helpOpen, setHelpOpen] = useState<string | null>(null);

  // ── 컬럼 매핑 팝업 ─────────────────────────────────────────────────────────
  const [mappingPopupOpen, setMappingPopupOpen] = useState(false);
  const [mappingMdOpen, setMappingMdOpen] = useState(false);

  // ── 컬럼 매핑 목록 조회 (기존 저장 데이터 표시용) ──────────────────────────
  const { data: colMappingsData, refetch: refetchMappings } = useQuery({
    queryKey: ["col-mappings", projectId, "FUNCTION", functionId],
    queryFn: () =>
      authFetch<{ data: { items: ColMappingItem[] } }>(
        `/api/projects/${projectId}/col-mappings?refType=FUNCTION&refId=${functionId}`
      ).then((r) => r.data),
    enabled: !isNew,
  });
  const colMappings = colMappingsData?.items ?? [];

  // ── 영역 목록 (areaId 선택용) ──────────────────────────────────────────────
  const { data: areasData } = useQuery({
    queryKey: ["areas", projectId],
    queryFn: () =>
      authFetch<{ data: { items: AreaOption[] } }>(`/api/projects/${projectId}/areas`)
        .then((r) => r.data),
  });
  const areaOptions = areasData?.items ?? [];

  // ── 기능 상세 조회 ────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["function", projectId, functionId],
    queryFn: () =>
      authFetch<{ data: FuncDetail }>(`/api/projects/${projectId}/functions/${functionId}`)
        .then((r) => r.data),
    enabled: !isNew,
  });

  // GNB 브레드크럼 설정 — 단위업무 > 화면 > 영역 > 기능
  useEffect(() => {
    if (isNew) {
      setBreadcrumb([
        { label: "기능 정의", href: `/projects/${projectId}/functions` },
        { label: "신규 등록" },
      ]);
    } else if (data) {
      const d = data as unknown as {
        unitWorkId?: string | null; unitWorkDisplayId?: string | null; unitWorkName?: string;
        screenId?: string | null;   screenDisplayId?: string | null;   screenName?: string;
      };
      const items = [
        // 단위업무
        ...(d.unitWorkId && d.unitWorkName
          ? [{ label: `${d.unitWorkDisplayId ?? ""} ${d.unitWorkName}`.trim(), href: `/projects/${projectId}/unit-works/${d.unitWorkId}` }]
          : []),
        // 화면
        ...(d.screenId && d.screenName
          ? [{ label: `${d.screenDisplayId ?? ""} ${d.screenName}`.trim(), href: `/projects/${projectId}/screens/${d.screenId}` }]
          : []),
        // 영역
        ...(data.areaId && data.areaName
          ? [{ label: `${data.areaDisplayId ?? ""} ${data.areaName}`.trim(), href: `/projects/${projectId}/areas/${data.areaId}` }]
          : []),
        // 기능 (현재 페이지 — href 없음)
        { label: `${data.displayId} ${data.name}` },
      ];
      setBreadcrumb(items);
    }
    return () => setBreadcrumb([]);
  }, [projectId, isNew, data, setBreadcrumb]);

  // AI 작업 패널 외부 클릭 시 닫기
  // 다른 다이얼로그(구현 대상 선택, 이력 팝업, 상세 팝업, 기간 알림)가 열려있으면 외부 클릭 닫기 무시
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (aiHistoryTaskType || aiDetailTaskId || periodAlert) return;
      // AiImplementCard 내부 팝업(overlay)이 열려있으면 외부 클릭 감지 무시
      const target = e.target as HTMLElement;
      if (target.closest('[data-impl-overlay]')) return;
      if (aiPanelRef.current && !aiPanelRef.current.contains(e.target as Node)) {
        setAiPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [aiHistoryTaskType, aiDetailTaskId, periodAlert]);

  useEffect(() => {
    if (data) {
      setName(data.name);
      setDisplayId(data.displayId ?? "");
      setType(data.type);
      setDescription(data.description);
      setPriority(data.priority);
      setComplexity(data.complexity);
      setEffort(data.effort);
      setAssignMemberId(data.assignMemberId ?? "");
      setImplStartDate(data.implStartDate);
      setImplEndDate(data.implEndDate);
      setAreaId(data.areaId ?? "");
      setSortOrder(data.sortOrder ?? 0);
      setCommentCn(data.commentCn ?? "");
      // 설명 변경 감지를 위해 원본 값 보관
      setOriginalDescription(data.description ?? "");
    }
  }, [data]);

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation<{ data: { funcId?: string } }, Error, { saveHistory?: boolean }>({
    mutationFn: ({ saveHistory } = {}) => {
      const body = {
        areaId: areaId || null,
        displayId: displayId.trim() || undefined,
        name: name.trim(), type, description: description.trim(),
        commentCn: commentCn.trim(),
        priority, complexity, effort: effort.trim(),
        assignMemberId: assignMemberId || null,
        implStartDate: implStartDate || null,
        implEndDate: implEndDate || null,
        sortOrder,
        saveHistory: saveHistory || undefined,
      };
      if (isNew) {
        return authFetch<{ data: { funcId?: string } }>(`/api/projects/${projectId}/functions`, {
          method: "POST", body: JSON.stringify(body),
        });
      }
      return authFetch<{ data: { funcId?: string } }>(`/api/projects/${projectId}/functions/${functionId}`, {
        method: "PUT", body: JSON.stringify(body),
      });
    },
    onSuccess: (res, variables) => {
      toast.success(isNew ? "기능이 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["functions", projectId] });
      if (isNew && res.data.funcId) {
        router.replace(`/projects/${projectId}/functions/${res.data.funcId}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ["function", projectId, functionId] });
        setOriginalDescription(description.trim());
        if (variables?.saveHistory) {
          queryClient.invalidateQueries({ queryKey: ["settings-history", projectId] });
        }
        // 단위업무 기간 범위 검증 — 벗어났으면 추가로 컨펌 모달 표시
        const violation = checkUnitWorkPeriod();
        if (violation) setPeriodAlert(violation);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 단위업무 기간 자동 조정 뮤테이션 ────────────────────────────────────────
  // 기능의 구현 기간이 단위업무 기간을 벗어났을 때, 단위업무 기간을 확장하여 포함시킴
  const adjustUnitWorkMutation = useMutation({
    mutationFn: async ({ uwId, startDate, endDate }: { uwId: string; startDate: string | null; endDate: string | null }) => {
      // 단위업무 PUT은 name이 필수이므로 먼저 detail GET → 전체 필드를 그대로 PUT
      const uw = await authFetch<{ data: {
        name: string; description: string; comment?: string; assignMemberId: string | null;
        startDate: string | null; endDate: string | null; progress: number; sortOrder: number;
      } }>(`/api/projects/${projectId}/unit-works/${uwId}`).then((r) => r.data);

      return authFetch(`/api/projects/${projectId}/unit-works/${uwId}`, {
        method: "PUT",
        body: JSON.stringify({
          name:           uw.name,
          description:    uw.description,
          comment:        uw.comment,
          assignMemberId: uw.assignMemberId,
          progress:       uw.progress,
          sortOrder:      uw.sortOrder,
          startDate:      startDate ?? uw.startDate,
          endDate:        endDate ?? uw.endDate,
        }),
      });
    },
    onSuccess: () => {
      toast.success("단위업무 기간이 조정되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["function", projectId, functionId] });
      queryClient.invalidateQueries({ queryKey: ["unit-work"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 단위업무 기간 범위 검증 ─────────────────────────────────────────────────
  // 기능의 구현 기간이 단위업무 기간을 벗어났는지 확인하고 위반 정보 반환
  // 위반 없으면 null — onSuccess에서 위반 여부에 따라 모달/토스트 분기
  function checkUnitWorkPeriod(): {
    messages: string[]; uwId: string; newStart: string | null; newEnd: string | null;
  } | null {
    if (!data) return null;
    const d = data as unknown as { unitWorkId?: string | null; unitWorkStartDate?: string | null; unitWorkEndDate?: string | null };
    if (!d.unitWorkId) return null;

    const fnStart = implStartDate || null;
    const fnEnd   = implEndDate   || null;
    const uwStart = d.unitWorkStartDate || null;
    const uwEnd   = d.unitWorkEndDate   || null;

    const messages: string[] = [];
    let newUwStart: string | null = null;
    let newUwEnd: string | null = null;

    if (fnStart && uwStart && fnStart < uwStart) {
      messages.push(`구현 시작일(${fnStart})이 단위업무 시작일(${uwStart})보다 빠릅니다.`);
      newUwStart = fnStart;
    }
    if (fnEnd && uwEnd && fnEnd > uwEnd) {
      messages.push(`구현 종료일(${fnEnd})이 단위업무 종료일(${uwEnd})보다 늦습니다.`);
      newUwEnd = fnEnd;
    }

    if (messages.length === 0) return null;
    return { messages, uwId: d.unitWorkId, newStart: newUwStart, newEnd: newUwEnd };
  }

  // ── 삭제 뮤테이션 ──────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/functions/${functionId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("기능이 삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["functions", projectId] });
      router.push(`/projects/${projectId}/functions`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── AI 컨펌 상태 ──────────────────────────────────────────────────────────
  const [aiConfirm, setAiConfirm] = useState<{ taskType: string; label: string } | null>(null);

  // 팝업 내부에서 첨부할 참고 이미지 — "요청" 시 multipart로 함께 전송
  // aiConfirm이 닫힐 때 초기화 (취소/성공 모두)
  const [aiPickedFiles, setAiPickedFiles] = useState<File[]>([]);

  // DESIGN/INSPECT 공통: 프롬프트 템플릿 조회 결과 (버튼 클릭 시 fetch → 컨펌 창에 표시)
  const [taskPrompt, setTaskPrompt] = useState<{ tmplId: string; tmplNm: string } | null | "loading" | "none">(null);

  async function openPromptConfirm(taskType: string, label: string) {
    if (!description.trim()) { toast.error("설명을 먼저 입력해 주세요."); return; }
    setTaskPrompt("loading");
    setAiConfirm({ taskType, label });
    try {
      const res = await authFetch<{ data: Array<{ tmplId: string; tmplNm: string; defaultYn: string }> }>(
        // refType 필터 없이 조회 — 프로젝트/시스템 공통 템플릿 중 해당 taskType 전부 검색
        `/api/projects/${projectId}/prompt-templates?taskType=${taskType}&refType=FUNCTION&useYn=Y`
      );
      const list = res.data ?? [];
      // defaultYn='Y' 우선, 없으면 첫 번째 (sort_ordr ASC 정렬이므로 첫 번째가 최우선)
      const preferred = list.find((t) => t.defaultYn === "Y") ?? list[0] ?? null;
      setTaskPrompt(preferred ? { tmplId: preferred.tmplId, tmplNm: preferred.tmplNm } : "none");
    } catch {
      setTaskPrompt("none");
    }
  }

  // ── AI 요청 뮤테이션 ──────────────────────────────────────────────────────
  // multipart/form-data로 전송 — 텍스트 필드 + 첨부 이미지(aiPickedFiles) 동봉
  // authFetch는 Content-Type을 application/json으로 강제하므로 raw fetch 사용
  // 첨부가 없어도 multipart로 보냄 (서버는 둘 다 수용 — aiTaskAttach.ts)
  const aiMutation = useMutation({
    mutationFn: async ({ taskType }: { taskType: string }) => {
      const fd = new FormData();
      fd.append("taskType",  taskType);
      fd.append("coment_cn", commentCn.trim());
      fd.append("req_cn",    description.trim());
      // 하위 호환성 — 일부 코드 경로에서 "comment" 키를 읽을 수 있음
      fd.append("comment",   commentCn.trim());
      aiPickedFiles.forEach((f) => fd.append("files", f));

      const at  = typeof window !== "undefined" ? (sessionStorage.getItem("access_token") ?? "") : "";
      const res = await fetch(`/api/projects/${projectId}/functions/${functionId}/ai`, {
        method:  "POST",
        body:    fd,
        headers: at ? { Authorization: `Bearer ${at}` } : {},
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { message?: string }).message ?? "AI 요청에 실패했습니다.");
      }
      return res.json();
    },
    onSuccess: (_res, vars) => {
      const labels: Record<string, string> = {
        DESIGN: "AI 설계 요청이 접수되었습니다.",
        INSPECT: "AI 점검 요청이 접수되었습니다.",
      };
      toast.success(labels[vars.taskType] ?? "AI 요청이 접수되었습니다.");
      // 첨부 state 초기화 — 다음 요청 시 이전 이미지가 남지 않도록
      setAiPickedFiles([]);
      // 상태 갱신을 위해 상세 재조회
      queryClient.invalidateQueries({ queryKey: ["function", projectId, functionId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!isNew && isLoading) return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;

  return (
    <div style={{ padding: 0 }}>

      {/* 타이틀 행 — full-width 배경, 좌: ← 타이틀 | 중: 상태 배지(HTML) | 우: 취소·저장 */}
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
            onClick={() => router.push(`/projects/${projectId}/functions`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1 }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "기능 신규 등록" : `기능 편집 (${data?.displayId ?? ""})`}
          </span>
        </div>


        {/* 설계·구현·테스트 진척률 — 수정 모드에서만 */}
        {!isNew && data && (
          <div style={{ marginLeft: 24 }}>
            <ProgressTracker
              projectId={projectId}
              refTable="tb_ds_function"
              refId={functionId}
              phases={["analy", "design", "impl", "test"]}
            />
          </div>
        )}

        {/* 우측 밀어내기 스페이서 */}
        <div style={{ flex: 1 }} />

        {/* 우: AI 버튼 그룹 + 구분선 + 취소·저장 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <style>{`@keyframes _spin{to{transform:rotate(360deg)}}`}</style>

          {/* PRD 다운로드 버튼 */}
          {!isNew && (
            <button
              onClick={() => setPrdOpen(true)}
              title="PRD 다운로드"
              style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 12px" }}
            >
              PRD ↓
            </button>
          )}

          {/* ★ AI 작업 드롭다운 버튼 */}
          {!isNew && (
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
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <span>★</span>
                AI 작업
                <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
              </button>

              {/* 드롭다운 패널 */}
              {aiPanelOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 300,
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
                  padding: "14px 16px",
                  minWidth: 340,
                }}>
                  <style>{`
                    .ai-task-card {
                      transition: background 0.15s, border-color 0.15s;
                    }
                    .ai-task-card:hover {
                      background: rgba(103,80,164,0.07) !important;
                      border-color: rgba(103,80,164,0.3) !important;
                    }
                    .ai-mini-btn {
                      transition: background 0.12s, color 0.12s, border-color 0.12s;
                    }
                    .ai-mini-btn:hover:not(:disabled) {
                      background: var(--color-bg-muted) !important;
                      color: var(--color-text-primary) !important;
                      border-color: rgba(103,80,164,0.35) !important;
                    }
                    .ai-mini-btn-run:hover:not(:disabled) {
                      background: rgba(103,80,164,0.18) !important;
                    }
                  `}</style>
                  {/* 패널 헤더 */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>AI 작업 현황</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{data?.displayId ?? ""}</span>
                  </div>

                  {/* AI 작업 카드 목록 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {AI_TASK_CONFIGS.map(({ taskType, label, desc, icon, hasHelp }) => {
                      const info = data?.aiTasks?.[taskType];
                      // API 요청이 전송 중인지 (뮤테이션 in-flight)
                      const isMutationPending = aiMutation.isPending && aiMutation.variables?.taskType === taskType;
                      // 버튼 비활성 조건: API 전송 중이거나 PENDING/IN_PROGRESS 상태
                      const isSpinning = isMutationPending
                        || !!(info && ["PENDING", "IN_PROGRESS"].includes(info.status));
                      // 도트 색상: 미호출이면 회색
                      const dotColor = info ? (AI_STATUS_DOT[info.status] ?? "#ccc") : "#ccc";
                      // 표시 레이블 결정
                      // - 미호출 + 요청 전송 중: "대기 중..."
                      // - 미호출: "-"
                      // - 상태 있음: AI_STATUS_LABEL 매핑
                      const statusLabel = isMutationPending && !info
                        ? "대기 중..."
                        : info
                          ? (AI_STATUS_LABEL[info.status] ?? info.status)
                          : "-";

                      function handleRun() {
                        // DESIGN·INSPECT는 프롬프트 템플릿 조회 후 상세 컨펌 팝업
                        if (taskType === "DESIGN" || taskType === "INSPECT") { openPromptConfirm(taskType, label); return; }
                        if (!description.trim()) { toast.error("설명을 먼저 입력해 주세요."); return; }
                        setAiConfirm({ taskType, label });
                      }

                      return (
                        <div key={taskType} className="ai-task-card" style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "10px 14px",
                          borderRadius: 8,
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
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>
                                {label}
                              </span>
                              {hasHelp && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setHelpOpen(taskType); }}
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
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2, lineHeight: 1.4 }}>
                              {desc}
                            </div>
                          </div>

                          {/* 상태 + 버튼 (우측 고정, 수직 배치) */}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                              <span style={{ fontSize: 11, color: dotColor, fontWeight: 600, whiteSpace: "nowrap" }}>
                                {statusLabel}
                              </span>
                            </div>
                            <div style={{ display: "flex", gap: 4 }}>
                              {info && (
                                <button
                                  className="ai-mini-btn"
                                  onClick={() => setAiDetailTaskId(info.aiTaskId)}
                                  title="내용 보기"
                                  style={aiMiniBtn}
                                >
                                  내용
                                </button>
                              )}
                              <button
                                className="ai-mini-btn ai-mini-btn-run"
                                onClick={handleRun}
                                disabled={isSpinning || aiMutation.isPending}
                                style={{
                                  ...aiMiniBtn,
                                  background: "rgba(103,80,164,0.1)",
                                  color: "rgba(103,80,164,0.95)",
                                  border: "1px solid rgba(103,80,164,0.3)",
                                  fontWeight: 700,
                                  cursor: isSpinning ? "not-allowed" : "pointer",
                                  opacity: isSpinning ? 0.5 : 1,
                                }}
                              >
                                {info ? "재 요청" : "실행"}
                              </button>
                              {info && (
                                <button
                                  className="ai-mini-btn"
                                  onClick={() => setAiHistoryTaskType(taskType)}
                                  title="이력 목록"
                                  style={{ ...aiMiniBtn, fontSize: 13, padding: "2px 6px", lineHeight: 1 }}
                                >
                                  ☰
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* AI 구현 — 공통 컴포넌트 (ImplTargetDialog + ImplRequestPopup + 상세/이력) */}
                    {!isNew && (
                      <AiImplementCard
                        projectId={projectId}
                        refType="FUNCTION"
                        refId={functionId}
                        implInfo={data?.aiTasks?.["IMPLEMENT"] ?? null}
                        onInvalidate={() => queryClient.invalidateQueries({ queryKey: ["function", projectId, functionId] })}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 구분선 */}
          <div style={{ width: 1, height: 20, background: "var(--color-border)" }} />

          {/* 삭제 버튼 (신규 등록 모드에서는 숨김) */}
          {!isNew && (
            <button
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={saveMutation.isPending || deleteMutation.isPending}
              style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60, color: "#e53935", borderColor: "#e53935" }}
            >
              삭제
            </button>
          )}

          {/* 취소·저장 */}
          <button
            onClick={() => router.push(`/projects/${projectId}/functions`)}
            disabled={saveMutation.isPending}
            style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            취소
          </button>
          <button
            onClick={() => {
              if (!name.trim()) { toast.error("기능명을 입력해 주세요."); return; }
              const descChanged = !isNew && description.trim() !== originalDescription.trim();
              if (descChanged) { setHistoryDialogOpen(true); return; }
              saveMutation.mutate({});
            }}
            disabled={saveMutation.isPending}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* ── 2컬럼 레이아웃: 왼쪽 기본 정보, 오른쪽 설명 + 컬럼 매핑 + AI 지원 */}
      <div style={{ padding: "0 24px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 20, alignItems: "start" }}>

          {/* ── 왼쪽: 기본 정보 + 첨부파일 ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <section style={sectionStyle}>

              {/* 행1: 소속 영역 | 유형 */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0 16px" }}>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>소속 영역</label>
                  <select value={areaId} onChange={(e) => setAreaId(e.target.value)} style={selectStyle}>
                    <option value="">미분류 (영역 없음)</option>
                    {areaOptions.map((a) => (
                      <option key={a.areaId} value={a.areaId}>{a.displayId} {a.name}</option>
                    ))}
                  </select>
                </div>

                <div style={formGroupStyle}>
                  <label style={labelStyle}>유형</label>
                  <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
                    {FUNC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>

              {/* 행2: 기능명 | 표시 ID */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0 16px" }}>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>기능명 <span style={{ color: "#e53935" }}>*</span></label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="기능명을 입력하세요"
                    style={inputStyle}
                  />
                </div>
                <div style={formGroupStyle}>
                  <label style={{ ...labelStyle, display: "inline-flex", alignItems: "center", gap: 4 }}>표시 ID<DisplayIdHelp /></label>
                  <input
                    type="text"
                    value={displayId}
                    onChange={(e) => setDisplayId(e.target.value)}
                    placeholder="미입력 시 자동 생성"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* 행3: 우선순위 | 복잡도 | 예상 공수 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 16px" }}>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>우선순위</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} style={selectStyle}>
                    <option value="HIGH">높음</option>
                    <option value="MEDIUM">중간</option>
                    <option value="LOW">낮음</option>
                  </select>
                </div>

                <div style={formGroupStyle}>
                  <label style={labelStyle}>복잡도</label>
                  <select value={complexity} onChange={(e) => setComplexity(e.target.value)} style={selectStyle}>
                    <option value="HIGH">높음</option>
                    <option value="MEDIUM">중간</option>
                    <option value="LOW">낮음</option>
                  </select>
                </div>

                <div style={formGroupStyle}>
                  <label style={labelStyle}>
                    예상 공수
                    <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: "var(--color-text-secondary)" }}>(단위: 시간)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={effort}
                    onChange={(e) => setEffort(e.target.value)}
                    placeholder="시간 (예: 2, 0.5)"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* 행4: 구현 시작일 | 구현 종료일 | 정렬 순서 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: "0 16px" }}>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>구현 시작일</label>
                  <input
                    type="date"
                    value={implStartDate}
                    onChange={(e) => setImplStartDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div style={formGroupStyle}>
                  <label style={labelStyle}>구현 종료일</label>
                  <input
                    type="date"
                    value={implEndDate}
                    onChange={(e) => setImplEndDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div style={formGroupStyle}>
                  <label style={labelStyle}>정렬</label>
                  <input
                    type="number"
                    min={0}
                    value={sortOrder}
                    onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
                    style={inputStyle}
                  />
                </div>
              </div>

            </section>

            {!isNew && (
              <section style={sectionStyle}>
                <h3 style={sectionTitleStyle}>첨부파일</h3>
                <AreaAttachFiles basePath={`/api/projects/${projectId}/functions/${functionId}`} />
              </section>
            )}
          </div>

          {/* ── 오른쪽: 설명 + 컬럼 매핑 + AI 지원 ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* 설명 (func_dc) — MarkdownEditor */}
            <section style={sectionStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
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
                    onClick={() => setDescription(DESCRIPTION_TEMPLATE(data?.displayId ?? "FN-XXXXX", name))}
                    style={ghostSmBtnStyle}
                  >
                    템플릿 삽입
                  </button>
                  {!isNew && (
                    <button type="button" onClick={() => setHistoryViewOpen(true)} style={ghostSmBtnStyle}>
                      🕐 변경 이력
                    </button>
                  )}
                </div>
              </div>
              <MarkdownEditor
                value={description}
                onChange={setDescription}
                placeholder="기능 설명을 마크다운으로 작성하세요."
                rows={25}
                tab={descTab}
                onTabChange={setDescTab}
              />
            </section>

            {/* 설명 예시 팝업 */}
            {descExampleOpen && (
              <FuncExamplePopup onClose={() => setDescExampleOpen(false)} />
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
                    기능 설명이 변경되었습니다.<br />
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
                      onClick={() => { setHistoryDialogOpen(false); saveMutation.mutate({}); }}
                      disabled={saveMutation.isPending}
                      style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
                    >
                      이력 없이 저장
                    </button>
                    <button
                      type="button"
                      onClick={() => { setHistoryDialogOpen(false); saveMutation.mutate({ saveHistory: true }); }}
                      disabled={saveMutation.isPending}
                      style={{ ...primaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
                    >
                      이력과 함께 저장
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 설명 변경 이력 조회 팝업 */}
            <SettingsHistoryDialog
              open={historyViewOpen}
              onClose={() => setHistoryViewOpen(false)}
              projectId={projectId}
              itemName="기능 설명"
              currentValue={description}
              title="기능 설명 변경 이력"
              refTblNm="tb_ds_function"
              refId={functionId}
            />

            {/* ── AR-00082 컬럼 매핑 — 신규 모드에서는 버튼 disabled */}
            <section style={sectionStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: colMappings.length > 0 ? 12 : 0 }}>
                <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>컬럼 매핑</h3>
                <div style={{ display: "flex", gap: 6 }}>
                  {colMappings.length > 0 && (
                    <button
                      onClick={() => setMappingMdOpen(true)}
                      style={{ ...ghostSmBtnStyle, fontSize: 11, padding: "3px 9px" }}
                    >
                      MD 복사
                    </button>
                  )}
                  <button
                    onClick={() => setMappingPopupOpen(true)}
                    disabled={isNew}
                    title={isNew ? "저장 후 사용할 수 있습니다" : undefined}
                    style={{ ...primaryBtnStyle, fontSize: 11, padding: "3px 10px", opacity: isNew ? 0.4 : 1, cursor: isNew ? "not-allowed" : "pointer" }}
                  >
                    매핑 관리
                  </button>
                </div>
              </div>

              {/* 저장된 매핑 목록 테이블 */}
              {colMappings.length > 0 ? (
                <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
                  {/* 헤더 */}
                  <div style={colMappingHeaderStyle}>
                    <div style={{ flex: "0 0 120px" }}>항목명</div>
                    <div style={{ flex: "0 0 72px", textAlign: "center" }}>IO구분</div>
                    <div style={{ flex: "0 0 90px" }}>UI유형</div>
                    <div style={{ flex: "1 1 0" }}>테이블</div>
                    <div style={{ flex: "1 1 0" }}>컬럼</div>
                    <div style={{ flex: "0 0 120px" }}>공통코드</div>
                  </div>
                  {/* 행 */}
                  {colMappings.map((m, idx) => (
                    <div
                      key={m.mappingId}
                      style={{
                        ...colMappingRowStyle,
                        borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                        background: idx % 2 === 0 ? "var(--color-bg-card)" : "var(--color-bg-muted)",
                      }}
                    >
                      <div style={{ flex: "0 0 120px", fontSize: 12 }}>{m.usePurpsCn || <span style={{ color: "var(--color-text-disabled)" }}>—</span>}</div>
                      <div style={{ flex: "0 0 72px", textAlign: "center" }}>
                        {m.ioSeCode ? (
                          <span style={{
                            display: "inline-block", padding: "1px 7px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                            background: "var(--color-primary, #1976d2)", color: "#fff",
                          }}>
                            {m.ioSeCode === "INPUT" ? "IN" : m.ioSeCode === "OUTPUT" ? "OUT" : "IO"}
                          </span>
                        ) : <span style={{ color: "var(--color-text-disabled)", fontSize: 12 }}>—</span>}
                      </div>
                      <div style={{ flex: "0 0 90px", fontSize: 12, color: "var(--color-text-secondary)" }}>{m.uiTyCode || "—"}</div>
                      <div style={{ flex: "1 1 0", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.tableName || "—"}</div>
                      <div style={{ flex: "1 1 0", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.colName || "—"}</div>
                      <div style={{ flex: "0 0 120px", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.refGrpCode ? (
                          <span style={{
                            padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600,
                            background: "rgba(46,125,50,0.1)", color: "#2e7d32",
                          }}>
                            {m.refGrpCode}
                          </span>
                        ) : <span style={{ color: "var(--color-text-disabled)" }}>—</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                !isNew && (
                  <div style={{ padding: "16px 0 4px", textAlign: "center", fontSize: 13, color: "var(--color-text-disabled)" }}>
                    등록된 컬럼 매핑이 없습니다.
                  </div>
                )
              )}
            </section>
          </div>
        </div>
      </div>

      {/* ── AI 요청 컨펌 다이얼로그 ──────────────────────────────────────── */}
      {aiConfirm && (
        <div
          data-impl-overlay="ai-confirm"
          style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            style={{ width: "100%", maxWidth: (aiConfirm.taskType === "DESIGN" || aiConfirm.taskType === "INSPECT") ? 520 : 420, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 12, boxShadow: "0 12px 48px rgba(0,0,0,0.25)", padding: "32px 36px" }}
          >

            {(aiConfirm.taskType === "DESIGN" || aiConfirm.taskType === "INSPECT") ? (
              <>
                {/* DESIGN/INSPECT 공통 헤더 */}
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

                {/* 프롬프트 템플릿 조회 결과 */}
                <div style={{ marginBottom: 20, padding: "14px 16px", background: "rgba(103,80,164,0.06)", border: "1px solid rgba(103,80,164,0.18)", borderRadius: 8 }}>
                  {taskPrompt === "loading" ? (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
                      프롬프트 템플릿 조회 중...
                    </p>
                  ) : taskPrompt === "none" || taskPrompt === null ? (
                    <div>
                      <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#c62828" }}>
                        ⚠ 프롬프트 템플릿을 찾지 못했습니다.
                      </p>
                      <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.7 }}>
                        <strong>AI 요청 코멘트를 직접 작성하신 후</strong><br />
                        AI에게 요청하시겠습니까?
                      </p>
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>
                        ✅ 프롬프트 템플릿 찾았습니다
                      </p>
                      <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 700, color: "rgba(103,80,164,1)" }}>
                        {taskPrompt.tmplNm}
                      </p>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>
                        해당 프롬프트와 함께 전달하도록 하겠습니다.
                      </p>
                    </>
                  )}
                </div>

                {/* 전달 내용 미리보기 */}
                <div style={{ marginBottom: 24, fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                  <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--color-text-primary)" }}>전달되는 내용</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {taskPrompt && taskPrompt !== "loading" && taskPrompt !== "none" && (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>시스템 프롬프트</span>
                        <span>{taskPrompt.tmplNm}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>설명</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{description.trim().slice(0, 80)}{description.trim().length > 80 ? "…" : ""}</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
                  AI 요청 확인
                </p>
                <p style={{ margin: "0 0 24px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  <strong>{aiConfirm.label}</strong>을 요청하시겠습니까?<br />
                  AI 요청 코멘트가 있으면 함께 전달됩니다.
                </p>
              </>
            )}

            {/* AI 요청 코멘트 입력 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>
                <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px" }}>코멘트</span>
                AI 요청 코멘트
              </label>
              <textarea
                value={commentCn}
                onChange={(e) => setCommentCn(e.target.value)}
                placeholder="AI 요청 시 참고할 추가 지시사항을 입력해 주세요"
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 13, resize: "vertical", lineHeight: 1.6, outline: "none" }}
              />
            </div>

            {/* 참고 이미지 피커 — "요청" 클릭 시 multipart로 함께 전송됨 */}
            {/* Claude 멀티모달 분석용 — 와이어프레임·스크린샷 등 첨부 */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>
                <span style={{ fontSize: 11, background: "rgba(25,118,210,0.12)", color: "#1565c0", borderRadius: 4, padding: "1px 6px" }}>첨부</span>
                참고 이미지 (선택)
              </label>
              <AiTaskFilePicker
                files={aiPickedFiles}
                onChange={setAiPickedFiles}
                disabled={aiMutation.isPending}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => { setAiConfirm(null); setTaskPrompt(null); setAiPickedFiles([]); }}
                style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 18px" }}
              >
                취소
              </button>
              {(aiConfirm.taskType === "DESIGN" || aiConfirm.taskType === "INSPECT") && taskPrompt === "none" && (
                <button
                  onClick={() => {
                    aiMutation.mutate({ taskType: aiConfirm.taskType });
                    setAiConfirm(null);
                    setTaskPrompt(null);
                  }}
                  disabled={aiMutation.isPending || !commentCn.trim()}
                  style={{
                    ...primaryBtnStyle, fontSize: 13, padding: "7px 18px",
                    background: commentCn.trim() ? "#e65100" : "#ccc",
                    cursor: commentCn.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  코멘트로 처리
                </button>
              )}
              {/* DESIGN/INSPECT: 프롬프트 찾은 경우만 활성 / 나머지: 항상 활성 */}
              <button
                onClick={() => {
                  aiMutation.mutate({ taskType: aiConfirm.taskType });
                  setAiConfirm(null);
                  setTaskPrompt(null);
                }}
                disabled={
                  aiMutation.isPending ||
                  ((aiConfirm.taskType === "DESIGN" || aiConfirm.taskType === "INSPECT") &&
                    (taskPrompt === "loading" || taskPrompt === "none" || taskPrompt === null))
                }
                style={{
                  ...primaryBtnStyle, fontSize: 13, padding: "7px 18px",
                  background: "rgba(103,80,164,1)",
                  opacity: ((aiConfirm.taskType === "DESIGN" || aiConfirm.taskType === "INSPECT") &&
                    (taskPrompt === "none" || taskPrompt === null || taskPrompt === "loading")) ? 0.3 : 1,
                  cursor: ((aiConfirm.taskType === "DESIGN" || aiConfirm.taskType === "INSPECT") &&
                    (taskPrompt === "none" || taskPrompt === null || taskPrompt === "loading")) ? "not-allowed" : "pointer",
                }}
              >
                요청
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 컬럼 매핑 마크다운 팝업 ──────────────────────────────────────── */}
      {mappingMdOpen && (
        <ColMappingMdPopup
          mappings={colMappings}
          onClose={() => setMappingMdOpen(false)}
        />
      )}

      {/* ── PRD 다운로드 팝업 ─────────────────────────────────────────── */}
      <PrdDownloadDialog
        open={prdOpen}
        onClose={() => setPrdOpen(false)}
        projectId={projectId}
        availableLevels={["UNIT_WORK", "SCREEN", "AREA", "FUNCTION"]}
        defaultLevel="FUNCTION"
        unitWorkId={data?.unitWorkId}
        screenId={data?.screenId}
        areaId={data?.areaId}
        functionId={functionId}
      />

      {/* ── PID-00053 컬럼 매핑 관리 팝업 ────────────────────────────────── */}
      <ColMappingDialog
        open={mappingPopupOpen}
        onClose={() => setMappingPopupOpen(false)}
        onSaved={() => { setMappingPopupOpen(false); refetchMappings(); }}
        projectId={projectId}
        refType="FUNCTION"
        refId={functionId}
        title="컬럼 매핑 관리"
        unitWorkDc={data?.unitWorkDc ?? ""}
      />

      {/* ── AI 태스크 결과 상세 팝업 ────────────────────────────────────── */}
      {aiDetailTaskId && (
        <AiTaskDetailDialog
          projectId={projectId}
          taskId={aiDetailTaskId}
          onClose={() => setAiDetailTaskId(null)}
          onRejected={() => { setAiDetailTaskId(null); queryClient.invalidateQueries({ queryKey: ["function", projectId, functionId] }); }}
        />
      )}

      {/* ── AI 도움말 팝업 ──────────────────────────────────────────────── */}
      {helpOpen && AI_HELP_CONTENT[helpOpen] && (() => {
        const help = AI_HELP_CONTENT[helpOpen];
        return (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400 }}
            onClick={() => setHelpOpen(null)}
          >
            <div
              style={{ background: "var(--color-bg-card)", borderRadius: 12, padding: "24px 28px", minWidth: 420, maxWidth: 520, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* 팝업 헤더 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
                  {help.title}
                </span>
                <button
                  onClick={() => setHelpOpen(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1, padding: "0 2px" }}
                >
                  ×
                </button>
              </div>

              {/* 섹션 목록 */}
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

      {/* ── AI 태스크 이력 팝업 ─────────────────────────────────────────── */}
      {aiHistoryTaskType && !isNew && (
        <AiTaskHistoryDialog
          projectId={projectId}
          refType="FUNCTION"
          refId={functionId}
          taskType={aiHistoryTaskType as "DESIGN" | "INSPECT" | "IMPLEMENT"}
          onClose={() => setAiHistoryTaskType(null)}
        />
      )}
      {/* ── 단위업무 기간 범위 경고 모달 ─────────────────────────────────── */}
      {periodAlert && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
          onClick={() => setPeriodAlert(null)}
        >
          <div
            style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "24px 28px", minWidth: 420, maxWidth: 520, boxShadow: "0 8px 32px rgba(0,0,0,0.22)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
                구현 기간이 단위업무 기간을 벗어났습니다
              </h3>
            </div>
            <ul style={{ margin: "0 0 18px", paddingLeft: 20, fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.7 }}>
              {periodAlert.messages.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-secondary)" }}>
              단위업무 기간을 자동으로 조정하시겠습니까?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setPeriodAlert(null)}
                style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 16px" }}
              >
                닫기
              </button>
              <button
                onClick={() => {
                  adjustUnitWorkMutation.mutate({
                    uwId:      periodAlert.uwId,
                    startDate: periodAlert.newStart,
                    endDate:   periodAlert.newEnd,
                  });
                  setPeriodAlert(null);
                }}
                disabled={adjustUnitWorkMutation.isPending}
                style={{ ...primaryBtnStyle, fontSize: 13, padding: "7px 16px" }}
              >
                단위업무 기간 수정
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── 삭제 확인 다이얼로그 ─────────────────────────────────────────── */}
      {deleteConfirmOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setDeleteConfirmOpen(false)}
        >
          <div
            style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", minWidth: 380, maxWidth: 480, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>기능을 삭제하시겠습니까?</h3>
            <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--color-text-secondary)" }}>
              &lsquo;{data?.name}&rsquo;
            </p>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#e53935" }}>
              삭제 후 복구할 수 없습니다.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleteMutation.isPending}
                style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 16px" }}
              >
                취소
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                style={{ ...primaryBtnStyle, fontSize: 13, padding: "6px 16px", background: "#e53935" }}
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

// ── (구 ColumnMappingPopup 제거됨 — ColMappingDialog 공통 컴포넌트로 교체)

// ── AI 태스크 설정 ────────────────────────────────────────────────────────────

const AI_TASK_CONFIGS = [
  { taskType: "DESIGN",  label: "AI 설계",   desc: "자유 형식 설명 → 표준 양식 재구성",            icon: { bg: "#e8eaf6", emoji: "⊞" }, hasHelp: true  },
  { taskType: "INSPECT", label: "AI 점검",   desc: "6가지 관점 설계 검토\n(같은 영역 기능 기준)",  icon: { bg: "#e8f5e9", emoji: "✓" }, hasHelp: true  },
];

// 도움말 팝업 내용 — taskType별 정의
const AI_HELP_CONTENT: Record<string, { title: string; sections: { heading: string; body: string }[] }> = {
  DESIGN: {
    title: "AI 설계 — 표준 양식 재구성 + 피드백",
    sections: [
      {
        heading: "무엇을 하나요?",
        body: "설명란에 자유 형식으로 작성한 내용을 표준 설계 양식으로 재구성해 줍니다.\n빈 내용을 AI가 만들어 주는 것이 아니라, 내가 쓴 내용을 정리·재배치합니다.\n\n재구성 양식: 기능 헤더 / Input / Output / 참조 테이블 관계 / 처리 로직 / 업무 규칙\n\n함께 제공: 누락 항목, 잘못된 내용, 개선이 필요한 부분에 대한 피드백",
      },
      {
        heading: "잘 쓰려면",
        body: "설명란에 먼저 내용을 채워야 결과가 나옵니다.\nAPI 경로, Input/Output 파라미터, 처리 로직 등을 자유롭게 적어두면\nAI가 표준 양식에 맞게 정리해 줍니다.",
      },
      {
        heading: "AI에 전달되는 데이터",
        body: "설명(description) 텍스트만 전달됩니다.\n영역·화면·단위업무 정보는 전달되지 않습니다.",
      },
    ],
  },
  INSPECT: {
    title: "AI 점검 — 6가지 관점 설계 검토",
    sections: [
      {
        heading: "무엇을 하나요?",
        body: "같은 영역의 전체 기능 설계서를 기준(Ground Truth)으로 삼아\n현재 기능 명세의 문제점을 6가지 관점에서 점검합니다.\n\n① 중복·충돌 — 같은 영역에 이미 동일·유사 기능이 있는가\n② 누락 — 이 기능이 동작하려면 필요한데 없는 연관 기능이 있는가\n③ 일관성 — API 패턴·명명 규칙이 다른 기능과 맞는가\n④ 권한 정합성 — 권한 처리가 설계서 기준과 일치하는가\n⑤ 업무 규칙 충돌 — 다른 기능의 업무 규칙과 모순되는가\n⑥ 양식 준수 — 표준 양식에서 누락된 섹션이 있는가\n\n문제 없는 항목은 출력하지 않습니다.",
      },
      {
        heading: "AI에 전달되는 데이터",
        body: "Bottom-up으로 직계 상위만 수집합니다.\n\n✔ 단위업무 (직계 상위 1개)\n✔ 화면 (직계 상위 1개)\n✔ 영역 (이 기능이 속한 영역 1개)\n✔ 기능 (같은 영역 내 전체, ★ 현재 기능 포함)\n\n✘ 다른 영역·다른 화면의 기능은 포함되지 않습니다.",
      },
    ],
  },
};

// 상태별 도트 색상 — 버튼 내부에 인라인으로 표시
const AI_STATUS_DOT: Record<string, string> = {
  PENDING: "#f57c00",
  IN_PROGRESS: "#1565c0",
  DONE: "#2e7d32",
  APPLIED: "#6a1b9a",
  REJECTED: "#c62828",
  FAILED: "#c62828",
  TIMEOUT: "#757575",
};

// 상태별 한글 레이블 — 버튼 tooltip에 표시
const AI_STATUS_LABEL: Record<string, string> = {
  PENDING: "대기 중",
  IN_PROGRESS: "처리 중",
  DONE: "완료",
  APPLIED: "적용됨",
  REJECTED: "반려",
  FAILED: "실패",
  TIMEOUT: "시간 초과",
};

// ── 설명 예시 / 템플릿 ────────────────────────────────────────────────────────

const DESCRIPTION_EXAMPLE = `#### 기능: [FN-00001] 게시판 목록 조회

| 항목 | 내용 |
|:-----|:-----|
| 기능ID | FN-00001 |
| 기능명 | 게시판 목록 조회 |
| 기능유형 | SELECT |
| API | \`GET /api/board\` |
| 트리거 | 화면 진입(자동), 검색 버튼 클릭 |

**Input**

| 파라미터 | 타입 | 필수 | DB 매핑 | 설명 |
|:---------|:-----|:-----|:--------|:-----|
| projectId | number | Y (세션) | project_id | |
| boardTypeCd | string | N | board_type_cd | null이면 전체 |
| keyword | string | N | board_title_nm | LIKE 검색 |
| startDt | string | N | reg_dt | >= 조건 (yyyy-MM-dd) |
| endDt | string | N | reg_dt | <= 조건 (yyyy-MM-dd) |
| page | number | Y | - | 1부터 시작 |
| size | number | Y | - | 기본 20 |

**Output**

| 필드 | 타입 | DB 매핑 | 설명 |
|:-----|:-----|:--------|:-----|
| boardId | number | board_id | |
| boardTypeCd | string | board_type_cd | |
| boardTitleNm | string | board_title_nm | |
| regUserNm | string | (JOIN) | 작성자명 |
| regDt | string | reg_dt | |
| viewCnt | number | view_cnt | |
| fixYn | string | fix_yn | |
| attachYn | string | (서브쿼리) | 첨부파일 존재 Y/N |
| totalCount | number | COUNT(*) OVER() | 총 건수 |

**참조 테이블 관계**
\`\`\`
tb_cm_board b
  LEFT JOIN tb_cm_user u ON u.user_id = b.reg_user_id
\`\`\`
- 첨부파일 존재 여부: \`EXISTS (SELECT 1 FROM tb_cm_attach_file WHERE ref_type_cd = 'BOARD' AND ref_id = b.board_id AND del_yn = 'N')\`

**처리 로직**
\`\`\`
1. project_id 세션에서 획득
2. del_yn = 'N' 필터
3. 검색 조건 적용 (boardTypeCd, keyword LIKE, startDt >=, endDt <= +1일)
4. 정렬: fix_yn DESC, reg_dt DESC (상단고정 우선, 최신순)
5. 페이징: LIMIT :size OFFSET (:page - 1) * :size
\`\`\`

**업무 규칙**
- 검색 결과 0건 → "등록된 게시글이 없습니다" 안내
- 상단고정 게시글은 페이지와 무관하게 항상 최상단
- 기간 종료일은 해당일 23:59:59까지 포함`;

const DESCRIPTION_TEMPLATE = (displayId: string, name: string) => `#### 기능: [${displayId}] ${name}

| 항목 | 내용 |
|:-----|:-----|
| 기능ID | ${displayId} |
| 기능명 | ${name} |
| 기능유형 | |
| API | \`\` |
| 트리거 | |

**Input**

| 파라미터 | 타입 | 필수 | DB 매핑 | 설명 |
|:---------|:-----|:-----|:--------|:-----|
| | | | | |

**Output**

| 필드 | 타입 | DB 매핑 | 설명 |
|:-----|:-----|:--------|:-----|
| | | | |

**참조 테이블 관계**
\`\`\`
\`\`\`

**처리 로직**
\`\`\`
1.
\`\`\`

**업무 규칙**
- `;

// ── 상수 ─────────────────────────────────────────────────────────────────────

const FUNC_TYPES = [
  { value: "SEARCH", label: "검색/조회" },
  { value: "SAVE", label: "저장" },
  { value: "DELETE", label: "삭제" },
  { value: "DOWNLOAD", label: "다운로드" },
  { value: "UPLOAD", label: "업로드" },
  { value: "NAVIGATE", label: "이동" },
  { value: "VALIDATE", label: "유효성검증" },
  { value: "OTHER", label: "기타" },
];

// ── 스타일 ────────────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  padding: "16px 20px",
  border: "1px solid var(--color-border)", borderRadius: 8,
  background: "var(--color-bg-card)",
};
const sectionTitleStyle: React.CSSProperties = { margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" };
const colMappingHeaderStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "9px 12px",
  background: "#f5f5f5",
  borderBottom: "1px solid #e0e0e0",
  fontSize: 12, fontWeight: 700, color: "#444",
  letterSpacing: "0.02em",
};
const colMappingRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "7px 12px",
};
const formGroupStyle: React.CSSProperties = { marginBottom: 16 };

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
  display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600,
  color: "var(--color-text-secondary)",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)", fontSize: 14,
  background: "var(--color-bg-card)", color: "var(--color-text-primary)", boxSizing: "border-box",
};
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  paddingRight: 32,
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 14, cursor: "pointer",
};

// AI 패널 내부 미니 버튼 스타일
const aiMiniBtn: React.CSSProperties = {
  padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", cursor: "pointer", whiteSpace: "nowrap",
};



// ── 컬럼 매핑 → 마크다운 변환 ────────────────────────────────────────────────

function buildMappingMarkdown(mappings: ColMappingItem[]): string {
  const IO_LABEL: Record<string, string> = { IN: "IN", OUT: "OUT", IO: "IN/OUT" };
  const UI_LABEL: Record<string, string> = {
    TEXT: "텍스트", TEXTAREA: "텍스트에어리어", SELECT: "콤보박스",
    RADIO: "라디오", CHECKBOX: "체크박스", DATE: "날짜", NUMBER: "숫자",
    FILE: "파일", HIDDEN: "히든",
  };

  const header = "| NO | 항목명 | IO구분 | UI유형 | 테이블.컬럼 | 설명 |";
  const sep = "|:---|:-------|:-------|:-------|:-----------|:-----|";
  const rows = mappings.map((m, i) => {
    const no = i + 1;
    const name = m.usePurpsCn || "-";
    const io = IO_LABEL[m.ioSeCode] || m.ioSeCode || "-";
    const ui = UI_LABEL[m.uiTyCode] || m.uiTyCode || "-";
    const col = m.tableName && m.colName ? `${m.tableName}.${m.colName}` : "-";
    return `| ${no} | ${name} | ${io} | ${ui} | ${col} | - |`;
  });

  return ["**컬럼 매핑**", "", header, sep, ...rows].join("\n");
}

// ── 컬럼 매핑 MD 팝업 ────────────────────────────────────────────────────────

function ColMappingMdPopup({
  mappings,
  onClose,
}: {
  mappings: ColMappingItem[];
  onClose: () => void;
}) {
  const md = buildMappingMarkdown(mappings);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"raw" | "preview">("preview");

  function handleCopy() {
    navigator.clipboard.writeText(md).then(() => {
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
        style={{ background: "var(--color-bg-card)", borderRadius: 10, width: "min(760px, 92vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--color-border)", gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700, flexShrink: 0 }}>컬럼 매핑 마크다운</span>
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
              {md}
            </pre>
          ) : (
            <>
              <style dangerouslySetInnerHTML={{ __html: ".cm-md table{border-collapse:collapse;width:100%}.cm-md th,.cm-md td{border:1px solid #e0e0e0;padding:5px 10px;font-size:13px}.cm-md th{background:#f5f5f5;font-weight:600}.cm-md h2{font-size:14px;font-weight:700;margin:0 0 12px}" }} />
              <div
                className="cm-md"
                style={{ fontSize: 13, lineHeight: 1.8, color: "var(--color-text-primary)" }}
                dangerouslySetInnerHTML={{ __html: markedParse(md) }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const ghostSmBtnStyle: React.CSSProperties = {
  padding: "3px 9px",
  borderRadius: 5,
  border: "1px solid var(--color-border)",
  background: "none",
  color: "var(--color-text-secondary)",
  fontSize: 12,
  cursor: "pointer",
};

// ── 예시 팝업 CSS ─────────────────────────────────────────────────────────────

const FUNC_EXAMPLE_CSS = [
  ".fn-example h3,.fn-example h4{font-size:14px;font-weight:700;margin:16px 0 8px}",
  ".fn-example table{border-collapse:collapse;width:100%;margin-bottom:12px}",
  ".fn-example th,.fn-example td{border:1px solid #e0e0e0;padding:5px 10px;font-size:12px}",
  ".fn-example th{background:#f5f5f5;font-weight:600}",
  ".fn-example pre{background:#f5f5f5;padding:10px 14px;border-radius:6px;font-size:12px;overflow-x:auto}",
  ".fn-example code{font-family:monospace}",
  ".fn-example ul{padding-left:18px;margin:4px 0}",
].join(" ");

// ── 예시 팝업 컴포넌트 ────────────────────────────────────────────────────────

function FuncExamplePopup({ onClose }: { onClose: () => void }) {
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
          <span style={{ fontSize: 15, fontWeight: 700, flexShrink: 0 }}>기능 설명 예시</span>
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
              <style dangerouslySetInnerHTML={{ __html: FUNC_EXAMPLE_CSS }} />
              <div
                className="fn-example"
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
