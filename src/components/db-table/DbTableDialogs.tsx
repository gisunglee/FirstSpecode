"use client";

/**
 * DbTableDialogs — DB 테이블 상세 페이지의 경량 확인 다이얼로그 모음
 *
 * 포함 컴포넌트:
 *   - LgclNameWarnDialog:  논리 컬럼명 누락 경고 → 사용자 확인 후 저장
 *   - DeleteTableConfirmDialog: 테이블 삭제 확인 (영향도 경고 포함)
 *
 * 설계:
 *   - 두 다이얼로그 모두 "확인 → onConfirm 콜백" 의 단순 패턴이라 한 파일에 묶음
 *   - 상위 페이지는 open / onClose / onConfirm + 필요한 context 만 내려주면 됨
 *   - 색상은 semantic 토큰만 사용 (3테마 자동 대응)
 */

import { useEscapeKey } from "@/hooks/useEscapeKey";

// ── 공용 스타일 ──────────────────────────────────────────────────────────────

const backdropStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  borderRadius: 10,
  padding: "28px 32px",
  minWidth: 360, maxWidth: 500,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};

const footerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "6px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "transparent",
  color: "var(--color-text-secondary)",
  fontSize: 13, cursor: "pointer",
};

// ── 1. 논리 컬럼명 누락 경고 ─────────────────────────────────────────────────

type LgclNameWarnProps = {
  open:       boolean;
  missing:    number;         // 논리명 누락 개수
  onClose:    () => void;
  onConfirm:  () => void;      // 누락 무시하고 저장
  busy?:      boolean;
};

export function LgclNameWarnDialog({ open, missing, onClose, onConfirm, busy }: LgclNameWarnProps) {
  useEscapeKey(onClose, open);
  if (!open) return null;

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>논리 컬럼명 누락</p>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          논리 컬럼명이 없는 컬럼이 <strong style={{ color: "var(--color-warning)" }}>{missing}개</strong> 있습니다.<br />
          나중에 입력하고, 지금은 이대로 저장하시겠습니까?
        </p>
        <div style={footerStyle}>
          <button type="button" style={cancelBtnStyle} onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            style={{
              padding: "6px 16px", borderRadius: 6, border: "none",
              background: "var(--color-brand)", color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
            onClick={onConfirm}
            disabled={busy}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 2. 테이블 삭제 확인 (영향도 경고 포함) ──────────────────────────────────

type ImpactCounts = {
  functionCount: number;
  areaCount:     number;
  screenCount:   number;
};

type DeleteConfirmProps = {
  open:       boolean;
  tableName:  string;            // 물리명 (code 태그로 표시)
  colCount:   number;             // 하위 컬럼 수
  impact?:    ImpactCounts;        // 매핑 영향도 (있으면 경고 표시)
  onClose:    () => void;
  onConfirm:  () => void;
  busy?:      boolean;
};

export function DeleteTableConfirmDialog({
  open, tableName, colCount, impact, onClose, onConfirm, busy,
}: DeleteConfirmProps) {
  useEscapeKey(onClose, open);
  if (!open) return null;

  // 매핑 참조가 하나라도 있는지 (없으면 영향도 경고 박스 자체를 숨김)
  const hasImpact = impact && (impact.functionCount + impact.areaCount + impact.screenCount) > 0;

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>테이블을 삭제하시겠습니까?</p>
        <p style={{ margin: "0 0 6px", fontSize: 14, color: "var(--color-text-secondary)" }}>
          <code style={{
            fontFamily: "monospace",
            background: "var(--color-bg-muted)",
            padding: "1px 6px", borderRadius: 4,
          }}>
            {tableName}
          </code>
        </p>
        {colCount > 0 && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-error)" }}>
            ⚠ 하위 컬럼 {colCount}개도 함께 삭제됩니다.
          </p>
        )}

        {/* 매핑 영향도 경고 — 참조가 있을 때만
             warning semantic 토큰 사용 → 3테마 자동 대응 */}
        {hasImpact && impact && (
          <div style={{
            marginTop: 14, padding: "10px 12px",
            background:   "var(--color-warning-subtle)",
            border:       "1px solid var(--color-warning-border)",
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-warning)", marginBottom: 4 }}>
              ⚠ 이 테이블은 현재 다음 설계 산출물에서 참조 중입니다
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--color-warning)", lineHeight: 1.6 }}>
              {impact.functionCount > 0 && <li>기능 <strong>{impact.functionCount}</strong>개</li>}
              {impact.areaCount > 0 && <li>영역 <strong>{impact.areaCount}</strong>개</li>}
              {impact.screenCount > 0 && <li>화면 <strong>{impact.screenCount}</strong>개</li>}
            </ul>
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--color-text-secondary)" }}>
              삭제 시 해당 산출물의 컬럼 매핑이 끊어집니다. 계속 진행하시겠습니까?
            </div>
          </div>
        )}

        <div style={footerStyle}>
          <button type="button" style={cancelBtnStyle} onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            style={{
              padding: "6px 16px", borderRadius: 6, border: "none",
              background: "var(--color-error)", color: "#fff",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}
