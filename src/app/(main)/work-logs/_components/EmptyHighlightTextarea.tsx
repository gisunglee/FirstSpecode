"use client";

/**
 * EmptyHighlightTextarea — 비어 있으면 "아직 안 썼다"가 바로 보이는 결과 입력칸
 *
 * 기본 placeholder(옅은 회색 텍스트)만으로는 "입력 안 한 상태"가 눈에 잘 안 띈다는 피드백 —
 * 비어 있을 때 배경을 파스텔로 칠하고, 가운데에 안내 문구를 카드처럼 띄운다. 값이 하나라도
 * 들어오면 평소 흰 배경으로 돌아간다(2026-07-24). DayCard/WeekResultSummary의 "결과" 계열
 * textarea가 공유한다.
 *
 * fill 옵션 추가(2026-07-24e) — WeekResultSummary가 WeekChecklistSummary와 카드 높이를
 * 맞출 때, rows 고정 대신 부모(flex 컬럼)의 남은 공간을 그대로 채우도록 한다.
 */

export default function EmptyHighlightTextarea({
  value,
  onChange,
  message,
  rows,
  fill,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 비어 있을 때 가운데 뜨는 안내 문구 — 예: "오늘 작업 결과를 입력해 주세요." */
  message: string;
  rows: number;
  /** true면 rows 대신 부모 flex 컨테이너의 남은 높이를 그대로 채운다 */
  fill?: boolean;
}) {
  const isEmpty = value.trim() === "";

  return (
    <div style={{ position: "relative", ...(fill ? { flex: 1, minHeight: 0, display: "flex" } : {}) }}>
      <textarea
        className="sp-input sp-textarea"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", fontSize: "var(--text-sm)",
          background: isEmpty ? "var(--color-highlight-bg)" : undefined,
          ...(fill ? { flex: 1, height: "100%", resize: "none" } : {}),
        }}
      />
      {isEmpty && (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none", padding: 8,
          }}
        >
          <span
            style={{
              background: "var(--color-bg-card)", border: "1px solid var(--color-border-strong)",
              borderRadius: "var(--radius-md)", padding: "6px 14px", boxShadow: "var(--shadow-sm)",
              fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--color-text-primary)",
              textAlign: "center",
            }}
          >
            {message}
          </span>
        </div>
      )}
    </div>
  );
}
