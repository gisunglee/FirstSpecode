"use client";

/**
 * MemoEditModal — 메모 추가/편집 전용 모달 (화면 중앙, 크게)
 *
 * 역할:
 *   - MemoPopover(작은 목록 팝오버)에서 타일/"새 메모"를 클릭하면 이 모달이 별도로 뜬다.
 *   - 목록 팝오버는 그 뒤에 계속 열려있는 채로 둔다 — 저장/삭제 시 자동으로 최신화됨
 *     (MemoDetailPanel의 mutation이 memos-popover 쿼리를 무효화하기 때문).
 *   - 내용 편집(웹 에디터/엑셀 표)이 들어가는 화면이라 목록 팝오버보다 기본 크기를
 *     훨씬 크게 잡고, 가로/세로/전체화면 버튼으로 더 키울 수 있게 한다.
 *
 * compact를 켜는 이유: MemoDetailPanel의 기본(비compact) 스타일은 풀페이지 기준
 * 여백(20px/24px, 헤더 52px)이라 이 모달 안에 넣으면 정작 편집기 영역보다 위쪽
 * 배지·제목 카드가 공간을 훨씬 많이 잡아먹는 문제가 있었음(실제 확인됨).
 *
 * 바깥 클릭으로 안 닫히는 이유 + 저장 후에도 안 닫는 이유: 편집 중 실수로 배경을
 * 클릭해서 내용을 날리는 걸 막기 위해 — 닫기는 우측 상단 ✕ 버튼으로만.
 * 저장 후에도 안 닫히는 이유는 저장 직후 리스트 팝오버를 즉시 다시 열면 최신화가 안 된
 * 채로 보였다가 새로고침하면 맞는(React Query 캐시 레이스) 문제가 있었는데, 저장 직후
 * 모달을 닫아 컴포넌트를 바로 언마운트하던 게 원인 중 하나였다 — 계속 켜둔 채로 두면
 * 같은 컴포넌트가 그대로 갱신되어 이 레이스가 사라진다. 신규 작성 저장 후에는 memoId를
 * "new"에서 실제 id로 바꿔치기해서 그대로 편집 모드로 이어간다(재생성 방지).
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import MemoDetailPanel from "./MemoDetailPanel";

// 기존 대비 20% 키움("기본 사이즈 더 크게" 피드백)
const WIDTH_STEPS  = [768, 1032, 1296];
const HEIGHT_STEPS = [768, 960, 1152];

type Props = {
  projectId:      string;
  memoId:         string; // "new" 또는 실제 id
  presetRefType?: string;
  presetRefId?:   string;
  onClose:        () => void;
  // 저장 성공 시 호출 — 모달은 닫지 않고, 신규였다면 실제 id로 전환해서 편집을 이어간다
  onSaved:        (savedMemoId: string) => void;
};

export default function MemoEditModal({ projectId, memoId, presetRefType, presetRefId, onClose, onSaved }: Props) {
  // 기본값부터 넉넉하게 — "내용 쓰는 화면이 너무 작다"는 피드백 반영
  const [widthIdx, setWidthIdx]   = useState(1);
  const [heightIdx, setHeightIdx] = useState(1);
  const [isFull, setIsFull]       = useState(false);

  const width  = isFull ? "96vw" : WIDTH_STEPS[widthIdx];
  const height = isFull ? "92vh" : HEIGHT_STEPS[heightIdx];
  // 실제 편집기에 넘길 픽셀 높이 계산 — FULL 모드는 vh라 window 기준으로 직접 환산
  const heightPx = isFull
    ? (typeof window !== "undefined" ? Math.round(window.innerHeight * 0.92) : 900)
    : HEIGHT_STEPS[heightIdx];

  return createPortal(
    <>
      {/* 바깥 클릭으로 닫히지 않음 — 편집 중 실수 클릭으로 내용을 잃지 않도록 의도적으로 onClick 없음 */}
      <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "var(--color-bg-overlay)" }} />
      <div
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width, height, maxWidth: "96vw", maxHeight: "92vh", zIndex: 301,
          background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
          borderRadius: 12, boxShadow: "0 16px 48px rgba(0,0,0,0.28)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 가로/세로/FULL/닫기를 별도 줄로 안 두고 MemoDetailPanel 헤더(타이틀 옆)에
            끼워 넣는다 — 줄 하나를 통째로 아껴서 편집 영역에 더 준다는 피드백 반영 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <MemoDetailPanel
            projectId={projectId}
            memoId={memoId}
            presetRefType={presetRefType}
            presetRefId={presetRefId}
            onBack={onClose}
            onSaved={onSaved}
            onDeleted={onClose}
            compact
            sheetHeight={Math.max(400, heightPx - 130)}
            richMinHeight={Math.max(280, heightPx - 210)}
            headerExtra={
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => { setIsFull(false); setWidthIdx((i) => (i + 1) % WIDTH_STEPS.length); }}
                  style={ctrlBtnStyle}
                  title={`가로 크기 조절 (${WIDTH_STEPS[widthIdx]}px)`}
                >
                  ↔ 가로
                </button>
                <button
                  onClick={() => { setIsFull(false); setHeightIdx((i) => (i + 1) % HEIGHT_STEPS.length); }}
                  style={ctrlBtnStyle}
                  title={`세로 크기 조절 (${HEIGHT_STEPS[heightIdx]}px)`}
                >
                  ↕ 세로
                </button>
                <button
                  onClick={() => setIsFull((v) => !v)}
                  style={isFull ? { ...ctrlBtnStyle, background: "var(--color-brand)", color: "var(--color-text-inverse)", borderColor: "var(--color-brand)" } : ctrlBtnStyle}
                  title="전체 화면 크기로 보기"
                >
                  ⛶ FULL
                </button>
                <button onClick={onClose} style={{ ...ctrlBtnStyle, fontSize: 14, padding: "5px 8px" }} title="닫기">
                  ✕
                </button>
              </div>
            }
          />
        </div>
      </div>
    </>,
    document.body,
  );
}

// border를 shorthand로 두면 FULL 버튼처럼 borderColor만 골라 덮어쓰는 곳에서
// React가 "리렌더 중 borderColor 제거 시 border와 충돌" 에러를 던진다(실제 재현됨).
// shorthand/longhand를 섞지 않도록 처음부터 개별 속성으로 선언한다.
const ctrlBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 3, fontSize: 11.5, fontWeight: 600,
  padding: "5px 10px", borderRadius: 6, cursor: "pointer",
  borderWidth: 1, borderStyle: "solid", borderColor: "var(--color-border)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
};
