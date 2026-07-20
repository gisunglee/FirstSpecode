"use client";

/**
 * MissingStatusCard — 미지정 현황 (담당자/일정/공수 입력 누락 매트릭스)
 *
 * 역할:
 *   - "지연 현황"은 마감을 넘긴 것만 잡는다 — 애초에 아무도 입력하지 않은 항목(담당자·일정·공수)은
 *     마감 판정 자체가 안 돼서 지연 위젯에 안 잡힌다. 이 위젯은 그 사각지대를 훑어보는 용도.
 *   - 행: 요구사항/단위업무/화면/기능, 열: 담당자 미지정 / 일정 미입력 / 공수 미입력.
 *   - 공수는 화면·기능에만 있는 개념이라(요구사항·단위업무는 DB 컬럼 자체가 없음) 해당 셀은 "-".
 *   - 0건이 아닌 셀을 클릭하면 실제 항목 목록 + 바로가기 링크 팝업(MissingDetailModal).
 */

import { useState } from "react";
import type { MissingEntityKind, MissingStat } from "@/types/pm";
import MissingDetailModal from "./MissingDetailModal";

type MissingKind = "assignee" | "date" | "effort";

type Props = {
  projectId: string;
  rows:      MissingStat[];
  isLoading: boolean;
  error:     Error | null;
};

type DetailTarget = { entity: MissingEntityKind; missing: MissingKind };

export default function MissingStatusCard({ projectId, rows, isLoading, error }: Props) {
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);

  const totalMissing = rows.reduce(
    (sum, r) => sum + r.assigneeMissing + r.dateMissing + (r.effortMissing ?? 0),
    0
  );

  return (
    <>
      <div className="sp-group">
        <div className="sp-group-header">
          <button
            type="button"
            className="sp-group-title"
            onClick={() => setDetailTarget({ entity: "REQUIREMENT", missing: "assignee" })}
            title="클릭하면 상세 목록을 볼 수 있습니다"
            style={{ cursor: "pointer", background: "none", border: "none", padding: 0, font: "inherit" }}
          >
            <WarningIcon />
            미지정 현황
            <ChevronIcon />
          </button>
          <div style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>
            입력 누락 <b style={{ color: totalMissing > 0 ? "var(--color-error)" : "var(--color-text-primary)" }}>{totalMissing}</b>건
          </div>
        </div>
        <div
          style={{
            padding: "6px 16px", fontSize: "var(--text-base)", color: "var(--color-text-tertiary)",
            borderBottom: "1px solid var(--color-border-subtle)",
          }}
        >
          마감을 넘긴 것과 별개로, 담당자·일정·공수를 아예 입력하지 않은 항목입니다. 공수는 화면·기능에만 해당됩니다.
        </div>
        <div className="sp-group-body" style={{ padding: 0 }}>
          {isLoading ? (
            <Skeleton />
          ) : error ? (
            <ErrorBox message={error.message} />
          ) : rows.length === 0 ? (
            <Empty />
          ) : (
            <Table rows={rows} onCellClick={setDetailTarget} />
          )}
        </div>
      </div>

      {detailTarget && (
        <MissingDetailModal
          projectId={projectId}
          initialEntity={detailTarget.entity}
          initialMissing={detailTarget.missing}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </>
  );
}

function Table({
  rows, onCellClick,
}: {
  rows: MissingStat[];
  onCellClick: (target: DetailTarget) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      {/* table-layout: fixed + 퍼센트 폭 — auto 레이아웃은 폭 안 준 컬럼이 남는 공간을 혼자
          흡수해서 컬럼별로 삐뚤빼뚤해진다(width:100%만 줬을 때의 문제). 퍼센트로 전 컬럼에
          나눠주면 카드 폭 전체를 고르게 채운다. */}
      <table style={{ borderCollapse: "collapse", fontSize: 15, width: "100%", tableLayout: "fixed" }}>
        <thead>
          <tr style={{ background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)" }}>
            <th style={{ ...thStyle, width: "24%" }}>유형</th>
            <th style={{ ...thNumStyle, width: "16%" }}>전체</th>
            <th style={{ ...thNumStyle, width: "20%" }}>담당자 미지정</th>
            <th style={{ ...thNumStyle, width: "20%" }}>일정 미입력</th>
            <th style={{ ...thNumStyle, width: "20%" }}>공수 미입력</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.entity} style={{ borderBottom: "1px solid var(--color-border)" }}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{r.entityLabel}</td>
              <td style={tdNumStyle}>{r.total}</td>
              <MissingCell count={r.assigneeMissing} onClick={() => onCellClick({ entity: r.entity, missing: "assignee" })} />
              <MissingCell count={r.dateMissing} onClick={() => onCellClick({ entity: r.entity, missing: "date" })} />
              {r.effortMissing === null ? (
                <td style={{ ...tdNumStyle, color: "var(--color-text-tertiary)" }}>-</td>
              ) : (
                <MissingCell count={r.effortMissing} onClick={() => onCellClick({ entity: r.entity, missing: "effort" })} />
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 0건이면 회색 텍스트만, 1건 이상이면 클릭 가능한 버튼(경고색)으로
function MissingCell({ count, onClick }: { count: number; onClick: () => void }) {
  if (count === 0) {
    return <td style={{ ...tdNumStyle, color: "var(--color-text-tertiary)" }}>0</td>;
  }
  return (
    <td style={{ ...tdNumStyle, padding: 0 }}>
      <button
        type="button"
        onClick={onClick}
        title="상세 목록 보기"
        style={{
          width: "100%", padding: "7px 12px", background: "none", border: "none",
          font: "inherit", fontFamily: "var(--font-mono)", textAlign: "right",
          color: "var(--color-error)", fontWeight: 700, cursor: "pointer",
        }}
      >
        {count}
      </button>
    </td>
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
      집계할 항목이 없습니다.
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
  width: 110,
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

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: 12, height: 12, marginLeft: 2 }}>
      <polyline points="6,3 11,8 6,13" />
    </svg>
  );
}
