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

import { Suspense, useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";
import SettingsHistoryDialog from "@/components/ui/SettingsHistoryDialog";
import AssigneeHistoryDialog from "@/components/ui/AssigneeHistoryDialog";
import PrdDownloadDialog from "@/components/ui/PrdDownloadDialog";
import { useAppStore } from "@/store/appStore";
import AiTaskDetailDialog from "@/components/ui/AiTaskDetailDialog";
import AiTaskHistoryDialog from "@/components/ui/AiTaskHistoryDialog";
import AiImplementCard from "@/components/ui/AiImplementCard";
import AiTaskFilePicker from "@/components/ui/AiTaskFilePicker";
import DesignExamplePopup from "@/components/ui/DesignExamplePopup";
import { useDesignTemplate, applyTemplateVars } from "@/lib/designTemplate";
import { type AiTaskStatus, AI_TASK_STATUS_LABEL, AI_TASK_STATUS_DOT } from "@/constants/codes";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type RequirementOption = {
  requirementId: string;
  displayId:     string;
  name:          string;
};

type AiTaskInfo = { aiTaskId: string; status: string };

type UnitWorkDetail = {
  unitWorkId:       string;
  displayId:        string;
  name:             string;
  description:      string;
  comment:          string;
  assignMemberId:   string | null;
  // 담당자 이름 — 서버에서 join으로 내려줌. 퇴장한 멤버면 null
  assignMemberName: string | null;
  startDate:        string | null;
  endDate:          string | null;
  progress:         number;
  sortOrder:        number;
  reqId:            string;
  reqDisplayId:     string;
  reqName:          string;
  aiTasks:          Record<string, AiTaskInfo>;
  screens: {
    screenId:  string;
    displayId: string;
    name:      string;
    type:      string;
    urlPath:   string;
  }[];
};

// 프로젝트 멤버 — 담당자 콤보박스 옵션용 (GET /api/projects/[id]/members)
type ProjectMember = {
  memberId: string;
  name:     string | null;
  email:    string;
  role:     string;
  job:      string;
};

type SaveBody = {
  reqId:           string;
  name:            string;
  displayId?:      string;
  description:     string;
  comment:         string;
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
    displayId:   "",
    description: "",
    comment:     "",
    progress:    0,
    sortOrder:   0,
  });

  // 원본 설명 추적: 이력 저장 여부 판단용 (수정 모드에서만 의미 있음)
  const [originalDescription, setOriginalDescription] = useState<string>("");

  // 이력 저장 다이얼로그 상태
  const [prdOpen,           setPrdOpen]           = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  // 이력 조회 팝업 상태
  const [historyViewOpen, setHistoryViewOpen] = useState(false);
  // 담당자 변경 이력 팝업 상태 — 설명 이력과 별개 다이얼로그
  const [assigneeHistoryOpen, setAssigneeHistoryOpen] = useState(false);

  // 예시 팝업 상태
  const [exampleOpen, setExampleOpen] = useState(false);

  // 설계 양식 DB 조회 — 단위업무 계층
  const { data: designTmpl } = useDesignTemplate(projectId, "UNIT_WORK");
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

  // ── 프로젝트 멤버 목록 조회 (담당자 콤보박스용) ─────────────────────────────
  // myMemberId로 본인 판별 — 프론트에서 이니셜/아이콘 등 파생 표시 가능
  const { data: memberData } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn:  () =>
      authFetch<{ data: { members: ProjectMember[]; myMemberId: string } }>(
        `/api/projects/${projectId}/members`
      ).then((r) => r.data),
    staleTime: 60 * 1000, // 1분
  });
  const members = memberData?.members ?? [];
  const myMemberId = memberData?.myMemberId ?? "";

  // ── 기존 단위업무 로드 (수정 모드) ─────────────────────────────────────────
  const { data: detail, isLoading: isDetailLoading, refetch: refetchDetail } = useQuery({
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
          displayId:       d.displayId ?? "",
          description:     desc,
          comment:         d.comment ?? "",
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

  // ── AI 작업 ───────────────────────────────────────────────────────────────
  const [aiPanelOpen,  setAiPanelOpen]  = useState(false);
  const aiPanelRef = useRef<HTMLDivElement>(null);
  const [aiConfirm,       setAiConfirm]       = useState<{ taskType: string; label: string } | null>(null);
  const [taskPrompt,      setTaskPrompt]      = useState<{ tmplId: string; tmplNm: string } | null | "loading" | "none">(null);

  // AI 요청 팝업의 참고 이미지 — multipart로 함께 전송, 팝업 종료 시 초기화
  const [aiPickedFiles, setAiPickedFiles] = useState<File[]>([]);
  const [aiDetailTaskId,  setAiDetailTaskId]  = useState<string | null>(null);
  const [aiHistoryTaskType, setAiHistoryTaskType] = useState<string | null>(null);

  // 패널 외부 클릭 시 닫기
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // AiImplementCard 내부 팝업(ImplTargetDialog/ImplRequestPopup/이력/상세)이 열려있으면 무시
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
    if (!form.description.trim()) { toast.error("설명을 먼저 입력해 주세요."); return; }
    setTaskPrompt("loading");
    setAiConfirm({ taskType, label });
    setAiPanelOpen(false);
    try {
      const res = await authFetch<{ data: Array<{ tmplId: string; tmplNm: string; defaultYn: string }> }>(
        `/api/projects/${projectId}/prompt-templates?taskType=${taskType}&refType=UNIT_WORK&useYn=Y`
      );
      const list = res.data ?? [];
      const preferred = list.find((t) => t.defaultYn === "Y") ?? list[0] ?? null;
      setTaskPrompt(preferred ? { tmplId: preferred.tmplId, tmplNm: preferred.tmplNm } : "none");
    } catch {
      setTaskPrompt("none");
    }
  }

  // multipart/form-data로 전송 — 첨부 이미지(aiPickedFiles)를 함께 올림
  // authFetch는 Content-Type을 JSON으로 고정하므로 raw fetch 사용
  const aiMutation = useMutation({
    mutationFn: async ({ taskType }: { taskType: string }) => {
      const fd = new FormData();
      fd.append("taskType",  taskType);
      fd.append("coment_cn", form.comment.trim());
      aiPickedFiles.forEach((f) => fd.append("files", f));

      const at  = typeof window !== "undefined" ? (sessionStorage.getItem("access_token") ?? "") : "";
      const res = await fetch(`/api/projects/${projectId}/unit-works/${unitWorkId}/ai`, {
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
        DESIGN:  "AI 설계 요청이 접수되었습니다.",
        INSPECT: "AI 점검 요청이 접수되었습니다.",
      };
      toast.success(labels[vars.taskType] ?? "AI 요청이 접수되었습니다.");
      // 첨부 state 초기화 — 다음 요청 시 이전 이미지가 남지 않도록
      setAiPickedFiles([]);
      queryClient.invalidateQueries({ queryKey: ["unit-work", projectId, unitWorkId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 ──────────────────────────────────────────────────────────────────
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // 하위 화면이 있을 때 처리 방법 선택 (null = 미선택)
  const screenCount = detail?.screens.length ?? 0;
  const [deleteChildren, setDeleteChildren] = useState<boolean | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => {
      const withChildren = screenCount === 0 ? true : (deleteChildren ?? true);
      return authFetch(
        `/api/projects/${projectId}/unit-works/${unitWorkId}?deleteChildren=${withChildren}`,
        { method: "DELETE" }
      );
    },
    onSuccess: () => {
      toast.success("단위업무가 삭제되었습니다.");
      router.push(`/projects/${projectId}/unit-works`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleDeleteConfirm() {
    if (screenCount > 0 && deleteChildren === null) {
      toast.error("하위 데이터 처리 방법을 선택해 주세요.");
      return;
    }
    deleteMutation.mutate();
  }

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

  // GNB 브레드크럼 설정 — 요구사항 > 단위업무 > 화면 목록
  useEffect(() => {
    if (isNew) {
      setBreadcrumb([
        { label: "단위업무", href: `/projects/${projectId}/unit-works` },
        { label: "신규 등록" },
      ]);
    } else if (detail) {
      const items = [
        // 요구사항 (클릭 → 요구사항 상세)
        ...(detail.reqId && detail.reqName
          ? [{ label: `${detail.reqDisplayId} ${detail.reqName}`, href: `/projects/${projectId}/requirements/${detail.reqId}` }]
          : []),
        // 단위업무 (현재 페이지 — href 없음)
        { label: `${detail.displayId} ${detail.name}` },
        // 하위 화면 목록 (해당 단위업무로 필터)
        { label: "화면 목록", href: `/projects/${projectId}/screens?unitWorkId=${unitWorkId}` },
      ];
      setBreadcrumb(items);
    }
    return () => setBreadcrumb([]);
  }, [projectId, unitWorkId, isNew, detail, setBreadcrumb]);

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
      {exampleOpen && designTmpl?.exampleCn && (
        <DesignExamplePopup
          title="단위업무 설명 예시"
          contentMd={designTmpl.exampleCn}
          onClose={() => setExampleOpen(false)}
        />
      )}

      {/* ── 삭제 확인 다이얼로그 ── */}
      {deleteDialogOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setDeleteDialogOpen(false)}
        >
          <div
            style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", minWidth: 380, maxWidth: 480, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>단위업무를 삭제하시겠습니까?</h3>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--color-text-secondary)" }}>
              &lsquo;{detail?.name}&rsquo;
            </p>
            {/* 하위 화면이 있을 때만 처리 방법 선택 */}
            {screenCount > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  연결된 화면 {screenCount}개 처리 방법:
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                  <input type="radio" name="delChildren" checked={deleteChildren === true} onChange={() => setDeleteChildren(true)} />
                  하위 화면 전체 삭제
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
                  <input type="radio" name="delChildren" checked={deleteChildren === false} onChange={() => setDeleteChildren(false)} />
                  단위업무만 삭제 (화면 미분류 처리)
                </label>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setDeleteDialogOpen(false)} style={secondaryBtnStyle} disabled={deleteMutation.isPending}>
                취소
              </button>
              <button
                onClick={handleDeleteConfirm}
                style={{ ...primaryBtnStyle, background: "#e53935" }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 요청 컨펌 다이얼로그 */}
      {aiConfirm && (
        <div
          data-impl-overlay="ai-confirm"
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 520, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 12, boxShadow: "0 12px 48px rgba(0,0,0,0.25)", padding: "32px 36px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 24 }}>✦</span>
              <div>
                <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>{aiConfirm.label} 요청</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
                  {aiConfirm.taskType === "DESIGN" ? "단위업무 설명을 기반으로 AI에게 설계 적합성을 확인합니다." : "단위업무 전체 tree(화면·영역·기능)를 포함해 AI에게 점검을 요청합니다."}
                </p>
              </div>
            </div>

            {/* 프롬프트 템플릿 조회 결과 */}
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
                {aiConfirm.taskType === "INSPECT" && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>전체 설계서</span>
                    <span>단위업무 전체 tree (화면 · 영역 · 기능)</span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>점검 대상</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{form.description.trim().slice(0, 80)}{form.description.trim().length > 80 ? "…" : ""}</span>
                </div>
              </div>
            </div>

            {/* AI 요청 코멘트 입력 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 8 }}>
                <span style={{ fontSize: 11, background: "rgba(103,80,164,0.12)", color: "rgba(103,80,164,0.9)", borderRadius: 4, padding: "1px 6px" }}>코멘트</span>
                AI 요청 코멘트
              </label>
              <textarea
                value={form.comment}
                onChange={(e) => handleChange("comment", e.target.value)}
                placeholder="AI 요청 시 참고할 추가 지시사항을 입력해 주세요"
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 13, resize: "vertical", lineHeight: 1.6, outline: "none" }}
              />
            </div>

            {/* 참고 이미지 피커 — multipart로 함께 전송 (Claude 멀티모달 분석용) */}
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
              <button onClick={() => { setAiConfirm(null); setTaskPrompt(null); setAiPickedFiles([]); }} style={{ ...secondaryBtnStyle, fontSize: 13, padding: "7px 18px" }}>취소</button>
              {taskPrompt === "none" && (
                <button
                  onClick={() => { aiMutation.mutate({ taskType: aiConfirm.taskType }); setAiConfirm(null); setTaskPrompt(null); }}
                  disabled={aiMutation.isPending || !form.comment.trim()}
                  style={{ ...primaryBtnStyle, fontSize: 13, padding: "7px 18px", background: form.comment.trim() ? "#e65100" : "#ccc", cursor: form.comment.trim() ? "pointer" : "not-allowed" }}
                >
                  코멘트로 처리
                </button>
              )}
              <button
                onClick={() => { aiMutation.mutate({ taskType: aiConfirm.taskType }); setAiConfirm(null); setTaskPrompt(null); }}
                disabled={aiMutation.isPending || taskPrompt === "loading" || taskPrompt === "none" || taskPrompt === null}
                style={{
                  ...primaryBtnStyle, fontSize: 13, padding: "7px 20px",
                  opacity: (taskPrompt === "none" || taskPrompt === null || taskPrompt === "loading") ? 0.3 : 1,
                  cursor: (taskPrompt === "none" || taskPrompt === null || taskPrompt === "loading") ? "not-allowed" : "pointer",
                }}
              >
                요청
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 태스크 결과 상세 팝업 */}
      {aiDetailTaskId && (
        <AiTaskDetailDialog
          projectId={projectId}
          taskId={aiDetailTaskId}
          onClose={() => setAiDetailTaskId(null)}
          onRejected={() => { setAiDetailTaskId(null); queryClient.invalidateQueries({ queryKey: ["unit-work", projectId, unitWorkId] }); }}
        />
      )}

      {/* AI 태스크 이력 팝업 */}
      {aiHistoryTaskType && (
        <AiTaskHistoryDialog
          projectId={projectId}
          refType="UNIT_WORK"
          refId={unitWorkId}
          taskType={aiHistoryTaskType as "DESIGN" | "INSPECT"}
          onClose={() => setAiHistoryTaskType(null)}
        />
      )}

      {/* PRD 다운로드 팝업 */}
      <PrdDownloadDialog
        open={prdOpen}
        onClose={() => setPrdOpen(false)}
        projectId={projectId}
        availableLevels={["UNIT_WORK"]}
        defaultLevel="UNIT_WORK"
        unitWorkId={unitWorkId}
      />

      {/* ── 이력 조회 팝업 (공통 컴포넌트) ── */}
      <SettingsHistoryDialog
        open={historyViewOpen}
        onClose={() => setHistoryViewOpen(false)}
        projectId={projectId}
        itemName="단위업무 설명"
        currentValue={form.description}
        title="버전 이력 비교"
        refTblNm="tb_ds_unit_work"
        refId={unitWorkId}
      />

      {/* 담당자 변경 이력 — 경량 전용 다이얼로그 (diff 없음, 타임라인만) */}
      <AssigneeHistoryDialog
        open={assigneeHistoryOpen}
        onClose={() => setAssigneeHistoryOpen(false)}
        projectId={projectId}
        refTblNm="tb_ds_unit_work"
        refId={unitWorkId}
        currentAssigneeName={detail?.assignMemberName ?? ""}
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
            {isNew ? "단위업무 신규 등록" : `단위업무 편집 (${detail?.displayId ?? ""})`}
          </span>
        </div>

        {/* 우: AI 작업 + PRD 다운로드 + 취소·저장 */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          {/* ★ AI 작업 드롭다운 */}
          {!isNew && (
            <div ref={aiPanelRef} style={{ position: "relative" }}>
              <button
                onClick={() => { setAiPanelOpen((v) => { if (!v) refetchDetail(); return !v; }); }}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 12px", borderRadius: 8,
                  border: "1px solid rgba(103,80,164,0.35)",
                  background: aiPanelOpen ? "rgba(103,80,164,0.1)" : "rgba(103,80,164,0.06)",
                  color: "rgba(103,80,164,1)",
                  fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                <span>★</span> AI 작업 <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
              </button>

              {aiPanelOpen && (
                <div ref={aiPanelRef} style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 300,
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
                  padding: "14px 16px",
                  minWidth: 340,
                }}>
                  <style>{`
                    .uw-ai-task-card { transition: background 0.15s, border-color 0.15s; }
                    .uw-ai-task-card:hover { background: rgba(103,80,164,0.07) !important; border-color: rgba(103,80,164,0.3) !important; }
                    .uw-ai-mini-btn { transition: background 0.12s, color 0.12s, border-color 0.12s; }
                    .uw-ai-mini-btn:hover:not(:disabled) { background: var(--color-bg-muted) !important; color: var(--color-text-primary) !important; border-color: rgba(103,80,164,0.35) !important; }
                    .uw-ai-mini-btn-run:hover:not(:disabled) { background: rgba(103,80,164,0.18) !important; }
                  `}</style>

                  {/* 패널 헤더 */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>AI 작업 현황</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{detail?.displayId ?? ""}</span>
                  </div>

                  {/* AI 작업 카드 목록 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {UW_AI_TASK_CONFIGS.map(({ taskType, label, desc, icon }) => {
                      const info              = detail?.aiTasks?.[taskType];
                      const isMutationPending = aiMutation.isPending && aiMutation.variables?.taskType === taskType;
                      const isSpinning        = isMutationPending || !!(info && ["PENDING", "IN_PROGRESS"].includes(info.status));
                      const hasDone           = !!(info && ["DONE", "APPLIED", "REJECTED", "FAILED"].includes(info.status));
                      const dotColor          = info ? (AI_TASK_STATUS_DOT[info.status as AiTaskStatus] ?? "#ccc") : "#ccc";
                      const statusLabel       = isMutationPending && !info ? "대기 중..." : info ? (AI_TASK_STATUS_LABEL[info.status as AiTaskStatus] ?? info.status) : "-";

                      return (
                        <div key={taskType} className="uw-ai-task-card" style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "10px 14px", borderRadius: 8,
                          border: "1px solid var(--color-border)",
                          background: "var(--color-bg-muted)",
                        }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: icon.bg, fontSize: 18,
                          }}>
                            {icon.emoji}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>{label}</div>
                            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                              <span style={{ fontSize: 11, color: dotColor, fontWeight: 600, whiteSpace: "nowrap" }}>{statusLabel}</span>
                            </div>
                            <div style={{ display: "flex", gap: 4 }}>
                              {hasDone && (
                                <button
                                  className="uw-ai-mini-btn"
                                  onClick={() => setAiDetailTaskId(info!.aiTaskId)}
                                  style={aiMiniBtn}
                                >
                                  결과
                                </button>
                              )}
                              <button
                                className="uw-ai-mini-btn uw-ai-mini-btn-run"
                                onClick={() => openPromptConfirm(taskType, label)}
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
                                  className="uw-ai-mini-btn"
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

                    {/* AI 구현 — 공통 컴포넌트 */}
                    {!isNew && (
                      <AiImplementCard
                        projectId={projectId}
                        refType="UNIT_WORK"
                        refId={unitWorkId}
                        implInfo={detail?.aiTasks?.["IMPLEMENT"] ?? null}
                        onInvalidate={() => queryClient.invalidateQueries({ queryKey: ["unit-work", projectId, unitWorkId] })}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {!isNew && (
            <button
              onClick={() => setPrdOpen(true)}
              title="PRD 다운로드"
              style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 12px" }}
            >
              PRD ↓
            </button>
          )}
          <button
            onClick={() => router.push(`/projects/${projectId}/unit-works`)}
            disabled={saveMutation.isPending}
            style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            취소
          </button>
          {/* 신규 모드에서는 삭제 버튼 숨김 */}
          {!isNew && (
            <button
              onClick={() => { setDeleteChildren(null); setDeleteDialogOpen(true); }}
              disabled={saveMutation.isPending}
              style={{ fontSize: 12, padding: "5px 14px", minWidth: 60, borderRadius: 6, border: "1px solid #e53935", background: "transparent", color: "#e53935", cursor: "pointer" }}
            >
              삭제
            </button>
          )}
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
      {/* 폼 — 2단 레이아웃 (좌: 메타 정보+코멘트, 우: 설명) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 20, alignItems: "start" }}>

        {/* ── 왼쪽 컬럼 ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

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

          {/* 단위업무명 + 표시 ID */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <FormField label="단위업무명" required>
              <input
                type="text"
                value={form.name}
                placeholder="단위업무명을 입력하세요"
                onChange={(e) => handleChange("name", e.target.value)}
                style={inputStyle}
              />
            </FormField>
            <FormField label={<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>표시 ID<DisplayIdHelp /></span>}>
              <input
                type="text"
                value={form.displayId ?? ""}
                placeholder="미입력 시 자동 생성"
                onChange={(e) => handleChange("displayId", e.target.value)}
                style={inputStyle}
              />
            </FormField>
          </div>

          {/* 시작일 + 종료일 — 2컬럼 */}
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

          {/* 담당자 + 진행률 + 정렬순서 — 담당자에 더 넓은 공간(2fr) 할당 */}
          {/* 담당자 라벨 옆의 작은 시계 아이콘 = 변경 이력 팝업 (신규 등록 모드에서는 숨김) */}
          {/* FormField 대신 인라인 div 사용 — <label> 요소 안에 <button>을 두면 */}
          {/*   라벨 빈 영역 클릭이 브라우저 기본 동작으로 버튼에 전달됨 (라벨→내부 form control) */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                <span>담당자</span>
                {!isNew && (
                  <button
                    type="button"
                    onClick={() => setAssigneeHistoryOpen(true)}
                    title="담당자 변경 이력"
                    style={inlineIconBtnStyle}
                  >
                    {/* 시계(이력) 아이콘 — 14px, currentColor로 테마 대응 */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2"
                         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </button>
                )}
              </div>
              <select
                value={form.assignMemberId ?? ""}
                onChange={(e) => handleChange("assignMemberId", e.target.value)}
                style={selectStyle}
              >
                <option value="">담당자 없음</option>
                {members.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.name ?? m.email}
                    {m.memberId === myMemberId ? " (나)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <FormField label="진행률 (%)">
              <input
                type="number"
                min={0}
                max={100}
                value={form.progress}
                onChange={(e) => handleChange("progress", Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
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

        </div>{/* ── 왼쪽 컬럼 끝 ── */}

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
              {/* 예시 버튼 — DB 설계 양식에서 로드 */}
              <button
                onClick={() => setExampleOpen(true)}
                disabled={!designTmpl?.exampleCn}
                style={{ ...descSubBtnStyle, opacity: designTmpl?.exampleCn ? 1 : 0.5, cursor: designTmpl?.exampleCn ? "pointer" : "not-allowed" }}
              >
                예시
              </button>
              {/* 템플릿 삽입 버튼 — DB 템플릿 + {{displayId}}/{{name}} 치환 */}
              <button
                onClick={() => {
                  if (!designTmpl?.templateCn) return;
                  handleChange("description", applyTemplateVars(designTmpl.templateCn, {
                    displayId: detail?.displayId,
                    name:      form.name,
                  }));
                }}
                disabled={!designTmpl?.templateCn}
                style={{ ...descSubBtnStyle, opacity: designTmpl?.templateCn ? 1 : 0.5, cursor: designTmpl?.templateCn ? "pointer" : "not-allowed" }}
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
  label:    React.ReactNode;
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

// select 전용 — 브라우저 기본 화살표(두껍고 오른쪽 끝에 붙음) 제거 후 커스텀 SVG 화살표 사용
// 과업/요구사항/화면 상세와 동일한 톤·위치
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

const descSubBtnStyle: React.CSSProperties = {
  padding:      "3px 10px",
  borderRadius: 5,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-base)",
  color:        "var(--color-text-secondary)",
  fontSize:     12,
  cursor:       "pointer",
};

// 라벨 옆 인라인 아이콘 버튼 — 테두리·배경 없음, hover 시만 색 변화
// FormField 라벨의 보조 액션(이력 조회 등)을 최소 면적으로 표현할 때 사용
const inlineIconBtnStyle: React.CSSProperties = {
  display:       "inline-flex",
  alignItems:    "center",
  justifyContent:"center",
  width:         18,
  height:        18,
  padding:       0,
  border:        "none",
  background:    "transparent",
  color:         "var(--color-text-tertiary)",
  cursor:        "pointer",
  borderRadius:  3,
  lineHeight:    0,
};

// ── AI 태스크 설정 ────────────────────────────────────────────────────────────

const UW_AI_TASK_CONFIGS = [
  { taskType: "DESIGN",  label: "AI 설계",  desc: "설계 양식 적합성 확인",               icon: { bg: "#e8eaf6", emoji: "⊞" } },
  { taskType: "INSPECT", label: "AI 점검",  desc: "전체 화면·영역·기능\ntop-down 점검", icon: { bg: "#e8f5e9", emoji: "✓" } },
] as const;

// AI 상태 라벨/도트 색상은 공용 codes 모듈(@/constants/codes) 사용
// 기존 로컬 정의는 "대기 중/진행 중/적용됨/반려됨/타임아웃" + Tailwind 팔레트(#f59e0b 등)로
// 다른 화면과 완전히 엇갈린 상태였음 → 일관된 팔레트(AI_TASK_STATUS_DOT)로 통일

const aiMiniBtn: React.CSSProperties = {
  fontSize: 11, padding: "3px 8px", borderRadius: 5, cursor: "pointer",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)",
  fontWeight: 600, whiteSpace: "nowrap",
};

// 설계 양식(예시/템플릿)은 DB(tb_ai_design_template)로 관리 — 공용 훅 useDesignTemplate 사용.
