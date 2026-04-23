"use client";

/**
 * TableUsageSection — DB 테이블 "사용 현황" 섹션 (매핑 인사이트 Phase 1)
 *
 * 역할:
 *   - 상단: 요약 카드 4개 (기능/영역/화면 연결수 + 컬럼 활용률)
 *   - 하단: 이 테이블을 참조하는 설계 산출물 목록 (화면 > 영역 > 기능 계층)
 *     · 행 클릭 시 각 상세 페이지로 라우팅
 *     · IO 프로필(IN/OUT/INOUT) 배지 + 사용 컬럼 수 표시
 *
 * Props:
 *   - projectId, tableId: 대상 테이블 식별
 *
 * 데이터:
 *   - GET /api/projects/[id]/db-tables/[tableId]/usage
 *   - TanStack Query 로 캐시 (queryKey = ["db-table-usage", projectId, tableId])
 *     상세 페이지가 컬럼 배지용으로 같은 endpoint 를 호출해도 쿼리 공유됨.
 *
 * UI 결정:
 *   - 본창 inline (팝업 아님) — 요약/리스트는 사용자가 항상 보고 싶은 정보
 *   - 리스트가 많아지면 Phase 2 에서 "전체 보기" 버튼으로 팝업 전환 검토
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
// 공통 배지/상수 — 색상·라벨의 단일 진실의 원천
// IO_META 는 인라인 배지 렌더링에 직접 사용 (바 차트 제거 이후)
import { RefTypeBadge, IoBadge, USAGE_STALE_TIME, IO_META } from "./TableInsightBadges";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type RefIoProfile = { in: number; out: number; inout: number };

type UsedByItem = {
  refType:   "FUNCTION" | "AREA" | "SCREEN" | string;
  refId:     string;
  refName:   string;
  scrnId:    string | null;
  scrnNm:    string | null;
  areaId:    string | null;
  areaNm:    string | null;
  ioProfile: RefIoProfile;
  colCount:  number;
};

type UsageSummary = {
  functionCount: number;
  // areaCount/screenCount — API 는 계속 반환하나 현재 UI 는 노출 안 함 (항상 0이라 공간 낭비).
  // 추후 AREA/SCREEN 매핑 UI 가 생기면 되살려 사용.
  areaCount:     number;
  screenCount:   number;
  usedColCount:  number;
  totalColCount: number;
  // IO 인라인 배지(조회/저장/입출력 %)에 사용
  ioTotals:      { in: number; out: number; inout: number };
  // lastUsedDt — 목록 페이지 'stale' 필터가 사용. 상세 UI 에서는 카드 제거됨.
  lastUsedDt:    string | null;
};

export type TableUsageResponse = {
  summary:     UsageSummary;
  usedBy:      UsedByItem[];
  columnUsage: Record<string, { in: number; out: number; inout: number; total: number }>;
};

type Props = {
  projectId: string;
  tableId:   string;
};

// ── 공통 쿼리 훅 ─────────────────────────────────────────────────────────────

/**
 * 상세 페이지(컬럼 배지용)와 이 컴포넌트가 같은 쿼리키를 공유하도록 외부에 훅을 공개한다.
 * → TanStack Query dedupe 로 API 호출 1회만 발생.
 */
export function useTableUsage(projectId: string, tableId: string) {
  return useQuery<TableUsageResponse>({
    queryKey: ["db-table-usage", projectId, tableId],
    queryFn:  () =>
      authFetch<{ data: TableUsageResponse }>(
        `/api/projects/${projectId}/db-tables/${tableId}/usage`
      ).then((r) => r.data),
    // 편집 중에는 매번 다시 보지 않아도 됨 — 저장 후 invalidate 로 갱신
    // staleTime 은 ColumnUsageDialog 와 공유되는 상수 사용
    staleTime: USAGE_STALE_TIME,
  });
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function TableUsageSection({ projectId, tableId }: Props) {
  const router = useRouter();
  const { data, isLoading, error } = useTableUsage(projectId, tableId);

  // 컬럼 활용률 문자열 — "80% (12/15)" 형태. 0 컬럼 테이블은 "—" 처리
  const coverageLabel = useMemo(() => {
    if (!data) return "—";
    const { usedColCount, totalColCount } = data.summary;
    if (totalColCount === 0) return "—";
    const pct = Math.round((usedColCount / totalColCount) * 100);
    return `${pct}% (${usedColCount}/${totalColCount})`;
  }, [data]);

  if (isLoading) {
    return <div style={sectionStyle}><div style={muted}>사용 현황을 불러오는 중...</div></div>;
  }
  if (error) {
    return <div style={sectionStyle}><div style={muted}>사용 현황을 불러오지 못했습니다.</div></div>;
  }
  if (!data) return null;

  // 참조 행 클릭 — 타입별로 라우팅 (없는 id 는 무시)
  function handleRowClick(row: UsedByItem) {
    if (row.refType === "FUNCTION") {
      router.push(`/projects/${projectId}/functions/${row.refId}`);
    } else if (row.refType === "AREA") {
      router.push(`/projects/${projectId}/areas/${row.refId}`);
    } else if (row.refType === "SCREEN") {
      router.push(`/projects/${projectId}/screens/${row.refId}`);
    }
  }

  return (
    <div style={sectionStyle}>
      {/* 섹션 타이틀 */}
      <div style={sectionTitleStyle}>사용 현황</div>

      {/* 요약 카드 2개 — 영역/화면/마지막사용 제거 (항상 0이거나 가치 낮음)
          기능 매핑만 실 사용됨 → 정보 밀도 유지하면서 공간 절약 */}
      <div style={cardRowStyle}>
        <SummaryCard label="연결 기능"   value={data.summary.functionCount} accent />
        <SummaryCard label="컬럼 활용률" valueText={coverageLabel} />
      </div>

      {/* IO 분포 인라인 배지 — 바 차트 제거, 한 줄 텍스트로 대체
          매핑 0건이면 이 줄 자체 숨김 */}
      <IoInlineRow totals={data.summary.ioTotals} />

      {/* 사용처 리스트 */}
      {data.usedBy.length === 0 ? (
        <div style={emptyBoxStyle}>
          아직 이 테이블을 참조하는 설계 산출물이 없습니다.
        </div>
      ) : (
        <div style={tableWrapStyle}>
          <div style={usageHeaderRowStyle}>
            <span>유형</span>
            <span>화면 &gt; 영역 &gt; 이름</span>
            <span style={{ textAlign: "center" }}>IO</span>
            <span style={{ textAlign: "center" }}>사용 컬럼</span>
          </div>

          {data.usedBy.map((row, idx) => (
            <div
              key={`${row.refType}-${row.refId}`}
              onClick={() => handleRowClick(row)}
              style={{
                ...usageRowStyle,
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover, #f4f6ff)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-bg-card)")}
            >
              <span>
                <RefTypeBadge refType={row.refType} />
              </span>
              <span style={hierarchyStyle}>
                <BreadcrumbText scrn={row.scrnNm} area={row.areaNm} name={row.refName} />
              </span>
              <span style={{ textAlign: "center" }}>
                <IoProfileBadges io={row.ioProfile} />
              </span>
              <span style={{ textAlign: "center", fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                {row.colCount}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 서브 컴포넌트 ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, valueText, accent }: {
  label: string; value?: number; valueText?: string; accent?: boolean;
}) {
  return (
    <div style={cardStyle}>
      <div style={cardLabelStyle}>{label}</div>
      <div style={{ ...cardValueStyle, color: accent ? "var(--color-brand)" : "var(--color-text-primary)" }}>
        {valueText ?? value ?? 0}
      </div>
    </div>
  );
}

function BreadcrumbText({ scrn, area, name }: { scrn: string | null; area: string | null; name: string }) {
  // 계층을 " › " 로 이어붙이되 null 은 생략. 같은 이름이 반복되면 (SCREEN 자기 자신) 중복 제거.
  const parts = [scrn, area, name].filter((v): v is string => !!v);
  const dedup: string[] = [];
  for (const p of parts) {
    if (dedup[dedup.length - 1] !== p) dedup.push(p);
  }
  return (
    <span style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
      {dedup.map((p, i) => (
        <span key={i}>
          {i > 0 && <span style={{ color: "var(--color-text-tertiary)", margin: "0 6px" }}>›</span>}
          <span style={{ fontWeight: i === dedup.length - 1 ? 600 : 400 }}>{p}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * 참조 행의 IO 구성 배지 세트 — 0인 항목은 숨김.
 * 공용 IoBadge 를 사용하여 색·라벨 단일화.
 */
function IoProfileBadges({ io }: { io: RefIoProfile }) {
  const hasAny = io.in > 0 || io.out > 0 || io.inout > 0;
  if (!hasAny) {
    return <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>—</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 4, justifyContent: "center" }}>
      {io.in    > 0 && <IoBadge io="INPUT"  count={io.in} />}
      {io.out   > 0 && <IoBadge io="OUTPUT" count={io.out} />}
      {io.inout > 0 && <IoBadge io="INOUT"  count={io.inout} />}
    </span>
  );
}

/**
 * 테이블 전체 IO 분포 인라인 배지 — 카드 아래 한 줄 요약
 *   · 형식: "🔍 조회 25% · ✏️ 저장 25% · 🔄 입출력 50%"
 *   · 0% 인 세그먼트는 생략 (시각 노이즈 감소)
 *   · 매핑 전혀 없으면 줄 자체 숨김 (공간 낭비 방지)
 *   · 이전에 별도 IoDistributionBar 컴포넌트였으나 바 차트가 과해서 인라인 배지로 축소
 */
function IoInlineRow({ totals }: { totals: { in: number; out: number; inout: number } }) {
  const total = totals.in + totals.out + totals.inout;
  if (total === 0) return null;

  // 표시 순서: 조회 → 저장 → 입출력. 실무 빈도 순.
  const segments = [
    { ioKey: "OUTPUT" as const, label: "조회",   count: totals.out },
    { ioKey: "INPUT"  as const, label: "저장",   count: totals.in },
    { ioKey: "INOUT"  as const, label: "입출력", count: totals.inout },
  ].filter((s) => s.count > 0);

  return (
    <div style={ioInlineRowStyle} title={`매핑 총 ${total}건`}>
      {segments.map((seg, i) => {
        const m   = IO_META[seg.ioKey];
        const pct = Math.round((seg.count / total) * 100);
        return (
          <span key={seg.ioKey} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {i > 0 && <span style={{ color: "var(--color-text-tertiary)" }}>·</span>}
            <span>{m.icon}</span>
            <span style={{ color: "var(--color-text-secondary)" }}>{seg.label}</span>
            <strong style={{ color: m.fg }}>{pct}%</strong>
          </span>
        );
      })}
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

// 사용처 행 그리드: 유형 / 계층텍스트 / IO / 사용컬럼
const USAGE_GRID = "60px 1fr 160px 80px";

const sectionStyle: React.CSSProperties = {
  marginTop: 24,
  padding:   14,
  background: "var(--color-bg-card)",
  border:    "1px solid var(--color-border)",
  borderRadius: 8,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700,
  color: "var(--color-text-primary)",
  marginBottom: 10,
};

// 카드 2개 전용 그리드. 카드가 너무 넓어지지 않도록 max 너비 제한
const cardRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 240px))",
  gap: 12,
  marginBottom: 10,
};

const cardStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "var(--color-bg-muted)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
};

const cardLabelStyle: React.CSSProperties = {
  fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4,
};

const cardValueStyle: React.CSSProperties = {
  fontSize: 17, fontWeight: 700,
  whiteSpace: "nowrap",
  overflow: "hidden", textOverflow: "ellipsis",
};

// IO 인라인 배지 줄 — 카드 아래 한 줄. 배경·테두리 없이 가볍게
const ioInlineRowStyle: React.CSSProperties = {
  display: "flex", gap: 10, flexWrap: "wrap",
  alignItems: "center",
  padding: "6px 2px",
  marginBottom: 12,
  fontSize: 12,
  color: "var(--color-text-primary)",
};

const tableWrapStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  overflow: "hidden",
};

const usageHeaderRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: USAGE_GRID,
  padding: "8px 12px", gap: 12,
  background: "var(--color-bg-muted)",
  borderBottom: "1px solid var(--color-border)",
  fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)",
  alignItems: "center",
};

const usageRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: USAGE_GRID,
  padding: "9px 12px", gap: 12,
  background: "var(--color-bg-card)",
  cursor: "pointer", alignItems: "center",
  transition: "background 0.1s",
};

const hierarchyStyle: React.CSSProperties = {
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const emptyBoxStyle: React.CSSProperties = {
  padding: "24px 0", textAlign: "center",
  color: "var(--color-text-tertiary)",
  fontSize: 13,
  border: "1px dashed var(--color-border)",
  borderRadius: 6,
};

const muted: React.CSSProperties = {
  fontSize: 13, color: "var(--color-text-secondary)", textAlign: "center", padding: "12px 0",
};

