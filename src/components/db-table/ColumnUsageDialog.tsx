"use client";

/**
 * ColumnUsageDialog — 단일 컬럼 사용처 드릴다운 팝업 (매핑 인사이트 Phase 2)
 *
 * 역할:
 *   - 주어진 colId 의 모든 매핑을 표(1행 1매핑) 형식으로 표시
 *   - 컬럼: [유형] [IO] [화면 › 영역] [참조명] [항목명]
 *   - 행 클릭 시 해당 참조(기능/영역/화면) 상세 페이지로 이동
 *
 * Props:
 *   - open:      팝업 표시 여부
 *   - onClose:   닫기 콜백
 *   - projectId, tableId, colId
 *
 * 표 형식 결정 배경:
 *   - 이 팝업은 "컬럼이 어디 어디서 쓰이는지" 빠르게 스캔하는 용도라 고밀도 표가 적합
 *   - 초기 설계는 3줄 카드 + IO 그룹 박스였으나, 매핑이 많은 컬럼(20건+)에서
 *     세로 길이가 폭발 → 표 1줄로 압축하여 한 화면에 더 많이 보이도록 개선
 */

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import { useEscapeKey } from "@/hooks/useEscapeKey";
// 공통 배지·상수 — 색/라벨/staleTime 단일 진실의 원천
import { RefTypeBadge, IO_META, USAGE_STALE_TIME, type IoSe } from "./TableInsightBadges";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type UsageItem = {
  mappingId:  string;
  ioSeCode:   IoSe;
  refType:    "FUNCTION" | "AREA" | "SCREEN" | string;
  refId:      string;
  refName:    string;
  scrnId:     string | null;
  scrnNm:     string | null;
  areaId:     string | null;
  areaNm:     string | null;
  usePurpsCn: string;
};

type UsageResponse = {
  column: { colId: string; colPhysclNm: string; colLgclNm: string };
  items:  UsageItem[];
};

type Props = {
  open:      boolean;
  onClose:   () => void;
  projectId: string;
  tableId:   string;
  colId:     string;
};

// ── 메인 ─────────────────────────────────────────────────────────────────────

export default function ColumnUsageDialog({ open, onClose, projectId, tableId, colId }: Props) {
  const router = useRouter();

  useEscapeKey(onClose, open);

  // 조회 — open === true 일 때만
  const { data, isLoading, error } = useQuery<UsageResponse>({
    queryKey: ["db-column-usage", projectId, tableId, colId],
    queryFn:  () =>
      authFetch<{ data: UsageResponse }>(
        `/api/projects/${projectId}/db-tables/${tableId}/columns/${colId}/usage`
      ).then((r) => r.data),
    enabled:   open,
    // TableUsageSection 과 공유되는 staleTime 상수 (SSOT)
    staleTime: USAGE_STALE_TIME,
  });

  if (!open) return null;

  const items = data?.items ?? [];

  function handleRowClick(row: UsageItem) {
    if (row.refType === "FUNCTION") {
      router.push(`/projects/${projectId}/functions/${row.refId}`);
    } else if (row.refType === "AREA") {
      router.push(`/projects/${projectId}/areas/${row.refId}`);
    } else if (row.refType === "SCREEN") {
      router.push(`/projects/${projectId}/screens/${row.refId}`);
    } else {
      toast.message("이동할 수 없는 참조 유형입니다.");
    }
    onClose();
  }

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>

        {/* 헤더 — 타이틀 1줄 + 서브 정보(참조 확인 컬럼 / 참조 건수) 1줄 */}
        <div style={headerStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={titleStyle}>컬럼 참조 기능 목록</div>
            <div style={subInfoRowStyle}>
              <div style={subInfoItemStyle}>
                <span style={subInfoLabelStyle}>참조 확인 컬럼:</span>
                <strong style={{
                  fontFamily: "'JetBrains Mono','Fira Code','Consolas',monospace",
                  color: "var(--color-text-primary)",
                  fontWeight: 700,
                }}>
                  {data?.column.colPhysclNm ?? "..."}
                </strong>
                {data?.column.colLgclNm && (
                  <span style={{ color: "var(--color-text-secondary)", marginLeft: 4 }}>
                    {data.column.colLgclNm}
                  </span>
                )}
              </div>
              <div style={subInfoItemStyle}>
                <span style={subInfoLabelStyle}>참조 건수:</span>
                <strong style={{ color: "var(--color-text-primary)", fontWeight: 700 }}>
                  총 {items.length}건
                </strong>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              background: "none", border: "none",
              fontSize: 18, cursor: "pointer",
              color: "var(--color-text-secondary)",
              lineHeight: 1, flexShrink: 0,
              // 타이틀 시각 중심선과 맞추기 위해 약간 아래로 offset
              alignSelf: "flex-start",
              marginTop: 2,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* 본문 — 표 형식 */}
        <div style={{ flex: 1, overflowY: "auto", padding: items.length > 0 ? 0 : 16 }}>
          {isLoading && <div style={mutedStyle}>불러오는 중...</div>}
          {error     && <div style={mutedStyle}>조회에 실패했습니다.</div>}
          {!isLoading && !error && data && items.length === 0 && (
            <div style={emptyBoxStyle}>
              이 컬럼은 아직 어떤 기능/영역/화면에서도 매핑되지 않았습니다.
            </div>
          )}

          {items.length > 0 && (
            <div role="table" aria-label="컬럼 참조 기능 목록">
              {/* 표 헤더 — 유형은 배지로 이미 시각 구분되므로 레이블 최소화.
                   "기능명" 으로 표기 (기획 용어 통일, 대부분 FUNCTION 매핑이므로 자연스러움)
                   AREA/SCREEN 매핑인 경우도 유형 배지로 구분되므로 혼동 없음. */}
              <div role="row" style={tableHeaderRowStyle}>
                <span>유형</span>
                <span>IO</span>
                <span>화면 › 영역</span>
                <span>기능명</span>
                <span>항목명</span>
              </div>

              {/* 데이터 행 */}
              {items.map((it, idx) => (
                <div
                  key={it.mappingId}
                  role="row"
                  onClick={() => handleRowClick(it)}
                  style={{
                    ...tableDataRowStyle,
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover, #f4f6ff)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span><RefTypeBadge refType={it.refType} sizeMode="sm" /></span>
                  <span><IoCell io={it.ioSeCode} /></span>
                  <span style={cellEllipsis} title={formatHierarchy(it)}>{formatHierarchy(it)}</span>
                  <span style={{ ...cellEllipsis, fontWeight: 600, color: "var(--color-text-primary)" }} title={it.refName}>
                    {it.refName}
                  </span>
                  <span style={{ ...cellEllipsis, color: "var(--color-text-secondary)" }} title={it.usePurpsCn || undefined}>
                    {it.usePurpsCn || <span style={{ color: "var(--color-text-tertiary)" }}>—</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div style={footerStyle}>
          <button type="button" onClick={onClose} style={closeBtnStyle}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 서브 컴포넌트 ────────────────────────────────────────────────────────────

/**
 * IO 셀 — 값이 있으면 IO_META 배지, 없으면 tertiary "—"
 * 한 컴포넌트에 "" 대응까지 넣어 호출부 단순화.
 *
 * INOUT 은 "IN/OUT" 로 구분 표기 — "INOUT" 한 덩어리로 붙어있으면 의미가 눈에 덜 들어와서.
 */
function IoCell({ io }: { io: IoSe }) {
  if (io === "") {
    return <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>—</span>;
  }
  const m = IO_META[io];
  const label = io === "INPUT" ? "IN" : io === "OUTPUT" ? "OUT" : "IN/OUT";
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 7px", borderRadius: 8,
      background: m.bg, color: m.fg,
      fontSize: 10, fontWeight: 700,
      letterSpacing: "0.02em",
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

/**
 * "화면 › 영역" 한 줄 문자열. null 제거 + 중복 제거 (SCREEN 자기 자신 케이스).
 * 둘 다 없으면 "—" 표시용 빈 문자열 반환 (호출부에서 처리).
 */
function formatHierarchy(it: UsageItem): string {
  const parts = [it.scrnNm, it.areaNm].filter((v): v is string => !!v);
  const dedup: string[] = [];
  for (const p of parts) {
    if (dedup[dedup.length - 1] !== p) dedup.push(p);
  }
  return dedup.join(" › ");
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

// 표 컬럼 너비: 유형 / IO / 화면 › 영역 / 기능명 / 항목명
// · 유형 / IO 는 배지라 고정폭 (IO 는 "IN/OUT" 을 여유롭게 담도록 70px)
// · 화면 › 영역 은 실무에서 가장 자주 길어짐 → 1.8fr / min 200px 확보
// · 기능명·항목명 은 길면 ellipsis + 호버 툴팁
const TABLE_GRID = "54px 70px minmax(200px, 1.8fr) minmax(140px, 1.3fr) minmax(90px, 0.9fr)";

const backdropStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  // 화면 > 영역 + 기능명이 동시에 길 수 있어 820px 확보
  width: 820, maxWidth: "94vw", maxHeight: "85vh",
  background: "var(--color-bg-card)",
  borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
  display: "flex", flexDirection: "column",
  overflow: "hidden",
};

// 다이얼로그 내부 가로 패딩 — 프로젝트 표준 (예: '기준 정보 추가' 팝업) 과 동일
// 상하 패딩은 상단 24 / 하단 16 로 title 의 위 공간이 더 넓도록 (답답함 해소)
const headerStyle: React.CSSProperties = {
  padding: "24px 28px 18px",
  borderBottom: "1px solid var(--color-border)",
  display: "flex", alignItems: "flex-start", justifyContent: "space-between",
  gap: 12,
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  // 17px — 기존 '기준 정보 추가' 등 표준 다이얼로그 타이틀과 동급
  fontSize: 17, fontWeight: 700,
  color: "var(--color-text-primary)",
  marginBottom: 10,
  lineHeight: 1.3,
};

// 서브 정보 한 줄 — "참조 확인 컬럼" 과 "참조 건수" 를 가로로 나란히
// 좁은 너비에서는 wrap 되도록 gap + flexWrap
const subInfoRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 24,
  flexWrap: "wrap",
  fontSize: 13,
  lineHeight: 1.5,
};

const subInfoItemStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 4,
};

const subInfoLabelStyle: React.CSSProperties = {
  color: "var(--color-text-secondary)",
  fontWeight: 500,
};

const footerStyle: React.CSSProperties = {
  padding: "14px 28px",
  borderTop: "1px solid var(--color-border)",
  textAlign: "right",
  flexShrink: 0,
};

const closeBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer",
};

// 가로 패딩은 다이얼로그 표준(28px) 과 맞춰 정렬감 유지
const tableHeaderRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: TABLE_GRID,
  padding: "10px 28px", gap: 12,
  background: "var(--color-bg-muted)",
  borderBottom: "1px solid var(--color-border)",
  fontSize: 11, fontWeight: 700,
  color: "var(--color-text-secondary)",
  position: "sticky", top: 0, zIndex: 1,
  alignItems: "center",
};

const tableDataRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: TABLE_GRID,
  padding: "10px 28px", gap: 12,
  fontSize: 12,
  alignItems: "center",
  cursor: "pointer",
  transition: "background 0.1s",
};

const cellEllipsis: React.CSSProperties = {
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const mutedStyle: React.CSSProperties = {
  padding: "32px 0", textAlign: "center",
  color: "var(--color-text-secondary)", fontSize: 13,
};

const emptyBoxStyle: React.CSSProperties = {
  padding: "32px 0", textAlign: "center",
  color: "var(--color-text-tertiary)", fontSize: 13,
  border: "1px dashed var(--color-border)",
  borderRadius: 6,
};
