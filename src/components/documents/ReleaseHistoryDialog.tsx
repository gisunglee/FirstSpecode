"use client";

/**
 * ReleaseHistoryDialog — 산출물 발행 이력 모달
 *
 * 역할:
 *   - 발행 이력 목록 + [다운로드] 액션을 모달로 띄운다.
 *   - 페이지 본문에 인라인으로 섹션을 두지 않기 위한 컨테이너.
 *
 * 구조:
 *   ReleaseHistorySection 을 모달 안에서 그대로 재사용한다 (도메인 무관 표 + 다운로드 로직).
 *   섹션 자체에 카드 padding/제목/안내문이 들어 있어 모달 안에서 자연스럽게 보임.
 *
 * 사용:
 *   <ReleaseHistoryDialog
 *     open={isOpen}
 *     onClose={() => setIsOpen(false)}
 *     projectId={projectId}
 *     docKind="REQUIREMENT"
 *     refId={reqId}
 *     refreshTag={tag}
 *   />
 *
 * 발행 액션은 본 모달 안에 두지 않는다 (헤더 드롭다운의 [발행하기] 가 유일한 진입점).
 */

import ReleaseHistorySection from "@/components/documents/ReleaseHistorySection";
import type { ReleaseDocKind } from "@/components/common/ReleaseDialog";

type Props = {
  open:       boolean;
  onClose:    () => void;
  projectId:  string;
  docKind:    ReleaseDocKind;
  refId:      string;
  /** 외부에서 trigger 가능한 강제 재조회 — 발행 직후 +1 시키면 모달 열렸을 때 즉시 반영 */
  refreshTag?: number;
};

export default function ReleaseHistoryDialog({
  open,
  onClose,
  projectId,
  docKind,
  refId,
  refreshTag,
}: Props) {
  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={onClose} role="presentation">
      <div
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-history-title"
      >
        {/* ReleaseHistorySection 내부에 카드 padding/제목/안내가 다 있어 그대로 사용 */}
        <ReleaseHistorySection
          projectId={projectId}
          docKind={docKind}
          refId={refId}
          refreshTag={refreshTag}
        />

        <div style={footerStyle}>
          <button onClick={onClose} style={closeBtnStyle}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// ─── 스타일 (ConfirmDialog/SettingsHistoryDialog 패턴과 통일) ─────────────
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
  // 내부 ReleaseHistorySection 이 자체 카드 padding 을 가지므로 외부 padding 0
  padding:      0,
  width:        "100%",
  maxWidth:     880,
  maxHeight:    "85vh",
  overflow:     "auto",
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
  border:       "1px solid var(--color-border)",
};

const footerStyle: React.CSSProperties = {
  display:        "flex",
  justifyContent: "flex-end",
  padding:        "12px 20px",
  borderTop:      "1px solid var(--color-border-subtle)",
};

const closeBtnStyle: React.CSSProperties = {
  padding:      "6px 16px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     13,
  cursor:       "pointer",
};
