"use client";

/**
 * RevisionListDialog — DB 테이블 변경 이력 전체 목록 모달
 *
 * 역할:
 *   - 상세 화면에서 "전체 이력 보기" 버튼 클릭 시 뜨는 팝업
 *   - 내부에 RevisionList(페이지네이션 모드) 렌더
 *   - 행 [Diff] 클릭 시 RevisionDiffDialog 중첩 팝업
 *
 * 페이지 이동 없이 상세 화면 위에 오버레이로 표시.
 */

import { useState } from "react";
import RevisionList from "./RevisionList";
import RevisionDiffDialog from "./RevisionDiffDialog";

type Props = {
  projectId: string;
  tblId:     string;
  onClose:   () => void;
};

export default function RevisionListDialog({ projectId, tblId, onClose }: Props) {
  const [diffRevId, setDiffRevId] = useState<string | null>(null);

  return (
    <>
      <div className="sp-overlay" onClick={onClose}>
        <div
          className="sp-modal"
          onClick={(e) => e.stopPropagation()}
          style={{ width: 820, maxWidth: "calc(100vw - 32px)", maxHeight: "85vh", display: "flex", flexDirection: "column" }}
        >
          <div className="sp-modal-header">
            <span className="sp-modal-title">전체 변경 이력</span>
            <button type="button" onClick={onClose} style={closeBtnStyle} aria-label="닫기">×</button>
          </div>

          <div className="sp-modal-body" style={{ overflow: "auto", flex: 1 }}>
            <RevisionList
              projectId={projectId}
              tblId={tblId}
              onSelectRev={(revId) => setDiffRevId(revId)}
            />
          </div>

          <div className="sp-modal-footer">
            <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose}>닫기</button>
          </div>
        </div>
      </div>

      {/* Diff 팝업 (중첩 오버레이) — 전체 이력 모달 위에 표시 */}
      {diffRevId && (
        <RevisionDiffDialog
          projectId={projectId}
          tblId={tblId}
          revId={diffRevId}
          onClose={() => setDiffRevId(null)}
          onNavigate={(id) => setDiffRevId(id)}
        />
      )}
    </>
  );
}

// 사이트 표준 패턴: 박스 없이 텍스트만 (ImplRequestPopup 등과 동일)
const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border:     "none",
  cursor:     "pointer",
  fontSize:   20,
  lineHeight: 1,
  color:      "var(--color-text-tertiary)",
  padding:    0,
};
