"use client";

/**
 * AiTaskFilePicker — AI 요청 팝업용 FE 전용 이미지 피커
 *
 * 역할:
 *   - AI 태스크 요청 전에 사용자가 첨부할 이미지를 선택
 *   - 선택된 파일은 서버에 업로드하지 않고 상위 컴포넌트 state(File[])에만 보관
 *   - "요청" 버튼을 누를 때 multipart/form-data로 한 번에 전송됨 (부모 책임)
 *
 * 왜 AreaAttachFiles를 재사용하지 않는가:
 *   - AreaAttachFiles는 서버 기반(즉시 업로드 + DB 저장). 여기는 태스크 생성 전이라
 *     taskId가 없음 → 메모리 전용의 훨씬 단순한 피커가 필요
 *
 * 기능:
 *   - 파일 선택 버튼 + 드래그&드롭 + Ctrl+V 클립보드 붙여넣기
 *   - 선택된 이미지의 blob URL 썸네일 그리드 (unmount 시 자동 revoke)
 *   - 개별 × 버튼으로 항목 제거
 *   - 크기(10MB) / 개수(10장) 제한 — 서버 유틸(aiTaskAttach.ts)과 동일한 상수
 *
 * Props:
 *   files    — 현재 선택된 파일 목록 (부모 state)
 *   onChange — 파일 목록 변경 콜백
 *   disabled — 비활성화 (요청 전송 중 방지)
 */

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { toast } from "sonner";

// ── 제약 (aiTaskAttach.ts와 동일해야 함) ──────────────────────────────────
// 이 값을 바꿀 때는 서버 유틸도 반드시 함께 수정할 것
const MAX_FILE_SIZE  = 10 * 1024 * 1024; // 10MB
const MAX_FILE_COUNT = 10;

type Props = {
  files:     File[];
  onChange:  (files: File[]) => void;
  disabled?: boolean;
};

export default function AiTaskFilePicker({ files, onChange, disabled = false }: Props) {
  // Ctrl+V 활성 조건 — 이 컴포넌트 위에 마우스가 있을 때만 반응
  const isHovered    = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // ── blob URL 관리 ──────────────────────────────────────────────────────────
  // files가 바뀔 때마다 새 blob URL 생성, 이전 URL은 useEffect cleanup에서 revoke
  const blobUrls = useMemo(() => {
    return files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : ""));
  }, [files]);

  useEffect(() => {
    // 컴포넌트 unmount 또는 다음 files 변경 직전에 이전 URL 정리
    // (메모리 누수 방지 — Chrome DevTools Memory에서 dangling Blob 보이면 이것 때문)
    return () => {
      blobUrls.forEach((url) => { if (url) URL.revokeObjectURL(url); });
    };
  }, [blobUrls]);

  // ── 파일 추가 (제약 적용) ──────────────────────────────────────────────────
  // 합산 개수/크기 검증 후 state 업데이트
  const addFiles = useCallback((newFiles: File[]) => {
    if (disabled || newFiles.length === 0) return;
    const combined = [...files, ...newFiles];
    if (combined.length > MAX_FILE_COUNT) {
      toast.error(`최대 ${MAX_FILE_COUNT}장까지 첨부할 수 있습니다.`);
      return;
    }
    const oversized = newFiles.find((f) => f.size > MAX_FILE_SIZE);
    if (oversized) {
      toast.error(`"${oversized.name}" 크기가 ${MAX_FILE_SIZE / 1024 / 1024}MB를 초과합니다.`);
      return;
    }
    onChange(combined);
  }, [files, onChange, disabled]);

  function removeAt(idx: number) {
    if (disabled) return;
    const next = files.slice();
    next.splice(idx, 1);
    onChange(next);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > 0) addFiles(selected);
    // 같은 파일 다시 선택 가능하도록 value 초기화 (브라우저 기본 동작 회피)
    e.target.value = "";
  }

  // ── Ctrl+V 클립보드 이미지 ─────────────────────────────────────────────────
  // document level paste 리스너 — 이 컴포넌트 호버 상태일 때만 동작
  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!isHovered.current || disabled) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const ext = item.type.split("/")[1] ?? "png";
          imageFiles.push(new File([file], `clipboard_${Date.now()}.${ext}`, { type: item.type }));
        }
      }
    }
    if (imageFiles.length > 0) { e.preventDefault(); addFiles(imageFiles); }
  }, [addFiles, disabled]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  // ── 드래그&드롭 ────────────────────────────────────────────────────────────
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length > 0) addFiles(dropped);
  }

  function fmtSize(bytes: number) {
    if (bytes < 1024)        return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  // ── 렌더링 ────────────────────────────────────────────────────────────────
  return (
    <div
      onMouseEnter={() => { isHovered.current = true;  }}
      onMouseLeave={() => { isHovered.current = false; }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        padding:      8,
        border:       dragOver ? "2px dashed var(--color-primary, #1976d2)" : "1px dashed var(--color-border)",
        borderRadius: 6,
        background:   dragOver ? "rgba(25,118,210,0.05)" : "transparent",
        transition:   "all 0.15s ease",
      }}
    >
      {/* 헤더 — 안내 + "파일 선택" 버튼 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: files.length > 0 ? 8 : 0,
      }}>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
          {files.length > 0
            ? `${files.length}/${MAX_FILE_COUNT}개 · 이미지 참조 (Ctrl+V / 드래그)`
            : "이미지를 드래그 / Ctrl+V / 파일 선택"}
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || files.length >= MAX_FILE_COUNT}
          style={{
            padding:      "3px 10px",
            borderRadius: 4,
            fontSize:     11,
            fontWeight:   600,
            border:       "1px solid var(--color-border)",
            background:   "var(--color-bg-elevated, #f5f5f5)",
            color:        "var(--color-text-primary)",
            cursor:       disabled || files.length >= MAX_FILE_COUNT ? "not-allowed" : "pointer",
            opacity:      disabled || files.length >= MAX_FILE_COUNT ? 0.5 : 1,
          }}
        >
          파일 선택
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>

      {/* 썸네일 그리드 */}
      {files.length > 0 && (
        <div style={{
          display:             "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
          gap:                 6,
        }}>
          {files.map((file, idx) => (
            <div
              key={`${file.name}-${idx}-${file.lastModified}`}
              style={{
                position:     "relative",
                border:       "1px solid var(--color-border)",
                borderRadius: 4,
                overflow:     "hidden",
                background:   "var(--color-bg-card)",
              }}
            >
              {blobUrls[idx] ? (
                <img
                  src={blobUrls[idx]}
                  alt={file.name}
                  style={{ width: "100%", height: 60, objectFit: "cover", display: "block" }}
                />
              ) : (
                <div style={{
                  height: 60, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16, color: "var(--color-text-secondary)",
                }}>
                  📄
                </div>
              )}

              {/* × 삭제 버튼 */}
              <button
                type="button"
                onClick={() => removeAt(idx)}
                disabled={disabled}
                title="삭제"
                style={{
                  position:     "absolute",
                  top:          2,
                  right:        2,
                  background:   "rgba(0,0,0,0.6)",
                  color:        "#fff",
                  border:       "none",
                  borderRadius: "50%",
                  width:        16,
                  height:       16,
                  fontSize:     11,
                  lineHeight:   "16px",
                  cursor:       disabled ? "not-allowed" : "pointer",
                  padding:      0,
                }}
              >
                ×
              </button>

              {/* 파일명 + 크기 */}
              <div style={{
                padding:      "2px 4px",
                fontSize:     9,
                color:        "var(--color-text-secondary)",
                overflow:     "hidden",
                textOverflow: "ellipsis",
                whiteSpace:   "nowrap",
              }}>
                {file.name}
              </div>
              <div style={{ padding: "0 4px 3px", fontSize: 9, color: "var(--color-text-muted, #bbb)" }}>
                {fmtSize(file.size)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
