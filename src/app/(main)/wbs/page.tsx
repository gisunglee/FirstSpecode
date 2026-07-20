"use client";

/**
 * WbsSchedulePage — WBS 일정 (URL: /wbs)
 *
 * 역할:
 *   - 단위업무 / 화면 / 기능 3종을 탭으로 전환하며 각각 간트차트로 조회
 *   - 간트 인스턴스는 하나만 두고 탭 전환 시 조회 데이터만 갈아끼움
 *   - 영역(Area)은 날짜 컬럼이 없어 이번 범위에서 제외(추후 마이그레이션 필요)
 *
 * 데이터:
 *   - 화면은 설계 일정(design_bgng_de/end_de) + 설계 진척률, 기능은 구현 일정
 *     (impl_bgng_de/end_de) + 구현 진척률을 사용 — DeadlineProgressHeatmap.tsx 의
 *     "화면=설계, 기능=구현" 페어링과 동일한 의미.
 *
 * 구조 분리:
 *   - 이 파일: 상태·데이터 조회만 담당(오케스트레이션). "무엇을 보여줄지"는 WbsFilterBar,
 *     "그걸 간트로 그리는" 건 WbsGanttChart — 서로의 존재를 모른 채 items(최종 결과 목록)와
 *     표시옵션만 주고받는다.
 */

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import type { DeadlineEntityKind } from "@/types/pm";
import type { WbsTaskItem } from "@/app/api/projects/[id]/wbs/route";
import type { WbsGanttHandle } from "./WbsGanttChart";
import WbsFilterBar, {
  ENTITY_ORDER, type WbsMemberOption, type WbsPeriodPreset,
} from "./WbsFilterBar";
import { useWbsSettingsStore } from "./wbsSettingsStore";

// DOM 렌더링 라이브러리 — GraphCanvas.tsx 와 동일한 이유로 SSR 제외
const WbsGanttChart = dynamic(() => import("./WbsGanttChart"), { ssr: false });

type WbsResponse = {
  items:      WbsTaskItem[];
  page:       number;
  pageSize:   number;
  totalCount: number;
  totalPages: number;
};

type MembersResponse = {
  members: { memberId: string; name: string | null; email: string }[];
};

// 로컬(브라우저) 달력 기준 YYYY-MM-DD — toISOString()은 UTC로 변환되면서 한국 시간대
// (UTC+9)에서는 날짜가 하루 밀릴 수 있어 직접 포맷한다.
function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 기간 프리셋 → 실제 startFrom/startTo 계산. 날짜 계산은 여기 한 곳에만 둔다 —
// WbsFilterBar는 프리셋 값만 오가고 실제 날짜 산출은 모른다.
function periodPresetToRange(preset: WbsPeriodPreset): { startFrom?: string; startTo?: string } {
  if (preset === "ALL") return {};

  const now = new Date();
  if (preset === "THIS_MONTH") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { startFrom: toLocalISODate(from), startTo: toLocalISODate(to) };
  }

  // THIS_WEEK — 월요일 시작. getDay()는 일(0)~토(6)라 월요일까지 며칠 전인지 보정.
  const diffToMonday = (now.getDay() + 6) % 7;
  const from = new Date(now);
  from.setDate(now.getDate() - diffToMonday);
  const to = new Date(from);
  to.setDate(from.getDate() + 6);
  return { startFrom: toLocalISODate(from), startTo: toLocalISODate(to) };
}

export default function WbsSchedulePage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);

  const [entity, setEntity]         = useState<DeadlineEntityKind>("UNIT_WORK");
  const [assigneeId, setAssigneeId] = useState("");
  const [page, setPage]             = useState(1);
  const [ganttHandle, setGanttHandle] = useState<WbsGanttHandle | null>(null);

  // 표시 설정(보기/줌/그리드 컬럼/막대 표시/상태·기간 필터/페이지당)은 매번 다시 켜야 해서
  // 불편하다는 피드백을 반영해 localStorage에 영속화 — wbsSettingsStore.ts 참고.
  // entity(탭)·assigneeId(담당자)·page는 "탐색 중인 대상"이라 일부러 여기서 제외했다.
  const view         = useWbsSettingsStore((s) => s.view);
  const setView      = useWbsSettingsStore((s) => s.setView);
  const phase        = useWbsSettingsStore((s) => s.phase);
  const setPhase     = useWbsSettingsStore((s) => s.setPhase);
  const zoomLevel     = useWbsSettingsStore((s) => s.zoomLevel);
  const setZoomLevel  = useWbsSettingsStore((s) => s.setZoomLevel);
  const barFieldsArr  = useWbsSettingsStore((s) => s.barFields);
  const toggleBarField = useWbsSettingsStore((s) => s.toggleBarField);
  const gridColumnsArr = useWbsSettingsStore((s) => s.gridColumns);
  const toggleGridColumn = useWbsSettingsStore((s) => s.toggleGridColumn);
  const statusColor    = useWbsSettingsStore((s) => s.statusColor);
  const setStatusColor = useWbsSettingsStore((s) => s.setStatusColor);
  const statusFilter    = useWbsSettingsStore((s) => s.statusFilter);
  const setStatusFilter = useWbsSettingsStore((s) => s.setStatusFilter);
  const periodFilter    = useWbsSettingsStore((s) => s.periodFilter);
  const setPeriodFilter = useWbsSettingsStore((s) => s.setPeriodFilter);
  const pageSize    = useWbsSettingsStore((s) => s.pageSize);
  const setPageSize = useWbsSettingsStore((s) => s.setPageSize);

  // WbsFilterBar/WbsSettingsPanel은 Set<BarField>/Set<WbsGridColumn>을 받는 기존 인터페이스라
  // 저장은 배열(JSON 직렬화 가능)로 하고, 넘겨줄 때만 Set으로 변환한다.
  const barFields   = useMemo(() => new Set(barFieldsArr), [barFieldsArr]);
  const gridColumns = useMemo(() => new Set(gridColumnsArr), [gridColumnsArr]);

  // 탭·설계구현·담당자·상태·기간 필터가 바뀌면 결과 집합 자체가 달라지므로 1페이지로 되돌린다
  useEffect(() => {
    setPage(1);
  }, [entity, phase, assigneeId, statusFilter, periodFilter]);

  // 키보드 단축키 — select/input/textarea에 포커스가 있을 땐(드롭다운 옵션 넘기기 등)
  // 그 기본 동작을 건드리면 안 되니 전부 건너뛴다.
  //   ←/→        : 간트 좌우 스크롤 버튼과 동일. Ctrl(또는 ⌘)+방향키는 3배 거리.
  //   1/2/3      : 단위업무/화면/기능 탭 전환(WbsFilterBar.ENTITY_ORDER 순서와 항상 일치).
  //                Ctrl+1 등은 브라우저 자체 탭 전환 단축키와 겹쳐서 일부러 수정키 없이만 반응.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const multiplier = e.ctrlKey || e.metaKey ? 3 : 1;
        ganttHandle?.scrollBy(e.key === "ArrowLeft" ? -1 : 1, multiplier);
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const idx = ["1", "2", "3"].indexOf(e.key);
        const target = idx !== -1 ? ENTITY_ORDER[idx] : undefined;
        if (target) {
          e.preventDefault();
          setEntity(target);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ganttHandle]);

  const { data: membersData } = useQuery<MembersResponse>({
    queryKey: ["project-members", currentProjectId],
    queryFn: () =>
      authFetch<{ data: MembersResponse }>(`/api/projects/${currentProjectId}/members`).then((r) => r.data),
    enabled:   !!currentProjectId,
    staleTime: 60_000,
  });
  const members: WbsMemberOption[] = (membersData?.members ?? []).map((m) => ({
    memberId: m.memberId,
    name:     m.name || m.email,
  }));

  const { startFrom, startTo } = periodPresetToRange(periodFilter);

  const { data, isLoading, error } = useQuery<WbsResponse>({
    queryKey: ["wbs", currentProjectId, entity, phase, assigneeId, statusFilter, periodFilter, page, pageSize],
    queryFn: () =>
      authFetch<{ data: WbsResponse }>(
        `/api/projects/${currentProjectId}/wbs?entity=${entity}&phase=${phase}&page=${page}&pageSize=${pageSize}` +
          (assigneeId ? `&assignedTo=${assigneeId}` : "") +
          (statusFilter !== "ALL" ? `&status=${statusFilter}` : "") +
          (startFrom ? `&startFrom=${startFrom}` : "") +
          (startTo ? `&startTo=${startTo}` : "")
      ).then((r) => r.data),
    enabled: !!currentProjectId,
  });

  return (
    <div style={{ padding: 0 }}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
          background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)",
          marginBottom: 16, gap: 12, flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 19, fontWeight: 700, color: "var(--color-text-primary)" }}>
          WBS 일정
        </div>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : (
          <div className="sp-group">
            <WbsFilterBar
              entity={entity}
              onEntityChange={setEntity}
              phase={phase}
              onPhaseChange={setPhase}
              view={view}
              onViewChange={setView}
              zoomLevel={zoomLevel}
              onZoomLevelChange={setZoomLevel}
              members={members}
              assigneeId={assigneeId}
              onAssigneeChange={setAssigneeId}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              periodFilter={periodFilter}
              onPeriodFilterChange={setPeriodFilter}
              barFields={barFields}
              onToggleBarField={toggleBarField}
              gridColumns={gridColumns}
              onToggleGridColumn={toggleGridColumn}
              statusColor={statusColor}
              onStatusColorChange={setStatusColor}
              page={data?.page ?? page}
              pageSize={pageSize}
              totalCount={data?.totalCount ?? 0}
              totalPages={data?.totalPages ?? 1}
              onPageChange={setPage}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              onScroll={(dir) => ganttHandle?.scrollBy(dir)}
              onScrollToEdge={(dir) => ganttHandle?.scrollToEdge(dir)}
            />
            <div className="sp-group-body">
              {isLoading ? (
                <Skeleton />
              ) : error ? (
                <ErrorBox message={(error as Error).message} />
              ) : !data || data.items.length === 0 ? (
                <Empty />
              ) : (
                <WbsGanttChart
                  items={data.items}
                  barFields={barFields}
                  statusColor={statusColor}
                  zoomLevel={zoomLevel}
                  grouped={view === "group"}
                  gridColumns={gridColumns}
                  onReady={setGanttHandle}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div
      className="sp-empty"
      style={{
        padding: "48px 24px", textAlign: "center",
        background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="sp-empty-icon">📁</div>
      <div className="sp-empty-title">프로젝트를 선택해 주세요</div>
      <div className="sp-empty-desc">
        상단 프로젝트 선택기에서 프로젝트를 고르면 WBS 일정이 표시됩니다.
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 16 }}>
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          style={{ height: 28, background: "var(--color-bg-elevated)", borderRadius: "var(--radius-sm)", opacity: 0.4 }}
        />
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{ padding: 16, color: "var(--color-error)", fontSize: "var(--text-lg)" }}>
      ⚠ {message}
    </div>
  );
}

function Empty() {
  return (
    <div style={{ padding: "32px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>
      일정이 지정된 항목이 없습니다.
    </div>
  );
}
