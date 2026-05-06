"use client";

/**
 * ConfirmDeleteDialog — 키워드 입력 강제 확인 모달
 *
 * 정보 삭제 화면 전용 — execute API 호출 직전에 띄운다.
 * 단순 confirm 다이얼로그 대신 키워드를 정확히 입력해야만 실행 버튼이
 * 활성화된다. 오타 한 글자로도 막히게 — 실수 트리거 방지.
 *
 * 키워드는 호출자가 결정한다(props.keyword). 정적 "DELETE" 보다 건수가
 * 들어간 동적 키워드("DELETE 5") 가 휴먼 에러 방어에 강하다 — 운영자가
 * 매일 같은 단어만 누르다 무의식적으로 통과하는 사고를 차단.
 */

import { useState, useEffect, useId } from "react";

interface Props {
  open:        boolean;
  title:       string;
  /** 사용자에게 보여줄 본문 — 무엇이 사라지는지 / 경고 등 */
  description: React.ReactNode;
  /** 입력 강제할 키워드 — 호출자가 동적으로 결정 (예: "DELETE 5") */
  keyword:     string;
  /** 실행 버튼 라벨 (기본 "영구 삭제") */
  confirmLabel?: string;
  /** 비동기 실행 — Promise resolve/reject 로 모달 동작 결정 */
  onConfirm:   () => Promise<void>;
  onCancel:    () => void;
}

export function ConfirmDeleteDialog({
  open,
  title,
  description,
  keyword,
  confirmLabel = "영구 삭제",
  onConfirm,
  onCancel,
}: Props) {
  const [typed,  setTyped]  = useState("");
  const [busy,   setBusy]   = useState(false);
  const inputId = useId();

  // 모달이 열릴 때마다 입력값/busy 초기화 — 이전 상태 누수 방지
  useEffect(() => {
    if (open) {
      setTyped("");
      setBusy(false);
    }
  }, [open, keyword]);

  if (!open) return null;

  const ready = typed === keyword && !busy;

  const handleConfirm = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      // 모달은 호출자가 닫는다 (성공/실패 분기 후) — busy 만 해제
      setBusy(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
      style={{
        position:     "fixed",
        inset:        0,
        background:   "rgba(0,0,0,0.5)",
        zIndex:       1000,
        display:      "flex",
        alignItems:   "center",
        justifyContent:"center",
      }}
    >
      <div
        style={{
          background:   "var(--color-bg-card)",
          border:       "1px solid var(--color-border)",
          borderRadius: "var(--radius-card)",
          padding:      24,
          width:        "min(520px, 92vw)",
          display:      "grid",
          gap:          16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: "var(--text-lg)", color: "var(--color-text-heading)" }}>
          {title}
        </h2>

        <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
          {description}
        </div>

        <label htmlFor={inputId} style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            계속하려면 <code style={{ fontFamily: "var(--font-mono)" }}>{keyword}</code> 를 정확히 입력하세요.
          </span>
          <input
            id={inputId}
            className="sp-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            autoFocus
            placeholder={keyword}
            style={{ fontFamily: "var(--font-mono)" }}
          />
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="sp-btn sp-btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            취소
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-danger"
            onClick={handleConfirm}
            disabled={!ready}
          >
            {busy ? "처리 중…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
