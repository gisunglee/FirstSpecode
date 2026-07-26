"use client";

/**
 * PlanStudioDetailPage — 기획실 상세·편집 (PID-PS-03)
 *
 * 역할:
 *   - 상단: 기획실명 + [AI 생성] [저장]
 *   - 기획명·구분 헤더 + [+ 새 기획]
 *   - 좌측: 산출물 그리드 + 컨텍스트 + 상세 아이디어 + AI 지시사항
 *   - 우측: 결과 뷰어 (MD/Mermaid/HTML 미리보기/원문편집, 좋은 설계 토글)
 *
 * 핵심 동작:
 *   - 좌측 그리드 행 클릭 → 해당 artf 데이터를 편집 폼에 로드
 *   - "+ 새 기획" → 폼 초기화 (신규 모드)
 *   - 저장 → 신규면 POST, 기존이면 PUT
 *   - AI 생성 → 저장 + Claude 호출 + artf_cn 갱신
 *
 * 주요 기술:
 *   - TanStack Query, Mermaid (dynamic import), marked (renderMarkdown)
 */

import { Suspense, useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { renderMarkdown } from "@/lib/renderMarkdown";
import { ARTF_DIV, ARTF_FMT, DIV_BADGE_COLOR, AI_STATUS_BADGE } from "@/constants/planStudio";
import AiTaskDetailDialog from "@/components/ui/AiTaskDetailDialog";
import PlanStudioAIRequestPopup from "@/components/ui/PlanStudioAIRequestPopup";
import { SelectChevron } from "@/components/ui/SelectChevron";
import { useAppStore } from "@/store/appStore";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type ArtfListItem = { artfId: string; artfNm: string; artfDivCode: string; artfFmtCode: string; goodDesignYn: string; aiStatus: string | null; aiTaskId: string | null; mdfcnDt: string | null; creatDt: string };
type ContextItem = { ctxtId: string; ctxtTyCode: string; refId: string; sortOrdr: number; refLabel: string };
type ArtfDetail = { artfId: string; artfNm: string; artfDivCode: string; artfFmtCode: string; artfIdeaCn: string | null; comentCn: string | null; artfCn: string | null; goodDesignYn: string; aiTaskId: string | null; contexts: ContextItem[] };
type ReqOption = { requirementId: string; displayId: string; name: string };
type BoardOption = { artfId: string; artfNm: string; refLabel: string };

export default function PlanStudioDetailPage() {
  return <Suspense fallback={null}><DetailInner /></Suspense>;
}

function DetailInner() {
  const { id: projectId, planStudioId } = useParams<{ id: string; planStudioId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const mermaidRef = useRef<HTMLDivElement>(null);
  // Mermaid 다이어그램 테마를 현재 앱 테마(라이트/다크/dark-purple)에 맞추기 위해 구독
  const theme = useAppStore((s) => s.theme);

  // ── 플로팅 목록 — 상단(목록+컨텍스트) 영역이 스크롤로 화면 밖으로 나가면 오른쪽에 미니 목록을 띄운다 ──
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [showFloatingNav, setShowFloatingNav] = useState(false);
  // X로 끄면 true — 스크롤 위치와 무관하게 숨김. 작은 토글 버튼으로 다시 켤 수 있음.
  const [floatingNavDismissed, setFloatingNavDismissed] = useState(false);

  // ── 기획실 상세 (산출물 목록 포함) ──
  const { data: studioData } = useQuery({
    queryKey: ["plan-studio-detail", projectId, planStudioId],
    queryFn: () =>
      authFetch<{ data: { planStudio: { planStudioId: string; planStudioDisplayId: string; planStudioNm: string }; artifacts: ArtfListItem[] } }>(
        `/api/projects/${projectId}/plan-studios/${planStudioId}`
      ).then((r) => r.data),
  });
  const studio = studioData?.planStudio;
  const artfList = studioData?.artifacts ?? [];

  // sentinel은 studio 로딩 완료 후에야 DOM에 실제로 존재한다(로딩 중엔 다른 JSX가 반환됨).
  // 그래서 이 effect는 studio 가 생긴 "이후" 다시 실행되어야 ref가 붙는다 — deps에 studio 포함.
  useEffect(() => {
    const el = topSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setShowFloatingNav(!entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, [studio]);

  // ── 기획실명 수정 (헤더 타이틀 옆 "이름 변경") ──
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameMut = useMutation({
    mutationFn: (nm: string) =>
      authFetch(`/api/projects/${projectId}/plan-studios/${planStudioId}`, {
        method: "PUT", body: JSON.stringify({ planStudioNm: nm }),
      }),
    onSuccess: () => {
      toast.success("기획실명이 변경되었습니다.");
      setRenameOpen(false);
      qc.invalidateQueries({ queryKey: ["plan-studio-detail", projectId, planStudioId] });
      qc.invalidateQueries({ queryKey: ["plan-studios", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── 편집 폼 상태 ──
  const [selectedArtfId, setSelectedArtfId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [artfNm, setArtfNm] = useState("");
  const [artfDivCode, setArtfDivCode] = useState("IA");
  const [artfFmtCode, setArtfFmtCode] = useState("MD");
  const [artfIdeaCn, setArtfIdeaCn] = useState("");
  // 코멘트(comentCn)는 본문 입력에서 제외됨 — AI 생성 팝업에서 일회성으로 입력받아
  // tb_ai_task.coment_cn 에만 저장된다. (산출물 entity 의 coment_cn 컬럼은 호환을 위해 유지하되 신규 저장 안 함)
  const [artfCn, setArtfCn] = useState("");
  const [contexts, setContexts] = useState<ContextItem[]>([]);
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  // 우측 미리보기가 실제로 렌더링할 형식 — artfFmtCode(폼 입력값, 저장 대상)와 분리.
  // 좌측 "형식" 드롭다운은 저장 전 편집값일 뿐인데 artfFmtCode를 공유하면
  // 드롭다운을 만지는 즉시 우측 미리보기가 따라 바뀌어 버려 혼란스러움.
  // 목록 클릭(artf 재선택)·저장 성공 시에만 서버 값으로 동기화한다.
  const [viewFmtCode, setViewFmtCode] = useState("MD");
  const [ideaTab, setIdeaTab] = useState<"edit" | "preview">("edit");

  // 팝업
  // 상세 아이디어 — 목록 화면이 좁아 인라인 카드 대신 레이어 팝업으로 편집 (편집 대상은 항상 "현재 선택된 artf")
  const [ideaModalOpen, setIdeaModalOpen] = useState(false);
  const [reqPickerOpen, setReqPickerOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [reqSearch, setReqSearch] = useState("");
  const [boardSearch, setBoardSearch] = useState("");
  const [reqPickerTab, setReqPickerTab] = useState<"req" | "uw">("req");
  // 요구사항 상세 보기 팝업
  const [reqDetailId, setReqDetailId] = useState<string | null>(null);
  const [reqDetailTab, setReqDetailTab] = useState<"current" | "spec" | "analysis">("current");
  // AI 태스크 상세 팝업
  const [aiDetailTaskId, setAiDetailTaskId] = useState<string | null>(null);
  // AI 생성 요청 확인 팝업 — open 시 매칭 프롬프트 조회 + 코멘트/첨부 입력 후 generate API 호출
  const [aiPopupOpen, setAiPopupOpen] = useState(false);
  const [aiPopupReRequest, setAiPopupReRequest] = useState(false);
  // Full Size 뷰어 팝업
  const [fullSizeOpen, setFullSizeOpen] = useState(false);
  const [fullSizeMode, setFullSizeMode] = useState<"preview" | "edit">("preview");
  const fullMermaidRef = useRef<HTMLDivElement>(null);

  // 상세 진입 시 첫 번째 산출물 자동 선택 (신규 모드가 아닐 때만)
  useEffect(() => {
    if (artfList.length > 0 && !selectedArtfId && !isNew) {
      setSelectedArtfId(artfList[0].artfId);
    }
  }, [artfList, selectedArtfId, isNew]);

  // ── 산출물 상세 로드 ──
  const { data: artfDetail } = useQuery({
    queryKey: ["artf-detail", projectId, planStudioId, selectedArtfId],
    queryFn: () =>
      authFetch<{ data: ArtfDetail }>(`/api/projects/${projectId}/plan-studios/${planStudioId}/artifacts/${selectedArtfId}`).then((r) => r.data),
    enabled: !!selectedArtfId && !isNew,
  });

  // 상세 로드 시 폼 채우기
  useEffect(() => {
    if (artfDetail && !isNew) {
      setArtfNm(artfDetail.artfNm);
      setArtfDivCode(artfDetail.artfDivCode);
      setArtfFmtCode(artfDetail.artfFmtCode);
      setArtfIdeaCn(artfDetail.artfIdeaCn ?? "");
      // artfDetail.comentCn 은 더 이상 본문에 노출하지 않음 (deprecated)
      setArtfCn(artfDetail.artfCn ?? "");
      setContexts(artfDetail.contexts);
      setViewFmtCode(artfDetail.artfFmtCode);
    }
  }, [artfDetail, isNew]);

  // 기획명 input ref
  const artfNmRef = useRef<HTMLInputElement>(null);

  // + 추가 클릭 → 기획명 input 값으로 바로 INSERT
  const createArtfMut = useMutation({
    mutationFn: () => {
      if (!artfNm.trim()) throw new Error("기획명을 입력해 주세요.");
      return authFetch<{ data: { artfId: string } }>(`/api/projects/${projectId}/plan-studios/${planStudioId}/artifacts`, {
        method: "POST",
        body: JSON.stringify({ artfNm: artfNm.trim(), artfDivCode, artfFmtCode }),
      }).then((r) => r.data);
    },
    onSuccess: (d) => {
      toast.success("기획이 추가되었습니다.");
      qc.invalidateQueries({ queryKey: ["plan-studio-detail", projectId, planStudioId] });
      setSelectedArtfId(d.artfId);
      setIsNew(false);
      // 폼 초기화 (다음 추가를 위해)
      setArtfNm("");
      setArtfDivCode("IA");
      setArtfFmtCode("MD");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // 행 클릭 → 상세 로드
  function selectArtf(artfId: string) {
    setSelectedArtfId(artfId);
    setIsNew(false);
    setViewMode("preview");
  }

  // 플로팅 목록 클릭 → 선택 + 상단(목록이 있는 위치)으로 스크롤 복귀.
  // 플로팅 목록은 목록이 화면 밖으로 나갔을 때만 뜨므로, 선택 직후 다시 위로 올려줘야
  // 방금 고른 항목이 실제 목록에서도 하이라이트된 걸 바로 확인할 수 있다.
  function selectArtfFromFloatingNav(artfId: string) {
    selectArtf(artfId);
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Mermaid 렌더링
  // theme 변화 시 자동 재렌더링되도록 의존성에 theme 포함 — 라이트→다크 토글하면 다이어그램이 다크 톤으로 즉시 갱신
  useEffect(() => {
    if (viewFmtCode !== "MERMAID" || viewMode !== "preview" || !artfCn || !mermaidRef.current) return;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        // dark, dark-purple 모두 mermaid 'dark' 팔레트 사용 — 어두운 본문 위에 어두운 다이어그램으로 자연스러움
        const isDark = theme === "dark" || theme === "dark-purple";
        mermaid.initialize({ startOnLoad: false, theme: isDark ? "dark" : "default" });
        // AI 응답이 ```mermaid ... ``` fence로 감싸져 오면 파싱 실패 → fence 벗겨서 전달
        const src = stripOuterCodeFence(artfCn, ["mermaid"]);
        // Mermaid는 같은 ID를 두 번 렌더링하면 에러 → 유니크 ID
        const { svg } = await mermaid.render(`mm-${Date.now()}`, src);
        if (mermaidRef.current) mermaidRef.current.innerHTML = svg;
      } catch (err) {
        if (mermaidRef.current) mermaidRef.current.innerHTML = `<pre style="color:#e53935">Mermaid 렌더링 오류:\n${err}</pre>`;
      }
    })();
  }, [viewFmtCode, viewMode, artfCn, theme]);

  // Full Size 팝업 Mermaid 렌더링
  useEffect(() => {
    if (!fullSizeOpen || viewFmtCode !== "MERMAID" || fullSizeMode !== "preview" || !artfCn || !fullMermaidRef.current) return;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const isDark = theme === "dark" || theme === "dark-purple";
        mermaid.initialize({ startOnLoad: false, theme: isDark ? "dark" : "default" });
        const src = stripOuterCodeFence(artfCn, ["mermaid"]);
        const { svg } = await mermaid.render(`mm-full-${Date.now()}`, src);
        if (fullMermaidRef.current) fullMermaidRef.current.innerHTML = svg;
      } catch (err) {
        if (fullMermaidRef.current) fullMermaidRef.current.innerHTML = `<pre style="color:#e53935">Mermaid 렌더링 오류:\n${err}</pre>`;
      }
    })();
  }, [fullSizeOpen, viewFmtCode, fullSizeMode, artfCn, theme]);

  // ── 저장 ──
  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        artfNm, artfDivCode, artfFmtCode, artfIdeaCn,
        artfCn: viewMode === "edit" ? artfCn : undefined,
        contexts: contexts.map((c, i) => ({ ctxtTyCode: c.ctxtTyCode, refId: c.refId, sortOrdr: i })),
      };
      if (isNew) {
        return authFetch<{ data: { artfId: string } }>(`/api/projects/${projectId}/plan-studios/${planStudioId}/artifacts`, {
          method: "POST", body: JSON.stringify(body),
        }).then((r) => r.data);
      }
      return authFetch(`/api/projects/${projectId}/plan-studios/${planStudioId}/artifacts/${selectedArtfId}`, {
        method: "PUT", body: JSON.stringify(body),
      });
    },
    onSuccess: (d) => {
      toast.success("저장되었습니다.");
      // 신규 저장 시 artfId 설정
      if (isNew && d && typeof d === "object" && "artfId" in d) {
        setSelectedArtfId((d as { artfId: string }).artfId);
        setIsNew(false);
      }
      qc.invalidateQueries({ queryKey: ["plan-studio-detail", projectId, planStudioId] });
      qc.invalidateQueries({ queryKey: ["artf-detail", projectId, planStudioId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── AI 생성 — 즉시 INSERT 가 아니라 PlanStudioAIRequestPopup 으로 위임 ──
  // 팝업이 자체적으로 매칭 프롬프트 조회 + 코멘트·첨부 입력 + multipart 호출까지 담당.
  // 페이지 측은 (1) PENDING/IN_PROGRESS 차단, (2) 팝업 open/close 토글, (3) 성공 시 캐시 무효화만.
  function openAIRequestPopup() {
    if (isNew || !selectedArtfId) { toast.error("먼저 저장해 주세요."); return; }
    if (!artfNm.trim())            { toast.error("기획명을 입력해 주세요."); return; }

    const currentArtf = artfList.find((a) => a.artfId === selectedArtfId);
    const aiStatus    = currentArtf?.aiStatus;

    // PENDING / IN_PROGRESS / PROCESSING 은 팝업 자체를 막음 (영역 패턴과 동일 정책).
    if (aiStatus === "PENDING" || aiStatus === "IN_PROGRESS" || aiStatus === "PROCESSING") {
      toast.error(`현재 AI 작업이 ${aiStatus === "PENDING" ? "대기 중" : "진행 중"}입니다.`);
      return;
    }

    // 이미 한 번 처리된 후 재요청 — 팝업은 열되 헤더에 안내 표시
    setAiPopupReRequest(!!currentArtf?.aiTaskId);
    setAiPopupOpen(true);
  }

  function handleAIRequestSuccess() {
    qc.invalidateQueries({ queryKey: ["plan-studio-detail", projectId, planStudioId] });
    qc.invalidateQueries({ queryKey: ["artf-detail", projectId, planStudioId, selectedArtfId] });
  }

  // ── 좋은 설계 토글 ──
  function toggleGood() {
    if (!selectedArtfId || !artfDetail) return;
    const yn = artfDetail.goodDesignYn === "Y" ? "N" : "Y";
    authFetch(`/api/projects/${projectId}/plan-studios/${planStudioId}/artifacts/${selectedArtfId}/good-design`, {
      method: "PUT", body: JSON.stringify({ goodDesignYn: yn }),
    }).then(() => {
      qc.invalidateQueries({ queryKey: ["plan-studio-detail"] });
      qc.invalidateQueries({ queryKey: ["artf-detail"] });
    });
  }

  // 목록에서 직접 별 토글 (artfId + 현재 yn 전달)
  function toggleGoodById(artfId: string, currentYn: string) {
    const yn = currentYn === "Y" ? "N" : "Y";
    authFetch(`/api/projects/${projectId}/plan-studios/${planStudioId}/artifacts/${artfId}/good-design`, {
      method: "PUT", body: JSON.stringify({ goodDesignYn: yn }),
    }).then(() => {
      qc.invalidateQueries({ queryKey: ["plan-studio-detail"] });
      qc.invalidateQueries({ queryKey: ["artf-detail"] });
    });
  }

  // ── 산출물 삭제 ──
  const deleteArtfMut = useMutation({
    mutationFn: (id: string) => authFetch(`/api/projects/${projectId}/plan-studios/${planStudioId}/artifacts/${id}`, { method: "DELETE" }),
    onSuccess: (_data, deletedId) => {
      toast.success("삭제되었습니다.");
      // 삭제된 artf가 현재 선택 중이었으면 → 다른 artf 자동 선택 또는 폼 초기화
      if (selectedArtfId === deletedId) {
        const remaining = artfList.filter((a) => a.artfId !== deletedId);
        if (remaining.length > 0) {
          // 다른 기획으로 자동 선택
          setSelectedArtfId(remaining[0].artfId);
          setIsNew(false);
        } else {
          // 남은 기획이 없으면 전체 초기화
          setSelectedArtfId(null);
          setIsNew(false);
          setArtfNm("");
          setArtfDivCode("IA");
          setArtfFmtCode("MD");
          setArtfIdeaCn("");
          setArtfCn("");
          setContexts([]);
          setViewFmtCode("MD");
        }
      }
      qc.invalidateQueries({ queryKey: ["plan-studio-detail", projectId, planStudioId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── 컨텍스트 추가/제거 ──
  function addContext(ctxtTyCode: string, refId: string, refLabel: string) {
    if (ctxtTyCode === "ARTF" && refId === selectedArtfId) { toast.error("자기 자신은 추가할 수 없습니다."); return; }
    if (contexts.some((c) => c.ctxtTyCode === ctxtTyCode && c.refId === refId)) return;
    setContexts((p) => [...p, { ctxtId: "", ctxtTyCode, refId, sortOrdr: p.length, refLabel }]);
  }
  function removeContext(refId: string, ctxtTyCode: string) {
    setContexts((p) => p.filter((c) => !(c.refId === refId && c.ctxtTyCode === ctxtTyCode)));
  }

  // ── 요구사항 전체 로드 (팝업 열릴 때 1회 — 클라이언트 필터링) ──
  const { data: allReqs } = useQuery({
    queryKey: ["all-reqs-ps", projectId],
    queryFn: () => authFetch<{ data: { items: Array<{ requirementId: string; displayId: string; name: string; taskId: string | null; taskName: string }> } }>(`/api/projects/${projectId}/requirements`).then((r) => r.data.items ?? []),
    enabled: reqPickerOpen,
  });
  // ── 요구사항 상세 조회 (칩 클릭 시 읽기 전용 팝업) ──
  const { data: reqDetailData } = useQuery({
    queryKey: ["req-detail-ps", projectId, reqDetailId],
    queryFn: () =>
      authFetch<{ data: { displayId: string; name: string; currentContent: string; detailSpec: string; analysisMemo: string } }>(
        `/api/projects/${projectId}/requirements/${reqDetailId}`
      ).then((r) => r.data),
    enabled: !!reqDetailId,
  });

  // 검색어로 클라이언트 필터링
  const filteredReqs = (allReqs ?? []).filter((r) => {
    if (!reqSearch.trim()) return true;
    const q = reqSearch.toLowerCase();
    return r.displayId.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
  });

  // ── 단위업무 목록 (탭용) — API 응답 필드: reqId (requirementId 아님)
  const { data: unitWorks } = useQuery({
    queryKey: ["unit-works-ps", projectId],
    queryFn: () => authFetch<{ data: { items: Array<{ unitWorkId: string; displayId: string; name: string; reqId: string; reqDisplayId: string; reqName: string }> } }>(`/api/projects/${projectId}/unit-works`).then((r) => r.data.items ?? []),
    enabled: reqPickerOpen,
  });

  // ── 기획보드 검색 ──
  const { data: boardOptions } = useQuery({
    queryKey: ["board-search-ps", projectId, boardSearch, selectedArtfId],
    queryFn: () => authFetch<{ data: { items: BoardOption[] } }>(`/api/projects/${projectId}/plan-studios/artifacts?q=${encodeURIComponent(boardSearch)}&excludeArtfId=${selectedArtfId ?? ""}`).then((r) => r.data.items ?? []),
    enabled: boardPickerOpen,
  });

  if (!studio) return <div style={{ padding: 40, color: "#888" }}>로딩 중...</div>;

  return (
    <div style={{ padding: 0, display: "flex", flexDirection: "column" }}>
      {/* 상단 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", position: "sticky", top: 0, zIndex: 10, background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => router.push(`/projects/${projectId}/plan-studio`)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#666" }}>←</button>
          {/* 엔티티 타입 배지 — 다른 상세 페이지(요구사항/화면/영역)의 "{타입} 편집" 헤더와 톤을 맞춤.
              분석 그룹의 기존 태그 색상(과업=파랑, 요구사항=회색, 스토리=보라)과 겹치지 않도록 시안 톤 사용. */}
          <span style={{
            fontSize: 11, fontWeight: 600,
            padding: "2px 8px", borderRadius: 4,
            background: "#e0f7fa", color: "#006064",
            letterSpacing: "0.02em", flexShrink: 0,
          }}>
            기획실
          </span>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>{studio.planStudioNm}</span>
          <span style={{ fontSize: 11, color: "#999" }}>({studio.planStudioDisplayId})</span>
          {/* 기획실명 자체는 여기서만 수정 가능 — 산출물(기획)명과는 별개 필드 */}
          <button
            onClick={() => { setRenameValue(studio.planStudioNm); setRenameOpen(true); }}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#999", padding: "2px 4px", lineHeight: 1 }}
            title="기획실명 수정"
          >
            ✏️
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={openAIRequestPopup}
            disabled={isNew}
            style={primaryBtn}
          >
            AI 생성
          </button>
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !artfNm.trim()} style={primaryBtn}>
            {saveMut.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* 상단: 목록(좌, 넓게) + 컨텍스트(우) 나란히 — 하단: 미리보기 full width
          예전 좌우 2컬럼(1fr 1fr) 구조는 목록도 미리보기(특히 Mermaid 다이어그램)도
          절반 폭에 갇혀 둘 다 타이트했다. 목록/컨텍스트는 위에서 필요한 만큼만 높이를 쓰고,
          미리보기는 남은 세로 공간 전체를 폭 100%로 쓰도록 재구성.
          페이지 자체는 높이를 강제하지 않는다 — <main>(MainLayout)이 유일한 스크롤 컨테이너가
          되도록 해서, 미리보기가 길어지면 그 안에서만 스크롤되지 않고 페이지 전체가 스크롤된다. */}
      <div style={{ display: "flex", flexDirection: "column" }}>

        {/* 상단 — 목록 + 컨텍스트
            컨텍스트 칩은 폭이 좁아 한 줄에 하나씩 나오므로(2열로 안 뻗음) 컬럼 비율을
            목록 쪽으로 더 몰아줌 — 목록이 컬럼 6개(기획명/구분/형식/AI상태/액션/수정일시)라 더 넓어야 함.
            행 높이를 고정하고 두 컬럼을 flex column으로 만들어, 컨텍스트 칩 개수가 늘어나도
            (내부 스크롤만 늘어날 뿐) 컬럼 전체 높이는 항상 목록과 정확히 같게 유지한다. */}
        <div style={{ display: "grid", gridTemplateColumns: "5fr 2fr", gap: 16, padding: "16px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)", height: 380, flexShrink: 0 }}>

          {/* ── 좌: 산출물 목록 ── */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>

            {/* 기획명·구분 헤더 */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 14px" }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", flexShrink: 0 }}>기획명:</label>
              <input ref={artfNmRef} value={artfNm} onChange={(e) => setArtfNm(e.target.value)} placeholder="기획명 입력" className="sp-input" style={{ flex: 1 }} />
              <div className="sp-select-wrap" style={{ width: 116 }}>
                <select value={artfDivCode} onChange={(e) => setArtfDivCode(e.target.value)} className="sp-input">
                  <optgroup label="기획">
                    {Object.values(ARTF_DIV).filter((d) => d.group === "기획").map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
                  </optgroup>
                  <optgroup label="개발">
                    {Object.values(ARTF_DIV).filter((d) => d.group === "개발").map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
                  </optgroup>
                </select>
                <span className="sp-select-arrow"><SelectChevron /></span>
              </div>
              <div className="sp-select-wrap" style={{ width: 92 }}>
                <select value={artfFmtCode} onChange={(e) => setArtfFmtCode(e.target.value)} className="sp-input">
                  {Object.values(ARTF_FMT).map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
                </select>
                <span className="sp-select-arrow"><SelectChevron /></span>
              </div>
              {/* 선택 상태 → 수정 + 새 기획 | 신규 상태 → 추가 + 새 기획 */}
          {selectedArtfId ? (
            <>
              <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !artfNm.trim()} style={secBtn}>
                {saveMut.isPending ? "수정 중..." : "수정"}
              </button>
              <button onClick={() => {
                setSelectedArtfId(null); setIsNew(true);
                setArtfNm(""); setArtfDivCode("IA"); setArtfFmtCode("MD");
                setArtfIdeaCn(""); setArtfCn(""); setContexts([]);
                setViewFmtCode("MD");
                setTimeout(() => artfNmRef.current?.focus(), 100);
              }} style={primaryBtn}>
                + 새 기획
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { if (!artfNm.trim()) { toast.error("기획명을 입력해 주세요."); artfNmRef.current?.focus(); return; } createArtfMut.mutate(); }} disabled={createArtfMut.isPending} style={primaryBtn}>
                {createArtfMut.isPending ? "추가 중..." : "+ 추가"}
              </button>
            </>
          )}
            </div>

            {/* 산출물 그리드 — 테이블 스타일
                헤더와 행을 같은 스크롤 박스 안에 두고 헤더만 sticky 처리한다.
                헤더를 스크롤 영역 밖에 따로 두면(예전 구조) 행 목록에만 세로 스크롤바가 붙는 순간
                그 폭(수~십px)만큼 헤더와 데이터 컬럼이 어긋나 보였다. */}
            <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {/* 헤더 — 스크롤 박스 안에서 sticky 로 고정 */}
              <div style={{ display: "grid", gridTemplateColumns: ARTF_GRID, gap: 0, padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)", position: "sticky", top: 0, zIndex: 1 }}>
                <div>기획명</div><div /><div style={{ textAlign: "center" }}>구분</div><div style={{ textAlign: "center" }}>형식</div><div style={{ textAlign: "center" }}>AI상태</div><div style={{ textAlign: "center" }}>액션</div><div style={{ textAlign: "center" }}>수정일시</div>
              </div>
              {artfList.map((a) => {
                const divBadge = DIV_BADGE_COLOR[a.artfDivCode] ?? { bg: "#eee", color: "#666" };
                const aiBadge = a.aiStatus ? AI_STATUS_BADGE[a.aiStatus] : null;
                const isSelected = selectedArtfId === a.artfId;
                return (
                  <div key={a.artfId} onClick={() => selectArtf(a.artfId)} style={{ display: "grid", gridTemplateColumns: ARTF_GRID, gap: 0, padding: "8px 12px", alignItems: "center", cursor: "pointer", borderBottom: "1px solid var(--color-border)", background: isSelected ? "var(--color-brand-subtle)" : "var(--color-bg-card)", borderLeft: isSelected ? "3px solid var(--color-primary, #1976d2)" : "3px solid transparent", transition: "background 0.1s" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: isSelected ? 600 : 400, overflow: "hidden", color: isSelected ? "var(--color-primary, #1976d2)" : "var(--color-text-primary)" }}>
                      <button onClick={(e) => { e.stopPropagation(); toggleGoodById(a.artfId, a.goodDesignYn); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1, flexShrink: 0 }} title="좋은 설계">{a.goodDesignYn === "Y" ? "⭐" : "☆"}</button>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.artfNm || "(이름 없음)"}</span>
                    </div>
                    {/* Full Size 미리보기 — 행을 선택한 뒤 바로 크게 열기 (아래로 스크롤해서 ⛶ 누르러 갈 필요 없이) */}
                    <div style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => { selectArtf(a.artfId); setFullSizeOpen(true); setFullSizeMode("preview"); }}
                        style={actionIconBtn}
                        title="Full Size로 보기"
                      >
                        ⛶
                      </button>
                    </div>
                    <div style={{ textAlign: "center" }}><span className="sp-badge" style={{ ...badge, background: divBadge.bg, color: divBadge.color }}>{ARTF_DIV[a.artfDivCode as keyof typeof ARTF_DIV]?.name ?? a.artfDivCode}</span></div>
                    <div style={{ textAlign: "center", fontSize: 11, color: "var(--color-text-secondary)" }}>{ARTF_FMT[a.artfFmtCode as keyof typeof ARTF_FMT]?.name ?? a.artfFmtCode}</div>
                    <div style={{ textAlign: "center" }} onClick={(e) => { e.stopPropagation(); if (a.aiTaskId) setAiDetailTaskId(a.aiTaskId); }}>
                      {aiBadge ? (
                        <span className="sp-badge" style={{ ...badge, background: aiBadge.bg, color: aiBadge.color, cursor: a.aiTaskId ? "pointer" : "default" }}>{aiBadge.label}</span>
                      ) : a.aiTaskId ? (
                        <span className="sp-badge" style={{ ...badge, background: "#fff3e0", color: "#e65100", cursor: "pointer" }}>대기</span>
                      ) : (
                        <span style={{ fontSize: 11, color: "#bbb" }}>—</span>
                      )}
                    </div>
                    <div style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { if (confirm("이 기획을 삭제하시겠습니까?")) deleteArtfMut.mutate(a.artfId); }} style={{ ...actionIconBtn, color: "#e53935" }} title="삭제">×</button>
                    </div>
                    <div style={{ fontSize: 11, color: "#999", textAlign: "center" }}>{formatShortDt(a.mdfcnDt ?? a.creatDt)}</div>
                  </div>
                );
              })}
              {artfList.length === 0 && <div style={{ padding: 16, fontSize: 12, color: "#aaa", textAlign: "center" }}>산출물이 없습니다. 기획명을 입력하고 "+ 추가"를 클릭하세요.</div>}
              </div>
            </div>

            {/* AI 지시사항(comment) 입력 영역은 [AI 생성] 클릭 시 뜨는 팝업으로 이동했다.
                본문 입력은 페이지 진입 시 폼이 너무 비대해지고, 산출물별 코멘트가
                실제로는 한 번 보내고 끝나는 일회성 지시사항이라 페이지에 상주할 필요가 없음.
                tb_ds_plan_studio_artf.coment_cn 은 호환을 위해 컬럼은 유지하되 새로 저장하지 않음. */}
          </div>

          {/* ── 우: 컨텍스트 — 2단 구조, 버튼 우측 정렬 ── */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "14px 16px" }}>
            {/* 헤더: 타이틀 + 버튼 그룹 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>컨텍스트</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setReqPickerOpen(true)} style={ctxAddBtn}>📋 요구사항 추가</button>
                <button onClick={() => setBoardPickerOpen(true)} style={ctxAddBtn}>🔗 기획보드 추가</button>
              </div>
            </div>

            {/* 요구사항 + 기획보드 칩 — 항목이 늘어나도 카드가 무한정 커지지 않도록
                섹션별이 아니라 이 영역 전체를 하나의 스크롤 박스로 묶는다.
                flex:1 로 목록 컬럼과 같은 전체 높이를 채우고, 늘어난 만큼은 내부 스크롤로만 처리
                → 아래 "상세 설계"가 항상 카드 맨 아래에 고정된다. */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {/* 요구사항 칩 영역 */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>요구사항</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {contexts.filter((c) => c.ctxtTyCode === "REQ").map((c) => (
                    <span key={c.refId} style={ctxChip}>
                      <span onClick={() => { setReqDetailId(c.refId); setReqDetailTab("current"); }} style={{ cursor: "pointer", color: "var(--color-primary, #1976d2)", fontWeight: 600, marginRight: 4 }} title="클릭하여 상세 보기">{c.refLabel.split(" ")[0]}</span>
                      <span onClick={() => { setReqDetailId(c.refId); setReqDetailTab("current"); }} style={{ cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }} title="클릭하여 상세 보기">{c.refLabel.split(" ").slice(1).join(" ")}</span>
                      <button onClick={() => removeContext(c.refId, c.ctxtTyCode)} style={ctxChipX}>×</button>
                    </span>
                  ))}
                  {contexts.filter((c) => c.ctxtTyCode === "REQ").length === 0 && (
                    <span style={{ fontSize: 12, color: "#bbb", fontStyle: "italic" }}>요구사항을 추가하세요</span>
                  )}
                </div>
              </div>

              {/* 기획보드 칩 영역 */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>기획보드</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {contexts.filter((c) => c.ctxtTyCode === "ARTF").map((c) => (
                    <span key={c.refId} style={ctxChip}>
                      <span style={{ color: "var(--color-primary, #1976d2)", fontWeight: 600, marginRight: 4 }}>{c.refLabel.split(" > ")[0]}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{c.refLabel.includes(" > ") ? c.refLabel.split(" > ")[1] : ""}</span>
                      <button onClick={() => removeContext(c.refId, c.ctxtTyCode)} style={ctxChipX}>×</button>
                    </span>
                  ))}
                  {contexts.filter((c) => c.ctxtTyCode === "ARTF").length === 0 && (
                    <span style={{ fontSize: 12, color: "#bbb", fontStyle: "italic" }}>기획보드를 추가하세요</span>
                  )}
                </div>
              </div>
            </div>

            {/* 상세 설계(아이디어) — 컨텍스트와 마찬가지로 "현재 선택된 산출물"의 속성이라 같은 카드에 둔다.
                제목 + 내용 스니펫으로 작성 여부/대략적인 내용을 바로 확인 가능, 클릭하면 팝업으로 편집. */}
            <div
              onClick={() => setIdeaModalOpen(true)}
              style={{ flexShrink: 0, marginTop: 10, display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-muted)", cursor: "pointer" }}
              title="상세 아이디어 보기/편집"
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-primary)", flexShrink: 0 }}>📝 상세 설계</span>
              <span style={{
                fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: artfIdeaCn.trim() ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
                fontStyle: artfIdeaCn.trim() ? "normal" : "italic",
              }}>
                {artfIdeaCn.trim() ? ideaSnippet(artfIdeaCn) : "작성된 내용이 없습니다"}
              </span>
            </div>
          </div>
        </div>

        {/* 상단(목록+컨텍스트) 영역이 스크롤로 화면 밖으로 나갔는지 감지하는 sentinel — 화면에 보이는 요소가 아님 */}
        <div ref={topSentinelRef} />

        {/* 하단 — 결과 뷰어 + 플로팅 미니 목록을 같은 그리드 셀에 겹쳐서 배치.
            (height:0 래퍼에 sticky를 넣는 방식은 sticky의 "움직일 수 있는 범위"도 부모 높이만큼만
            생겨서 실제로는 절대 안 뜬다 — 그래서 미리보기와 같은 셀에 겹쳐 미리보기 높이 전체를
            sticky의 이동 범위로 확보한다.) */}
        <div style={{ display: "grid" }}>
          {/* 하단 — 결과 뷰어 (full width, 내부 스크롤 없음 — 페이지 스크롤에 맡김) */}
          <div style={{ gridColumn: "1 / -1", gridRow: "1 / -1", display: "flex", flexDirection: "column", background: "var(--color-bg-card)" }}>
          {/* 탭 바 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setViewMode("preview")} style={{ ...tabBtn, fontWeight: viewMode === "preview" ? 700 : 400 }}>미리보기</button>
              <button onClick={() => setViewMode("edit")} style={{ ...tabBtn, fontWeight: viewMode === "edit" ? 700 : 400 }}>원문편집</button>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {(["MD", "MERMAID", "HTML"] as const).map((f) => (
                // 우측 탭 클릭은 미리보기 형식(viewFmtCode)뿐 아니라 저장될 폼 값(artfFmtCode)도 함께 바꾼다.
                // (좌측 "형식" 드롭다운 → 우측 미리보기로의 자동 반영만 끊은 것이지,
                //  우측 탭을 직접 누르는 명시적 조작까지 저장값과 분리할 필요는 없음)
                <button key={f} onClick={() => { setViewFmtCode(f); setArtfFmtCode(f); }} style={{ ...tabBtn, fontWeight: viewFmtCode === f ? 700 : 400 }}>{ARTF_FMT[f].name}</button>
              ))}
              <button onClick={() => { setFullSizeOpen(true); setFullSizeMode("preview"); }} style={{ ...tabBtn, fontSize: 14 }} title="Full Size">⛶</button>
            </div>
          </div>

          {/* 렌더링 영역 — 내용 높이만큼 자연스럽게 늘어나고, 스크롤은 페이지(<main>) 가 담당 */}
          <div style={{ padding: 16, minHeight: 400 }}>
            {viewMode === "edit" ? (
              <textarea value={artfCn} onChange={(e) => setArtfCn(e.target.value)} className="sp-input" style={{ width: "100%", height: 500, boxSizing: "border-box", fontFamily: "monospace", resize: "vertical" }} />
            ) : !artfCn ? (
              <div style={{ color: "#aaa", fontSize: 13, padding: 20 }}>아직 생성된 본문이 없습니다.</div>
            ) : viewFmtCode === "MD" ? (
              <div className="sp-markdown" style={{ fontSize: 14, lineHeight: 1.8, color: "var(--color-text-primary)" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(stripOuterCodeFence(artfCn, ["markdown", "md"])) }} />
            ) : viewFmtCode === "MERMAID" ? (
              <div ref={mermaidRef} />
            ) : viewFmtCode === "HTML" ? (
              <iframe srcDoc={stripOuterCodeFence(artfCn, ["html"])} sandbox="allow-scripts" style={{ width: "100%", height: 700, border: "1px solid var(--color-border)", borderRadius: 6 }} title="HTML 미리보기" />
            ) : null}
          </div>
          </div>

          {/* 플로팅 미니 목록 — 상단 목록이 화면 밖으로 나갔을 때만 등장 (X로 끄면 다시 스크롤해도 안 뜸).
              래퍼는 pointerEvents:none 으로 미리보기 클릭을 막지 않게 하고, 실제 박스에서만 다시 켠다. */}
          {showFloatingNav && !floatingNavDismissed && (
            <div style={{ gridColumn: "1 / -1", gridRow: "1 / -1", position: "relative", zIndex: 40, pointerEvents: "none" }}>
              <div style={{
                position: "sticky", top: "50vh", transform: "translateY(-50%)",
                marginLeft: "auto", width: 200, maxHeight: "60vh", overflowY: "auto", pointerEvents: "auto",
                background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
                borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", padding: "8px 0",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 8px 8px 14px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    기획 목록
                  </span>
                  <button
                    onClick={() => setFloatingNavDismissed(true)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#999", padding: "0 2px", lineHeight: 1 }}
                    title="닫기"
                  >
                    ×
                  </button>
                </div>
                {artfList.map((a) => (
                  <button
                    key={a.artfId}
                    onClick={() => selectArtfFromFloatingNav(a.artfId)}
                    title={a.artfNm || "(이름 없음)"}
                    style={{
                      display: "block", width: "100%", boxSizing: "border-box", textAlign: "left",
                      padding: "6px 14px", border: "none", background: "none", cursor: "pointer",
                      fontSize: 12, fontWeight: selectedArtfId === a.artfId ? 700 : 400,
                      color: selectedArtfId === a.artfId ? "var(--color-primary, #1976d2)" : "var(--color-text-primary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {a.artfNm || "(이름 없음)"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 꺼져 있을 때만 등장하는 작은 재활성화 토글 — 오른쪽 아래에 아이콘만 */}
          {showFloatingNav && floatingNavDismissed && (
            <div style={{ gridColumn: "1 / -1", gridRow: "1 / -1", position: "relative", zIndex: 40, pointerEvents: "none" }}>
              <button
                onClick={() => setFloatingNavDismissed(false)}
                title="기획 목록 다시 보기"
                style={{
                  position: "sticky", top: "50vh", transform: "translateY(-50%)",
                  marginLeft: "auto", display: "block", pointerEvents: "auto",
                  width: 32, height: 32, borderRadius: "50%",
                  background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.18)", cursor: "pointer", fontSize: 14,
                }}
              >
                📑
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── 상세 아이디어 팝업 — 항상 "현재 선택된 artf"를 편집한다.
          "저장"은 다른 필드(이름/구분/형식/컨텍스트)와 동일하게 상단 저장 로직(saveMut)을 그대로 재사용.
          바깥 영역 클릭으로는 닫히지 않게 오버레이에 onClick을 두지 않음 — "닫기"/"×"로만 닫힘. ── */}
      {ideaModalOpen && (
        <div style={overlay}>
          <div style={{ ...pickerDialog, width: 700, height: "75vh" }}>
            {/* 헤더 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>📝 상세 아이디어</div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>{artfNm || "(이름 없음)"} · AI 생성 시 1순위로 참조됩니다</div>
              </div>
              <button onClick={() => setIdeaModalOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#999" }}>×</button>
            </div>
            {/* 탭 */}
            <div style={{ display: "flex", gap: 4, padding: "10px 20px 0", flexShrink: 0 }}>
              <button onClick={() => setIdeaTab("edit")} style={{ ...tabBtn, fontWeight: ideaTab === "edit" ? 700 : 400 }}>편집</button>
              <button onClick={() => setIdeaTab("preview")} style={{ ...tabBtn, fontWeight: ideaTab === "preview" ? 700 : 400 }}>미리보기</button>
            </div>
            {/* 본문 */}
            <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
              {ideaTab === "edit" ? (
                <textarea
                  value={artfIdeaCn}
                  onChange={(e) => setArtfIdeaCn(e.target.value)}
                  className="sp-input"
                  style={{ width: "100%", height: "100%", boxSizing: "border-box", fontFamily: "'맑은 고딕', 'Malgun Gothic', sans-serif", resize: "none" }}
                  placeholder="마크다운으로 상세 아이디어를 작성하세요..."
                  autoFocus
                />
              ) : (
                <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: 12, minHeight: "100%", boxSizing: "border-box", fontSize: 13, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(artfIdeaCn) }} />
              )}
            </div>
            {/* 하단 */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--color-border)", flexShrink: 0 }}>
              <button onClick={() => setIdeaModalOpen(false)} disabled={saveMut.isPending} style={secBtn}>닫기</button>
              <button
                onClick={() => saveMut.mutate(undefined, { onSuccess: () => setIdeaModalOpen(false) })}
                disabled={saveMut.isPending || !artfNm.trim()}
                style={primaryBtn}
              >
                {saveMut.isPending ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 기획실명 수정 팝업 ── */}
      {renameOpen && (
        <div onClick={() => setRenameOpen(false)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--color-bg-card)", borderRadius: 10, padding: "24px 28px", minWidth: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: "var(--color-text-primary)" }}>기획실명 수정</div>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && renameValue.trim()) renameMut.mutate(renameValue.trim()); }}
              className="sp-input"
              style={{ width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setRenameOpen(false)} disabled={renameMut.isPending} style={secBtn}>취소</button>
              <button
                onClick={() => renameValue.trim() && renameMut.mutate(renameValue.trim())}
                disabled={renameMut.isPending || !renameValue.trim()}
                style={primaryBtn}
              >
                {renameMut.isPending ? "저장 중..." : "확인"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 요구사항 추가 팝업 (탭: 요구사항 / 단위업무) ── */}
      {reqPickerOpen && (() => {
        const selectedCount = contexts.filter((c) => c.ctxtTyCode === "REQ").length;
        const uwList = unitWorks ?? [];

        // 단위업무의 요구사항 일괄 추가
        function addUwReqs(uw: { unitWorkId: string; displayId: string; name: string; reqId: string; reqDisplayId: string; reqName: string }) {
          // 단위업무의 상위 요구사항을 컨텍스트에 추가
          if (!uw.reqId) { toast.error("이 단위업무에 연결된 요구사항이 없습니다."); return; }
          // 이미 선택되어 있는지 확인
          if (contexts.some((c) => c.ctxtTyCode === "REQ" && c.refId === uw.reqId)) {
            toast.error(`${uw.reqDisplayId} ${uw.reqName}은(는) 이미 추가되어 있습니다.`);
            return;
          }
          if (!confirm(`${uw.displayId} ${uw.name}의 요구사항 (${uw.reqDisplayId} ${uw.reqName})을 추가하시겠습니까?`)) return;
          addContext("REQ", uw.reqId, `${uw.reqDisplayId} ${uw.reqName}`);
          toast.success(`${uw.reqDisplayId} 추가됨`);
        }

        return (
          <div onClick={() => { setReqPickerOpen(false); setReqPickerTab("req"); }} style={overlay}>
            <div onClick={(e) => e.stopPropagation()} style={{ ...pickerDialog, height: "70vh" }}>
              {/* 헤더 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>📋 요구사항 추가</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>선택 {selectedCount}건</div>
                </div>
                <button onClick={() => setReqPickerOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#999" }}>×</button>
              </div>

              {/* 탭 */}
              <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
                <button onClick={() => setReqPickerTab("req")} style={{ flex: 1, padding: "10px 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: reqPickerTab === "req" ? 700 : 400, color: reqPickerTab === "req" ? "var(--color-primary, #1976d2)" : "var(--color-text-secondary)", borderBottom: reqPickerTab === "req" ? "2px solid var(--color-primary, #1976d2)" : "2px solid transparent", background: "transparent" }}>
                  요구사항 선택
                </button>
                <button onClick={() => setReqPickerTab("uw")} style={{ flex: 1, padding: "10px 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: reqPickerTab === "uw" ? 700 : 400, color: reqPickerTab === "uw" ? "var(--color-primary, #1976d2)" : "var(--color-text-secondary)", borderBottom: reqPickerTab === "uw" ? "2px solid var(--color-primary, #1976d2)" : "2px solid transparent", background: "transparent" }}>
                  단위업무별 추가
                </button>
              </div>

              {reqPickerTab === "req" ? (
                <>
                  {/* 검색 */}
                  <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
                    <input value={reqSearch} onChange={(e) => setReqSearch(e.target.value)} placeholder="요구사항 ID 또는 이름으로 검색..." className="sp-input" style={{ background: "var(--color-bg-muted)" }} autoFocus />
                  </div>
                  {/* 목록 — 고정 스크롤 */}
                  <div style={{ flex: 1, overflow: "auto" }}>
                    {filteredReqs.length === 0 ? (
                      <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 13 }}>검색 결과가 없습니다.</div>
                    ) : filteredReqs.map((r) => {
                      const sel = contexts.some((c) => c.ctxtTyCode === "REQ" && c.refId === r.requirementId);
                      return (
                        <div key={r.requirementId} onClick={() => { if (!sel) addContext("REQ", r.requirementId, `${r.displayId} ${r.name}`); }}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", cursor: sel ? "default" : "pointer", borderBottom: "1px solid var(--color-border)", background: sel ? "var(--color-bg-muted)" : "var(--color-bg-card)", transition: "background 0.1s" }}>
                          <div style={{ width: 18, height: 18, borderRadius: 3, border: sel ? "none" : "2px solid #d0d0d0", background: sel ? "var(--color-primary, #1976d2)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {sel && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-primary, #1976d2)", marginRight: 6 }}>{r.displayId}</span>
                            <span style={{ fontSize: 13, color: sel ? "var(--color-text-secondary)" : "var(--color-text-primary)" }}>{r.name}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  {/* 단위업무 목록 */}
                  <div style={{ flex: 1, overflow: "auto" }}>
                    {uwList.length === 0 ? (
                      <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 13 }}>단위업무가 없습니다.</div>
                    ) : uwList.map((uw) => {
                      const alreadyAdded = contexts.some((c) => c.ctxtTyCode === "REQ" && c.refId === uw.reqId);
                      return (
                        <div key={uw.unitWorkId} onClick={() => addUwReqs(uw)}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", cursor: alreadyAdded ? "default" : "pointer", borderBottom: "1px solid var(--color-border)", background: alreadyAdded ? "var(--color-bg-muted)" : "var(--color-bg-card)", opacity: alreadyAdded ? 0.5 : 1, transition: "background 0.1s" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-primary, #1976d2)" }}>{uw.displayId}</span>
                          <span style={{ fontSize: 13, color: "var(--color-text-primary)", flex: 1 }}>{uw.name}</span>
                          <span style={{ fontSize: 11, color: "#999" }}>{uw.reqDisplayId}</span>
                          <span style={{ fontSize: 11, color: alreadyAdded ? "#4caf50" : "#999" }}>{alreadyAdded ? "✓ 추가됨" : "클릭하여 추가"}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* 하단 */}
              <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 20px", borderTop: "1px solid var(--color-border)", flexShrink: 0 }}>
                <button onClick={() => setReqPickerOpen(false)} style={primaryBtn}>닫기</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 기획보드 추가 팝업 ── */}
      {boardPickerOpen && (() => {
        const bList = boardOptions ?? [];
        const selectedCount = contexts.filter((c) => c.ctxtTyCode === "ARTF").length;
        return (
          <div onClick={() => setBoardPickerOpen(false)} style={overlay}>
            <div onClick={(e) => e.stopPropagation()} style={pickerDialog}>
              {/* 헤더 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>🔗 기획보드 추가</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>선택 {selectedCount}건 · 전체 {bList.length}건</div>
                </div>
                <button onClick={() => setBoardPickerOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#999" }}>×</button>
              </div>
              {/* 검색 */}
              <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--color-border)" }}>
                <input value={boardSearch} onChange={(e) => setBoardSearch(e.target.value)} placeholder="기획명 또는 기획실 ID로 검색..." className="sp-input" style={{ background: "var(--color-bg-muted)" }} autoFocus />
              </div>
              {/* 목록 */}
              <div style={{ maxHeight: 400, overflow: "auto", padding: "4px 0" }}>
                {bList.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 13 }}>검색 결과가 없습니다.</div>
                ) : bList.map((b) => {
                  const sel = contexts.some((c) => c.ctxtTyCode === "ARTF" && c.refId === b.artfId);
                  return (
                    <div
                      key={b.artfId}
                      onClick={() => { if (!sel) addContext("ARTF", b.artfId, b.refLabel); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", cursor: sel ? "default" : "pointer", borderBottom: "1px solid var(--color-border)", background: sel ? "var(--color-bg-muted)" : "var(--color-bg-card)", transition: "background 0.1s" }}
                    >
                      <div style={{ width: 18, height: 18, borderRadius: 3, border: sel ? "none" : "2px solid var(--color-border)", background: sel ? "#7b1fa2" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {sel && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 13, color: sel ? "var(--color-text-secondary)" : "var(--color-text-primary)" }}>{b.refLabel}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* 하단 */}
              <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 20px", borderTop: "1px solid var(--color-border)" }}>
                <button onClick={() => setBoardPickerOpen(false)} style={primaryBtn}>닫기</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 요구사항 상세 보기 팝업 (읽기 전용) ── */}
      {reqDetailId && (
        <div onClick={() => setReqDetailId(null)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...pickerDialog, width: 700, height: "80vh" }}>
            {/* 헤더 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>
                  {reqDetailData ? `${reqDetailData.displayId} ${reqDetailData.name}` : "로딩 중..."}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>요구사항 상세 (읽기 전용)</div>
              </div>
              <button onClick={() => setReqDetailId(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#999" }}>×</button>
            </div>

            {/* 탭 */}
            <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
              {([
                { key: "current", label: "현행화" },
                { key: "spec", label: "명세" },
                { key: "analysis", label: "분석" },
              ] as const).map((t) => (
                <button key={t.key} onClick={() => setReqDetailTab(t.key)} style={{
                  flex: 1, padding: "10px 0", border: "none", cursor: "pointer", fontSize: 13,
                  fontWeight: reqDetailTab === t.key ? 700 : 400,
                  color: reqDetailTab === t.key ? "var(--color-primary, #1976d2)" : "var(--color-text-secondary)",
                  borderBottom: reqDetailTab === t.key ? "2px solid var(--color-primary, #1976d2)" : "2px solid transparent",
                  background: "transparent",
                }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* 본문 */}
            <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
              {!reqDetailData ? (
                <div style={{ color: "#aaa", fontSize: 13 }}>로딩 중...</div>
              ) : reqDetailTab === "current" ? (
                // 현행화 — HTML (웹 에디터 출력물)
                reqDetailData.currentContent ? (
                  <div className="sp-markdown" style={{ fontSize: 14, lineHeight: 1.8, color: "var(--color-text-primary)" }} dangerouslySetInnerHTML={{ __html: reqDetailData.currentContent }} />
                ) : (
                  <div style={{ color: "#aaa", fontSize: 13 }}>현행화 내용이 없습니다.</div>
                )
              ) : reqDetailTab === "spec" ? (
                // 명세 — 마크다운 미리보기 (sp-md-preview 클래스로 CSS 적용)
                reqDetailData.detailSpec ? (
                  <div className="sp-markdown" style={{ fontSize: 14, lineHeight: 1.8, color: "var(--color-text-primary)" }} dangerouslySetInnerHTML={{ __html: smartRender(reqDetailData.detailSpec) }} />
                ) : (
                  <div style={{ color: "#aaa", fontSize: 13 }}>명세 내용이 없습니다.</div>
                )
              ) : (
                // 분석 — 마크다운 미리보기
                reqDetailData.analysisMemo ? (
                  <div className="sp-markdown" style={{ fontSize: 14, lineHeight: 1.8, color: "var(--color-text-primary)" }} dangerouslySetInnerHTML={{ __html: smartRender(reqDetailData.analysisMemo) }} />
                ) : (
                  <div style={{ color: "#aaa", fontSize: 13 }}>분석 내용이 없습니다.</div>
                )
              )}
            </div>

            {/* 하단 */}
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 20px", borderTop: "1px solid var(--color-border)", flexShrink: 0 }}>
              <button onClick={() => setReqDetailId(null)} style={primaryBtn}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Full Size 뷰어 팝업 ── */}
      {fullSizeOpen && (
        <div onClick={() => setFullSizeOpen(false)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--color-bg-card)", borderRadius: 10, width: "95vw", height: "93vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 48px rgba(0,0,0,0.3)", overflow: "hidden" }}>
            {/* 헤더 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={() => setFullSizeMode("preview")} style={{ ...tabBtn, fontWeight: fullSizeMode === "preview" ? 700 : 400 }}>미리보기</button>
                <button onClick={() => setFullSizeMode("edit")} style={{ ...tabBtn, fontWeight: fullSizeMode === "edit" ? 700 : 400 }}>원문편집</button>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginLeft: 8 }}>
                  {ARTF_FMT[viewFmtCode as keyof typeof ARTF_FMT]?.name ?? viewFmtCode}
                </span>
              </div>
              <button onClick={() => setFullSizeOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#999" }}>✕</button>
            </div>
            {/* 본문 */}
            <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
              {fullSizeMode === "edit" ? (
                <textarea value={artfCn} onChange={(e) => setArtfCn(e.target.value)} className="sp-input" style={{ width: "100%", height: "100%", fontFamily: "monospace", resize: "none", fontSize: 13 }} />
              ) : !artfCn ? (
                <div style={{ color: "#aaa", fontSize: 13, padding: 20 }}>아직 생성된 본문이 없습니다.</div>
              ) : viewFmtCode === "MD" ? (
                <div className="sp-markdown" style={{ fontSize: 15, lineHeight: 1.9, color: "var(--color-text-primary)" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(stripOuterCodeFence(artfCn, ["markdown", "md"])) }} />
              ) : viewFmtCode === "MERMAID" ? (
                <div ref={fullMermaidRef} />
              ) : viewFmtCode === "HTML" ? (
                <iframe srcDoc={stripOuterCodeFence(artfCn, ["html"])} sandbox="allow-same-origin allow-scripts" style={{ width: "100%", height: "100%", border: "1px solid var(--color-border)", borderRadius: 6 }} />
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ── AI 태스크 상세 팝업 (공통 컴포넌트) ── */}
      {aiDetailTaskId && (
        <AiTaskDetailDialog
          projectId={projectId}
          taskId={aiDetailTaskId}
          onClose={() => setAiDetailTaskId(null)}
          onRejected={() => {
            setAiDetailTaskId(null);
            qc.invalidateQueries({ queryKey: ["plan-studio-detail", projectId, planStudioId] });
          }}
        />
      )}

      {/* ── AI 생성 요청 확인 팝업 — 매칭 프롬프트 미리보기 + 코멘트·첨부 입력 + multipart 호출 ── */}
      {selectedArtfId && (
        <PlanStudioAIRequestPopup
          open={aiPopupOpen}
          onClose={() => setAiPopupOpen(false)}
          projectId={projectId}
          planStudioId={planStudioId}
          artfId={selectedArtfId}
          artfNm={artfNm}
          artfDivCode={artfDivCode}
          artfFmtCode={artfFmtCode}
          artfIdeaCn={artfIdeaCn}
          contexts={contexts.map((c, i) => ({ ctxtTyCode: c.ctxtTyCode, refId: c.refId, sortOrdr: i }))}
          isReRequest={aiPopupReRequest}
          onSuccess={handleAIRequestSuccess}
        />
      )}
    </div>
  );
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
/** 마크다운이든 HTML이든 렌더링 — 항상 renderMarkdown 통과 (GFM 지원) */
function smartRender(content: string): string {
  if (!content?.trim()) return "";
  return renderMarkdown(content);
}

/**
 * AI가 ```lang ... ``` 코드 fence로 감싸서 돌려주는 경우가 잦음 — 가장 바깥 fence만 제거.
 * 허용 언어 태그에 매칭되는 경우에만 제거 (내부 코드블록은 건드리지 않음).
 * 언어 태그가 없는 경우(``` ... ```)도 허용.
 *   예) ```mermaid\ngraph TD\n``` → "graph TD"
 */
function stripOuterCodeFence(content: string, langs: string[]): string {
  if (!content) return content;
  const trimmed = content.trim();
  const langPart = langs.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // ^```(lang|)  newline   body   newline?  ```$
  const re = new RegExp("^```\\s*(?:" + langPart + ")?\\s*\\r?\\n([\\s\\S]*?)\\r?\\n?```\\s*$", "i");
  const m = trimmed.match(re);
  return m ? m[1] : content;
}

/** 날짜 → "26.4.11. 14:22" 형식 */
function formatShortDt(dt: string | Date): string {
  const d = new Date(dt);
  const y = String(d.getFullYear()).slice(2);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}.${m}.${day}. ${h}:${min}`;
}

/** 마크다운 문법 기호를 걷어내고 한 줄짜리 미리보기 스니펫으로 축약 (컨텍스트 카드의 "상세 설계" 한 줄 미리보기용) */
function ideaSnippet(md: string): string {
  const stripped = md.replace(/[#*_`>[\]()~-]/g, "").replace(/\s+/g, " ").trim();
  const MAX_LEN = 60;
  return stripped.length > MAX_LEN ? stripped.slice(0, MAX_LEN) + "…" : stripped;
}

// ── 스타일 ───────────────────────────────────────────────────────────────────
// 기획명만 늘고 줄어들고, 나머지는 실제 표시되는 배지·날짜 길이에 맞춘 고정폭 + 중앙 정렬.
const ARTF_GRID = "minmax(0, 1fr) 32px 88px 62px 77px 37px 86px";
const actionIconBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#999", padding: "2px 4px" };
const primaryBtn: React.CSSProperties = { padding: "5px 14px", borderRadius: 6, border: "none", background: "var(--color-primary, #1976d2)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const secBtn: React.CSSProperties = { padding: "5px 14px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 12, cursor: "pointer" };
const tabBtn: React.CSSProperties = { padding: "3px 8px", borderRadius: 4, border: "none", background: "transparent", fontSize: 11, cursor: "pointer", color: "var(--color-text-primary)" };
const badge: React.CSSProperties = { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, textAlign: "center" };
// 컨텍스트 칩 — 파란 테두리 + 깔끔한 배경
const ctxChip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 16, fontSize: 12, background: "var(--color-bg-card)", border: "1px solid #d0d0d0", maxWidth: 280, lineHeight: 1.3 };
const ctxChipX: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#bbb", padding: "0 0 0 2px", lineHeight: 1, flexShrink: 0 };
const ctxAddBtn: React.CSSProperties = { padding: "5px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "var(--color-text-primary)" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 };
// 팝업 — 넉넉한 크기, 구조적
const pickerDialog: React.CSSProperties = { background: "var(--color-bg-card)", borderRadius: 12, width: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.25)", overflow: "hidden" };
