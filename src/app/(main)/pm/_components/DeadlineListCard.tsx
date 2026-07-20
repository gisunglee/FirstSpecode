"use client";

/**
 * DeadlineListCard — 마감 임박 리스트 (단위업무/화면/기능 공용)
 *
 * 역할:
 *   - "위험 워치리스트"/"우선순위 × 진척 히트맵" 자리를 대체. entity prop 하나로 세 용도를 다
 *     커버한다 — pm/page.tsx 에서 이 컴포넌트를 UNIT_WORK/SCREEN/FUNCTION 3번 렌더.
 *   - 기준일(오늘을 대신하는 값) 대비 마감이 가까운 순으로 전체를 나열. 지연 중인 것이 자동으로
 *     맨 위에 온다.
 *   - "완료 제외" 체크(기본 켜짐)로 이미 끝난 항목을 숨길 수 있음 — "PM 진단"이라는 이름대로
 *     기본은 "아직 신경 써야 할 것"만 보이게.
 *
 * 격리:
 *   - pm-summary 캐시와 무관 — 이 카드 전용 useQuery로 entity/기준일/완료제외 조합마다 독립적으로 fetch.
 *   - 기준일 +/- 스테퍼는 DelayStatusMatrix.tsx/DeadlineProgressHeatmap.tsx 와 동일한 UI/로직
 *     (shiftDateStr) — 카드마다 독립적으로 기준일을 가진다(사용자 확정).
 *   - 리스트 행 스타일은 RiskWatchlist.tsx 를 참고(D-day 배지 + 이름/담당자 + 진척률).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { authFetch } from "@/lib/authFetch";
import { DEADLINE_ENTITY_LABELS } from "@/types/pm";
import type { DeadlineEntityKind, DeadlineListItem } from "@/types/pm";

type Props = {
  projectId: string;
  entity:    DeadlineEntityKind;
};

// yyyy-MM-dd 문자열에 일수를 더하고(음수면 뺀다) 다시 yyyy-MM-dd 로 반환 — DelayStatusMatrix.tsx 와 동일
function shiftDateStr(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export default function DeadlineListCard({ projectId, entity }: Props) {
  const [asOfDate, setAsOfDate] = useState("");
  const displayDate = asOfDate || new Date().toISOString().slice(0, 10);
  const [excludeCompleted, setExcludeCompleted] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ["pm-deadline-list", projectId, entity, displayDate, excludeCompleted],
    queryFn: () =>
      authFetch<{ data: { items: DeadlineListItem[]; total: number } }>(
        `/api/projects/${projectId}/pm-deadline-list?entity=${entity}&asOf=${displayDate}&excludeCompleted=${excludeCompleted}`
      ).then((r) => r.data),
    enabled: !!projectId,
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="sp-group" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div className="sp-group-header">
        <div className="sp-group-title">
          <ListIcon />
          {DEADLINE_ENTITY_LABELS[entity]} 마감 리스트
        </div>
        <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)" }}>{total}건</span>
      </div>

      {/* 컨트롤 — 기준일 +/- 스테퍼 + 완료 제외 체크박스 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: "1px solid var(--color-border-subtle)", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>기준일</span>
        <button type="button" onClick={() => setAsOfDate(shiftDateStr(displayDate, -1))} title="하루 전" style={stepBtnStyle}>−</button>
        <input
          type="date"
          value={displayDate}
          onChange={(e) => setAsOfDate(e.target.value)}
          className="sp-input"
          style={{ padding: "2px 6px", fontSize: "var(--text-base)", height: 26, width: 122 }}
        />
        <button type="button" onClick={() => setAsOfDate(shiftDateStr(displayDate, 1))} title="하루 후" style={stepBtnStyle}>+</button>
        {asOfDate && (
          <button type="button" onClick={() => setAsOfDate("")} title="오늘 기준으로 되돌리기" style={resetBtnStyle}>오늘</button>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "var(--text-base)", color: "var(--color-text-secondary)", cursor: "pointer", marginLeft: "auto" }}>
          <input type="checkbox" checked={excludeCompleted} onChange={(e) => setExcludeCompleted(e.target.checked)} style={{ cursor: "pointer" }} />
          완료 제외
        </label>
      </div>

      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <ErrorBox message={(error as Error).message} />
        ) : items.length === 0 ? (
          <Empty />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((it) => (
              <li key={it.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                <Link
                  href={it.href}
                  style={{
                    display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10,
                    padding: "9px 14px", textDecoration: "none", color: "var(--color-text-primary)",
                    alignItems: "center",
                  }}
                >
                  {/* 좌측 — D-day 배지 */}
                  <DDayBadge dDay={it.dDay} />

                  {/* 중앙 — 이름 + 담당자 */}
                  <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span
                      style={{ fontSize: "var(--text-lg)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={it.name}
                    >
                      {it.name || "(이름 없음)"}
                    </span>
                    <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {it.memberName ?? "(미할당)"}
                    </span>
                  </div>

                  {/* 우측 — 진척률 */}
                  <span
                    style={{
                      fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", fontWeight: 600,
                      color: it.progress === 0 ? "var(--color-error)" : it.progress < 50 ? "var(--color-warning)" : "var(--color-text-primary)",
                    }}
                  >
                    {it.progress}%
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// D-day 배지 — RiskWatchlist.tsx 의 formatDDay 와 동일한 톤(지연=error, D-0~3=warning, D-4~7=info)
function DDayBadge({ dDay }: { dDay: number | null }) {
  const { label, tone } = formatDDay(dDay);
  return (
    <span className={`sp-badge ${tone}`} style={{ fontSize: "var(--text-base)", fontWeight: 700, padding: "2px 8px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function formatDDay(d: number | null): { label: string; tone: string } {
  if (d === null) return { label: "마감 없음", tone: "sp-badge-neutral" };
  if (d < 0)      return { label: `D+${-d}`, tone: "sp-badge-error" };
  if (d === 0)    return { label: "D-DAY",   tone: "sp-badge-warning" };
  if (d <= 3)     return { label: `D-${d}`,  tone: "sp-badge-warning" };
  if (d <= 7)     return { label: `D-${d}`,  tone: "sp-badge-info" };
  return            { label: `D-${d}`,  tone: "sp-badge-neutral" };
}

// ── 상태 컴포넌트 ───────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ height: 40, background: "var(--color-bg-elevated)", borderRadius: "var(--radius-sm)", opacity: 0.5 }} />
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <div style={{ padding: 16, color: "var(--color-error)", fontSize: "var(--text-lg)" }}>⚠ {message}</div>;
}

function Empty() {
  return (
    <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-lg)" }}>
      🎉 해당 항목이 없습니다.
    </div>
  );
}

const stepBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 22, height: 22, borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 14, fontWeight: 700,
  cursor: "pointer", lineHeight: 1, padding: 0,
};

const resetBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  height: 22, padding: "0 8px", borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 11, fontWeight: 600,
  cursor: "pointer", lineHeight: 1,
};

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}
