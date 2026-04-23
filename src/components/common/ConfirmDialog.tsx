"use client";

/**
 * ConfirmDialog — 삭제/위험 작업 확인 다이얼로그
 *
 * 역할:
 *   - 삭제 등 위험한 작업 전 사용자 확인을 받는 모달
 *   - window.confirm() 대신 반드시 이 컴포넌트를 사용할 것
 *     (window.confirm은 브라우저마다 UI가 다르고 UX가 최악임)
 *
 * 구현 메모:
 *   - 프로젝트 내 다른 inline DeleteConfirmDialog(screens/areas 등)들과 동일한
 *     오버레이·다이얼로그 스타일 패턴을 사용하여 시각적 일관성 유지
 *   - 과거 버전은 Tailwind utility 클래스를 사용했으나 일부 환경에서 렌더링이
 *     깨지는 문제가 있어 CSS 변수 기반 inline style로 통일
 *
 * 사용 예:
 *   <ConfirmDialog
 *     open={isOpen}
 *     title="사용자 삭제"
 *     description="정말 삭제하시겠습니까?"
 *     onConfirm={handleDelete}
 *     onCancel={() => setIsOpen(false)}
 *   />
 */

type ConfirmDialogProps = {
  open:         boolean;
  title:        string;
  description:  string;
  confirmLabel?: string;
  cancelLabel?:  string;
  loading?:     boolean;
  onConfirm:    () => void;
  onCancel:     () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "확인",
  cancelLabel  = "취소",
  loading      = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // 닫혀 있으면 렌더링하지 않음 — DOM에서 완전히 제거
  if (!open) return null;

  return (
    // 배경 오버레이 — 바깥 영역 클릭 시 닫기
    <div
      style={overlayStyle}
      onClick={onCancel}
      role="presentation"
    >
      {/* 다이얼로그 본체 — 클릭 이벤트 버블링 차단 */}
      <div
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h3
          id="confirm-dialog-title"
          style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}
        >
          {title}
        </h3>
        <p
          style={{ margin: "0 0 24px", fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.5 }}
        >
          {description}
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{ ...secondaryBtnStyle, fontSize: 13, padding: "6px 14px" }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            // 위험 작업이므로 danger 색상 — 다른 inline dialog 패턴과 일치
            style={{
              ...primaryBtnStyle,
              fontSize: 13,
              padding: "6px 14px",
              background: "var(--color-error, #e53935)",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "처리 중..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────
// screens/page.tsx 등 inline dialog 패턴과 동일하게 맞춰 시각적 일관성 유지

const overlayStyle: React.CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(0,0,0,0.45)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  zIndex:         1000,
};

const dialogStyle: React.CSSProperties = {
  background:   "var(--color-bg-card)",
  borderRadius: 10,
  padding:      "24px 28px",
  minWidth:     380,
  maxWidth:     480,
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
  border:       "1px solid var(--color-border)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding:      "8px 20px",
  borderRadius: 6,
  border:       "1px solid transparent",
  background:   "var(--color-primary, #1976d2)",
  color:        "#fff",
  fontSize:     14,
  fontWeight:   600,
  cursor:       "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding:      "8px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  cursor:       "pointer",
};
