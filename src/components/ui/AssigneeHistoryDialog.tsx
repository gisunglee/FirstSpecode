"use client";

/**
 * AssigneeHistoryDialog — 담당자 변경 이력 전용 경량 다이얼로그 (공통)
 *
 * 역할:
 *   - tb_ds_design_change 기반 이력 조회 (chg_rsn_cn="담당자")
 *   - SettingsHistoryDialog(diff 뷰어)와 달리 선택·비교·삭제 없이 단순 타임라인
 *   - 단위업무/과업/요구사항/화면 4개 엔티티에서 공유 사용
 *
 * API: GET /api/projects/[id]/design-history?refTblNm=xxx&refId=xxx&itemName=담당자
 *   응답 item: { histId, version, changedBy, changedAt, afterVal, beforeVal }
 *   (design-history 라우트가 snapshot의 beforeName/afterName을 우선 사용하므로
 *    afterVal/beforeVal에는 이미 이름이 들어있음 — 퇴장 멤버도 보존)
 *
 * 사용 예:
 *   <AssigneeHistoryDialog
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     projectId={projectId}
 *     refTblNm="tb_ds_screen"
 *     refId={screenId}
 *     currentAssigneeName={detail?.assignMemberName ?? ""}
 *   />
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type HistoryItem = {
  histId:    string;
  version:   number;
  changedBy: string;
  changedAt: string;
  afterVal:  string;
  beforeVal: string;
};

export type AssigneeHistoryDialogProps = {
  open:                 boolean;
  onClose:              () => void;
  projectId:            string;
  refTblNm:             string;
  refId:                string;
  /** 현재 담당자 이름 — 헤더 상단에 표시. 미지정이면 빈 문자열 */
  currentAssigneeName?: string;
};

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function AssigneeHistoryDialog({
  open,
  onClose,
  projectId,
  refTblNm,
  refId,
  currentAssigneeName = "",
}: AssigneeHistoryDialogProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["design-history", projectId, refTblNm, refId, "담당자"],
    queryFn:  () =>
      authFetch<{ data: { items: HistoryItem[] } }>(
        `/api/projects/${projectId}/design-history`
          + `?refTblNm=${encodeURIComponent(refTblNm)}`
          + `&refId=${encodeURIComponent(refId)}`
          + `&itemName=${encodeURIComponent("담당자")}`
      ).then((r) => r.data.items),
    enabled: open,
  });
  const items = data ?? [];

  if (!open) return null;

  // 이력은 서버에서 최신(chg_dt desc) 순으로 내려옴 — 그대로 렌더
  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={dialogStyle}>
        {/* 헤더 */}
        <div style={headerStyle}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
            담당자 변경 이력
          </span>
          <button onClick={onClose} style={closeBtnStyle} title="닫기">×</button>
        </div>

        {/* 현재 담당자 */}
        <div style={currentRowStyle}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>
            현재
          </span>
          <span style={{
            fontSize: 13,
            color: currentAssigneeName ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
            fontWeight: 500,
          }}>
            {currentAssigneeName || "담당자 없음"}
          </span>
        </div>

        {/* 이력 리스트 */}
        <div style={listAreaStyle}>
          {isLoading ? (
            <div style={emptyStyle}>불러오는 중…</div>
          ) : items.length === 0 ? (
            <div style={emptyStyle}>변경 이력이 없습니다.</div>
          ) : (
            <ul style={listStyle}>
              {items.map((h) => (
                <li key={h.histId} style={itemStyle}>
                  {/* 상단: 날짜 + 변경자 */}
                  <div style={metaRowStyle}>
                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                      {formatDt(h.changedAt)}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                      by {h.changedBy}
                    </span>
                  </div>
                  {/* 하단: before → after */}
                  <div style={changeRowStyle}>
                    <NameChip value={h.beforeVal} />
                    <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>→</span>
                    <NameChip value={h.afterVal} highlight />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 서브 컴포넌트 ────────────────────────────────────────────────────────────

function NameChip({ value, highlight }: { value: string; highlight?: boolean }) {
  const isEmpty = !value?.trim();
  return (
    <span style={{
      display:      "inline-flex",
      alignItems:   "center",
      padding:      "3px 10px",
      borderRadius: 12,
      fontSize:     12,
      fontWeight:   highlight ? 600 : 500,
      border:       "1px solid var(--color-border)",
      background:   highlight ? "var(--color-brand-subtle)" : "var(--color-bg-muted)",
      color:        isEmpty
                      ? "var(--color-text-tertiary)"
                      : (highlight ? "var(--color-brand)" : "var(--color-text-primary)"),
      whiteSpace:   "nowrap",
    }}>
      {isEmpty ? "없음" : value}
    </span>
  );
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

/** ISO 날짜를 "26.4.22. 14:30" 형태로 간결하게 표시 */
function formatDt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const y   = String(d.getFullYear()).slice(2);
  const m   = d.getMonth() + 1;
  const day = d.getDate();
  const hh  = String(d.getHours()).padStart(2, "0");
  const mm  = String(d.getMinutes()).padStart(2, "0");
  return `${y}.${m}.${day}. ${hh}:${mm}`;
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(0,0,0,0.4)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  zIndex:         1200,
};

const dialogStyle: React.CSSProperties = {
  background:    "var(--color-bg-card)",
  borderRadius:  10,
  width:         440,
  maxWidth:      "92vw",
  maxHeight:     "80vh",
  display:       "flex",
  flexDirection: "column",
  boxShadow:     "0 12px 40px rgba(0,0,0,0.25)",
  overflow:      "hidden",
};

const headerStyle: React.CSSProperties = {
  display:        "flex",
  alignItems:     "center",
  justifyContent: "space-between",
  padding:        "12px 16px",
  borderBottom:   "1px solid var(--color-border)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border:     "none",
  fontSize:   20,
  lineHeight: 1,
  color:      "var(--color-text-secondary)",
  cursor:     "pointer",
  padding:    "0 4px",
};

// 현재 담당자 표시 행
const currentRowStyle: React.CSSProperties = {
  display:     "flex",
  alignItems:  "center",
  gap:         10,
  padding:     "10px 16px",
  background:  "var(--color-bg-muted)",
  borderBottom:"1px solid var(--color-border)",
};

// 이력 리스트 스크롤 영역
const listAreaStyle: React.CSSProperties = {
  flex:      1,
  overflow:  "auto",
  padding:   "4px 0",
};

const emptyStyle: React.CSSProperties = {
  padding:   "32px 16px",
  textAlign: "center",
  fontSize:  13,
  color:     "var(--color-text-tertiary)",
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin:    0,
  padding:   0,
};

const itemStyle: React.CSSProperties = {
  padding:       "10px 16px",
  borderBottom:  "1px solid var(--color-border)",
  display:       "flex",
  flexDirection: "column",
  gap:           6,
};

const metaRowStyle: React.CSSProperties = {
  display:        "flex",
  justifyContent: "space-between",
  alignItems:     "center",
};

const changeRowStyle: React.CSSProperties = {
  display:    "flex",
  alignItems: "center",
  gap:        8,
  flexWrap:   "wrap",
};
