"use client";

/**
 * ScreensPage — 화면 목록 (PID-00043)
 *
 * 역할:
 *   - 화면 목록 조회 (FID-00142)
 *   - 드래그앤드롭 순서 조정 (FID-00145)
 *   - 단위업무 상세 링크 이동 (FID-00144)
 *   - 영역 목록 바로가기 (FID-00143)
 *   - 화면 삭제 확인 팝업 (PID-00045 / FID-00150)
 *
 * 주요 기술:
 *   - TanStack Query: 목록 조회 및 낙관적 업데이트
 *   - useRef 기반 HTML5 네이티브 드래그앤드롭
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import AiTaskDetailDialog from "@/components/ui/AiTaskDetailDialog";
import { type AiTaskStatus, AI_TASK_STATUS_LABEL, AI_TASK_STATUS_BADGE } from "@/constants/codes";
import { useAppStore } from "@/store/appStore";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type ScreenRow = {
  screenId: string;
  displayId: string;
  name: string;
  type: string;
  categoryL: string;
  categoryM: string;
  categoryS: string;
  unitWorkId: string | null;
  unitWorkName: string;
  requirementId: string | null;
  requirementName: string;
  // 담당자 — 서버 join으로 내려옴. 미지정/퇴장 멤버면 null
  assignMemberId: string | null;
  assignMemberName: string | null;
  areaCount: number;
  sortOrder: number;
  avgDesignRt: number;
  avgImplRt: number;
  avgTestRt: number;
  // AI 구현 요청 정보 (스냅샷 → IMPLEMENT 태스크 최신 1건)
  implTask: { aiTaskId: string; status: string; requestedAt: string } | null;
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function ScreensPage() {
  return (
    <Suspense fallback={null}>
      <ScreensPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function ScreensPageInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectId = params.id;

  // 삭제 다이얼로그 상태
  const [deleteTarget, setDeleteTarget] = useState<ScreenRow | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── 드래그 상태 ────────────────────────────────────────────────────────────
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  // 드래그 중인 화면의 unitWorkId — 같은 단위업무 내에서만 순서 변경 허용
  const dragItemUnitWorkId = useRef<string | null>(null);

  // ── 단위업무 필터 (URL ?unitWorkId=xxx 로 초기화 — 브레드크럼에서 진입 시 자동 적용) ──
  const searchParams = useSearchParams();
  const [unitWorkFilter, setUnitWorkFilter] = useState(searchParams.get("unitWorkId") ?? "");
  // 담당자 필터 — 전역 appStore.myAssigneeMode 구독 (GNB 토글과 양방향 바인딩)
  const filterAssignedTo = useAppStore((s) => s.myAssigneeMode);
  const setMyAssigneeMode = useAppStore((s) => s.setMyAssigneeMode);
  const hasLoadedProfile = useAppStore((s) => s._hasLoadedProfile);
  // 페이지 세그먼트 토글 클릭 → 전역 state + DB 저장 + 실패 시 롤백
  function setFilterAssignedTo(next: "all" | "me") {
    const prev = filterAssignedTo;
    setMyAssigneeMode(next);
    authFetch("/api/member/profile/assignee-view", {
      method: "PATCH",
      body: JSON.stringify({ mode: next }),
    }).catch((err: Error) => {
      setMyAssigneeMode(prev);
      toast.error("설정 저장 실패: " + err.message);
    });
  }
  // AI 구현 태스크 상세 팝업
  const [aiDetailTaskId, setAiDetailTaskId] = useState<string | null>(null);

  // "내 담당" URL 동기화
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (filterAssignedTo === "me") url.searchParams.set("assignedTo", "me");
    else url.searchParams.delete("assignedTo");
    window.history.replaceState(null, "", url.toString());
  }, [filterAssignedTo]);

  // URL ?assignedTo=me 진입 시 — 프로필 로드 후 전역 state에도 반영(DB 저장)
  useEffect(() => {
    if (!hasLoadedProfile) return;
    if (searchParams.get("assignedTo") === "me" && filterAssignedTo !== "me") {
      setFilterAssignedTo("me");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLoadedProfile]);

  // 담당자 드롭다운 — 특정 멤버 필터. "" = 담당자 전체 (드롭다운이 세그먼트보다 우선)
  const [filterMember, setFilterMember] = useState<string>("");

  // 뷰 모드 — "default": 서버가 내려준 요구사항/단위업무/sortOrder 순서 그대로
  //          "category": 대분류 → 중분류 → 소분류 → 화면명 텍스트 정렬
  // 주의: 컬럼 구조는 두 모드 모두 동일 (과거 컬럼을 왼쪽으로 이동시키던 방식이
  //       레이아웃을 깨뜨려 제거됨. 지금은 정렬 기준만 바꾼다).
  const [viewMode, setViewMode] = useState<"default" | "category">("default");

  // 프로젝트 멤버 목록 — 담당자 드롭다운 옵션용
  const { data: memberData } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () =>
      authFetch<{ data: { members: Array<{ memberId: string; name: string | null; email: string }> } }>(
        `/api/projects/${projectId}/members`
      ).then((r) => r.data),
    staleTime: 60 * 1000,
  });
  const members = memberData?.members ?? [];

  // 실제 서버로 보낼 assignedTo 값 — 드롭다운 우선, 없으면 전역 모드
  const effectiveAssignedTo = filterMember || (filterAssignedTo === "me" ? "me" : "");

  // ── 데이터 조회 — 전체 조회 후 클라이언트 필터 (드롭다운 옵션 생성용) ──
  // 담당자는 서버 쿼리 파라미터로 전달 (URL 공유 가능, 향후 페이징 대응)
  // 프로필 로드 전에는 쿼리 지연 → 첫 렌더 플리커 방지
  const { data, isLoading } = useQuery({
    queryKey: ["screens", projectId, effectiveAssignedTo],
    queryFn: () => {
      const qs = effectiveAssignedTo ? `?assignedTo=${encodeURIComponent(effectiveAssignedTo)}` : "";
      return authFetch<{ data: { items: ScreenRow[]; totalCount: number } }>(
        `/api/projects/${projectId}/screens${qs}`
      ).then((r) => r.data);
    },
    enabled: hasLoadedProfile,
  });

  const allItems = data?.items ?? [];

  // 단위업무 드롭다운 옵션 — items에서 중복 제거하여 추출
  const unitWorkOptions = Array.from(
    new Map(allItems.filter((s) => s.unitWorkId).map((s) => [s.unitWorkId, s.unitWorkName])).entries()
  ).map(([id, name]) => ({ id: id!, name }));

  // 필터 적용
  const filtered = unitWorkFilter
    ? allItems.filter((s) => s.unitWorkId === unitWorkFilter)
    : allItems;

  // 뷰 모드별 정렬
  //   default  — 서버 응답 순서 유지 (요구사항/단위업무 그룹핑 + sortOrder)
  //   category — 대 → 중 → 소 → 화면명 순 텍스트 정렬 (localeCompare "ko")
  //             빈 값은 ""로 취급되어 앞쪽에 모임.
  const items = viewMode === "category"
    ? [...filtered].sort((a, b) => {
        const lA = a.categoryL ?? "", lB = b.categoryL ?? "";
        if (lA !== lB) return lA.localeCompare(lB, "ko");
        const mA = a.categoryM ?? "", mB = b.categoryM ?? "";
        if (mA !== mB) return mA.localeCompare(mB, "ko");
        const sA = a.categoryS ?? "", sB = b.categoryS ?? "";
        if (sA !== sB) return sA.localeCompare(sB, "ko");
        return a.name.localeCompare(b.name, "ko");
      })
    : filtered;

  // 분류순 모드에서는 드래그/그룹핑 의미가 사라지므로 비활성
  const isCategoryView = viewMode === "category";

  // ── 순서 변경 뮤테이션 ──────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (orders: { screenId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/screens/sort`, {
        method: "PUT",
        body: JSON.stringify({ orders }),
      }),
    onError: () => {
      toast.error("순서 변경에 실패했습니다.");
      queryClient.invalidateQueries({ queryKey: ["screens", projectId] });
    },
  });

  // ── 드래그 핸들러 ──────────────────────────────────────────────────────────
  function handleDragStart(index: number) {
    dragItem.current = index;
    dragItemUnitWorkId.current = items[index]?.unitWorkId ?? null;
  }

  function handleDragEnter(index: number) {
    // 다른 단위업무의 화면 위에 올라오면 무시
    if (items[index]?.unitWorkId !== dragItemUnitWorkId.current) return;
    dragOverItem.current = index;
  }

  function handleDragEnd() {
    const from = dragItem.current;
    const to = dragOverItem.current;

    dragItem.current = null;
    dragOverItem.current = null;
    dragItemUnitWorkId.current = null;

    if (from === null || to === null || from === to) return;

    // 방어: 서로 다른 단위업무로 떨어진 경우 이중 검증
    if (items[from]?.unitWorkId !== items[to]?.unitWorkId) {
      toast.error("같은 단위업무 내에서만 순서를 변경할 수 있습니다.");
      return;
    }

    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    if (!moved) return;
    reordered.splice(to, 0, moved);

    // 낙관적 업데이트 후 서버 동기화
    queryClient.setQueryData(
      ["screens", projectId],
      { items: reordered, totalCount: reordered.length }
    );

    const orders = reordered.map((s, idx) => ({ screenId: s.screenId, sortOrder: idx + 1 }));
    sortMutation.mutate(orders);
  }

  // ── 로딩 ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 타이틀 — full-width 배경 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          화면 목록
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/screens/new`)}
          style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
        >
          + 신규 등록
        </button>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {/* 총 건수 + 필터 (오른쪽 정렬) */}
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            총 {items.length}건
          </span>
          <div style={{ flex: 1 }} />
          {/* 담당자 드롭다운 — 특정 멤버 필터 (드롭다운이 우선, 세그먼트와 공존) */}
          <select
            value={filterMember}
            onChange={(e) => setFilterMember(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="">담당자 전체</option>
            {members.map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.name ?? m.email}
              </option>
            ))}
          </select>
          {/* 담당자 세그먼트 토글 — 서버 쿼리(?assignedTo=me)로 필터 */}
          <div style={segmentGroupStyle}>
            <button
              type="button"
              onClick={() => setFilterAssignedTo("all")}
              style={segmentBtnStyle(filterAssignedTo === "all")}
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setFilterAssignedTo("me")}
              style={segmentBtnStyle(filterAssignedTo === "me")}
            >
              내 담당
            </button>
          </div>
          <select
            value={unitWorkFilter}
            onChange={(e) => setUnitWorkFilter(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="">단위업무 전체</option>
            {unitWorkOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.name}</option>
            ))}
          </select>

          {/* 뷰 모드 토글 — 정렬순(기본) / 분류순(대·중·소 텍스트 정렬) */}
          <div style={segmentGroupStyle}>
            <button
              type="button"
              onClick={() => setViewMode("default")}
              style={segmentBtnStyle(viewMode === "default")}
            >
              정렬순
            </button>
            <button
              type="button"
              onClick={() => setViewMode("category")}
              style={segmentBtnStyle(viewMode === "category")}
            >
              분류순
            </button>
          </div>
        </div>

        {/* 목록 — 빈 상태에서도 헤더 표시 (과업 페이지 패턴과 통일) */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          {/* 헤더 행 */}
          <div style={gridHeaderStyle}>
            <div />
            <div>요구사항 명</div>
            <div>단위업무 명</div>
            <div>화면 명</div>
            <div>담당자</div>
            <div>화면유형</div>
            <div style={{ textAlign: "center" }}>영역수</div>
            <div style={{ textAlign: "center" }}>정렬</div>
            <div>대분류</div>
            <div>중분류</div>
            <div>소분류</div>
            <div style={{ textAlign: "center" }}>AI 구현</div>
            <div style={{ textAlign: "center" }}>설/구/테</div>
          </div>

          {items.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              등록된 화면이 없습니다.
            </div>
          ) : (
            items.map((screen, idx) => {
              // 분류순 모드에선 정렬 기준이 대/중/소라 요구사항·단위업무 그룹 경계가 의미 없음
              //   → 매 행에 요구사항·단위업무명을 반복 표시하고, 행 구분선도 모두 그어준다.
              const isFirstReq = isCategoryView
                ? true
                : (idx === 0 || items[idx - 1].requirementId !== screen.requirementId);
              const isLastOfReq = isCategoryView
                ? true
                : (idx === items.length - 1 || items[idx + 1].requirementId !== screen.requirementId);

              return (
                <div
                  key={screen.screenId}
                  // draggable은 핸들(☰)에만 부여 — row 본문 클릭이 예상치 못한 드래그로 인식되어
                  // 순서 변경 캐시와 뒤엉켜 잘못된 상세로 이동하던 문제를 원천 차단.
                  // row에는 drop target용 이벤트만 유지.
                  onDragEnter={() => !isCategoryView && handleDragEnter(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => router.push(`/projects/${projectId}/screens/${screen.screenId}`)}
                  onMouseEnter={() => setHoveredId(screen.screenId)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    ...gridRowStyle,
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                    borderBottom: isLastOfReq ? "1px solid var(--color-border)" : "none",
                    background: hoveredId === screen.screenId ? "var(--color-bg-hover, rgba(99,102,241,0.06))" : "var(--color-bg-card)",
                    borderLeft: hoveredId === screen.screenId ? "3px solid var(--color-primary, #6366f1)" : "3px solid transparent",
                    paddingLeft: 13,
                  }}
                >
                  {/* 드래그 핸들 — 이 요소에만 draggable 부여. 분류순 모드에선 완전 비활성. */}
                  <div
                    draggable={!isCategoryView}
                    onDragStart={(e) => {
                      if (isCategoryView) { e.preventDefault(); return; }
                      handleDragStart(idx);
                    }}
                    onDragEnd={() => !isCategoryView && handleDragEnd()}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      cursor: isCategoryView ? "default" : "grab",
                      color: "#aaa", userSelect: "none", paddingLeft: 4,
                      opacity: isCategoryView ? 0.3 : 1,
                    }}
                  >☰</div>

                  {/* 요구사항 (첫 행에만 표시) */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={isFirstReq ? screen.requirementName : undefined}
                  >
                    {isFirstReq ? (
                      screen.requirementId ? (
                        <button
                          onClick={() => router.push(`/projects/${projectId}/requirements/${screen.requirementId}`)}
                          style={linkBtnStyle}
                        >
                          {screen.requirementName}
                        </button>
                      ) : (
                        <span style={{ color: "#aaa", fontSize: 13 }}>미분류</span>
                      )
                    ) : null}
                  </div>

                  {/* 단위업무명 — default 모드에선 같은 unitWorkId 연속 행은 첫 행에만,
                      category 모드에선 정렬이 섞이므로 항상 표시 */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={screen.unitWorkName}
                  >
                    {!isCategoryView && items[idx - 1]?.unitWorkId === screen.unitWorkId && screen.unitWorkId
                      ? null
                      : screen.unitWorkId ? (
                        <button
                          onClick={() => router.push(`/projects/${projectId}/unit-works/${screen.unitWorkId}`)}
                          style={linkBtnStyle}
                        >
                          {screen.unitWorkName}
                        </button>
                      ) : (
                        <span style={{ color: "#aaa", fontSize: 13 }}>미분류</span>
                      )
                    }
                  </div>

                  {/* 화면명 */}
                  <div
                    style={{
                      fontSize: 14, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                    title={`${screen.displayId} ${screen.name}`}
                  >
                    <span style={{ color: "var(--color-text-secondary)", fontSize: 12, marginRight: 6 }}>
                      {screen.displayId}
                    </span>
                    {screen.name}
                  </div>

                  {/* 담당자 — 미지정/퇴장 멤버는 흐린 "-" */}
                  <div
                    style={{
                      fontSize: 13,
                      color: screen.assignMemberName
                        ? "var(--color-text-primary)"
                        : "var(--color-text-tertiary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                    title={screen.assignMemberName ?? undefined}
                  >
                    {screen.assignMemberName ?? "-"}
                  </div>

                  {/* 화면유형 배지 */}
                  <div>
                    <span className="sp-badge" style={typeBadgeStyle(screen.type)}>
                      {screen.type}
                    </span>
                  </div>

                  {/* 영역 수 */}
                  <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-secondary)" }}>
                    {screen.areaCount}
                  </div>

                  {/* 정렬순서 */}
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {screen.sortOrder}
                  </div>

                  {/* 대분류 */}
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {screen.categoryL || "-"}
                  </div>

                  {/* 중분류 */}
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {screen.categoryM || "-"}
                  </div>

                  {/* 소분류 */}
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {screen.categoryS || "-"}
                  </div>

                  {/* AI 구현 — 스냅샷 경유 IMPLEMENT 태스크 최신 1건.
                    배지 + 시간을 한 줄(flex row)로 배치해 row 전체 높이가 늘어나지 않도록 함. */}
                  <div
                    style={{ display: "flex", justifyContent: "center" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {screen.implTask ? (
                      <button
                        onClick={() => setAiDetailTaskId(screen.implTask!.aiTaskId)}
                        title={`AI 구현 태스크 · ${formatRequestedAt(screen.implTask.requestedAt)}`}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          background: "transparent", border: "none", padding: 0, cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span className="sp-badge" style={implStatusBadgeStyle(screen.implTask.status)}>
                          {AI_TASK_STATUS_LABEL[screen.implTask.status as AiTaskStatus] ?? screen.implTask.status}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>
                          {formatRequestedAt(screen.implTask.requestedAt)}
                        </span>
                      </button>
                    ) : (
                      <span style={{ color: "#ccc", fontSize: 13 }}>—</span>
                    )}
                  </div>

                  {/* 설/구/테 평균 진행률 */}
                  <div style={{ display: "flex", gap: 4, justifyContent: "center", fontSize: 11 }}>
                    {[
                      { val: screen.avgDesignRt, color: "#1565c0" },
                      { val: screen.avgImplRt, color: "#2e7d32" },
                      { val: screen.avgTestRt, color: "#6a1b9a" },
                    ].map(({ val, color }, i) => (
                      <span key={i} style={{
                        color, fontWeight: 600,
                        background: val === 100 ? `${color}14` : "transparent",
                        borderRadius: 3, padding: "1px 3px",
                      }}>
                        {val}%
                      </span>
                    ))}
                  </div>

                </div>
              );
            })
          )}
        </div>
      </div>

      {/* PID-00045 삭제 확인 팝업 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          screen={deleteTarget}
          projectId={projectId}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            queryClient.invalidateQueries({ queryKey: ["screens", projectId] });
          }}
        />
      )}

      {/* AI 구현 태스크 상세 팝업 */}
      {aiDetailTaskId && (
        <AiTaskDetailDialog
          projectId={projectId}
          taskId={aiDetailTaskId}
          onClose={() => setAiDetailTaskId(null)}
        />
      )}
    </div>
  );
}

// ── AI 태스크 상태 배지 스타일 (AI 구현 컬럼용) ─────────────────────
// 상태 라벨·색상은 공용 codes 모듈 사용

function implStatusBadgeStyle(status: string): React.CSSProperties {
  const c = AI_TASK_STATUS_BADGE[status as AiTaskStatus] ?? { bg: "#f5f5f5", fg: "#555" };
  return {
    display: "inline-block", padding: "2px 8px", borderRadius: 4,
    fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg,
    whiteSpace: "nowrap",
  };
}

function formatRequestedAt(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── PID-00045 삭제 확인 다이얼로그 ───────────────────────────────────────────

function DeleteConfirmDialog({
  screen, projectId, onClose, onDeleted,
}: {
  screen: ScreenRow;
  projectId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const hasAreas = screen.areaCount > 0;
  const [deleteChildren, setDeleteChildren] = useState<boolean | null>(hasAreas ? null : true);

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (hasAreas && deleteChildren === null) {
        throw new Error("하위 데이터 처리 방법을 선택해 주세요.");
      }
      return authFetch(
        `/api/projects/${projectId}/screens/${screen.screenId}?deleteChildren=${deleteChildren ?? true}`,
        { method: "DELETE" }
      );
    },
    onSuccess: () => {
      toast.success("화면이 삭제되었습니다.");
      onDeleted();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleDelete() {
    if (hasAreas && deleteChildren === null) {
      toast.error("하위 데이터 처리 방법을 선택해 주세요.");
      return;
    }
    deleteMutation.mutate();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
          화면을 삭제하시겠습니까?
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          &lsquo;{screen.name}&rsquo;
        </p>

        {hasAreas && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--color-text-secondary)" }}>
              연결된 영역 {screen.areaCount}개 처리 방법:
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input
                type="radio"
                name="deleteType"
                checked={deleteChildren === true}
                onChange={() => setDeleteChildren(true)}
              />
              하위 영역·기능 전체 삭제
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input
                type="radio"
                name="deleteType"
                checked={deleteChildren === false}
                onChange={() => setDeleteChildren(false)}
              />
              화면만 삭제 (영역 미분류 상태로 유지)
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

// ── 상수 ─────────────────────────────────────────────────────────────────────

function typeBadgeStyle(type: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    LIST: { bg: "#e3f2fd", color: "#1565c0" },
    DETAIL: { bg: "#e8f5e9", color: "#2e7d32" },
    INPUT: { bg: "#fff3e0", color: "#e65100" },
    POPUP: { bg: "#f3e5f5", color: "#6a1b9a" },
    TAB: { bg: "#e0f2f1", color: "#00695c" },
    REPORT: { bg: "#fce4ec", color: "#880e4f" },
  };
  const c = colors[type] ?? { bg: "#f5f5f5", color: "#555" };
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
    background: c.bg,
    color: c.color,
  };
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

// 요구사항·단위업무·화면명·담당자·분류는 fr 비율, 소형 컬럼은 고정 / AI 구현 + 설구테
// 담당자 컬럼(100px)을 화면명 뒤, 화면유형 앞에 삽입
// AI 구현 컬럼은 "배지 + 시간(MM-DD HH:mm)"을 한 줄에 담도록 150px로 여유 확보
const GRID_TEMPLATE = "32px 1.5fr 1.5fr 3fr 100px 70px 48px 40px 1fr 1fr 1fr 150px 7%";

const gridHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap: 10,
  padding: "10px 16px",
  background: "var(--color-bg-muted)",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)",
  alignItems: "center",
};

// row 높이를 컴팩트하게 — 데이터량이 많은 페이지 특성상 좁게 유지.
// AI 구현 컬럼처럼 2줄 내용이 있어도 전체 row가 뜨지 않도록 셀별로 nowrap 강제.
const gridRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: GRID_TEMPLATE,
  gap: 10,
  padding: "12px 16px",
  alignItems: "center",
  background: "var(--color-bg-card)",
  transition: "background 0.1s",
  cursor: "pointer",
};

const linkBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--color-primary, #1976d2)",
  fontSize: 14,
  padding: 0,
  textAlign: "left",
  textDecoration: "underline",
};

const filterSelectStyle: React.CSSProperties = {
  padding: "7px 32px 7px 12px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  fontSize: 13,
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  cursor: "pointer",
  outline: "none",
  appearance: "none",
  WebkitAppearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  minWidth: 160,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

// 담당자 필터 세그먼트 토글 — 단위업무·과업·요구사항 목록과 동일 패턴
const segmentGroupStyle: React.CSSProperties = {
  display: "inline-flex",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  overflow: "hidden",
  background: "var(--color-bg-card)",
};
const segmentBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: "7px 14px",
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  border: "none",
  background: active ? "var(--color-brand-subtle)" : "transparent",
  color: active ? "var(--color-brand)" : "var(--color-text-secondary)",
  cursor: "pointer",
  outline: "none",
});

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 14,
  cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  borderRadius: 4,
  border: "1px solid #e53935",
  background: "transparent",
  color: "#e53935",
  fontSize: 12,
  cursor: "pointer",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  borderRadius: 10,
  padding: "28px 32px",
  minWidth: 380,
  maxWidth: 480,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};
