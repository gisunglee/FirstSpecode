"use client";

/**
 * ExcalidrawDialog — Excalidraw 팝업 다이얼로그
 *
 * 역할:
 *   - 트리거 버튼 클릭 시 전체 화면 크기 팝업으로 Excalidraw 캔버스 열기
 *   - 저장 버튼 클릭 시 JSON 직렬화 후 onSave 콜백 호출
 *   - 이미지 파일 데이터(files) 포함하여 저장
 *
 * 주요 기술:
 *   - next/dynamic으로 SSR 비활성화 (Excalidraw은 브라우저 전용)
 *   - collaborators Map 복원 처리 (JSON 직렬화 시 일반 객체로 변환되는 문제 해결)
 */

// Excalidraw 전용 스타일
import "@excalidraw/excalidraw/index.css";

import { useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";

type ExcalidrawAPI = {
  getSceneElements: () => unknown[];
  getAppState:      () => unknown;
  getFiles:         () => Record<string, unknown>;
};

// Excalidraw은 SSR 불가 — next/dynamic으로 lazy load
const ExcalidrawComponent = dynamic(
  async () => {
    const { Excalidraw } = await import("@excalidraw/excalidraw");
    return Excalidraw;
  },
  {
    ssr: false,
    loading: () => (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-text-secondary)", fontSize: 14 }}>
        Excalidraw 로딩 중...
      </div>
    ),
  }
);

interface ExcalidrawDialogProps {
  /** 저장된 Excalidraw JSON 오브젝트 (null이면 빈 캔버스) */
  value:    object | null;
  /** 저장 버튼 클릭 시 호출 — JSON 오브젝트 전달 */
  onSave:   (data: object) => void;
  /** 저장 중 여부 */
  saving?:  boolean;
  /** 버튼 레이블 (기본: "디자인 설계") */
  label?:   string;
}

export default function ExcalidrawDialog({ value, onSave, saving, label = "디자인 설계" }: ExcalidrawDialogProps) {
  const [open,     setOpen]     = useState(false);
  const [mountKey, setMountKey] = useState(0);
  const apiRef = useRef<ExcalidrawAPI | null>(null);

  const handleOpen = useCallback(() => {
    setMountKey((k) => k + 1);
    setOpen(true);
  }, []);

  // collaborators는 Map인데 JSON 직렬화 시 일반 객체로 변환됨 → 제거 후 복원
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialData: any = (() => {
    if (!value) return undefined;
    try {
      const parsed = value as Record<string, unknown>;
      const appState = parsed.appState as Record<string, unknown> | undefined;
      const { collaborators: _c, ...restAppState } = appState ?? {};
      return {
        elements: parsed.elements ?? [],
        appState: restAppState,
        files:    parsed.files ?? {},
      };
    } catch {
      return undefined;
    }
  })();

  const handleSave = useCallback(() => {
    if (!apiRef.current) return;
    const elements = apiRef.current.getSceneElements();
    const appState = apiRef.current.getAppState();
    const files    = apiRef.current.getFiles();
    onSave({ elements, appState, files });
  }, [onSave]);

  const hasData = value != null && (
    Array.isArray((value as Record<string, unknown>).elements)
      ? ((value as Record<string, unknown>).elements as unknown[]).length > 0
      : false
  );

  return (
    <>
      {/* 트리거 버튼 */}
      <button
        onClick={handleOpen}
        style={{
          padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-card)",
          color: "var(--color-text-primary)",
          display: "inline-flex", alignItems: "center", gap: 5,
        }}
      >
        ✏️ {label}
        {hasData && (
          <span style={{ fontSize: 10, color: "var(--color-primary, #1976d2)", fontWeight: 700 }}>●</span>
        )}
      </button>

      {/* 팝업 오버레이 */}
      {open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9000,
            background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{
              width: "calc(100vw - 48px)", height: "calc(100vh - 48px)",
              background: "#fff", borderRadius: 10,
              display: "flex", flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 헤더 */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 20px",
              borderBottom: "1px solid var(--color-border)",
              flexShrink: 0, background: "var(--color-bg-card)",
            }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
                디자인 설계 — Excalidraw
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setOpen(false)}
                  style={{ padding: "5px 14px", borderRadius: 6, fontSize: 13, cursor: "pointer", border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)" }}
                >
                  닫기
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{ padding: "5px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: "var(--color-primary, #1976d2)", color: "#fff", opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>

            {/* Excalidraw 캔버스 */}
            <div style={{ flex: 1, minHeight: 0 }}>
              {open && (
                <ExcalidrawComponent
                  key={mountKey}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  excalidrawAPI={async (api: any) => {
                    apiRef.current = api;
                    try {
                      const res = await fetch("/excalidraw-libs/ui-wireframe.excalidrawlib");
                      const lib = await res.json();
                      api.updateLibrary({ libraryItems: lib.libraryItems, merge: false, openLibraryMenu: false });
                    } catch { /* 라이브러리 로드 실패 시 무시 */ }
                  }}
                  initialData={initialData}
                  theme="light"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
