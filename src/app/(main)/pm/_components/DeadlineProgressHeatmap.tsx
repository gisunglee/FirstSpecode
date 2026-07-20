"use client";

/**
 * DeadlineProgressHeatmap — 마감 임박 × 진척률 히트맵
 *
 * 역할:
 *   - 엔티티(단위업무/화면/기능) 중 하나를 골라, 그 엔티티 전체를 마감 근접도(6행) × 진척률(6열)
 *     로 교차 집계해서 "임박한 것 중 얼마나 안 끝났는지"를 매트릭스로 본다.
 *   - PriorityHeatmap.tsx 와 같은 시각화 스타일(색 농도로 건수 표현)이지만, 대상이 요구사항
 *     우선순위가 아니라 엔티티 하나를 골라 마감/진척으로 보는 것이 다르다.
 *   - 진척률은 엔티티와 무관하게 항상 기능(TbDsFunction) 기준으로 롤업된 값 — 구현 진척률(impl_rt)
 *     과 설계 진척률(design_rt) 중 어느 걸 쓸지 사용자가 고를 수 있다. 서버(pm-deadline-progress/route.ts)
 *     에서 이미 계산해서 내려준다.
 *
 * 격리:
 *   - pm-summary 캐시와 완전히 무관 — 이 위젯 전용 useQuery로 엔티티/기준일 조합마다 독립적으로 fetch.
 *   - 기준일 +/- 스테퍼는 DelayStatusMatrix.tsx 와 동일한 UI/로직(shiftDateStr) — 2곳뿐이라 그대로 복제.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  DEADLINE_ENTITY_LABELS, DEADLINE_BUCKET_ORDER, DEADLINE_BUCKET_LABELS,
  PROGRESS_BUCKET_ORDER, PROGRESS_BUCKET_LABELS, PROGRESS_KIND_LABELS,
} from "@/types/pm";
import type {
  DeadlineEntityKind, DeadlineBucket, ProgressBucket, DeadlineProgressMatrix, ProgressKind,
} from "@/types/pm";
import DeadlineProgressDetailModal from "./DeadlineProgressDetailModal";

type Props = { projectId: string };

const ENTITY_ORDER: DeadlineEntityKind[] = ["UNIT_WORK", "SCREEN", "FUNCTION"];
const PROGRESS_KIND_ORDER: ProgressKind[] = ["IMPL", "DESIGN"];

// yyyy-MM-dd 문자열에 일수를 더하고(음수면 뺀다) 다시 yyyy-MM-dd 로 반환 — DelayStatusMatrix.tsx 와 동일
function shiftDateStr(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

type DetailTarget = { deadlineBucket: DeadlineBucket; progressBucket: ProgressBucket };

export default function DeadlineProgressHeatmap({ projectId }: Props) {
  const [entity, setEntity] = useState<DeadlineEntityKind>("FUNCTION");
  const [progressKind, setProgressKind] = useState<ProgressKind>("IMPL");
  const [asOfDate, setAsOfDate] = useState("");
  const displayDate = asOfDate || new Date().toISOString().slice(0, 10);
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["pm-deadline-progress", projectId, entity, progressKind, displayDate],
    queryFn: () =>
      authFetch<{ data: DeadlineProgressMatrix }>(
        `/api/projects/${projectId}/pm-deadline-progress?entity=${entity}&progressKind=${progressKind}&asOf=${displayDate}`
      ).then((r) => r.data),
    enabled: !!projectId,
  });

  return (
    <>
      <div className="sp-group">
        <div className="sp-group-header">
          <div className="sp-group-title">
            <HeatIcon />
            마감 임박 × 진척률
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* 엔티티 세그먼트 — 라디오처럼 한 번에 하나만 */}
            <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              {ENTITY_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setEntity(k)}
                  style={{
                    padding: "4px 10px", fontSize: "var(--text-base)", fontWeight: 600,
                    border: "none", cursor: "pointer",
                    background: entity === k ? "var(--color-brand)" : "var(--color-bg-card)",
                    color: entity === k ? "#fff" : "var(--color-text-secondary)",
                  }}
                >
                  {DEADLINE_ENTITY_LABELS[k]}
                </button>
              ))}
            </div>
            {/* 진척률 기준 세그먼트 — 구현(impl_rt)/설계(design_rt) 중 하나만 */}
            <div style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              {PROGRESS_KIND_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setProgressKind(k)}
                  style={{
                    padding: "4px 10px", fontSize: "var(--text-base)", fontWeight: 600,
                    border: "none", cursor: "pointer",
                    background: progressKind === k ? "var(--color-brand)" : "var(--color-bg-card)",
                    color: progressKind === k ? "#fff" : "var(--color-text-secondary)",
                  }}
                >
                  {PROGRESS_KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <span
              title="진척률을 구현 진척률(impl_rt)로 볼지 설계 진척률(design_rt)로 볼지 고릅니다. 어떤 엔티티를 선택하든 항상 하위 기능들의 값을 롤업합니다 — 화면·단위업무는 하위 기능 평균, 기능은 자기 자신의 값."
              style={{ ...helpBtnStyle, cursor: "help" }}
            >?</span>
            {/* 기준일 +/- 스테퍼 — DelayStatusMatrix.tsx 와 동일 UI */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>기준일</span>
              <button type="button" onClick={() => setAsOfDate(shiftDateStr(displayDate, -1))} title="하루 전" style={stepBtnStyle}>−</button>
              <input
                type="date"
                value={displayDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="sp-input"
                style={{ padding: "2px 6px", fontSize: "var(--text-base)", height: 26, width: 130 }}
              />
              <button type="button" onClick={() => setAsOfDate(shiftDateStr(displayDate, 1))} title="하루 후" style={stepBtnStyle}>+</button>
            </div>
            {asOfDate && (
              <button type="button" onClick={() => setAsOfDate("")} title="오늘 기준으로 되돌리기" style={resetBtnStyle}>오늘</button>
            )}
          </div>
        </div>
        <div
          style={{
            padding: "6px 16px", fontSize: "var(--text-base)", color: "var(--color-text-tertiary)",
            borderBottom: "1px solid var(--color-border-subtle)",
          }}
        >
          {DEADLINE_ENTITY_LABELS[entity]} 기준입니다. 진척률은 항상 기능의 {PROGRESS_KIND_LABELS[progressKind]} 진척률 기준으로 롤업한 값입니다.
          {data && data.excludedNoDeadline > 0 && ` 마감일이 없는 ${data.excludedNoDeadline}건은 제외했습니다(미지정 현황 위젯 참고).`}
        </div>
        <div className="sp-group-body">
          {isLoading ? (
            <Skeleton />
          ) : error ? (
            <ErrorBox message={(error as Error).message} />
          ) : !data || data.totalCount === 0 ? (
            <Empty />
          ) : (
            <Grid matrix={data} onCellClick={(deadlineBucket, progressBucket) => setDetailTarget({ deadlineBucket, progressBucket })} />
          )}
        </div>
      </div>

      {detailTarget && (
        <DeadlineProgressDetailModal
          projectId={projectId}
          entity={entity}
          progressKind={progressKind}
          asOf={displayDate}
          deadlineBucket={detailTarget.deadlineBucket}
          progressBucket={detailTarget.progressBucket}
          onClose={() => setDetailTarget(null)}
        />
      )}
    </>
  );
}

function Grid({
  matrix, onCellClick,
}: {
  matrix: DeadlineProgressMatrix;
  onCellClick: (deadlineBucket: DeadlineBucket, progressBucket: ProgressBucket) => void;
}) {
  const maxCellValue = Math.max(
    1,
    ...DEADLINE_BUCKET_ORDER.flatMap((d) => PROGRESS_BUCKET_ORDER.map((p) => matrix.cells[d][p])),
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "64px repeat(6, 1fr) 56px", gap: 4 }}>
      {/* 헤더 행 */}
      <div />
      {PROGRESS_BUCKET_ORDER.map((p) => (
        <div key={p} style={colHeaderStyle}>{PROGRESS_BUCKET_LABELS[p]}</div>
      ))}
      <div style={{ ...colHeaderStyle, textAlign: "right" }}>합계</div>

      {/* 데이터 행 */}
      {DEADLINE_BUCKET_ORDER.map((d) => {
        const rowTotal = PROGRESS_BUCKET_ORDER.reduce((sum, p) => sum + matrix.cells[d][p], 0);
        return (
          <RowFragment
            key={d}
            deadlineBucket={d}
            matrix={matrix}
            maxCellValue={maxCellValue}
            rowTotal={rowTotal}
            onCellClick={onCellClick}
          />
        );
      })}
    </div>
  );
}

function RowFragment({
  deadlineBucket, matrix, maxCellValue, rowTotal, onCellClick,
}: {
  deadlineBucket: DeadlineBucket;
  matrix:         DeadlineProgressMatrix;
  maxCellValue:   number;
  rowTotal:       number;
  onCellClick:    (deadlineBucket: DeadlineBucket, progressBucket: ProgressBucket) => void;
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 8, fontSize: "var(--text-lg)", fontWeight: 600, color: rowLabelColor(deadlineBucket) }}>
        {DEADLINE_BUCKET_LABELS[deadlineBucket]}
      </div>
      {PROGRESS_BUCKET_ORDER.map((p) => {
        const value = matrix.cells[deadlineBucket][p];
        return (
          <Cell
            key={p}
            value={value}
            maxValue={maxCellValue}
            tone={cellTone(deadlineBucket, p, value)}
            onClick={value > 0 ? () => onCellClick(deadlineBucket, p) : undefined}
          />
        );
      })}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6, fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", color: "var(--color-text-secondary)" }}>
        {rowTotal}
      </div>
    </>
  );
}

function Cell({
  value, maxValue, tone, onClick,
}: {
  value:    number;
  maxValue: number;
  tone:     { bg: string; fg: string; border: string };
  onClick?: () => void;
}) {
  const intensity = maxValue > 0 ? value / maxValue : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={onClick ? "클릭하면 목록을 볼 수 있습니다" : undefined}
      style={{
        position: "relative", minHeight: 52, border: `1px solid ${tone.border}`,
        borderRadius: "var(--radius-sm)", background: "transparent", overflow: "hidden",
        padding: 0, cursor: onClick ? "pointer" : "default",
      }}
    >
      <div aria-hidden style={{ position: "absolute", inset: 0, background: tone.bg, opacity: 0.15 + intensity * 0.65 }} />
      <div style={{ position: "relative", height: "100%", minHeight: 52, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--text-xl)", fontWeight: 700, fontFamily: "var(--font-mono)", color: value > 0 ? tone.fg : "var(--color-text-tertiary)" }}>
        {value}
      </div>
    </button>
  );
}

// 마감 임박 행 라벨 색 — 지연/D-1 만 강조
function rowLabelColor(d: DeadlineBucket): string {
  if (d === "OVERDUE") return "var(--color-error)";
  if (d === "D1")      return "var(--color-warning)";
  return "var(--color-text-tertiary)";
}

// 셀 톤 — 완료(P100)는 항상 success, 지연은 항상 error, D-1/D-3은 warning, 그 외 중립
function cellTone(d: DeadlineBucket, p: ProgressBucket, value: number) {
  if (p === "P100") {
    return { bg: "var(--color-success-subtle)", fg: "var(--color-success)", border: "var(--color-success-border)" };
  }
  if (d === "OVERDUE" && value > 0) {
    return { bg: "var(--color-error-subtle)", fg: "var(--color-error)", border: "var(--color-error-border)" };
  }
  if ((d === "D1" || d === "D3") && value > 0) {
    return { bg: "var(--color-warning-subtle)", fg: "var(--color-warning)", border: "var(--color-warning-border)" };
  }
  return { bg: "var(--color-bg-elevated)", fg: "var(--color-text-secondary)", border: "var(--color-border-subtle)" };
}

// ── 상태 컴포넌트 ───────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "64px repeat(6, 1fr) 56px", gap: 4 }}>
      {Array.from({ length: 32 }, (_, i) => (
        <div key={i} style={{ minHeight: 28, background: "var(--color-bg-elevated)", borderRadius: "var(--radius-sm)", opacity: 0.4 }} />
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <div style={{ color: "var(--color-error)", fontSize: "var(--text-lg)" }}>⚠ {message}</div>;
}

function Empty() {
  return (
    <div style={{ padding: "32px 0", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>
      집계할 항목이 없습니다.
    </div>
  );
}

const colHeaderStyle: React.CSSProperties = {
  fontSize: "var(--text-base)", fontWeight: 600, textAlign: "center",
  color: "var(--color-text-tertiary)", padding: "4px 0",
};

const helpBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 18, height: 18, borderRadius: "50%",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 12, fontWeight: 700,
  cursor: "pointer", lineHeight: 1, padding: 0,
};

const stepBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 22, height: 22, borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 16, fontWeight: 700,
  cursor: "pointer", lineHeight: 1, padding: 0,
};

const resetBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  height: 22, padding: "0 8px", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 13, fontWeight: 600,
  cursor: "pointer", lineHeight: 1,
};

function HeatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
