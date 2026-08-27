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
import { useAppStore } from "@/store/appStore";
import { usePermissions } from "@/hooks/useMyRole";
import ExcelDownloadButton from "@/components/common/ExcelDownloadButton";

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
  // 실질구현기간 — 화면 자신의 actl_impl_bgng_de/end_de (2026-07-28)
  implStartDate: string | null;
  implEndDate: string | null;
  // 화면정의서 작성 상태 — BEFORE(작성전) / DOING(작성중) / DONE(작성완료)
  docStatus: string;
  avgDesignRt: number;
  avgImplRt: number;
};

// 작성상태 — 색 구분 없이 기본 텍스트로만 표시 (단위업무 목록과 동일 정책).
// "전"/"중"/"완료"로 줄여뒀던 걸 풀네임으로 되돌림 — 컬럼 폭(64px)에 4글자("작성완료")도
// 충분히 들어가는데 굳이 줄여서 뜻이 안 와닿았다는 피드백(2026-07-29).
const DOC_STATUS_LABEL: Record<string, string> = { BEFORE: "작성전", DOING: "작성중", DONE: "작성완료" };

// "YYYY-MM-DD" → "YY-MM-DD" — 목록 "기간" 컬럼 폭을 줄이기 위해 연도를 2자리로 축약
function shortYear(date: string): string {
  return date.slice(2);
}

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
  const { myRole } = usePermissions(projectId);

  // 삭제 다이얼로그 상태
  const [deleteTarget, setDeleteTarget] = useState<ScreenRow | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── 화면명 인라인 편집 ────────────────────────────────────────────────────────
  // VIEWER는 decideSpecContentWrite에서 항상 차단되므로 연필 아이콘 자체를 숨긴다.
  // 그 외(담당자 아님/생성자 보정시간 만료 등)는 서버 판정에 맡기고 실패 시 토스트로 안내.
  // 드래그 핸들(☰)이 이름 셀과 분리되어 있어 편집 중에도 행 draggable 가드가 불필요.
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");

  const nameMutation = useMutation({
    mutationFn: ({ screenId, name }: { screenId: string; name: string }) =>
      authFetch(`/api/projects/${projectId}/screens/${screenId}`, {
        method: "PUT",
        body:   JSON.stringify({ name }),
      }),
    onSuccess: (_res, variables) => {
      queryClient.setQueryData<{ items: ScreenRow[]; totalCount: number }>(
        ["screens", projectId, effectiveAssignedTo],
        (old) => old ? {
          ...old,
          items: old.items.map((r) =>
            r.screenId === variables.screenId ? { ...r, name: variables.name } : r
          ),
        } : old
      );
      setEditingNameId(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setEditingNameId(null);
    },
  });

  function startEditName(screen: ScreenRow, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingNameId(screen.screenId);
    setEditNameValue(screen.name);
  }

  function commitEditName(screen: ScreenRow) {
    const trimmed = editNameValue.trim();
    if (!trimmed || trimmed === screen.name) {
      setEditingNameId(null);
      return;
    }
    nameMutation.mutate({ screenId: screen.screenId, name: trimmed });
  }

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
  //   default  — 서버 응답 순서 그대로 (요구사항 → 단위업무 → sortOrder)
  //   category — 대 → 중 → 소 → 화면명 순 텍스트 정렬 (localeCompare "ko")
  //             단, 요구사항/단위업무 그룹 순서(서버가 이미 정렬해 준 순서)는 그대로 두고
  //             그 "그룹 안에서만" 카테고리 순으로 재배열한다.
  //             카테고리만으로 전체를 정렬하면 같은 단위업무의 화면들이 뿔뿔이 흩어져
  //             요구사항·단위업무 열의 그룹핑(병합 표시)이 깨지는 문제가 있었다.
  const items = viewMode === "category"
    ? (() => {
        const groupKey = (s: ScreenRow) => `${s.requirementId ?? ""} ${s.unitWorkId ?? ""}`;
        // filtered는 서버가 내려준 요구사항/단위업무 그룹 순서를 유지하고 있으므로,
        // 그룹이 처음 등장하는 위치를 그대로 그룹 순서로 사용한다.
        const groupOrder = new Map<string, number>();
        for (const s of filtered) {
          const key = groupKey(s);
          if (!groupOrder.has(key)) groupOrder.set(key, groupOrder.size);
        }
        return [...filtered].sort((a, b) => {
          const gA = groupOrder.get(groupKey(a))!;
          const gB = groupOrder.get(groupKey(b))!;
          if (gA !== gB) return gA - gB;
          const lA = a.categoryL ?? "", lB = b.categoryL ?? "";
          if (lA !== lB) return lA.localeCompare(lB, "ko");
          const mA = a.categoryM ?? "", mB = b.categoryM ?? "";
          if (mA !== mB) return mA.localeCompare(mB, "ko");
          const sA = a.categoryS ?? "", sB = b.categoryS ?? "";
          if (sA !== sB) return sA.localeCompare(sB, "ko");
          return a.name.localeCompare(b.name, "ko");
        });
      })()
    : filtered;

  // 분류순 모드에서는 순서가 텍스트 정렬로 자동 결정되므로 드래그(수동 순서 변경)만 비활성.
  // 요구사항/단위업무 그룹 경계는 두 모드 모두 유지된다 (아래 isFirstReq/isLastOfReq 참조).
  const isCategoryView = viewMode === "category";

  // ── 순서 변경 뮤테이션 ──────────────────────────────────────────────────────
  const sortMutation = useMutation({
    mutationFn: (orders: { screenId: string; sortOrder: number }[]) =>
      authFetch(`/api/projects/${projectId}/screens/sort`, {
        method: "PUT",
        body: JSON.stringify({ orders }),
      }),
    // 성공해도 서버 재조회로 확정 — 낙관적 업데이트만 믿고 두면 다른 필터/탭에서 보던
    // 캐시가 어긋난 채로 남을 수 있음
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["screens", projectId] });
    },
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

    const unitWorkId = items[from]?.unitWorkId ?? null;

    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    if (!moved) return;
    reordered.splice(to, 0, moved);

    // 낙관적 업데이트 후 서버 동기화 — queryKey는 실제 useQuery가 쓰는 키(담당자 필터 포함)와
    // 정확히 일치해야 함. 예전엔 ["screens", projectId] 로만 써서 실제 캐시(["screens", projectId,
    // effectiveAssignedTo])와 어긋나 화면에 반영이 전혀 안 되던 버그였음(2026-07-29).
    queryClient.setQueryData(
      ["screens", projectId, effectiveAssignedTo],
      { items: reordered, totalCount: reordered.length }
    );

    // 정렬순서는 "단위업무 안에서" 1,2,3... 로 매기는 값 — 예전엔 필터링된 전체 목록을
    // 통째로 idx+1 로 다시 매겨서 다른 단위업무의 화면까지 전역 일련번호로 덮어써버렸다
    // (기능 목록에도 있던 동일 버그, 2026-07-29 수정). 같은 단위업무 항목만 추려 새 상대
    // 순서대로 1부터 다시 매겨서 그 단위업무만 갱신한다.
    const sameUnitWorkOrders = reordered
      .filter((s) => s.unitWorkId === unitWorkId)
      .map((s, idx) => ({ screenId: s.screenId, sortOrder: idx + 1 }));
    sortMutation.mutate(sameUnitWorkOrders);
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
        padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          화면 목록
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ExcelDownloadButton
            href={`/api/projects/${projectId}/screens/export${
              effectiveAssignedTo
                ? `?assignedTo=${encodeURIComponent(effectiveAssignedTo)}`
                : ""
            }`}
            entityKey="screens"
          />
          <button
            onClick={() => router.push(`/projects/${projectId}/screens/new`)}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
          >
            + 신규 등록
          </button>
        </div>
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
        {/* 컬럼이 늘어(기간/작성상태 추가, 2026-07-28) 좁은 화면에서 넘칠 수 있어 overflowX:auto로 전환.
            hidden이면 넘치는 컬럼이 잘려서 안 보이는 채로 사라짐 — 단위업무 목록과 동일 패턴. */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflowX: "auto" }}>
          {/* 헤더 행 */}
          <div style={{ ...gridHeaderStyle, gridTemplateColumns: isCategoryView ? GRID_TEMPLATE_CATEGORY : GRID_TEMPLATE_DEFAULT }}>
            <div />
            <div>단위업무 명</div>
            <div>화면 명</div>
            {/* 대/중/소분류는 분류순 모드에서만 노출 — 화면명 바로 다음에 배치해 분류 기준으로
                훑어보기 쉽게 함(2026-07-29) */}
            {isCategoryView && (
              <>
                <div>대분류</div>
                <div>중분류</div>
                <div>소분류</div>
              </>
            )}
            <div>담당자</div>
            {/* 작성상태는 담당자 오른쪽에 배치(2026-07-29) */}
            <div style={{ textAlign: "center" }}>작성상태</div>
            <div>화면유형</div>
            {/* 화면은 실질구현기간(actl_impl_*)을 관리 — 단위업무 목록의 "설계 기간"과 구분되도록 명시 */}
            <div style={{ textAlign: "center" }}>구현 기간</div>
            <div style={{ textAlign: "center" }}>영역</div>
            <div style={{ textAlign: "center" }}>정렬</div>
            <div style={{ textAlign: "center" }}>설/구</div>
          </div>

          {items.length === 0 ? (
            <div style={{ padding: "64px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
              등록된 화면이 없습니다.
            </div>
          ) : (
            items.map((screen, idx) => {
              // 요구사항 그룹 경계 — 요구사항 명 컬럼은 화면에서 뺐지만, 그룹 사이 구분선은
              // 분류순 모드에서도 그대로 유지 (같은 요구사항의 화면은 항상 연속으로 붙어 있음).
              const isLastOfReq = idx === items.length - 1 || items[idx + 1].requirementId !== screen.requirementId;

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
                    gridTemplateColumns: isCategoryView ? GRID_TEMPLATE_CATEGORY : GRID_TEMPLATE_DEFAULT,
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

                  {/* 단위업무명 — 같은 unitWorkId가 연속되는 첫 행에만 표시 (두 모드 공통) */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={screen.unitWorkName}
                  >
                    {items[idx - 1]?.unitWorkId === screen.unitWorkId && screen.unitWorkId
                      ? null
                      : screen.unitWorkId ? (
                        <button
                          onClick={() => router.push(`/projects/${projectId}/unit-works/${screen.unitWorkId}`)}
                          style={linkBtnStyle}
                        >
                          {screen.unitWorkName}
                        </button>
                      ) : (
                        <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>미분류</span>
                      )
                    }
                  </div>

                  {/* 화면명 — 연필 클릭 시 인라인 편집(입력 후 focus out/Enter로 즉시 저장) */}
                  <div
                    style={{
                      fontSize: 13, display: "flex", alignItems: "center", minWidth: 0,
                      overflow: "hidden", whiteSpace: "nowrap",
                    }}
                    title={editingNameId === screen.screenId ? undefined : `${screen.displayId} ${screen.name}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {editingNameId === screen.screenId ? (
                      <input
                        autoFocus
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        onBlur={() => commitEditName(screen)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); commitEditName(screen); }
                          if (e.key === "Escape") { e.preventDefault(); setEditingNameId(null); }
                        }}
                        style={{ ...nameEditInputStyle, minWidth: 0, flex: 1 }}
                      />
                    ) : (
                      <>
                        <span
                          onClick={() => router.push(`/projects/${projectId}/screens/${screen.screenId}`)}
                          style={{ cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}
                        >
                          <span style={{ color: "var(--color-text-secondary)", fontSize: 13, marginRight: 6 }}>
                            {screen.displayId}
                          </span>
                          {screen.name}
                        </span>
                        {myRole !== "VIEWER" && (
                          <button
                            onClick={(e) => startEditName(screen, e)}
                            title="화면명 수정"
                            style={editIconBtnStyle}
                          >
                            <PencilIcon />
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* 대/중/소분류 — 분류순 모드에서만 노출, 화면명 바로 다음에 배치(2026-07-29) */}
                  {isCategoryView && (
                    <>
                      <div style={{ fontSize: 13, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {screen.categoryL || "-"}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {screen.categoryM || "-"}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {screen.categoryS || "-"}
                      </div>
                    </>
                  )}

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

                  {/* 화면정의서 작성 상태 — 색 구분 없이 기본 텍스트(단위업무 목록과 동일 정책).
                      담당자 오른쪽으로 위치 이동(2026-07-29) */}
                  <div style={{ textAlign: "center" }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
                      {DOC_STATUS_LABEL[screen.docStatus] ?? screen.docStatus}
                    </span>
                  </div>

                  {/* 화면유형 배지 */}
                  <div>
                    <span className="sp-badge" style={typeBadgeStyle(screen.type)}>
                      {screen.type}
                    </span>
                  </div>

                  {/* 구현 기간 — 화면 자신의 실질구현기간(actl_impl_*). 단위업무 목록과 동일하게
                      연도 2자리로 줄이고 2줄로 표시해 컬럼 폭을 좁게 유지(2026-07-28) */}
                  <div
                    title={screen.implStartDate && screen.implEndDate ? `${screen.implStartDate} ~ ${screen.implEndDate}` : undefined}
                    style={{ fontSize: 11, lineHeight: 1, textAlign: "center", color: "var(--color-text-secondary)" }}
                  >
                    {screen.implStartDate ? (
                      <>
                        <div>{shortYear(screen.implStartDate)}</div>
                        <div>{screen.implEndDate ? `~ ${shortYear(screen.implEndDate)}` : "~"}</div>
                      </>
                    ) : "미정"}
                  </div>

                  {/* 영역 수 — 클릭 시 이 화면으로 필터된 영역 목록으로 이동. 0건이면 갈 곳이 없으므로 비활성 텍스트만 표시 */}
                  <div style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    {screen.areaCount > 0 ? (
                      <button
                        onClick={() => router.push(`/projects/${projectId}/areas?screenId=${screen.screenId}`)}
                        title="이 화면의 영역 목록으로 이동"
                        style={{ ...linkBtnStyle, fontSize: 13, textAlign: "center" }}
                      >
                        {screen.areaCount}
                      </button>
                    ) : (
                      <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>{screen.areaCount}</span>
                    )}
                  </div>

                  {/* 정렬순서 */}
                  <div style={{ textAlign: "center", fontSize: 13, color: "var(--color-text-primary)" }}>
                    {screen.sortOrder}
                  </div>

                  {/* 설/구 평균 진행률 — 테스트율은 화면 단위에서 더 이상 집계하지 않아 뺐다 */}
                  <div style={{ display: "flex", gap: 4, justifyContent: "center", fontSize: 11 }}>
                    {[
                      { val: screen.avgDesignRt, color: "#1565c0" },
                      { val: screen.avgImplRt, color: "#2e7d32" },
                    ].map(({ val, color }, i) => (
                      <span key={i} style={{
                        color,
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
    </div>
  );
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

// ── 인라인 편집용 연필 아이콘 (외부 아이콘 라이브러리 미도입 — 인라인 SVG) ──
function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
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

// 단위업무·화면명·분류는 fr 비율, 소형 컬럼은 고정 / 설구
// 담당자·화면유형·영역·정렬·설구는 내용 길이에 맞춰 타이트하게 —
// 남는 공간은 fr 컬럼(단위업무/화면명/분류)이 자동으로 가져간다.
// 요구사항 명 컬럼은 삭제(2026-07-28) — 단위업무 명만으로도 소속 파악 가능해 중복 정보였음.
// AI 구현 컬럼도 삭제(2026-07-28) — 화면 목록에서는 안 쓰여 뺐다. 관련 상태(aiDetailTaskId)·
// 다이얼로그·배지 헬퍼 함수도 이 페이지에서만 쓰이던 거라 같이 정리.
// 담당자(48px): "멋쟁이" 류 짧은 이름 기준. 화면유형(52px): LIST~REPORT 배지 폭에 맞춤.
// 설/구(58px): "100% 100%" 두 배지가 겨우 들어가는 최소 폭.
// 단위업무(1.5→2fr)·대/중/소분류(1→1.3fr)는 AI구현 삭제로 남은 공간을 더 많이 가져가도록
// 화면명(3fr) 대비 비중을 키움 — 분류값이 길어 잘리던 문제(스크린샷 "1프로젝트 ...") 완화.
// 대/중/소분류 컬럼은 분류순 모드에서만 렌더링되므로(2026-07-28) 정렬순 모드용 템플릿을 따로 둠 —
// 정렬순에서 안 쓰는 분류 정보 때문에 나머지 컬럼이 좁아지고 화면이 복잡해 보이던 문제 해결.
// 기간(70px)/작성상태(64px) — 단위업무 목록과 동일한 형식(2줄 날짜, 텍스트만 상태)으로 추가(2026-07-28).
// 작성상태는 60→64px — "전/중/완료" 축약을 "작성전/작성중/작성완료" 풀네임으로 되돌리며 소폭 확장(2026-07-29).
// 대/중/소분류 위치를 화면명 바로 다음으로 이동(2026-07-29) — 템플릿 컬럼 순서도 함께 이동.
// 작성상태도 담당자 오른쪽으로 이동(2026-07-29).
const GRID_TEMPLATE_DEFAULT  = "32px 2fr 3fr 48px 64px 52px 70px 30px 32px 58px";
const GRID_TEMPLATE_CATEGORY = "32px 2fr 3fr 1.3fr 1.3fr 1.3fr 48px 64px 52px 70px 30px 32px 58px";

const gridHeaderStyle: React.CSSProperties = {
  display: "grid",
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
// 여러 줄이 될 수 있는 셀도 전체 row가 뜨지 않도록 셀별로 nowrap 강제.
const gridRowStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  padding: "12px 16px",
  alignItems: "center",
  background: "var(--color-bg-card)",
  transition: "background 0.1s",
  cursor: "pointer",
};

// 인라인 링크 — AI 태스크 페이지 기준에 맞춰 평소엔 일반 텍스트로 통일.
// font: inherit 으로 <button> user-agent 폰트가 옆 <span> 과 어긋나는 문제 방지.
const linkBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--color-text-primary)",
  fontFamily: "inherit",
  fontWeight: "inherit",
  fontSize: 13,
  padding: 0,
  textAlign: "left",
  textDecoration: "none",
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

const nameEditInputStyle: React.CSSProperties = {
  padding:      "3px 6px",
  borderRadius: 4,
  border:       "1px solid var(--color-brand, #1976d2)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     13,
  outline:      "none",
  boxSizing:    "border-box",
};

const editIconBtnStyle: React.CSSProperties = {
  display:        "inline-flex",
  alignItems:     "center",
  justifyContent: "center",
  flexShrink:     0,
  marginLeft:     6,
  padding:        2,
  border:         "none",
  background:     "none",
  color:          "var(--color-text-tertiary)",
  cursor:         "pointer",
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
