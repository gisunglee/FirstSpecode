"use client";

/**
 * UnitWorksPage — 단위업무 목록 (PID-00040)
 *
 * 역할:
 *   - 단위업무 목록 조회 (FID-00129) — 요구사항별 그룹 + 요구사항 필터
 *   - 드래그앤드롭 순서 조정 (FID-00132)
 *   - 진행률 인라인 수정 (FID-00133)
 *   - 단위업무 삭제 확인 팝업 (PID-00042 / FID-00131)
 *
 * 주요 기술:
 *   - TanStack Query: 목록 조회 및 낙관적 업데이트
 *   - useRef 기반 HTML5 네이티브 드래그앤드롭 (dnd-kit 미사용)
 *   - PATCH progress: 인라인 진행률 수정
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type UnitWorkRow = {
  unitWorkId:    string;
  displayId:     string;
  name:          string;
  description:   string;
  assignMemberId: string | null;
  startDate:     string | null;
  endDate:       string | null;
  progress:      number;
  sortOrder:     number;
  reqId:         string;
  reqDisplayId:  string;
  reqName:       string;
  screenCount:   number;
  analyRt:       number;
  designRt:      number;
  implRt:        number;
  testRt:        number;
};

type RequirementOption = {
  requirementId: string;
  displayId:     string;
  name:          string;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function UnitWorksPage() {
  return (
    <Suspense fallback={null}>
      <UnitWorksPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function UnitWorksPageInner() {
  const params      = useParams<{ id: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const projectId   = params.id;

  // 요구사항 필터 (빈 문자열 = 전체)
  // URL 쿼리 ?reqId=xxx 로 초기화 (상세 페이지 브레드크럼에서 진입 시 해당 요구사항으로 자동 필터)
  const searchParams = useSearchParams();
  const [filterReqId, setFilterReqId] = useState(searchParams.get("reqId") ?? "");

  // 삭제 다이얼로그 상태
  const [deleteTarget, setDeleteTarget] = useState<UnitWorkRow | null>(null);

  // 행 호버 상태
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── 단위업무 다운로드 드롭다운 ────────────────────────────────────────────────
  const [uwDownOpen, setUwDownOpen] = useState(false);
  const uwDownRef   = useRef<HTMLDivElement>(null);

  // ── PRD(설계) 다운로드 드롭다운 + 범위 선택 모달 ──────────────────────────────
  const [prdDownOpen,       setPrdDownOpen]       = useState(false);
  const prdDownRef          = useRef<HTMLDivElement>(null);
  const [prdInclude, setPrdInclude] = useState({ screens: true, areas: true, functions: true });
  const [prdRangeOpen,      setPrdRangeOpen]      = useState(false);
  const [prdRangeMode,      setPrdRangeMode]      = useState<"title_only" | "with_content">("title_only");
  const [selectedUwIds,     setSelectedUwIds]     = useState<Set<string>>(new Set());
  const [prdLoading,        setPrdLoading]        = useState(false);

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (uwDownRef.current && !uwDownRef.current.contains(e.target as Node)) setUwDownOpen(false);
      if (prdDownRef.current && !prdDownRef.current.contains(e.target as Node)) setPrdDownOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // (인라인 수정 제거 — 상세 페이지에서 수정)

  // ── 드래그 상태 ────────────────────────────────────────────────────────────
  const dragItem     = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ── 단위업무 목록 조회 ──────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["unit-works", projectId, filterReqId],
    queryFn:  () => {
      const qs = filterReqId ? `?reqId=${filterReqId}` : "";
      return authFetch<{ data: { items: UnitWorkRow[]; totalCount: number } }>(
        `/api/projects/${projectId}/unit-works${qs}`
      ).then((r) => r.data);
    },
  });

  const items = data?.items ?? [];

  // ── 요구사항 목록 조회 (필터 드롭다운용) ────────────────────────────────────
  const { data: reqData } = useQuery({
    queryKey: ["requirements-for-filter", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: RequirementOption[] } }>(
        `/api/projects/${projectId}/requirements`
      ).then((r) => r.data.items),
  });
  const reqOptions = reqData ?? [];

  // ── 순서 변경 뮤테이션 ──────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (orders: { unitWorkId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/unit-works/sort`, {
        method: "PUT",
        body:   JSON.stringify({ orders }),
      }),
    onError: () => {
      toast.error("순서 변경에 실패했습니다.");
      queryClient.invalidateQueries({ queryKey: ["unit-works", projectId] });
    },
  });

  // ── 진행률 인라인 수정 뮤테이션 ─────────────────────────────────────────────
  const progressMutation = useMutation({
    mutationFn: ({ unitWorkId, progress }: { unitWorkId: string; progress: number }) =>
      authFetch(`/api/projects/${projectId}/unit-works/${unitWorkId}/progress`, {
        method: "PATCH",
        body:   JSON.stringify({ progress }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unit-works", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 드래그 핸들러 ──────────────────────────────────────────────────────────
  function handleDragStart(index: number) {
    dragItem.current = index;
  }

  function handleDragEnter(index: number) {
    // 다른 요구사항 그룹으로는 이동 불가 — 같은 reqId 내에서만 순서 변경 허용
    if (dragItem.current === null) return;
    if (items[dragItem.current]?.reqId !== items[index]?.reqId) return;
    dragOverItem.current = index;
  }

  function handleDragEnd() {
    const from = dragItem.current;
    const to   = dragOverItem.current;
    if (from === null || to === null || from === to) {
      dragItem.current     = null;
      dragOverItem.current = null;
      return;
    }

    // 안전 체크: 다른 요구사항 그룹이면 취소
    if (items[from]?.reqId !== items[to]?.reqId) {
      dragItem.current     = null;
      dragOverItem.current = null;
      return;
    }

    const reordered = [...items];
    const [moved]   = reordered.splice(from, 1);
    if (!moved) return;
    reordered.splice(to, 0, moved);

    // 낙관적 업데이트 후 서버 동기화
    queryClient.setQueryData(
      ["unit-works", projectId, filterReqId],
      { items: reordered, totalCount: reordered.length }
    );

    const orders = reordered.map((uw, idx) => ({
      unitWorkId: uw.unitWorkId,
      sortOrder:  idx + 1,
    }));
    sortMutation.mutate(orders);

    dragItem.current     = null;
    dragOverItem.current = null;
  }

  // ── 단위업무 목록 MD 다운로드 (클라이언트 사이드) ────────────────────────────
  function downloadUnitWorksMd(mode: "name_only" | "name_desc") {
    const lines: string[] = ["# 단위업무 목록", ""];
    for (const uw of items) {
      if (mode === "name_only") {
        lines.push(`- **${uw.displayId}** ${uw.name}`);
      } else {
        lines.push(`## ${uw.displayId} ${uw.name}`);
        if (uw.description?.trim()) {
          lines.push("");
          lines.push(uw.description.trim());
        }
        lines.push("");
      }
    }
    // 파일명: 단위업무_목록_이름만.md / 단위업무_목록_이름+설명.md
    const suffix = mode === "name_only" ? "이름만" : "이름+설명";
    triggerDownload(lines.join("\n"), `단위업무_목록_${suffix}.md`);
    setUwDownOpen(false);
  }

  // ── PRD 다운로드 파일명 생성 ──────────────────────────────────────────────
  // 예: 설계_전체_화면영역기능_제목만.md / 설계_3건_화면영역_내용포함.md
  function buildPrdFilename(unitWorkIds: string[], contentMode: "title_only" | "with_content") {
    const scopePart   = unitWorkIds.length === 0 ? "전체" : `${unitWorkIds.length}건`;
    const levelParts  = [
      prdInclude.screens   ? "화면" : null,
      prdInclude.areas     ? "영역" : null,
      prdInclude.functions ? "기능" : null,
    ].filter(Boolean).join("");
    const contentPart = contentMode === "title_only" ? "제목만" : "내용포함";
    const levelSuffix = levelParts ? `_${levelParts}` : "";
    return `설계_${scopePart}${levelSuffix}_${contentPart}.md`;
  }

  // ── PRD 다운로드 (API 호출) ───────────────────────────────────────────────
  async function downloadPrd(unitWorkIds: string[], contentMode: "title_only" | "with_content") {
    setPrdLoading(true);
    try {
      const res = await authFetch<{ data: { markdown: string; filename: string } }>(
        `/api/projects/${projectId}/prd/bulk`,
        {
          method: "POST",
          body: JSON.stringify({
            unitWorkIds,
            includeScreens:   prdInclude.screens,
            includeAreas:     prdInclude.areas,
            includeFunctions: prdInclude.functions,
            contentMode,
          }),
        }
      );
      // API가 반환한 기본 파일명 대신 포함 레벨·범위·콘텐츠 모드가 담긴 이름 사용
      const filename = buildPrdFilename(unitWorkIds, contentMode);
      triggerDownload(res.data.markdown, filename);
      setPrdDownOpen(false);
      setPrdRangeOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "다운로드에 실패했습니다.");
    } finally {
      setPrdLoading(false);
    }
  }

  function triggerDownload(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── 진행률 변경 ────────────────────────────────────────────────────────────
  function handleProgressChange(unitWorkId: string, value: string) {
    const num = parseInt(value);
    if (isNaN(num) || num < 0 || num > 100) return;
    progressMutation.mutate({ unitWorkId, progress: num });
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: 0 }}>
      {/* ── 헤더 타이틀 ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            단위업무 목록
          </div>
        </div>

        {/* 우측 버튼 그룹 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>

          {/* ── 단위업무 다운로드 드롭다운 ───────────────────────── */}
          <div ref={uwDownRef} style={{ position: "relative" }}>
            <button
              onClick={() => { setUwDownOpen((v) => !v); setPrdDownOpen(false); }}
              style={{ ...outlineBtnStyle, fontSize: 12, padding: "5px 12px" }}
            >
              단위업무 ↓
            </button>
            {uwDownOpen && (
              <div style={dropdownPanelStyle}>
                <button
                  style={dropdownItemStyle}
                  onClick={() => downloadUnitWorksMd("name_only")}
                >
                  이름만
                </button>
                <button
                  style={dropdownItemStyle}
                  onClick={() => downloadUnitWorksMd("name_desc")}
                >
                  이름 + 설명
                </button>
              </div>
            )}
          </div>

          {/* ── 설계 다운로드 드롭다운 ───────────────────────────── */}
          <div ref={prdDownRef} style={{ position: "relative" }}>
            <button
              onClick={() => { setPrdDownOpen((v) => !v); setUwDownOpen(false); }}
              style={{ ...outlineBtnStyle, fontSize: 12, padding: "5px 12px" }}
            >
              설계 ↓
            </button>
            {prdDownOpen && (
              <div style={{ ...dropdownPanelStyle, width: 220, right: 0, left: "auto" }}>
                {/* 포함 레벨 체크박스 */}
                <div style={{ padding: "10px 14px 6px", borderBottom: "1px solid var(--color-border)" }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 8, fontWeight: 600 }}>포함 레벨</div>
                  {([ ["screens", "화면"], ["areas", "영역"], ["functions", "기능"] ] as const).map(([key, label]) => (
                    <label key={key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, marginBottom: 6, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={prdInclude[key]}
                        onChange={(e) => setPrdInclude((p) => ({ ...p, [key]: e.target.checked }))}
                      />
                      {label} 포함
                    </label>
                  ))}
                </div>
                {/* 전체 다운로드 */}
                <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--color-border)" }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 6, fontWeight: 600 }}>전체 다운로드</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      disabled={prdLoading}
                      style={{ ...dropdownItemStyle, flex: 1, textAlign: "center", border: "1px solid var(--color-border)", borderRadius: 5, padding: "5px 0" }}
                      onClick={() => downloadPrd([], "title_only")}
                    >
                      제목만
                    </button>
                    <button
                      disabled={prdLoading}
                      style={{ ...dropdownItemStyle, flex: 1, textAlign: "center", border: "1px solid var(--color-border)", borderRadius: 5, padding: "5px 0" }}
                      onClick={() => downloadPrd([], "with_content")}
                    >
                      내용까지
                    </button>
                  </div>
                </div>
                {/* 범위 선택 */}
                <div style={{ padding: "8px 14px" }}>
                  <button
                    style={{ ...dropdownItemStyle, width: "100%", textAlign: "center", border: "1px solid var(--color-border)", borderRadius: 5, padding: "6px 0" }}
                    onClick={() => {
                      setSelectedUwIds(new Set(items.map((u) => u.unitWorkId)));
                      setPrdRangeMode("title_only");
                      setPrdRangeOpen(true);
                      setPrdDownOpen(false);
                    }}
                  >
                    범위 선택...
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => router.push(`/projects/${projectId}/unit-works/new`)}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
          >
            + 신규 등록
          </button>
        </div>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
      {/* ── 검색 필터 ────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        {/* 요구사항 필터 */}
        <select
          value={filterReqId}
          onChange={(e) => setFilterReqId(e.target.value)}
          style={{ ...selectStyle, width: "auto", minWidth: 200 }}
        >
          <option value="">전체 요구사항</option>
          {reqOptions.map((r) => (
            <option key={r.requirementId} value={r.requirementId}>
              {r.displayId} — {r.name}
            </option>
          ))}
        </select>
        
        <div style={{ flex: 1 }} />
      </div>

      {/* 총 건수 */}
      <div style={{ marginBottom: 16, fontSize: 14, color: "var(--color-text-secondary)" }}>
        총 {items.length}건
      </div>

      {/* 목록 */}
      {items.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          등록된 단위업무가 없습니다.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div />
            <div style={{ textAlign: "center" }}>순서</div>
            <div>요구사항</div>
            <div>단위업무명</div>
            <div>기간</div>
            <div style={{ textAlign: "center" }}>진행률</div>
            <div style={{ textAlign: "center" }}>화면수</div>
            <div style={{ textAlign: "center" }}>분/설/구/테</div>
          </div>

          {/* 데이터 행 */}
          {items.map((uw, idx) => (
            <div
              key={uw.unitWorkId}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => router.push(`/projects/${projectId}/unit-works/${uw.unitWorkId}`)}
              onMouseEnter={() => setHoveredId(uw.unitWorkId)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                ...gridRowStyle,
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                background: hoveredId === uw.unitWorkId
                  ? (uw.analyRt === 100 && uw.designRt === 100 && uw.implRt === 100 && uw.testRt === 100
                      ? "rgba(34,197,94,0.10)"
                      : "var(--color-bg-hover, rgba(99,102,241,0.06))")
                  : (uw.analyRt === 100 && uw.designRt === 100 && uw.implRt === 100 && uw.testRt === 100
                      ? "rgba(34,197,94,0.04)"
                      : "var(--color-bg-card)"),
                borderLeft: uw.analyRt === 100 && uw.designRt === 100 && uw.implRt === 100 && uw.testRt === 100
                  ? "3px solid #22c55e"
                  : hoveredId === uw.unitWorkId ? "3px solid var(--color-primary, #6366f1)" : "3px solid transparent",
                paddingLeft: 13,
              }}
            >
              {/* 드래그 핸들 */}
              <div style={{ cursor: "grab", color: "#aaa", userSelect: "none", paddingLeft: 4 }}>
                ☰
              </div>

              {/* 순서 */}
              <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)", fontWeight: 500 }}>
                {uw.sortOrder}
              </div>

              {/* 요구사항 (클릭 → 요구사항 상세, 행 클릭과 분리) */}
              <div onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => router.push(`/projects/${projectId}/requirements/${uw.reqId}`)}
                  style={linkBtnStyle}
                >
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 4 }}>
                    {uw.reqDisplayId}
                  </span>
                  {uw.reqName}
                </button>
              </div>

              {/* 단위업무명 */}
              <div style={{ fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>
                  {uw.displayId}
                </span>
                <span style={uw.analyRt === 100 && uw.designRt === 100 && uw.implRt === 100 && uw.testRt === 100 ? { color: "var(--color-text-secondary)", textDecoration: "none" } : {}}>
                  {uw.name}
                </span>
                {uw.analyRt === 100 && uw.designRt === 100 && uw.implRt === 100 && uw.testRt === 100 && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: "#16a34a",
                    background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)",
                    borderRadius: 4, padding: "1px 7px", letterSpacing: "0.2px", whiteSpace: "nowrap",
                  }}>
                    ✓ 완료
                  </span>
                )}
              </div>

              {/* 기간 */}
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                {uw.startDate && uw.endDate
                  ? `${uw.startDate} ~ ${uw.endDate}`
                  : uw.startDate
                  ? `${uw.startDate} ~`
                  : "미정"}
              </div>

              {/* 진행률 인라인 수정 (FID-00133) */}
              <div style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                <ProgressCell
                  unitWorkId={uw.unitWorkId}
                  progress={uw.progress}
                  isPending={progressMutation.isPending}
                  onChange={handleProgressChange}
                />
              </div>

              {/* 화면수 */}
              <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>
                {uw.screenCount}
              </div>

              {/* 분석/설계/구현/테스트 진척률 */}
              {uw.analyRt === 100 && uw.designRt === 100 && uw.implRt === 100 && uw.testRt === 100 ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{
                    background: "linear-gradient(90deg, #e65100, #1565c0, #2e7d32, #6a1b9a)",
                    color: "#fff", borderRadius: 6, padding: "2px 8px",
                    fontSize: 11, fontWeight: 800, letterSpacing: "0.5px", whiteSpace: "nowrap",
                  }}>
                    100점 🎉
                  </span>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 3, alignItems: "center", justifyContent: "center" }}>
                  <UwRatioChip label="분" value={uw.analyRt}  color="#e65100" />
                  <UwRatioChip label="설" value={uw.designRt} color="#1565c0" />
                  <UwRatioChip label="구" value={uw.implRt}   color="#2e7d32" />
                  <UwRatioChip label="테" value={uw.testRt}   color="#6a1b9a" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      </div>

      {/* ── PRD 범위 선택 모달 ─────────────────────────────────────────────── */}
      {prdRangeOpen && (
        <div style={overlayStyle} onClick={() => setPrdRangeOpen(false)}>
          <div style={{ ...dialogStyle, minWidth: 420, maxWidth: 520, maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>설계 다운로드 — 범위 선택</h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--color-text-secondary)" }}>
              다운로드할 단위업무를 선택하세요.
            </p>

            {/* 콘텐츠 모드 */}
            <div style={{ display: "flex", gap: 20, marginBottom: 14 }}>
              {([ ["title_only", "제목만"], ["with_content", "내용까지"] ] as const).map(([val, label]) => (
                <label key={val} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="prdRangeMode"
                    checked={prdRangeMode === val}
                    onChange={() => setPrdRangeMode(val)}
                  />
                  {label}
                </label>
              ))}
            </div>

            {/* 전체 선택 토글 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {selectedUwIds.size}개 선택됨
              </span>
              <button
                style={{ ...secondaryBtnStyle, fontSize: 12, padding: "3px 10px" }}
                onClick={() => {
                  if (selectedUwIds.size === items.length) {
                    setSelectedUwIds(new Set());
                  } else {
                    setSelectedUwIds(new Set(items.map((u) => u.unitWorkId)));
                  }
                }}
              >
                {selectedUwIds.size === items.length ? "전체 해제" : "전체 선택"}
              </button>
            </div>

            {/* 단위업무 체크리스트 */}
            <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 6, padding: "4px 0" }}>
              {items.map((uw) => (
                <label
                  key={uw.unitWorkId}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid var(--color-border)", fontSize: 13 }}
                >
                  <input
                    type="checkbox"
                    checked={selectedUwIds.has(uw.unitWorkId)}
                    onChange={(e) => {
                      setSelectedUwIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(uw.unitWorkId);
                        else next.delete(uw.unitWorkId);
                        return next;
                      });
                    }}
                  />
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 11, flexShrink: 0 }}>{uw.displayId}</span>
                  <span style={{ flex: 1 }}>{uw.name}</span>
                </label>
              ))}
            </div>

            {/* 하단 버튼 */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                style={secondaryBtnStyle}
                onClick={() => setPrdRangeOpen(false)}
                disabled={prdLoading}
              >
                취소
              </button>
              <button
                style={{ ...primaryBtnStyle, fontSize: 13, padding: "7px 18px" }}
                disabled={selectedUwIds.size === 0 || prdLoading}
                onClick={() => downloadPrd(Array.from(selectedUwIds), prdRangeMode)}
              >
                {prdLoading ? "생성 중..." : `${selectedUwIds.size}개 다운로드`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PID-00042 삭제 확인 팝업 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          unitWork={deleteTarget}
          projectId={projectId}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            queryClient.invalidateQueries({ queryKey: ["unit-works", projectId] });
          }}
        />
      )}
    </div>
  );
}

// ── 분석/설계/구현/테스트 비율 칩 ────────────────────────────────────────────

function UwRatioChip({ label, value, color }: { label: string; value: number; color: string }) {
  const fullLabel = label === "분" ? "분석" : label === "설" ? "설계" : label === "구" ? "구현" : "테스트";
  return (
    <span
      title={`${fullLabel}: ${value}%`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, lineHeight: 1,
        color: value > 0 ? color : "#bbb",
        minWidth: 24,
      }}
    >
      {value}%
    </span>
  );
}

// ── 진행률 셀 — 클릭하면 인라인 입력으로 전환 ────────────────────────────────

function ProgressCell({
  unitWorkId, progress, isPending, onChange,
}: {
  unitWorkId: string;
  progress:   number;
  isPending:  boolean;
  onChange:   (id: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(String(progress));

  function commit() {
    onChange(unitWorkId, draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        type="number"
        min={0}
        max={100}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        style={{
          width:        52,
          padding:      "2px 6px",
          border:       "1px solid var(--color-border)",
          borderRadius: 4,
          fontSize:     13,
          textAlign:    "center",
          background:   "var(--color-bg-card)",
          color:        "var(--color-text-primary)",
        }}
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(String(progress)); setEditing(true); }}
      disabled={isPending}
      title="클릭하여 수정"
      style={{
        background:   "none",
        border:       "none",
        cursor:       "pointer",
        padding:      "2px 6px",
        borderRadius: 4,
        fontSize:     13,
        color:        progress === 100 ? "#2e7d32" : "var(--color-text-primary)",
        fontWeight:   progress === 100 ? 700 : 400,
      }}
    >
      {progress}%
    </button>
  );
}

// ── PID-00042 삭제 확인 다이얼로그 ───────────────────────────────────────────

function DeleteConfirmDialog({
  unitWork, projectId, onClose, onDeleted,
}: {
  unitWork:  UnitWorkRow;
  projectId: string;
  onClose:   () => void;
  onDeleted: () => void;
}) {
  // 화면이 있을 때만 선택지를 보여줌
  // 화면이 0개면 deleteChildren 관계없이 단위업무만 삭제
  const hasScreens       = unitWork.screenCount > 0;
  const [deleteChildren, setDeleteChildren] = useState<boolean | null>(hasScreens ? null : true);

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (hasScreens && deleteChildren === null) {
        throw new Error("하위 데이터 처리 방법을 선택해 주세요.");
      }
      return authFetch(
        `/api/projects/${projectId}/unit-works/${unitWork.unitWorkId}?deleteChildren=${deleteChildren ?? true}`,
        { method: "DELETE" }
      );
    },
    onSuccess: () => {
      toast.success("단위업무가 삭제되었습니다.");
      onDeleted();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleDelete() {
    if (hasScreens && deleteChildren === null) {
      toast.error("하위 데이터 처리 방법을 선택해 주세요.");
      return;
    }
    deleteMutation.mutate();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
          단위업무를 삭제하시겠습니까?
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          &lsquo;{unitWork.name}&rsquo;
        </p>

        {/* 화면이 있을 때만 하위 처리 선택지 표시 */}
        {hasScreens && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-secondary)" }}>
              연결된 화면 {unitWork.screenCount}개 처리 방법:
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input
                type="radio"
                name="deleteType"
                checked={deleteChildren === true}
                onChange={() => setDeleteChildren(true)}
              />
              하위 화면 전체 삭제
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input
                type="radio"
                name="deleteType"
                checked={deleteChildren === false}
                onChange={() => setDeleteChildren(false)}
              />
              단위업무만 삭제 (화면 미분류 처리)
            </label>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={secondaryBtnStyle} disabled={deleteMutation.isPending}>
            취소
          </button>
          <button
            onClick={handleDelete}
            style={{ ...primaryBtnStyle, background: "#e53935" }}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

// 드래그핸들 / 순서 / 요구사항 / 단위업무명(flex) / 기간 / 진행률 / 화면수 / 분석구테
const GRID_TEMPLATE = "28px 44px 22% 1fr 16% 80px 56px 110px";

const gridHeaderStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap:                 12,
  padding:             "10px 16px",
  background:          "var(--color-bg-muted)",
  fontSize:            12,
  fontWeight:          600,
  color:               "var(--color-text-secondary)",
  borderBottom:        "1px solid var(--color-border)",
  alignItems:          "center",
};

const gridRowStyle: React.CSSProperties = {
  display:             "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap:                 12,
  padding:             "12px 16px",
  alignItems:          "center",
  background:          "var(--color-bg-card)",
  transition:          "background 0.1s",
  cursor:              "pointer",
};

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

const inlineInputStyle: React.CSSProperties = {
  padding:      "3px 6px",
  borderRadius: 4,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     13,
  outline:      "none",
  boxSizing:    "border-box",
};

const outlineBtnStyle: React.CSSProperties = {
  padding:      "8px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  cursor:       "pointer",
};

const dropdownPanelStyle: React.CSSProperties = {
  position:     "absolute",
  top:          "calc(100% + 4px)",
  left:         0,
  zIndex:       200,
  background:   "var(--color-bg-card)",
  border:       "1px solid var(--color-border)",
  borderRadius: 8,
  boxShadow:    "0 4px 16px rgba(0,0,0,0.13)",
  minWidth:     140,
  overflow:     "hidden",
};

const dropdownItemStyle: React.CSSProperties = {
  display:    "block",
  width:      "100%",
  padding:    "9px 16px",
  background: "none",
  border:     "none",
  cursor:     "pointer",
  fontSize:   13,
  color:      "var(--color-text-primary)",
  textAlign:  "left",
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

const dialogStyle: React.CSSProperties = {
  background:   "var(--color-bg-card)",
  borderRadius: 10,
  padding:      "28px 32px",
  minWidth:     380,
  maxWidth:     480,
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
};
