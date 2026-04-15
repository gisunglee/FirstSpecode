"use client";

/**
 * RequirementDetailPage — 요구사항 상세·편집 (PID-00031)
 *
 * 역할:
 *   - 신규: reqId = "new" → POST (FID-00103 신규)
 *   - 수정: reqId 존재 → GET 로드(FID-00102) → PUT (FID-00103 수정 + 이력)
 *   - 원문·현행화 편집 (FID-00104)
 *   - 첨부파일 업로드·다운로드·삭제 (FID-00106~108)
 */

import { Suspense, useState, useRef, useEffect } from "react";
import { marked } from "marked";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import RichEditor from "@/components/ui/RichEditor";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";
import SettingsHistoryDialog from "@/components/ui/SettingsHistoryDialog";

// ── 상세 명세 예시 / 템플릿 상수 ────────────────────────────────────────────

const SPEC_EXAMPLE = `## 기능 개요
다양한 유형의 게시판(공지, 자료실, 묻고답하기 등)을 단일 구조로 통합 관리하며,
관리자가 게시판 유형과 속성을 직접 설정할 수 있는 기능을 제공한다.

## 메뉴 위치
- 사용자: 정보마당 > 게시판
- 관리자: 시스템관리 > 게시판관리

## 사용 대상 / 권한
| 구분 | 대상 | 접근 범위 |
|------|------|-----------|
| 일반사용자 | 로그인 사용자 전체 | 조회, 글쓰기, 댓글 |
| 비로그인 | 일반 방문자 | 조회만 가능 (게시판별 설정) |
| 게시판 관리자 | 지정된 담당자 | 글 관리, 공지 지정, 첨부 삭제 |
| 시스템 관리자 | 관리자 | 게시판 생성/수정/삭제, 권한 설정 |

## 제공 화면 목록
| 화면명 | 설명 |
|--------|------|
| 게시판 목록 | 게시글 목록 조회, 검색, 페이징 |
| 게시글 상세 | 본문, 첨부파일, 댓글 표시 |
| 게시글 등록/수정 | 에디터 포함, 첨부파일 업로드 |
| 게시판 관리 | 관리자용 게시판 유형/속성 설정 |
| 게시글 관리 | 관리자용 전체 글 목록, 일괄 처리 |

## 기능 상세
| 기능명 | 설명 | 비고 |
|--------|------|------|
| 게시판 유형 설정 | 공지/자료실/QnA 등 유형별 속성 ON/OFF | 관리자 전용 |
| 게시글 CRUD | 등록, 수정, 삭제, 조회 | 권한별 차등 |
| 공지 고정 | 상단 고정 공지 지정 | 게시판관리자 이상 |
| 첨부파일 | 다중 파일 업로드, 확장자/용량 제한 설정 | 게시판별 설정 |
| 댓글 | 댓글 등록/삭제, 대댓글 1단계 지원 | 게시판별 ON/OFF |
| 검색 | 제목, 내용, 작성자 검색 | |
| 조회수 | 게시글 조회 시 자동 카운트 | 관리자 조회 제외 |
| 답글 (QnA) | 원글에 대한 답변 글 연결 표시 | QnA 유형만 해당 |

## 업무 처리 순서
1. 관리자가 게시판 유형/속성 생성 (댓글 허용 여부, 첨부 허용 여부 등 설정)
2. 사용자가 게시글 등록 (에디터 작성 + 첨부파일 업로드)
3. 게시판 관리자가 필요 시 공지 지정 또는 글 숨김 처리
4. 일반 사용자 목록 조회 → 상세 조회 → 댓글 작성
5. QnA 유형의 경우 담당자가 답글 등록 → 작성자에게 알림 (알림 연계 시)

## 제외 범위 / 제약 사항 / 협의 사항
- (제외) 이메일 알림 연계는 본 범위 제외
- (제약) 첨부파일 확장자는 보안지침상 exe, sh 등 실행파일 불가
- (협의) 익명 게시 기능은 추후 결정`;

// 내용은 비우고 구조(헤딩·표 컬럼)만 유지한 템플릿
const SPEC_TEMPLATE = `## 기능 개요


## 메뉴 위치
- 사용자:
- 관리자:

## 사용 대상 / 권한
| 구분 | 대상 | 접근 범위 |
|------|------|-----------|
| | | |

## 제공 화면 목록
| 화면명 | 설명 |
|--------|------|
| | |

## 기능 상세
| 기능명 | 설명 | 비고 |
|--------|------|------|
| | | |

## 업무 처리 순서
1.

## 제외 범위 / 제약 사항 / 협의 사항
- (제외)
- (제약)
- (협의)`;

// ── 타입 ─────────────────────────────────────────────────────────────────────

type HistoryItem = {
  historyId:    string;
  versionNo:    string;
  comment:      string;
  changedAt:    string;
  changerEmail: string;
};

type DiffContent = {
  historyId: string;
  versionNo: string;
  orgnlCn:   string;
  curncyCn:  string;
};

type DiffResult = {
  v1Content: DiffContent;
  v2Content: DiffContent;
};

type TaskOption = {
  taskId:   string;
  name:     string;
  category: string;
};

type RequirementDetail = {
  requirementId:   string;
  displayId:       string;
  name:            string;
  priority:        string;
  source:          string;
  rfpPage:         string;
  originalContent: string;
  currentContent:  string;
  analysisMemo:    string;
  detailSpec:      string;
  taskId:          string | null;
  sortOrder:       number;
};

type AttachedFile = {
  fileId:     string;
  fileName:   string;
  fileSize:   number;
  extension:  string;
  uploadedAt: string;
};

type SaveBody = {
  taskId?:          string;
  reqDisplayId:     string;
  sortOrder:        number;
  name:             string;
  priority:         string;
  source:           string;
  rfpPage:          string;
  originalContent:  string;
  currentContent:   string;
  analysisMemo:     string;
  detailSpec:       string;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function RequirementDetailPage() {
  return (
    <Suspense fallback={null}>
      <RequirementDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function RequirementDetailPageInner() {
  const params      = useParams<{ id: string; reqId: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const projectId   = params.id;
  const reqId       = params.reqId;
  const isNew       = reqId === "new";

  // ── 폼 상태 ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState<SaveBody>({
    taskId:          undefined,
    reqDisplayId:    "",
    sortOrder:       0,
    name:            "",
    priority:        "MEDIUM",
    source:          "RFP",
    rfpPage:         "",
    originalContent: "",
    currentContent:  "",
    analysisMemo:    "",
    detailSpec:      "",
  });

  // 원문·현행화 탭 — 기본값: 현행화
  const [contentTab, setContentTab] = useState<"original" | "current">("current");

  // 마크다운 탭 상태 (분석메모 / 상세명세 각각)
  const [analyzeTab, setAnalyzeTab] = useState<"edit" | "preview">("edit");
  const [specTab,    setSpecTab]    = useState<"edit" | "preview">("edit");

  // 상세 명세 예시 팝업 상태
  const [specExampleOpen, setSpecExampleOpen] = useState(false);

  // 변경 이력 팝업 상태
  const [historyOpen,    setHistoryOpen]    = useState(false);
  const [diffTarget,     setDiffTarget]     = useState<HistoryItem | null>(null);
  const [deleteTarget,   setDeleteTarget]   = useState<HistoryItem | null>(null);
  // 저장 다이얼로그 상태
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  // 변경이력(designChange) 팝업 — 분석메모/상세명세 각각
  const [analyChangeHistOpen, setAnalyChangeHistOpen] = useState(false);
  const [specChangeHistOpen,  setSpecChangeHistOpen]  = useState(false);

  // 요구사항 삭제 팝업 상태
  const [reqDeleteOpen, setReqDeleteOpen] = useState(false);

  // 파일 업로드 input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { setBreadcrumb } = useAppStore();

  // ── 과업 목록 조회 (taskId 선택용) ─────────────────────────────────────────
  const { data: tasksData } = useQuery({
    queryKey: ["tasks-for-select", projectId],
    queryFn:  () =>
      authFetch<{ data: { tasks: TaskOption[] } }>(
        `/api/projects/${projectId}/tasks`
      ).then((r) => r.data.tasks),
  });
  const taskOptions = tasksData ?? [];

  // ── 기존 요구사항 로드 (수정 모드) ─────────────────────────────────────────
  const { data: detail, isLoading: isDetailLoading } = useQuery({
    queryKey: ["requirement", projectId, reqId],
    queryFn:  () =>
      authFetch<{ data: RequirementDetail }>(
        `/api/projects/${projectId}/requirements/${reqId}`
      ).then((r) => {
        const d = r.data;
        setForm({
          taskId:          d.taskId ?? undefined,
          reqDisplayId:    d.displayId ?? "",
          sortOrder:       d.sortOrder ?? 0,
          name:            d.name,
          priority:        d.priority,
          source:          d.source,
          rfpPage:         d.rfpPage,
          // 기존 마크다운이면 HTML로 변환 (RichEditor는 HTML 저장)
          originalContent: d.originalContent && !d.originalContent.includes("<")
            ? renderMarkdown(d.originalContent) : (d.originalContent ?? ""),
          currentContent:  d.currentContent && !d.currentContent.includes("<")
            ? renderMarkdown(d.currentContent)  : (d.currentContent  ?? ""),
          analysisMemo:    d.analysisMemo,
          detailSpec:      d.detailSpec,
        });
        return d;
      }),
    enabled: !isNew,
  });

  // ── 첨부파일 목록 조회 ──────────────────────────────────────────────────────
  const { data: filesData, refetch: refetchFiles } = useQuery({
    queryKey: ["req-files", projectId, reqId],
    queryFn:  () =>
      authFetch<{ data: { items: AttachedFile[] } }>(
        `/api/projects/${projectId}/requirements/${reqId}/files`
      ).then((r) => r.data.items),
    enabled: !isNew,
  });
  const files = filesData ?? [];

  // ── 저장 뮤테이션 ──────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: SaveBody) =>
      isNew
        ? authFetch<{ data: { requirementId: string } }>(`/api/projects/${projectId}/requirements`, {
            method: "POST",
            body:   JSON.stringify(body),
          })
        : authFetch(`/api/projects/${projectId}/requirements/${reqId}`, {
            method: "PUT",
            body:   JSON.stringify(body),
          }),
    onSuccess: (res) => {
      toast.success(isNew ? "요구사항이 등록되었습니다." : "저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] });
      if (isNew) {
        // 신규 등록 후 → 생성된 상세 페이지로 이동
        const newId = (res as { data: { requirementId: string } }).data.requirementId;
        router.push(`/projects/${projectId}/requirements/${newId}`);
      } else {
        // 수정 후 → 현재 페이지 그대로 (캐시 갱신으로 최신 데이터 반영)
        queryClient.invalidateQueries({ queryKey: ["requirement", projectId, reqId] });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 변경 이력 조회 ─────────────────────────────────────────────────────────
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ["req-history", projectId, reqId],
    queryFn:  () =>
      authFetch<{ data: { items: HistoryItem[]; totalCount: number } }>(
        `/api/projects/${projectId}/requirements/${reqId}/history`
      ).then((r) => r.data),
    enabled: !isNew && historyOpen,
  });
  const historyItems = historyData?.items ?? [];

  // ── 요구사항 삭제 뮤테이션 ───────────────────────────────────────────────────
  const reqDeleteMutation = useMutation({
    mutationFn: (deleteChildren: boolean) =>
      authFetch(`/api/projects/${projectId}/requirements/${reqId}?deleteChildren=${deleteChildren}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("요구사항이 삭제되었습니다.");
      router.push(`/projects/${projectId}/requirements`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 이력 삭제 뮤테이션 ──────────────────────────────────────────────────────
  const deleteHistMutation = useMutation({
    mutationFn: (historyId: string) =>
      authFetch(`/api/projects/${projectId}/requirements/${reqId}/history/${historyId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("이력이 삭제되었습니다.");
      setDeleteTarget(null);
      refetchHistory();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 파일 삭제 뮤테이션 ──────────────────────────────────────────────────────
  const deleteFileMutation = useMutation({
    mutationFn: (fileId: string) =>
      authFetch(
        `/api/projects/${projectId}/requirements/${reqId}/files/${fileId}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      toast.success("파일이 삭제되었습니다.");
      refetchFiles();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 입력 핸들러 ────────────────────────────────────────────────────────────
  function handleChange(field: keyof SaveBody, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSave() {
    if (!form.name.trim()) {
      toast.error("요구사항명을 입력해 주세요.");
      return;
    }
    if (!form.priority) {
      toast.error("우선순위를 선택해 주세요.");
      return;
    }
    if (!form.source) {
      toast.error("출처를 선택해 주세요.");
      return;
    }
    if (isNew) {
      saveMutation.mutate(form);
      return;
    }

    // 어떤 영역이 변경되었는지 감지
    const contentChanged =
      form.originalContent !== (detail?.originalContent ?? "") ||
      form.currentContent  !== (detail?.currentContent  ?? "");
    const specChanged  = form.detailSpec    !== (detail?.detailSpec    ?? "");
    const analyChanged = form.analysisMemo  !== (detail?.analysisMemo  ?? "");

    // 이력 대상 변경이 하나라도 있으면 다이얼로그 표시
    if (contentChanged || specChanged || analyChanged) {
      setSaveDialogOpen(true);
    } else {
      // 기본정보만 변경 → 바로 저장
      saveMutation.mutate(form);
    }
  }

  // 다이얼로그에서 옵션 선택 후 실행
  function executeSave(opts: {
    saveHistory?: boolean; versionMode?: string; versionComment?: string;
    saveSpecHistory?: boolean; saveAnalyHistory?: boolean;
  }) {
    saveMutation.mutate({ ...form, ...opts } as SaveBody & typeof opts);
    setSaveDialogOpen(false);
  }

  // 변경 감지 (다이얼로그에 전달)
  function getChangedFlags() {
    return {
      contentChanged:
        form.originalContent !== (detail?.originalContent ?? "") ||
        form.currentContent  !== (detail?.currentContent  ?? ""),
      specChanged:  form.detailSpec   !== (detail?.detailSpec   ?? ""),
      analyChanged: form.analysisMemo !== (detail?.analysisMemo ?? ""),
    };
  }

  // ── GNB 브레드크럼 ─────────────────────────────────────────────────────────
  // 분석 계층 네비: [상위 과업?] > [요구사항 목록] > [현재 요구사항] > [사용자스토리 목록(하위)]
  // - 요구사항은 과업 하위(1:N). detail.taskId 가 있으면 taskOptions 에서 이름을 찾아
  //   상위 과업 상세로 이동할 수 있도록 링크를 건다.
  // - 하위 사용자스토리 목록은 reqId 로 필터링된 뷰로 이동한다.
  //   (사용자스토리 목록 페이지는 reqId 쿼리 파라미터 필터를 이미 지원)
  // - 신규 등록 모드는 연결된 맥락이 없으므로 상/하위 링크를 생략한다.
  useEffect(() => {
    // 현재 요구사항의 상위 과업 — tasksData 에서 lookup (없으면 undefined)
    // tasksData 는 TanStack Query 가 관리하는 안정 참조이므로 의존성에 안전하게 사용 가능.
    // 파생값(taskOptions = tasksData ?? [])을 직접 의존성에 넣으면 매 렌더마다 새 배열이 되어
    // useEffect 무한 루프가 발생하므로 원본 쿼리 데이터를 참조한다.
    const parentTask = detail?.taskId
      ? tasksData?.find((t) => t.taskId === detail.taskId)
      : undefined;

    const items = [
      // 상위 과업 (연결돼 있으면만 노출)
      ...(parentTask
        ? [{ label: parentTask.name, href: `/projects/${projectId}/tasks/${parentTask.taskId}` }]
        : []),
      // 요구사항 목록 진입점
      { label: "요구사항", href: `/projects/${projectId}/requirements` },
      // 현재 요구사항 (href 없음 = 현재 위치)
      { label: isNew ? "신규 등록" : (detail?.displayId ?? "편집") },
      // 하위 사용자스토리 목록 (수정 모드에서만)
      ...(isNew
        ? []
        : [{ label: "사용자스토리 목록", href: `/projects/${projectId}/user-stories?reqId=${reqId}` }]),
    ];
    setBreadcrumb(items);
    return () => setBreadcrumb([]);
  }, [projectId, reqId, isNew, detail?.displayId, detail?.taskId, tasksData, setBreadcrumb]);

  // ── 파일 업로드 ─────────────────────────────────────────────────────────────
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    // authFetch는 Content-Type: application/json을 강제하므로
    // 파일 업로드는 직접 fetch 사용 (브라우저가 multipart boundary 자동 설정)
    const at =
      typeof window !== "undefined"
        ? (sessionStorage.getItem("access_token") ?? "")
        : "";

    const formData = new FormData();
    for (const file of Array.from(selectedFiles)) {
      formData.append("files", file);
    }

    try {
      const res = await fetch(
        `/api/projects/${projectId}/requirements/${reqId}/files`,
        {
          method:  "POST",
          headers: at ? { Authorization: `Bearer ${at}` } : {},
          body:    formData,
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? "파일 업로드에 실패했습니다.");
      }
      toast.success("파일이 업로드되었습니다.");
      refetchFiles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "파일 업로드 중 오류가 발생했습니다.");
    } finally {
      // input 초기화 (같은 파일 재선택 가능하도록)
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── 파일 다운로드 ───────────────────────────────────────────────────────────
  function handleDownload(file: AttachedFile) {
    const at =
      typeof window !== "undefined"
        ? (sessionStorage.getItem("access_token") ?? "")
        : "";

    // <a> 태그를 동적 생성하여 다운로드 트리거
    const url = `/api/projects/${projectId}/requirements/${reqId}/files/${file.fileId}/download`;
    fetch(url, { headers: at ? { Authorization: `Bearer ${at}` } : {} })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.fileName;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => toast.error("파일 다운로드에 실패했습니다."));
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (!isNew && isDetailLoading) {
    return (
      <div style={{ padding: "40px 32px", color: "#888" }}>
        요구사항 정보를 불러오는 중...
      </div>
    );
  }

  return (
    <div style={{ padding: 0, maxWidth: 1400 }}>
      {/* 헤더 타이틀 바 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/requirements`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#666", lineHeight: 1, padding: "2px 4px" }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "요구사항 추가" : "요구사항 편집"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!isNew && (
            <button
              onClick={() => setReqDeleteOpen(true)}
              style={{ fontSize: 12, padding: "5px 14px", minWidth: 60, borderRadius: 6, border: "1px solid #e53935", background: "none", color: "#e53935", cursor: "pointer", fontWeight: 600 }}
            >
              삭제
            </button>
          )}
          <button
            onClick={() => router.push(`/projects/${projectId}/requirements`)}
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
      {/* 2단 레이아웃: 왼쪽(기본정보+원문·현행화) / 오른쪽(분석메모·상세명세+근거파일) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 24, alignItems: "start" }}>

        {/* ── 왼쪽 컬럼 ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* ── AR-00043 기본 정보 ────────────────────────────────────────────── */}
          <Section>
            {/* 상위 과업 선택 */}
            <FormField label="상위 과업">
              <select
                value={form.taskId ?? ""}
                onChange={(e) => handleChange("taskId", e.target.value || "")}
                style={selectStyle}
              >
                <option value="">미분류</option>
                {taskOptions.map((t) => (
                  <option key={t.taskId} value={t.taskId}>{t.name}</option>
                ))}
              </select>
            </FormField>

            {/* 요구사항명 */}
            <FormField label="요구사항명" required>
              <input
                type="text"
                value={form.name}
                placeholder="요구사항명을 입력하세요"
                onChange={(e) => handleChange("name", e.target.value)}
                style={inputStyle}
              />
            </FormField>

            {/* 표시 ID + 정렬 순서 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 16 }}>
              <FormField label="표시 ID">
                <input
                  type="text"
                  value={form.reqDisplayId}
                  placeholder="예: RQ-00001"
                  onChange={(e) => handleChange("reqDisplayId", e.target.value)}
                  style={inputStyle}
                />
              </FormField>
              <FormField label="정렬 순서">
                <input
                  type="number"
                  min={0}
                  // 0이면 빈 문자열로 표시해 삭제 후 바로 입력 가능
                  value={form.sortOrder || ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, sortOrder: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                  style={inputStyle}
                />
              </FormField>
            </div>

            {/* 우선순위 + 출처 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <FormField label="우선순위" required>
                <select
                  value={form.priority}
                  onChange={(e) => handleChange("priority", e.target.value)}
                  style={selectStyle}
                >
                  <option value="HIGH">높음 (HIGH)</option>
                  <option value="MEDIUM">중간 (MEDIUM)</option>
                  <option value="LOW">낮음 (LOW)</option>
                </select>
              </FormField>
              <FormField label="출처" required>
                <select
                  value={form.source}
                  onChange={(e) => handleChange("source", e.target.value)}
                  style={selectStyle}
                >
                  <option value="RFP">RFP</option>
                  <option value="ADD">추가</option>
                  <option value="CHANGE">변경</option>
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
          </Section>

          {/* ── AR-00044 원문·현행화 ──────────────────────────────────────────── */}
          <Section label={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <span>요구사항 내용</span>
              {!isNew && (
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  style={{ padding: "3px 12px", fontSize: 11, fontWeight: 500, borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-muted)", color: "var(--color-text-secondary)", cursor: "pointer" }}
                >
                  🕐 이력
                </button>
              )}
            </div>
          }>
            {/* 탭 헤더 */}
            <div style={{ display: "flex", gap: 16, borderBottom: "1px solid var(--color-border)", marginBottom: 12 }}>
              {(["original", "current"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setContentTab(tab)}
                  style={{
                    padding:      "8px 6px",
                    border:       "none",
                    borderBottom: contentTab === tab ? "2px solid var(--color-primary, #1976d2)" : "2px solid transparent",
                    background:   "transparent",
                    color:        contentTab === tab ? "var(--color-primary, #1976d2)" : "var(--color-text-secondary)",
                    fontSize:     14,
                    fontWeight:   contentTab === tab ? 600 : 500,
                    cursor:       "pointer",
                    transition:   "all 0.2s ease",
                    marginBottom: -1,
                  }}
                >
                  {tab === "original" ? "원문 (RFP·계약서)" : "현행화 (협의·변경 뱐영)"}
                </button>
              ))}
            </div>

            {/* 에디터 본체 */}
            <div>
              {contentTab === "current" ? (
                <RichEditor
                  value={form.currentContent}
                  onChange={(html) => handleChange("currentContent", html)}
                  placeholder="협의 또는 변경 사항이 반영된 최신 내용을 입력하세요"
                  minHeight={338}
                />
              ) : (
                <RichEditor
                  value={form.originalContent}
                  onChange={(html) => handleChange("originalContent", html)}
                  placeholder="RFP 또는 계약서의 원문 그대로 입력하세요"
                  minHeight={338}
                />
              )}
            </div>
          </Section>

          {/* ── AR-00046 첨부파일 (수정 모드에서만) ────────────────────────── */}
          {!isNew && (
            <Section title="첨부파일">
              {files.length === 0 ? (
                <p style={{ fontSize: 13, color: "#aaa", margin: 0 }}>첨부파일이 없습니다.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {files.map((file) => (
                    <div
                      key={file.fileId}
                      style={{
                        display:      "flex",
                        alignItems:   "center",
                        gap:          12,
                        padding:      "8px 12px",
                        border:       "1px solid var(--color-border)",
                        borderRadius: 6,
                        background:   "var(--color-bg-muted)",
                      }}
                    >
                      <span style={{ flex: 1, fontSize: 13, wordBreak: "break-all" }}>
                        📎 {file.fileName}
                        <span style={{ color: "#aaa", marginLeft: 8, fontSize: 12 }}>
                          ({formatFileSize(file.fileSize)})
                        </span>
                      </span>
                      <button
                        onClick={() => handleDownload(file)}
                        style={{ ...secondaryBtnStyle, fontSize: 12, padding: "4px 10px" }}
                      >
                        다운로드
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`'${file.fileName}' 파일을 삭제하시겠습니까?`)) {
                            deleteFileMutation.mutate(file.fileId);
                          }
                        }}
                        disabled={deleteFileMutation.isPending}
                        style={{ ...dangerBtnStyle, fontSize: 12 }}
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 파일 첨부 버튼 */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={handleFileUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={secondaryBtnStyle}
              >
                + 파일 첨부
              </button>
            </Section>
          )}
        </div>

        {/* ── 오른쪽 컬럼 ───────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* ── AR-00045 상세명세·분석메모 ──────────────────────────────────── */}
          <Section>
            {/* 상세 명세 (위) */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>상세 명세</span>
                <MarkdownTabButtons tab={specTab} onTabChange={setSpecTab} />
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setSpecExampleOpen(true)}
                    style={{ padding: "2px 10px", fontSize: 11, fontWeight: 500, borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-muted)", color: "var(--color-text-secondary)", cursor: "pointer" }}
                  >
                    예시
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChange("detailSpec", SPEC_TEMPLATE)}
                    style={{ padding: "2px 10px", fontSize: 11, fontWeight: 500, borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-muted)", color: "var(--color-text-secondary)", cursor: "pointer" }}
                  >
                    템플릿 적용
                  </button>
                  {!isNew && (
                    <button
                      type="button"
                      onClick={() => setSpecChangeHistOpen(true)}
                      style={{ padding: "2px 10px", fontSize: 11, fontWeight: 500, borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-muted)", color: "var(--color-text-secondary)", cursor: "pointer" }}
                    >
                      변경이력
                    </button>
                  )}
                </div>
              </div>
              <MarkdownEditor
                value={form.detailSpec}
                tab={specTab}
                onTabChange={setSpecTab}
                onChange={(v) => handleChange("detailSpec", v)}
                placeholder={`## 기능 상세\n\n- 항목1\n- 항목2`}
                rows={18}
              />
            </div>

            {/* 분석 메모 (아래) */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>분석 메모</span>
                <MarkdownTabButtons tab={analyzeTab} onTabChange={setAnalyzeTab} />
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {!isNew && (
                    <button
                      type="button"
                      onClick={() => setAnalyChangeHistOpen(true)}
                      style={{ padding: "2px 10px", fontSize: 11, fontWeight: 500, borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-bg-muted)", color: "var(--color-text-secondary)", cursor: "pointer" }}
                    >
                      변경이력
                    </button>
                  )}
                </div>
              </div>
              <MarkdownEditor
                value={form.analysisMemo}
                tab={analyzeTab}
                onTabChange={setAnalyzeTab}
                onChange={(v) => handleChange("analysisMemo", v)}
                placeholder={`## 분석 내용\n\n- 항목1\n- 항목2`}
                rows={14}
              />
            </div>
          </Section>
        </div>
      </div>
      </div>

      {/* ── 상세 명세 예시 팝업 ─────────────────────────────────────────────── */}
      {specExampleOpen && (
        <SpecExamplePopup onClose={() => setSpecExampleOpen(false)} />
      )}

      {/* ── 변경 이력 팝업 ──────────────────────────────────────────────────── */}
      {historyOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setHistoryOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "90vw", maxWidth: 900, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "24px 28px", maxHeight: "85vh", display: "flex", flexDirection: "column" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>변경 이력</span>
              <button type="button" onClick={() => setHistoryOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#888" }}>×</button>
            </div>
            <div style={{ marginBottom: 12, fontSize: 13, color: "var(--color-text-secondary)" }}>총 {historyItems.length}건</div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {historyItems.length === 0 ? (
                <p style={{ color: "#aaa", fontSize: 13 }}>변경 이력이 없습니다.</p>
              ) : (
                <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "80px 160px 1fr 1fr 120px", gap: 8, padding: "8px 14px", background: "var(--color-bg-muted)", fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid var(--color-border)" }}>
                    <div>버전</div><div>변경일시</div><div>변경자</div><div>사유</div><div>액션</div>
                  </div>
                  {historyItems.map((item, idx) => (
                    <div key={item.historyId} style={{ display: "grid", gridTemplateColumns: "80px 160px 1fr 1fr 120px", gap: 8, padding: "10px 14px", alignItems: "center", background: "var(--color-bg-card)", borderTop: idx === 0 ? "none" : "1px solid var(--color-border)" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{item.versionNo}</div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                        {new Date(item.changedAt).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.changerEmail || "-"}</div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.comment || "-"}</div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => setDiffTarget(item)} style={{ ...histGhostBtn }}>Diff</button>
                        <button onClick={() => setDeleteTarget(item)} style={{ ...histGhostBtn, color: "#e53935", borderColor: "#e53935" }}>삭제</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Diff 뷰어 팝업 */}
      {diffTarget && (
        <ReqDiffViewerPopup
          projectId={projectId}
          reqId={reqId}
          items={historyItems}
          initialItem={diffTarget}
          onClose={() => setDiffTarget(null)}
        />
      )}

      {/* 저장 옵션 다이얼로그 */}
      {saveDialogOpen && (
        <SaveOptionDialog
          lastVersion={historyItems[0]?.versionNo ?? null}
          changedFlags={getChangedFlags()}
          onClose={() => setSaveDialogOpen(false)}
          onSave={executeSave}
          isPending={saveMutation.isPending}
        />
      )}

      {/* 상세 명세 변경이력 팝업 — 화면 설명 이력과 동일 UI */}
      <SettingsHistoryDialog
        open={specChangeHistOpen}
        onClose={() => setSpecChangeHistOpen(false)}
        projectId={projectId}
        itemName="상세 명세"
        currentValue={form.detailSpec}
        title="상세 명세 변경이력"
        refTblNm="tb_rq_requirement"
        refId={reqId}
      />

      {/* 분석 메모 변경이력 팝업 — 화면 설명 이력과 동일 UI */}
      <SettingsHistoryDialog
        open={analyChangeHistOpen}
        onClose={() => setAnalyChangeHistOpen(false)}
        projectId={projectId}
        itemName="분석 메모"
        currentValue={form.analysisMemo}
        title="분석 메모 변경이력"
        refTblNm="tb_rq_requirement"
        refId={reqId}
      />

      {/* 삭제 확인 팝업 */}
      {deleteTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setDeleteTarget(null)}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", minWidth: 360, maxWidth: 460, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>이력을 삭제하시겠습니까?</h3>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: "var(--color-text-secondary)" }}>{deleteTarget.versionNo} 버전을 삭제합니다.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} disabled={deleteHistMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 13 }}>취소</button>
              <button onClick={() => deleteHistMutation.mutate(deleteTarget.historyId)} disabled={deleteHistMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 13, background: "#e53935", color: "#fff", border: "none" }}>
                {deleteHistMutation.isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 요구사항 삭제 확인 팝업 */}
      {reqDeleteOpen && (
        <ReqDeleteDialog
          onClose={() => setReqDeleteOpen(false)}
          onConfirm={(deleteChildren) => reqDeleteMutation.mutate(deleteChildren)}
          isPending={reqDeleteMutation.isPending}
        />
      )}

    </div>
  );
}

// ── 요구사항 삭제 다이얼로그 ──────────────────────────────────────────────────

function ReqDeleteDialog({
  onClose,
  onConfirm,
  isPending,
}: {
  onClose:   () => void;
  onConfirm: (deleteChildren: boolean) => void;
  isPending: boolean;
}) {
  const [deleteChildren, setDeleteChildren] = useState<boolean | null>(null);

  function handleDelete() {
    if (deleteChildren === null) { toast.error("하위 데이터 처리 방법을 선택해 주세요."); return; }
    onConfirm(deleteChildren);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", minWidth: 360, maxWidth: 460, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>요구사항을 삭제하시겠습니까?</h3>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--color-text-secondary)" }}>삭제하면 복구할 수 없습니다.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
            <input type="radio" name="reqDeleteType" checked={deleteChildren === true}  onChange={() => setDeleteChildren(true)} />
            하위 사용자스토리 전체 삭제
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
            <input type="radio" name="reqDeleteType" checked={deleteChildren === false} onChange={() => setDeleteChildren(false)} />
            요구사항만 삭제 (스토리 미분류 처리)
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={isPending} style={{ padding: "7px 16px", borderRadius: 6, border: "1px solid var(--color-border)", background: "none", cursor: "pointer", fontSize: 13 }}>취소</button>
          <button onClick={handleDelete} disabled={isPending} style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: "#e53935", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            {isPending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────────────────

function Section({
  title,
  label,
  children,
}: {
  title?: string;
  label?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border:        "1px solid var(--color-border)",
        borderRadius:  8,
        padding:       "20px 24px",
        background:    "var(--color-bg-card)",
        display:       "flex",
        flexDirection: "column",
        gap:           16,
      }}
    >
      {/* 큰 헤더 — title 있을 때만 표시 */}
      {title && (
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
          {title}
        </h2>
      )}
      {/* 작은 레이블 — label 있을 때만 표시 */}
      {label && (
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
          {label}
        </span>
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

// ── 상세 명세 예시 팝업 CSS ──────────────────────────────────────────────────

const SPEC_EXAMPLE_CSS = [
  ".sp-example h2,.sp-example h3{font-size:14px;font-weight:700;margin:16px 0 8px}",
  ".sp-example table{border-collapse:collapse;width:100%;margin-bottom:12px}",
  ".sp-example th,.sp-example td{border:1px solid #e0e0e0;padding:5px 10px;font-size:12px}",
  ".sp-example th{background:#f5f5f5;font-weight:600}",
  ".sp-example p{margin:4px 0;font-size:13px}",
  ".sp-example ul,.sp-example ol{padding-left:18px;margin:4px 0}",
  ".sp-example li{font-size:13px}",
].join(" ");

// ── 상세 명세 예시 팝업 컴포넌트 ─────────────────────────────────────────────

function SpecExamplePopup({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"raw" | "preview">("preview");
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(SPEC_EXAMPLE).then(() => {
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
          <span style={{ fontSize: 15, fontWeight: 700, flexShrink: 0 }}>상세 명세 예시</span>
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
              {SPEC_EXAMPLE}
            </pre>
          ) : (
            <>
              <style dangerouslySetInnerHTML={{ __html: SPEC_EXAMPLE_CSS }} />
              <div
                className="sp-example"
                style={{ fontSize: 13, lineHeight: 1.8, color: "var(--color-text-primary)" }}
                dangerouslySetInnerHTML={{ __html: (() => { const r = marked.parse(SPEC_EXAMPLE, { async: false }); return typeof r === "string" ? r : ""; })() }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 파일 크기 포맷 ───────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024)         return `${bytes} B`;
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Diff 뷰어 팝업 ────────────────────────────────────────────────────────────

function ReqDiffViewerPopup({
  projectId, reqId, items, initialItem, onClose,
}: {
  projectId:   string;
  reqId:       string;
  items:       HistoryItem[];
  initialItem: HistoryItem;
  onClose:     () => void;
}) {
  const initialIdx = items.findIndex((i) => i.historyId === initialItem.historyId);
  const prevItem   = items[initialIdx + 1];
  const [v1Id, setV1Id] = useState<string>(prevItem?.historyId ?? items[items.length - 1]?.historyId ?? "");
  const [v2Id, setV2Id] = useState<string>(initialItem.historyId);
  const sameSelected    = v1Id === v2Id;

  const { data, isLoading } = useQuery({
    queryKey: ["req-history-diff", projectId, reqId, v1Id, v2Id],
    queryFn:  () =>
      authFetch<{ data: DiffResult }>(
        `/api/projects/${projectId}/requirements/${reqId}/history/diff?v1=${v1Id}&v2=${v2Id}`
      ).then((r) => r.data),
    enabled: !!v1Id && !!v2Id && !sameSelected,
  });

  const selStyle: React.CSSProperties = { padding: "7px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 13 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", overflowY: "auto", justifyContent: "center" }}
      onClick={onClose}>
      <div
        style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "28px 32px", width: "90vw", maxWidth: 1100, margin: "40px auto", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>버전 비교 (Diff)</h3>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, fontSize: 13 }}>닫기</button>
        </div>
        <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "center" }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>좌측 버전</label>
            <select value={v1Id} onChange={(e) => setV1Id(e.target.value)} style={selStyle}>
              {items.map((i) => <option key={i.historyId} value={i.historyId}>{i.versionNo} ({i.versionType === "CONFIRMED" ? "확정" : "내부"})</option>)}
            </select>
          </div>
          <div style={{ marginTop: 16, fontSize: 18, color: "var(--color-text-secondary)" }}>↔</div>
          <div>
            <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>우측 버전</label>
            <select value={v2Id} onChange={(e) => setV2Id(e.target.value)} style={selStyle}>
              {items.map((i) => <option key={i.historyId} value={i.historyId}>{i.versionNo} ({i.versionType === "CONFIRMED" ? "확정" : "내부"})</option>)}
            </select>
          </div>
        </div>
        {sameSelected && <div style={{ padding: "16px 0", textAlign: "center", color: "#f57c00", fontSize: 14 }}>서로 다른 버전을 선택해 주세요.</div>}
        {isLoading && !sameSelected && <div style={{ padding: "16px 0", textAlign: "center", color: "#888" }}>로딩 중...</div>}
        {data && !sameSelected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {([
              { label: "원문 (orgnl_cn)",     l: data.v1Content.orgnlCn,  r: data.v2Content.orgnlCn  },
              { label: "현행화 (curncy_cn)",  l: data.v1Content.curncyCn, r: data.v2Content.curncyCn },
            ] as { label: string; l: string; r: string }[]).map(({ label, l, r }) => (
              <ReqDiffSection key={label} label={label} leftText={l} rightText={r}
                leftVersion={data.v1Content.versionNo} rightVersion={data.v2Content.versionNo} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReqDiffSection({ label, leftText, rightText, leftVersion, rightVersion }: {
  label: string; leftText: string; rightText: string; leftVersion: string; rightVersion: string;
}) {
  const leftLines  = leftText.split("\n");
  const rightLines = rightText.split("\n");
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--color-text-secondary)" }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ borderRight: "1px solid var(--color-border)" }}>
          <div style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>{leftVersion} (이전)</div>
          <pre style={{ margin: 0, padding: "10px 12px", fontSize: 12, lineHeight: 1.6, fontFamily: "inherit", whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 48, background: "transparent" }}>
            {leftLines.map((line, i) => {
              const inRight = rightLines.includes(line);
              return <span key={i} style={{ display: "block", background: !inRight && line ? "rgba(229,57,53,0.12)" : "transparent", color: !inRight && line ? "#c62828" : "inherit", textDecoration: !inRight && line ? "line-through" : "none" }}>{line || " "}</span>;
            })}
          </pre>
        </div>
        <div>
          <div style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>{rightVersion} (이후)</div>
          <pre style={{ margin: 0, padding: "10px 12px", fontSize: 12, lineHeight: 1.6, fontFamily: "inherit", whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 48, background: "transparent" }}>
            {rightLines.map((line, i) => {
              const inLeft = leftLines.includes(line);
              return <span key={i} style={{ display: "block", background: !inLeft && line ? "rgba(46,125,50,0.12)" : "transparent", color: !inLeft && line ? "#2e7d32" : "inherit" }}>{line || " "}</span>;
            })}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── 저장 옵션 다이얼로그 (통합) ────────────────────────────────────────────────

function SaveOptionDialog({ lastVersion, changedFlags, onClose, onSave, isPending }: {
  lastVersion: string | null;
  changedFlags: { contentChanged: boolean; specChanged: boolean; analyChanged: boolean };
  onClose: () => void;
  onSave: (opts: {
    saveHistory?: boolean; versionMode?: string; versionComment?: string;
    saveSpecHistory?: boolean; saveAnalyHistory?: boolean;
  }) => void;
  isPending: boolean;
}) {
  // 요구사항 내용 이력 모드
  type VersionMode = "none" | "minor" | "major";
  const [versionMode, setVersionMode] = useState<VersionMode>("none");
  const [comment, setComment]         = useState("");

  // 상세명세·분석메모 이력 저장 여부
  const [saveSpec,  setSaveSpec]  = useState(false);
  const [saveAnaly, setSaveAnaly] = useState(false);

  // 버전 미리보기
  const parts = (lastVersion ?? "V1.0").replace("V", "").split(".");
  const major = parseInt(parts[0] ?? "1", 10);
  const minor = parseInt(parts[1] ?? "0", 10);

  function handleSave() {
    onSave({
      // 요구사항 내용 이력
      ...(changedFlags.contentChanged && versionMode !== "none"
        ? { saveHistory: true, versionMode, versionComment: comment }
        : {}),
      // 상세명세 이력
      saveSpecHistory:  changedFlags.specChanged  && saveSpec,
      // 분석메모 이력
      saveAnalyHistory: changedFlags.analyChanged && saveAnaly,
    });
  }

  const checkboxStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
    borderRadius: 6, fontSize: 13, cursor: "pointer",
    border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  };

  const radioStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
    borderRadius: 6, cursor: "pointer", fontSize: 13,
    border: active ? "1px solid var(--color-primary, #1976d2)" : "1px solid var(--color-border)",
    background: active ? "var(--color-brand-subtle, rgba(25,118,210,0.06))" : "var(--color-bg-card)",
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "24px 28px", minWidth: 400, maxWidth: 500, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700 }}>변경 이력 저장</h3>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "var(--color-text-secondary)" }}>
          변경된 항목의 이력 저장 여부를 선택하세요.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* ── 요구사항 내용 (원문/현행화) ── */}
          {changedFlags.contentChanged && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1976d2", display: "inline-block" }} />
                요구사항 내용 변경됨
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 12 }}>
                <label style={radioStyle(versionMode === "none")} onClick={() => setVersionMode("none")}>
                  <input type="radio" name="vMode" checked={versionMode === "none"} onChange={() => setVersionMode("none")} />
                  이력 없이 저장
                </label>
                <label style={radioStyle(versionMode === "minor")} onClick={() => setVersionMode("minor")}>
                  <input type="radio" name="vMode" checked={versionMode === "minor"} onChange={() => setVersionMode("minor")} />
                  마이너 버전 <span style={{ color: "#1976d2", fontSize: 12, fontWeight: 600 }}>V{major}.{minor + 1}</span>
                </label>
                <label style={radioStyle(versionMode === "major")} onClick={() => setVersionMode("major")}>
                  <input type="radio" name="vMode" checked={versionMode === "major"} onChange={() => setVersionMode("major")} />
                  메이저 버전 <span style={{ color: "#e65100", fontSize: 12, fontWeight: 600 }}>V{major + 1}.0</span>
                </label>
                {versionMode !== "none" && (
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="사유 (선택)"
                    rows={2}
                    style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 12, resize: "vertical", boxSizing: "border-box", marginTop: 4 }}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── 상세 명세 ── */}
          {changedFlags.specChanged && (
            <label style={checkboxStyle}>
              <input type="checkbox" checked={saveSpec} onChange={(e) => setSaveSpec(e.target.checked)} />
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#2e7d32", display: "inline-block" }} />
              <span style={{ flex: 1 }}>상세 명세 변경이력 저장</span>
            </label>
          )}

          {/* ── 분석 메모 ── */}
          {changedFlags.analyChanged && (
            <label style={checkboxStyle}>
              <input type="checkbox" checked={saveAnaly} onChange={(e) => setSaveAnaly(e.target.checked)} />
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6a1b9a", display: "inline-block" }} />
              <span style={{ flex: 1 }}>분석 메모 변경이력 저장</span>
            </label>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} disabled={isPending} style={{ ...secondaryBtnStyle, fontSize: 13 }}>취소</button>
          <button onClick={handleSave} disabled={isPending} style={{ ...secondaryBtnStyle, fontSize: 13, background: "var(--color-primary, #1976d2)", color: "#fff", border: "none" }}>
            {isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── 스타일 ───────────────────────────────────────────────────────────────────

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

const dangerBtnStyle: React.CSSProperties = {
  padding:      "4px 10px",
  borderRadius: 4,
  border:       "1px solid #e53935",
  background:   "transparent",
  color:        "#e53935",
  fontSize:     13,
  cursor:       "pointer",
};

const histGhostBtn: React.CSSProperties = {
  padding:      "2px 8px",
  borderRadius: 4,
  border:       "1px solid var(--color-border)",
  background:   "none",
  color:        "var(--color-text-secondary)",
  fontSize:     11,
  cursor:       "pointer",
  whiteSpace:   "nowrap",
};
