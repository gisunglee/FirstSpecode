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
  const [ideaTab, setIdeaTab] = useState<"edit" | "preview">("edit");

  // 팝업
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

  // Mermaid 렌더링
  useEffect(() => {
    if (artfFmtCode !== "MERMAID" || viewMode !== "preview" || !artfCn || !mermaidRef.current) return;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "default" });
        // AI 응답이 ```mermaid ... ``` fence로 감싸져 오면 파싱 실패 → fence 벗겨서 전달
        const src = stripOuterCodeFence(artfCn, ["mermaid"]);
        // Mermaid는 같은 ID를 두 번 렌더링하면 에러 → 유니크 ID
        const { svg } = await mermaid.render(`mm-${Date.now()}`, src);
        if (mermaidRef.current) mermaidRef.current.innerHTML = svg;
      } catch (err) {
        if (mermaidRef.current) mermaidRef.current.innerHTML = `<pre style="color:#e53935">Mermaid 렌더링 오류:\n${err}</pre>`;
      }
    })();
  }, [artfFmtCode, viewMode, artfCn]);

  // Full Size 팝업 Mermaid 렌더링
  useEffect(() => {
    if (!fullSizeOpen || artfFmtCode !== "MERMAID" || fullSizeMode !== "preview" || !artfCn || !fullMermaidRef.current) return;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "default" });
        const src = stripOuterCodeFence(artfCn, ["mermaid"]);
        const { svg } = await mermaid.render(`mm-full-${Date.now()}`, src);
        if (fullMermaidRef.current) fullMermaidRef.current.innerHTML = svg;
      } catch (err) {
        if (fullMermaidRef.current) fullMermaidRef.current.innerHTML = `<pre style="color:#e53935">Mermaid 렌더링 오류:\n${err}</pre>`;
      }
    })();
  }, [fullSizeOpen, artfFmtCode, fullSizeMode, artfCn]);

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
    <div style={{ padding: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* 상단 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => router.push(`/projects/${projectId}/plan-studio`)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#666" }}>←</button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>{studio.planStudioNm}</span>
          <span style={{ fontSize: 11, color: "#999" }}>({studio.planStudioDisplayId})</span>
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

      {/* 2컬럼 메인 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1, overflow: "hidden" }}>

        {/* ── 좌측: 산출물 목록 + 컨텍스트 + 아이디어 ── */}
        <div style={{ overflow: "auto", borderRight: "1px solid var(--color-border)", padding: "16px 20px", background: "var(--color-bg-muted)" }}>

          {/* 기획명·구분 헤더 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 14px" }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", flexShrink: 0 }}>기획명:</label>
            <input ref={artfNmRef} value={artfNm} onChange={(e) => setArtfNm(e.target.value)} placeholder="기획명 입력" style={{ ...inputStyle, flex: 1 }} />
            <select value={artfDivCode} onChange={(e) => setArtfDivCode(e.target.value)} style={{ ...inputStyle, width: 140, paddingRight: 28, appearance: "none", WebkitAppearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center" }}>
              <optgroup label="기획">
                {Object.values(ARTF_DIV).filter((d) => d.group === "기획").map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
              </optgroup>
              <optgroup label="개발">
                {Object.values(ARTF_DIV).filter((d) => d.group === "개발").map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
              </optgroup>
            </select>
            <select value={artfFmtCode} onChange={(e) => setArtfFmtCode(e.target.value)} style={{ ...inputStyle, width: 110, paddingRight: 28, appearance: "none", WebkitAppearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center" }}>
              {Object.values(ARTF_FMT).map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
            </select>
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

          {/* 산출물 그리드 — 테이블 스타일 */}
          <div style={{ marginBottom: 16, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            {/* 헤더 — 고정 */}
            <div style={{ display: "grid", gridTemplateColumns: ARTF_GRID, gap: 0, padding: "8px 12px", fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
              <div>기획명</div><div style={{ textAlign: "center" }}>구분</div><div style={{ textAlign: "center" }}>형식</div><div style={{ textAlign: "center" }}>AI상태</div><div style={{ textAlign: "center" }}>액션</div><div style={{ textAlign: "center" }}>수정일시</div>
            </div>
            {/* 행 목록 — 5행(약 200px) 초과 시 스크롤 */}
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
            {artfList.map((a) => {
              const divBadge = DIV_BADGE_COLOR[a.artfDivCode] ?? { bg: "#eee", color: "#666" };
              const aiBadge = a.aiStatus ? AI_STATUS_BADGE[a.aiStatus] : null;
              const isSelected = selectedArtfId === a.artfId;
              return (
                <div key={a.artfId} onClick={() => selectArtf(a.artfId)} style={{ display: "grid", gridTemplateColumns: ARTF_GRID, gap: 0, padding: "9px 12px", alignItems: "center", cursor: "pointer", borderBottom: "1px solid var(--color-border)", background: isSelected ? "var(--color-primary-bg, #e3f2fd)" : "var(--color-bg-card)", borderLeft: isSelected ? "3px solid var(--color-primary, #1976d2)" : "3px solid transparent", transition: "background 0.1s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: isSelected ? 600 : 500, overflow: "hidden", color: isSelected ? "var(--color-primary, #1976d2)" : "var(--color-text-primary)" }}>
                    <button onClick={(e) => { e.stopPropagation(); toggleGoodById(a.artfId, a.goodDesignYn); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1, flexShrink: 0 }} title="좋은 설계">{a.goodDesignYn === "Y" ? "⭐" : "☆"}</button>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.artfNm || "(이름 없음)"}</span>
                  </div>
                  <div style={{ textAlign: "center" }}><span style={{ ...badge, background: divBadge.bg, color: divBadge.color }}>{ARTF_DIV[a.artfDivCode as keyof typeof ARTF_DIV]?.name ?? a.artfDivCode}</span></div>
                  <div style={{ textAlign: "center", fontSize: 11, color: "var(--color-text-secondary)" }}>{ARTF_FMT[a.artfFmtCode as keyof typeof ARTF_FMT]?.name ?? a.artfFmtCode}</div>
                  <div style={{ textAlign: "center" }} onClick={(e) => { e.stopPropagation(); if (a.aiTaskId) setAiDetailTaskId(a.aiTaskId); }}>
                    {aiBadge ? (
                      <span style={{ ...badge, background: aiBadge.bg, color: aiBadge.color, cursor: a.aiTaskId ? "pointer" : "default" }}>{aiBadge.label}</span>
                    ) : a.aiTaskId ? (
                      <span style={{ ...badge, background: "#fff3e0", color: "#e65100", cursor: "pointer" }}>대기</span>
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

          {/* 컨텍스트 — 2단 구조, 버튼 우측 정렬 */}
          <div style={{ marginBottom: 16, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "14px 16px" }}>
            {/* 헤더: 타이틀 + 버튼 그룹 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>컨텍스트</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setReqPickerOpen(true)} style={ctxAddBtn}>📋 요구사항 추가</button>
                <button onClick={() => setBoardPickerOpen(true)} style={ctxAddBtn}>🔗 기획보드 추가</button>
              </div>
            </div>

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

          {/* 상세 아이디어 — 카드 스타일 */}
          <div style={{ marginBottom: 16, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)" }}>상세 아이디어 (AI 1순위 참조)</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => setIdeaTab("edit")} style={{ ...tabBtn, fontWeight: ideaTab === "edit" ? 700 : 400 }}>편집</button>
                <button onClick={() => setIdeaTab("preview")} style={{ ...tabBtn, fontWeight: ideaTab === "preview" ? 700 : 400 }}>미리보기</button>
              </div>
            </div>
            {ideaTab === "edit" ? (
              <textarea value={artfIdeaCn} onChange={(e) => setArtfIdeaCn(e.target.value)} rows={8} style={{ ...inputStyle, fontFamily: "'맑은 고딕', 'Malgun Gothic', sans-serif", resize: "vertical", minHeight: 180 }} placeholder="마크다운으로 상세 아이디어를 작성하세요..." />
            ) : (
              <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: 10, minHeight: 100, fontSize: 13, lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(artfIdeaCn) }} />
            )}
          </div>

          {/* AI 지시사항(comment) 입력 영역은 [AI 생성] 클릭 시 뜨는 팝업으로 이동했다.
              본문 입력은 페이지 진입 시 폼이 너무 비대해지고, 산출물별 코멘트가
              실제로는 한 번 보내고 끝나는 일회성 지시사항이라 페이지에 상주할 필요가 없음.
              tb_ds_plan_studio_artf.coment_cn 은 호환을 위해 컬럼은 유지하되 새로 저장하지 않음. */}
        </div>

        {/* ── 우측: 결과 뷰어 ── */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--color-bg-card)" }}>
          {/* 탭 바 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setViewMode("preview")} style={{ ...tabBtn, fontWeight: viewMode === "preview" ? 700 : 400 }}>미리보기</button>
              <button onClick={() => setViewMode("edit")} style={{ ...tabBtn, fontWeight: viewMode === "edit" ? 700 : 400 }}>원문편집</button>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {(["MD", "MERMAID", "HTML"] as const).map((f) => (
                <button key={f} onClick={() => setArtfFmtCode(f)} style={{ ...tabBtn, fontWeight: artfFmtCode === f ? 700 : 400 }}>{ARTF_FMT[f].name}</button>
              ))}
              <button onClick={() => { setFullSizeOpen(true); setFullSizeMode("preview"); }} style={{ ...tabBtn, fontSize: 14 }} title="Full Size">⛶</button>
            </div>
          </div>

          {/* 렌더링 영역 */}
          <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
            {viewMode === "edit" ? (
              <textarea value={artfCn} onChange={(e) => setArtfCn(e.target.value)} style={{ ...inputStyle, height: "100%", fontFamily: "monospace", resize: "none" }} />
            ) : !artfCn ? (
              <div style={{ color: "#aaa", fontSize: 13, padding: 20 }}>아직 생성된 본문이 없습니다.</div>
            ) : artfFmtCode === "MD" ? (
              <div className="sp-markdown" style={{ fontSize: 14, lineHeight: 1.8, color: "var(--color-text-primary)" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(stripOuterCodeFence(artfCn, ["markdown", "md"])) }} />
            ) : artfFmtCode === "MERMAID" ? (
              <div ref={mermaidRef} />
            ) : artfFmtCode === "HTML" ? (
              <iframe srcDoc={stripOuterCodeFence(artfCn, ["html"])} sandbox="allow-scripts" style={{ width: "100%", height: "100%", border: "1px solid var(--color-border)", borderRadius: 6 }} title="HTML 미리보기" />
            ) : null}
          </div>
        </div>
      </div>

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
                    <input value={reqSearch} onChange={(e) => setReqSearch(e.target.value)} placeholder="요구사항 ID 또는 이름으로 검색..." style={{ ...inputStyle, background: "var(--color-bg-muted)" }} autoFocus />
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
                <input value={boardSearch} onChange={(e) => setBoardSearch(e.target.value)} placeholder="기획명 또는 기획실 ID로 검색..." style={{ ...inputStyle, background: "var(--color-bg-muted)" }} autoFocus />
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
                  {ARTF_FMT[artfFmtCode as keyof typeof ARTF_FMT]?.name ?? artfFmtCode}
                </span>
              </div>
              <button onClick={() => setFullSizeOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#999" }}>✕</button>
            </div>
            {/* 본문 */}
            <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
              {fullSizeMode === "edit" ? (
                <textarea value={artfCn} onChange={(e) => setArtfCn(e.target.value)} style={{ ...inputStyle, width: "100%", height: "100%", fontFamily: "monospace", resize: "none", fontSize: 13 }} />
              ) : !artfCn ? (
                <div style={{ color: "#aaa", fontSize: 13, padding: 20 }}>아직 생성된 본문이 없습니다.</div>
              ) : artfFmtCode === "MD" ? (
                <div className="sp-markdown" style={{ fontSize: 15, lineHeight: 1.9, color: "var(--color-text-primary)" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(stripOuterCodeFence(artfCn, ["markdown", "md"])) }} />
              ) : artfFmtCode === "MERMAID" ? (
                <div ref={fullMermaidRef} />
              ) : artfFmtCode === "HTML" ? (
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

// ── 스타일 ───────────────────────────────────────────────────────────────────
const ARTF_GRID = "1fr 80px 70px 80px 35px 105px";
const actionIconBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#999", padding: "2px 4px" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 13, outline: "none", boxSizing: "border-box" };
const primaryBtn: React.CSSProperties = { padding: "5px 14px", borderRadius: 6, border: "none", background: "var(--color-primary, #1976d2)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const secBtn: React.CSSProperties = { padding: "5px 14px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 12, cursor: "pointer" };
const tabBtn: React.CSSProperties = { padding: "3px 8px", borderRadius: 4, border: "none", background: "transparent", fontSize: 11, cursor: "pointer", color: "var(--color-text-primary)" };
const badge: React.CSSProperties = { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600, textAlign: "center" };
// 컨텍스트 칩 — 파란 테두리 + 깔끔한 배경
const ctxChip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 16, fontSize: 12, background: "var(--color-bg-card)", border: "1px solid #d0d0d0", maxWidth: 280, lineHeight: 1.3 };
const ctxChipX: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#bbb", padding: "0 0 0 2px", lineHeight: 1, flexShrink: 0 };
const ctxAddBtn: React.CSSProperties = { padding: "4px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "var(--color-text-primary)" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 };
// 팝업 — 넉넉한 크기, 구조적
const pickerDialog: React.CSSProperties = { background: "var(--color-bg-card)", borderRadius: 12, width: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.25)", overflow: "hidden" };
