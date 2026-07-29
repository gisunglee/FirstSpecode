"use client";

/**
 * DelayStatusMatrix — 지연 현황 (설계 + 구현 한 표)
 *
 * 역할:
 *   - 멤버 1행에 설계(단위업무 기준)와 구현(단위업무/화면/영역/기능 기준) 지표를
 *     그룹 헤더로 나란히 보여준다 — 별도 표 2개로 쌓지 않고 한 줄로 쭉 이어 붙여
 *     PM이 한 멤버의 설계·구현 현황을 스크롤 없이 바로 비교할 수 있게 한다.
 *   - "지연만 보기" 토글 하나로 설계·구현 개수 컬럼이 동시에 전체 ↔ 지연만 전환된다.
 *   - 토글 옆 "?" 를 누르면 지연율/지연 공수 계산법을 설명하는 팝업이 뜬다.
 *
 * 팀 부하 매트릭스와의 차이 (헤더 캡션으로도 안내):
 *   - 팀 부하 매트릭스: 단위업무 자체의 end_de/progrs_rt 기준 작업 상태 분포 (담당/진행중/임박/지연/완료)
 *   - 지연 현황(이 컴포넌트): "지연"이라는 한 축에 집중 — 설계는 단위업무 자신의 계획설계일정·공수
 *     기준(2026-07-28 2차 개편으로 화면 단위 세분화 폐지), 구현은 기능(Function) 기준이고
 *     상위 계층(영역/화면/단위업무)은 하위 지연 여부를 그대로 물려받는다.
 *     그래서 같은 "지연 단위업무" 라도 두 위젯의 숫자가 다를 수 있음 — 의도된 차이.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import type { DesignDelayRow, ImplDelayRow, PmSummaryResponse } from "@/types/pm";
import { hoursToDays } from "@/lib/effort";
import DelayDetailModal from "./DelayDetailModal";

type Props = {
  projectId:  string;
  designRows: DesignDelayRow[];
  implRows:   ImplDelayRow[];
  isLoading:  boolean;
  error:      Error | null;
};

// 설계/구현 결과를 멤버 기준으로 한 줄에 합친다 (한쪽에만 데이터가 있으면 다른 쪽은 null)
type MergedRow = {
  mberId:      string;
  displayName: string;
  design: DesignDelayRow | null;
  impl:   ImplDelayRow | null;
};

function mergeRows(designRows: DesignDelayRow[], implRows: ImplDelayRow[]): MergedRow[] {
  const map = new Map<string, MergedRow>();
  for (const d of designRows) {
    map.set(d.mberId, { mberId: d.mberId, displayName: d.displayName, design: d, impl: null });
  }
  for (const i of implRows) {
    const existing = map.get(i.mberId);
    if (existing) existing.impl = i;
    else map.set(i.mberId, { mberId: i.mberId, displayName: i.displayName, design: null, impl: i });
  }
  // 설계·구현 중 더 급한(지연율 높은) 쪽 기준 내림차순
  return [...map.values()].sort((a, b) => {
    const aRate = Math.max(a.design?.delayRate ?? 0, a.impl?.delayRate ?? 0);
    const bRate = Math.max(b.design?.delayRate ?? 0, b.impl?.delayRate ?? 0);
    return bRate - aRate;
  });
}

// yyyy-MM-dd 문자열에 일수를 더하고(음수면 뺀다) 다시 yyyy-MM-dd 로 반환 — 기준일 +/- 버튼용.
// UTC 기준 계산 — pm-summary/route.ts 의 horizonStr 계산과 동일한 관례.
function shiftDateStr(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export default function DelayStatusMatrix({ projectId, designRows, implRows, isLoading, error }: Props) {
  const [delayOnly, setDelayOnly] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // null = 닫힘. "" = 필터 없이 열림(제목 클릭). 그 외 = 그 멤버로 필터된 채 열림(행 클릭)
  const [detailMberId, setDetailMberId] = useState<string | null>(null);
  // 지연 기준일 — 빈 문자열이면 "오늘" = 부모(pm-summary)가 이미 내려준 props 그대로 사용.
  // 값을 고르면 그 날짜로 pm-summary를 다시 불러 designDelay/implDelay만 갈아끼운다
  // (teamLoad 등 나머지 위젯은 이 카드에서 안 쓰므로 응답의 다른 필드는 무시).
  const [asOfDate, setAsOfDate] = useState("");
  // 날짜 입력창에 실제로 보여줄 값 — asOfDate가 비어있어도(=오늘 기준) 빈칸 대신 오늘 날짜를 표시
  const displayDate = asOfDate || new Date().toISOString().slice(0, 10);

  const asOfQuery = useQuery({
    queryKey: ["pm-summary-asof", projectId, asOfDate],
    queryFn: () =>
      authFetch<{ data: PmSummaryResponse }>(`/api/projects/${projectId}/pm-summary?asOf=${asOfDate}`)
        .then((r) => r.data),
    enabled: !!projectId && !!asOfDate,
  });

  const effDesignRows = asOfDate ? (asOfQuery.data?.designDelay ?? []) : designRows;
  const effImplRows   = asOfDate ? (asOfQuery.data?.implDelay   ?? []) : implRows;
  const effLoading    = asOfDate ? asOfQuery.isLoading : isLoading;
  const effError      = asOfDate ? (asOfQuery.error as Error | null) : error;

  const rows = mergeRows(effDesignRows, effImplRows);

  return (
    <>
      <div className="sp-group">
        <div className="sp-group-header">
          {/* <div> 대신 <button> — 브라우저가 커서·포커스·접근성을 기본 보장해서
              CSS cursor 스타일이 씹히는 경우를 원천 차단 */}
          <button
            type="button"
            className="sp-group-title"
            onClick={() => setDetailMberId("")}
            title="클릭하면 상세 목록을 볼 수 있습니다"
            style={{ cursor: "pointer", background: "none", border: "none", padding: 0, font: "inherit" }}
          >
            <ClockIcon />
            지연 현황
            <ChevronIcon />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: "var(--text-base)", color: "var(--color-text-secondary)" }}>기준일</span>
              <button
                type="button"
                onClick={() => setAsOfDate(shiftDateStr(displayDate, -1))}
                title="하루 전"
                style={stepBtnStyle}
              >−</button>
              <input
                type="date"
                value={displayDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="sp-input"
                style={{ padding: "2px 6px", fontSize: "var(--text-base)", height: 26, width: 130 }}
              />
              <button
                type="button"
                onClick={() => setAsOfDate(shiftDateStr(displayDate, 1))}
                title="하루 후"
                style={stepBtnStyle}
              >+</button>
            </div>
            {/* 클릭 동작 없이 hover 툴팁만 — span 사용 */}
            <span title="종료일이 이 날짜보다 이전인데 진척률이 100% 미만이면 지연으로 계산합니다. 비워두면 실제 오늘 기준." style={{ ...helpBtnStyle, cursor: "help" }}>?</span>
            {asOfDate && (
              <button
                type="button"
                onClick={() => setAsOfDate("")}
                title="오늘 기준으로 되돌리기"
                style={resetBtnStyle}
              >
                오늘
              </button>
            )}
            <label
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: "var(--text-base)", color: "var(--color-text-secondary)", cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={delayOnly}
                onChange={(e) => setDelayOnly(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              지연만 보기
            </label>
            <button onClick={() => setHelpOpen(true)} title="도움말" style={helpBtnStyle}>?</button>
          </div>
        </div>
        <div
          style={{
            padding: "6px 16px", fontSize: "var(--text-base)", color: "var(--color-text-tertiary)",
            borderBottom: "1px solid var(--color-border-subtle)",
          }}
        >
          설계는 단위업무(공수 × 진척률), 구현은 기능(공수 × 진척률) 기준입니다 — 팀 부하 매트릭스(단위업무 마감일 기준)와 숫자가 다를 수 있습니다.
          {asOfDate && (
            <>
              {" "}<b style={{ color: "var(--color-brand)" }}>{asOfDate} 기준</b>으로 다시 계산한 값입니다(오늘 기준 아님).
            </>
          )}
        </div>
        <div className="sp-group-body" style={{ padding: 0 }}>
          {effLoading ? (
            <Skeleton />
          ) : effError ? (
            <ErrorBox message={effError.message} />
          ) : rows.length === 0 ? (
            <Empty />
          ) : (
            <MergedTable rows={rows} delayOnly={delayOnly} onMemberClick={setDetailMberId} />
          )}
        </div>
      </div>

      {helpOpen && <FormulaHelpModal onClose={() => setHelpOpen(false)} />}
      {detailMberId !== null && (
        <DelayDetailModal
          projectId={projectId}
          asOf={asOfDate || undefined}
          initialMberId={detailMberId || undefined}
          onClose={() => setDetailMberId(null)}
        />
      )}
    </>
  );
}

// ── 지연율 → 색 톤 (semantic 토큰만 사용 — 3테마 자동 대응) ──────────────────
function delayTone(pct: number): string {
  if (pct >= 80) return "var(--color-error)";
  if (pct >= 50) return "var(--color-warning)";
  return "var(--color-success)";
}

// ── 병합 표 — 멤버 | (설계: 화면·영역·지연율·지연공수) | (구현: 단위업무·화면·영역·기능·지연율·지연공수) ──
function MergedTable({
  rows, delayOnly, onMemberClick,
}: {
  rows: MergedRow[];
  delayOnly: boolean;
  /** 멤버 이름 클릭 시 그 멤버(mberId, 미할당이면 UNASSIGNED_MBER_KEY)로 상세 팝업을 연다 */
  onMemberClick: (mberId: string) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      {/* table-layout: fixed + 퍼센트 폭 — MissingStatusCard.tsx 와 동일한 이유(auto 레이아웃은
          폭 안 준 컬럼이 남는 공간을 혼자 흡수해 카드 오른쪽이 텅 비어 보인다). 10개 컬럼
          (멤버 1 + 설계 3 + 구현 6)에 고르게 나눠 카드 폭 전체를 채운다.
          설계는 2026-07-28 2차 개편으로 단위업무 기준 단일 축이 됨(화면/영역 세분화 폐지). */}
      <table style={{ borderCollapse: "collapse", fontSize: 15, width: "100%", tableLayout: "fixed", minWidth: 780 }}>
        <thead>
          <tr style={{ background: "var(--color-bg-muted)" }}>
            <th rowSpan={2} style={{ ...thStyle, width: "15%", verticalAlign: "bottom", borderBottom: "1px solid var(--color-border)" }}>멤버</th>
            <th colSpan={3} style={{ ...thGroupStyle, borderLeft: "1px solid var(--color-border)" }}>설계</th>
            <th colSpan={6} style={{ ...thGroupStyle, borderLeft: "1px solid var(--color-border)" }}>구현</th>
          </tr>
          <tr style={{ background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)" }}>
            <th style={{ ...thNumStyle, width: "9.4%", borderLeft: "1px solid var(--color-border)" }}>단위업무</th>
            <th style={{ ...thNumStyle, width: "9.4%" }}>지연율</th>
            <th style={{ ...thNumStyle, width: "9.4%" }}>지연 공수</th>
            <th style={{ ...thNumStyle, width: "9.4%", borderLeft: "1px solid var(--color-border)" }}>단위업무</th>
            <th style={{ ...thNumStyle, width: "9.4%" }}>화면</th>
            <th style={{ ...thNumStyle, width: "9.4%" }}>영역</th>
            <th style={{ ...thNumStyle, width: "9.4%" }}>기능</th>
            <th style={{ ...thNumStyle, width: "9.4%" }}>지연율</th>
            <th style={{ ...thNumStyle, width: "9.4%" }}>지연 공수</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = r.design;
            const i = r.impl;
            return (
              <tr key={r.mberId} style={{ borderBottom: "1px solid var(--color-border)" }}>
                {/* maxWidth 지정 안 함 — table-layout:fixed 에서는 헤더 행(th)의 width(15%)가
                    컬럼 폭을 결정하므로 이후 행의 td width/maxWidth는 무시된다 */}
                <td style={{ ...tdStyle, padding: 0 }}>
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
                {/* 설계 */}
                <td style={{ ...tdNumStyle, borderLeft: "1px solid var(--color-border-subtle)" }}>
                  {d ? (delayOnly ? d.unitWorkDelayed : d.unitWorkTotal) : "-"}
                </td>
                <td style={{ ...tdNumStyle, color: d ? delayTone(d.delayRate) : undefined, fontWeight: 600 }}>
                  {d ? `${Math.round(d.delayRate)}%` : "-"}
                </td>
                <td style={{ ...tdNumStyle, color: d && d.delayedEffortHours > 0 ? "var(--color-error)" : undefined }}>
                  {d ? `${hoursToDays(d.delayedEffortHours)}일` : "-"}
                </td>
                {/* 구현 */}
                <td style={{ ...tdNumStyle, borderLeft: "1px solid var(--color-border-subtle)" }}>
                  {i ? (delayOnly ? i.unitWorkDelayed : i.unitWorkTotal) : "-"}
                </td>
                <td style={tdNumStyle}>{i ? (delayOnly ? i.screenDelayed : i.screenTotal) : "-"}</td>
                <td style={tdNumStyle}>{i ? (delayOnly ? i.areaDelayed : i.areaTotal) : "-"}</td>
                <td style={tdNumStyle}>{i ? (delayOnly ? i.functionDelayed : i.functionTotal) : "-"}</td>
                <td style={{ ...tdNumStyle, color: i ? delayTone(i.delayRate) : undefined, fontWeight: 600 }}>
                  {i ? `${Math.round(i.delayRate)}%` : "-"}
                </td>
                <td style={{ ...tdNumStyle, color: i && i.delayedEffortHours > 0 ? "var(--color-error)" : undefined }}>
                  {i ? `${hoursToDays(i.delayedEffortHours)}일` : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── 지연율/지연 공수 계산법 도움말 팝업 — common-codes 페이지의 도움말 팝업과 같은 패턴 ──
function FormulaHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 90vw)", background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>지연율 · 지연 공수 계산법</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12, fontSize: 15, lineHeight: 1.7, color: "var(--color-text-primary)" }}>
          <div style={{ color: "var(--color-text-secondary)" }}>
            건수 비율이 아니라 <b>공수(工數)로 가중한 지연율</b>을 씁니다. 마감을 넘긴 항목이 몇 개인지보다,
            "실제로 얼마만큼의 작업이 밀렸는지"가 더 중요하기 때문입니다.
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>① 지연 판정</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              설계 = 단위업무의 계획설계 종료일이 지났고 그 하위 기능들의 설계 진척률 평균이 100% 미만.<br />
              구현 = 기능의 구현 종료일이 지났고 그 기능의 구현 진척률이 100% 미만.
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>② 지연 공수</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              지연 공수 = 공수 × (1 − 진척률 ÷ 100) — 즉 아직 끝나지 않은 만큼의 공수만 지연으로 계산합니다.
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--color-bg-muted)", border: "1px solid var(--color-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>③ 지연율</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              지연율(%) = (지연 공수 합계 ÷ 전체 공수 합계) × 100
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(46,125,50,0.08)", border: "1px solid rgba(46,125,50,0.25)" }}>
            <div style={{ fontWeight: 700, marginBottom: 2, color: "var(--color-success, #2e7d32)" }}>예시</div>
            <div style={{ color: "var(--color-text-secondary)" }}>
              기능 A: 10일 공수, 진척률 0% → 지연 공수 10일<br />
              기능 B: 1일 공수, 진척률 50% → 지연 공수 0.5일<br />
              둘 다 마감이 지났으니 건수로는 2/2 = 100% 지연이지만, 공수 기준 지연율은
              (10 + 0.5) ÷ (10 + 1) ≈ <b>95%</b> — 실제로 밀린 작업량에 훨씬 가깝습니다.
            </div>
          </div>
        </div>
      </div>
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
      담당자가 지정된 항목이 없습니다.
    </div>
  );
}

// ── 스타일 — admin/users/page.tsx 의 표 톤(연한 회색 헤더 + 화이트 바디)과 일관 ──
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: "var(--text-base)",
  fontWeight: 600,
  color: "var(--color-text-tertiary)",
};
const thGroupStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: "center",
  borderBottom: "1px solid var(--color-border-subtle)",
};
const thNumStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: "right",
  width: 76,
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

const helpBtnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 18, height: 18, borderRadius: "50%",
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)", fontSize: 12, fontWeight: 700,
  cursor: "pointer", lineHeight: 1, padding: 0,
};

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
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
