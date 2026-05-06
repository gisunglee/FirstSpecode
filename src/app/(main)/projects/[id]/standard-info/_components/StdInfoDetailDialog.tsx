"use client";

/**
 * StdInfoDetailDialog — 기준 정보 상세 조회 다이얼로그
 *
 * 역할:
 *   - 행 클릭으로 열림. 코드/유형/주요값/보조값/기간/사용/설명을 표시.
 *   - 하단 [닫기 / 삭제 / 수정] 액션 — 삭제·수정 클릭 시 부모로 콜백 전달.
 *   - 오버레이 클릭으로 닫힘.
 *
 * 주요 기술:
 *   - 모든 색상 semantic 토큰 사용 (3테마 자동 대응)
 *   - 부모와의 결합도 낮춤 — 데이터 + 콜백만 받음
 */

import { type StdInfo, DATA_TYPE_LABEL, getCategoryColor, formatDate } from "../_constants";

type Props = {
  target:     StdInfo;
  onClose:    () => void;
  onEdit:     (target: StdInfo) => void;
  onDelete:   (target: StdInfo) => void;
};

export function StdInfoDetailDialog({ target, onClose, onEdit, onDelete }: Props) {
  const v = target;
  const ctgryColor = getCategoryColor(v.bizCtgryNm);
  const period     = formatDate(v.stdBgngDe) + (v.stdEndDe ? ` ~ ${formatDate(v.stdEndDe)}` : " ~");

  // 표시할 필드 정의 — 코드 변경 시 이 배열만 수정하면 됨
  const fields: Array<{ label: string; value: string }> = [
    { label: "코드",     value: v.stdInfoCode },
    { label: "유형",     value: DATA_TYPE_LABEL[v.stdDataTyCode] ?? v.stdDataTyCode },
    { label: "주요 값",  value: v.mainStdVal || "—" },
    { label: "보조 값",  value: v.subStdVal  || "—" },
    { label: "기간",     value: period },
    { label: "사용",     value: v.useYn === "Y" ? "사용" : "미사용" },
    { label: "설명",     value: v.stdInfoDc  || "—" },
  ];

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={{ ...dialogStyle, minWidth: 480, maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              display: "inline-block", padding: "2px 8px", borderRadius: 12,
              background: ctgryColor.bg, color: ctgryColor.text,
              fontSize: 11, fontWeight: 700,
              maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {v.bizCtgryNm || "—"}
            </span>
            <h3 style={{
              margin: 0, fontSize: 16, fontWeight: 700,
              color: "var(--color-text-primary)",
            }}>
              {v.stdInfoNm}
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 18, color: "var(--color-text-secondary)",
              lineHeight: 1, padding: "0 2px",
            }}
          >
            ×
          </button>
        </div>

        {/* 상세 내용 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {fields.map(({ label, value }) => (
            <div
              key={label}
              style={{
                display: "grid", gridTemplateColumns: "80px 1fr",
                gap: 8, alignItems: "flex-start",
              }}
            >
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: "var(--color-text-secondary)",
              }}>
                {label}
              </span>
              <span style={{
                fontSize: 13, color: "var(--color-text-primary)",
                whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* 액션 버튼 */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={secondaryBtnStyle}>닫기</button>
          <button onClick={() => onDelete(v)} style={dangerBtnStyle}>삭제</button>
          <button onClick={() => onEdit(v)}   style={primaryBtnStyle}>수정</button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 (모두 토큰 사용) ──────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "var(--color-bg-overlay)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  borderRadius: 12, padding: "24px 28px",
  boxShadow: "var(--shadow-lg)",
  color: "var(--color-text-primary)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "7px 20px", borderRadius: 6,
  border: "none",
  background: "var(--color-brand)",
  color: "var(--color-text-inverse)",
  fontSize: 13, fontWeight: 600, cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  background: "var(--color-error)",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "7px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
  fontSize: 13, cursor: "pointer",
};
