"use client";

/**
 * TeamLoadMatrix — 팀 부하 매트릭스
 *
 * 역할:
 *   - 멤버 × 작업 상태(담당/진행중/임박/지연/완료) 표
 *   - 활성 작업량 게이지로 "누가 과부하인지 / 누가 비어있는지" 즉시 파악
 *
 * 시각화 규칙:
 *   - activeLoad 가 가장 큰 멤버를 100% 로 두고 다른 멤버를 상대 비율로
 *   - >=80% → 빨강(과부하), 50~80% → 노랑(보통), <50% → 초록(여유)
 *   - 완료(completed)는 별도 회색 — 누적 성과 표시
 */

import { useState } from "react";
import type { TeamLoadRow } from "@/types/pm";

type Props = {
  rows:      TeamLoadRow[];
  isLoading: boolean;
  error:     Error | null;
};

export default function TeamLoadMatrix({ rows, isLoading, error }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <div className="sp-group-title">
          <PeopleIcon />
          팀 부하 매트릭스
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)" }}>
            {rows.length}명
          </span>
          <button onClick={() => setHelpOpen(true)} title="컬럼 설명" style={helpBtnStyle}>?</button>
        </div>
      </div>
      <div
        style={{
          padding: "6px 16px", fontSize: "var(--text-base)", color: "var(--color-text-tertiary)",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        단위업무 기준입니다. 진척률은 단위업무 자체의 진척률(화면/기능 진척률과는 다른 값)을 씁니다 — 지연 현황(화면·기능 기준)과 숫자가 다를 수 있습니다.
      </div>
      <div className="sp-group-body" style={{ padding: 0 }}>
        {isLoading ? (
          <Skeleton />
        ) : error ? (
          <ErrorBox message={error.message} />
        ) : rows.length === 0 ? (
          <Empty />
        ) : (
          <Matrix rows={rows} />
        )}
      </div>

      {helpOpen && <TeamLoadHelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

// ── 컬럼 설명 도움말 팝업 — RiskWatchlist의 RiskScoreHelpModal과 같은 톤 ─────────
function TeamLoadHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(520px, 90vw)", background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>팀 부하 매트릭스 컬럼 설명</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12, fontSize: 15, lineHeight: 1.7, color: "var(--color-text-primary)" }}>
          <div style={{ color: "var(--color-text-secondary)" }}>
            멤버가 담당한 <b>단위업무</b> 기준으로 집계합니다. 진척률은 단위업무 자체의 진척률(progrs_rt)이고,
            화면·기능 진척률과는 다른 값이라 지연 현황 위젯과 숫자가 다를 수 있습니다.
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>컬럼 정의</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              담당 — 그 멤버가 담당자로 지정된 단위업무 총 건수<br />
              진행중 — 진척률 1~99%<br />
              마감 임박 — 종료일이 오늘부터 7일 이내이고 진척률 100% 미만<br />
              지연 — 종료일이 지났고 진척률 100% 미만<br />
              완료 — 진척률 100%
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>활성 작업량</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              진행중 + 마감 임박 + 지연 건수를 그대로 더한 값입니다. 한 단위업무가 "진행중이면서 지연"이면
              2건으로 겹쳐서 잡힙니다 — 부하를 체감하기 위한 의도된 합산이라 겹치는 걸 막지 않습니다.<br />
              막대 길이는 팀원 중 활성 작업량이 가장 큰 사람을 100%로 놓고 나머지를 상대 비율로 그린 것입니다
              (절대적인 업무 한도 기준이 아니라 "이 프로젝트 안에서 누가 제일 바쁜가"를 보는 용도).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Matrix({ rows }: { rows: TeamLoadRow[] }) {
  const maxLoad = Math.max(1, ...rows.map((r) => r.activeLoad));

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        className="sp-table"
        style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}
      >
        <thead>
          <tr>
            <th style={thStyle}>멤버</th>
            <th style={thNumStyle}>담당</th>
            <th style={thNumStyle}>진행중</th>
            <th style={thNumStyle}>마감 임박</th>
            <th style={thNumStyle}>지연</th>
            <th style={thNumStyle}>완료</th>
            {/* 자세한 설명은 헤더의 "?" 도움말 팝업으로 이동 — 컬럼이 5개나 겹쳐서
                하나만 hover 툴팁으로 설명하면 나머지 컬럼 정의가 안 보여 불충분했다 */}
            <th style={{ ...thStyle, width: 220 }}>활성 작업량</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = Math.round((r.activeLoad / maxLoad) * 100);
            const tone = loadTone(pct);
            return (
              <tr key={r.mberId}>
                <td
                  style={{
                    ...tdStyle,
                    maxWidth: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={r.displayName}
                >
                  {r.displayName}
                </td>
                <td style={tdNumStyle}>{r.total}</td>
                <td style={tdNumStyle}>{r.inProgress}</td>
                <td style={{ ...tdNumStyle, color: r.dueSoon > 0 ? "var(--color-warning)" : undefined }}>
                  {r.dueSoon}
                </td>
                <td style={{ ...tdNumStyle, color: r.overdue > 0 ? "var(--color-error)" : undefined }}>
                  {r.overdue}
                </td>
                <td style={{ ...tdNumStyle, color: "var(--color-text-tertiary)" }}>{r.completed}</td>
                <td style={tdStyle}>
                  <LoadBar pct={pct} tone={tone} label={`${r.activeLoad}건`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LoadBar({ pct, tone, label }: { pct: number; tone: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 8,
          background: "var(--color-border-subtle)",
          borderRadius: "var(--radius-full)",
          overflow: "hidden",
        }}
        aria-hidden
      >
        <div
          style={{
            width: `${Math.max(2, pct)}%`,
            height: "100%",
            background: tone,
            transition: "width 200ms ease",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-base)",
          color: "var(--color-text-secondary)",
          minWidth: 36,
          textAlign: "right",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// 부하 비율 → 색 톤 (semantic 토큰만 사용 — 3테마 자동 대응)
function loadTone(pct: number): string {
  if (pct >= 80) return "var(--color-error)";
  if (pct >= 50) return "var(--color-warning)";
  return "var(--color-success)";
}

// ── 상태 컴포넌트 ───────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: 28,
            background: "var(--color-bg-elevated)",
            borderRadius: "var(--radius-sm)",
            opacity: 0.5,
          }}
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
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        color: "var(--color-text-tertiary)",
        fontSize: "var(--text-lg)",
      }}
    >
      담당자가 지정된 단위업무가 없습니다.
    </div>
  );
}

// ── 스타일 ─────────────────────────────────────────────────────────────────
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--color-text-tertiary)",
  borderBottom: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-elevated)",
};
const thNumStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: "right",
  width: 70,
};
const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: "var(--text-lg)",
  borderBottom: "1px solid var(--color-border-subtle)",
  color: "var(--color-text-primary)",
};
const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontFamily: "var(--font-mono)",
};

const helpBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 18, height: 18, borderRadius: "50%",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 12, fontWeight: 700,
  cursor: "pointer", lineHeight: 1, padding: 0,
};

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
