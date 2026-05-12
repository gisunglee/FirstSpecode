"use client";

/**
 * PriorityHeatmap — 요구사항 우선순위 × 단위업무 진척 단계 히트맵
 *
 * 역할:
 *   - 3×3 그리드 (HIGH/MEDIUM/LOW × 미시작/진행중/완료)
 *   - 각 셀의 건수와 비율을 색 농도로 표현
 *   - PM 관점: "HIGH × 미시작" 셀이 빨강이면 즉시 개입 신호
 *
 * 색상 룰:
 *   - HIGH 행 + (미시작/진행중) = 위험 톤 (error 농도 차이)
 *   - 완료 열 = success 톤
 *   - 그 외 = neutral
 *   - 셀 안의 숫자는 모노폰트로 정렬
 */

import type { PriorityLevel, PriorityMatrix, PriorityStage } from "@/types/pm";

type Props = {
  matrix:    PriorityMatrix;
  isLoading: boolean;
  error:     Error | null;
};

const STAGE_ORDER:   PriorityStage[] = ["notStarted", "inProgress", "completed"];
const STAGE_LABEL:   Record<PriorityStage, string> = {
  notStarted: "미시작",
  inProgress: "진행중",
  completed:  "완료",
};
const PRIORITY_ORDER: PriorityLevel[] = ["HIGH", "MEDIUM", "LOW"];
const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  HIGH:   "높음",
  MEDIUM: "보통",
  LOW:    "낮음",
};

export default function PriorityHeatmap({ matrix, isLoading, error }: Props) {
  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <div className="sp-group-title">
          <GridIcon />
          우선순위 × 진척 히트맵
        </div>
        {!isLoading && !error && (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
            총 {matrix.grandTotal}건
          </span>
        )}
      </div>
      <div className="sp-group-body">
        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <ErrorBox message={error.message} />
        ) : matrix.grandTotal === 0 ? (
          <Empty />
        ) : (
          <Grid matrix={matrix} />
        )}
      </div>
    </div>
  );
}

function Grid({ matrix }: { matrix: PriorityMatrix }) {
  // 셀 최댓값 — 색 농도 정규화 기준
  const maxCellValue = Math.max(
    1,
    ...PRIORITY_ORDER.flatMap((p) => STAGE_ORDER.map((s) => matrix.cells[p][s])),
  );

  return (
    <div
      style={{
        display: "grid",
        // 열 4개: 우선순위 라벨 + 3 단계 + 합계
        gridTemplateColumns: "70px repeat(3, 1fr) 70px",
        gap: 4,
      }}
    >
      {/* 헤더 행 */}
      <div />
      {STAGE_ORDER.map((s) => (
        <div
          key={s}
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            textAlign: "center",
            color: "var(--color-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            padding: "4px 0",
          }}
        >
          {STAGE_LABEL[s]}
        </div>
      ))}
      <div
        style={{
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          textAlign: "right",
          color: "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          padding: "4px 6px",
        }}
      >
        합계
      </div>

      {/* 데이터 행 */}
      {PRIORITY_ORDER.map((p) => (
        <RowFragment key={p} priority={p} matrix={matrix} maxCellValue={maxCellValue} />
      ))}
    </div>
  );
}

function RowFragment({
  priority, matrix, maxCellValue,
}: {
  priority:     PriorityLevel;
  matrix:       PriorityMatrix;
  maxCellValue: number;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingRight: 8,
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          color: priorityLabelColor(priority),
        }}
      >
        {PRIORITY_LABEL[priority]}
      </div>
      {STAGE_ORDER.map((s) => {
        const value = matrix.cells[priority][s];
        return (
          <Cell key={s} value={value} maxValue={maxCellValue} tone={cellTone(priority, s, value)} />
        );
      })}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingRight: 6,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-sm)",
          color: "var(--color-text-secondary)",
        }}
      >
        {matrix.rowTotals[priority]}
      </div>
    </>
  );
}

function Cell({
  value, maxValue, tone,
}: {
  value:    number;
  maxValue: number;
  tone:     { bg: string; fg: string; border: string };
}) {
  // 색 농도 — 0~1. 0 이면 거의 무색, 1 이면 진한 톤.
  const intensity = maxValue > 0 ? value / maxValue : 0;
  // CSS 변수 alpha 변형은 불가하므로 opacity 로 배경 농도 표현.
  // 텍스트는 가독성 위해 opacity 미적용.
  return (
    <div
      style={{
        position: "relative",
        minHeight: 60,
        border: `1px solid ${tone.border}`,
        borderRadius: "var(--radius-sm)",
        background: "transparent",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: tone.bg,
          opacity: 0.15 + intensity * 0.65, // 0.15 ~ 0.80
        }}
      />
      <div
        style={{
          position: "relative",
          height: "100%",
          minHeight: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "var(--text-xl)",
          fontWeight: 700,
          fontFamily: "var(--font-mono)",
          color: value > 0 ? tone.fg : "var(--color-text-tertiary)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// 우선순위 라벨 색 — HIGH 만 강조
function priorityLabelColor(p: PriorityLevel): string {
  if (p === "HIGH")   return "var(--color-error)";
  if (p === "MEDIUM") return "var(--color-text-primary)";
  return "var(--color-text-tertiary)";
}

// 셀 톤 — 위험·성공·중립
function cellTone(p: PriorityLevel, s: PriorityStage, value: number) {
  // 완료 열은 항상 success 톤
  if (s === "completed") {
    return {
      bg:     "var(--color-success-subtle)",
      fg:     "var(--color-success)",
      border: "var(--color-success-border)",
    };
  }
  // HIGH × 미진행 = error
  if (p === "HIGH" && value > 0) {
    return {
      bg:     "var(--color-error-subtle)",
      fg:     "var(--color-error)",
      border: "var(--color-error-border)",
    };
  }
  // MEDIUM × 미시작 = warning
  if (p === "MEDIUM" && s === "notStarted" && value > 0) {
    return {
      bg:     "var(--color-warning-subtle)",
      fg:     "var(--color-warning)",
      border: "var(--color-warning-border)",
    };
  }
  // 나머지 — 중립
  return {
    bg:     "var(--color-bg-elevated)",
    fg:     "var(--color-text-secondary)",
    border: "var(--color-border-subtle)",
  };
}

// ── 상태 컴포넌트 ───────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "70px repeat(3, 1fr) 70px",
        gap: 4,
      }}
    >
      {Array.from({ length: 20 }, (_, i) => (
        <div
          key={i}
          style={{
            minHeight: 32,
            background: "var(--color-bg-elevated)",
            borderRadius: "var(--radius-sm)",
            opacity: 0.4,
          }}
        />
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{ color: "var(--color-error)", fontSize: "var(--text-sm)" }}>
      ⚠ {message}
    </div>
  );
}

function Empty() {
  return (
    <div
      style={{
        padding: "32px 0",
        textAlign: "center",
        color: "var(--color-text-tertiary)",
        fontSize: "var(--text-sm)",
      }}
    >
      집계할 단위업무가 없습니다.
    </div>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3"  width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
