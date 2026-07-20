"use client";

/**
 * AnalysisStatusCard — 분석 현황 (요구사항 기준)
 *
 * 역할:
 *   - 멤버별 담당 요구사항 건수 / 완료 / 지연 / 분석률(평균 진척률)을 한 표로 보여준다.
 *   - 제목 클릭 또는 멤버 이름 클릭 → AnalysisDetailModal 드릴다운.
 *
 * DelayStatusMatrix(설계·구현)와 별도 위젯인 이유:
 *   요구사항엔 공수(effort) 필드가 없어 "지연율"이 건수 기준이다. 설계/구현은 공수 가중
 *   지연율을 쓰므로, 같은 표에 나란히 두면 컬럼마다 계산 기준이 달라 오해를 부른다.
 *   (src/types/pm.ts AnalysisDelayRow 주석 참조)
 */

import { useState } from "react";
import type { AnalysisDelayRow, PmSummaryResponse } from "@/types/pm";
import AnalysisDetailModal from "./AnalysisDetailModal";

type Props = {
  projectId: string;
  rows:      AnalysisDelayRow[];
  summary:   PmSummaryResponse["analysisSummary"] | undefined;
  isLoading: boolean;
  error:     Error | null;
};

// ── 분석률/지연율 → 색 톤 (semantic 토큰만 사용 — 3테마 자동 대응) ────────────
function progressTone(pct: number): string {
  if (pct >= 80) return "var(--color-success)";
  if (pct >= 40) return "var(--color-warning)";
  return "var(--color-error)";
}

export default function AnalysisStatusCard({ projectId, rows, summary, isLoading, error }: Props) {
  // null = 닫힘. "" = 필터 없이 열림(제목 클릭). 그 외 = 그 멤버로 필터된 채 열림(행 클릭)
  const [detailMberId, setDetailMberId] = useState<string | null>(null);

  return (
    <>
      <div className="sp-group">
        <div className="sp-group-header">
          <button
            type="button"
            className="sp-group-title"
            onClick={() => setDetailMberId("")}
            title="클릭하면 상세 목록을 볼 수 있습니다"
            style={{ cursor: "pointer", background: "none", border: "none", padding: 0, font: "inherit" }}
          >
            <SearchIcon />
            분석 현황
            <ChevronIcon />
          </button>
          {summary && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>
              <span>전체 <b style={{ color: "var(--color-text-primary)" }}>{summary.totalCount}</b>건</span>
              <span>분석률 <b style={{ color: progressTone(summary.avgProgress) }}>{summary.avgProgress}%</b></span>
              <span>지연 <b style={{ color: summary.delayedCount > 0 ? "var(--color-error)" : "var(--color-text-primary)" }}>{summary.delayedCount}</b>건</span>
            </div>
          )}
        </div>
        <div
          style={{
            padding: "6px 16px", fontSize: "var(--text-base)", color: "var(--color-text-tertiary)",
            borderBottom: "1px solid var(--color-border-subtle)",
          }}
        >
          요구사항(TbRqRequirement) 기준입니다 — 분석률은 담당 요구사항 진척률 평균, 지연은 건수 기준입니다.
        </div>
        <div className="sp-group-body" style={{ padding: 0 }}>
          {isLoading ? (
            <Skeleton />
          ) : error ? (
            <ErrorBox message={error.message} />
          ) : rows.length === 0 ? (
            <Empty />
          ) : (
            <Table rows={rows} onMemberClick={setDetailMberId} />
          )}
        </div>
      </div>

      {detailMberId !== null && (
        <AnalysisDetailModal
          projectId={projectId}
          initialMberId={detailMberId || undefined}
          onClose={() => setDetailMberId(null)}
        />
      )}
    </>
  );
}

function Table({
  rows, onMemberClick,
}: {
  rows: AnalysisDelayRow[];
  /** 멤버 이름 클릭 시 그 멤버(mberId, 미할당이면 UNASSIGNED_MBER_KEY)로 상세 팝업을 연다 */
  onMemberClick: (mberId: string) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      {/* table-layout: fixed + 퍼센트 폭 — MissingStatusCard.tsx 와 동일한 이유 */}
      <table style={{ borderCollapse: "collapse", fontSize: 15, width: "100%", tableLayout: "fixed" }}>
        <thead>
          <tr style={{ background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)" }}>
            <th style={{ ...thStyle, width: "28%" }}>멤버</th>
            <th style={{ ...thNumStyle, width: "18%" }}>요구사항</th>
            <th style={{ ...thNumStyle, width: "18%" }}>완료</th>
            <th style={{ ...thNumStyle, width: "18%" }}>지연</th>
            <th style={{ ...thNumStyle, width: "18%" }}>분석률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mberId} style={{ borderBottom: "1px solid var(--color-border)" }}>
              <td style={{ ...tdStyle, padding: 0, maxWidth: 200 }}>
                <button
                  type="button"
                  onClick={() => onMemberClick(r.mberId)}
                  title={`${r.displayName} 상세 목록 보기`}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "7px 12px", background: "none", border: "none", font: "inherit",
                    color: "var(--color-brand)", cursor: "pointer",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {r.displayName}
                </button>
              </td>
              <td style={tdNumStyle}>{r.reqTotal}</td>
              <td style={tdNumStyle}>{r.reqCompleted}</td>
              <td style={{ ...tdNumStyle, color: r.reqDelayed > 0 ? "var(--color-error)" : undefined }}>{r.reqDelayed}</td>
              <td style={{ ...tdNumStyle, color: progressTone(r.avgProgress), fontWeight: 600 }}>{r.avgProgress}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 상태 컴포넌트 ───────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{ height: 28, background: "var(--color-bg-elevated)", borderRadius: "var(--radius-sm)", opacity: 0.5 }}
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
    <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>
      담당자가 지정된 요구사항이 없습니다.
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--color-text-tertiary)",
};
const thNumStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: "right",
  width: 90,
};
const tdStyle: React.CSSProperties = {
  padding: "7px 12px",
  fontSize: "var(--text-lg)",
  color: "var(--color-text-primary)",
};
const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontFamily: "var(--font-mono)",
};

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

// "클릭하면 상세히 열립니다"를 커서 변화에만 기대지 않고 눈으로도 보이게 하는 화살표
function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: 12, height: 12, marginLeft: 2 }}>
      <polyline points="6,3 11,8 6,13" />
    </svg>
  );
}
