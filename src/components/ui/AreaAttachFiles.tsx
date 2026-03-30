"use client";

/**
 * AreaAttachFiles — 영역 첨부파일 업로드/관리 컴포넌트
 *
 * 역할:
 *   - 이미지: 썸네일 카드 그리드 표시 (blob URL로 인증 우회)
 *   - 파일: 컴팩트 행 표시
 *   - Ctrl+V 클립보드 이미지 붙여넣기 (이 컴포넌트에 마우스가 있을 때만)
 *   - req_ref_yn 체크박스 오버레이
 *   - 파일 삭제
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";

// ── 타입 ────────────────────────────────────────────────────────────────────

type AttachFile = {
  fileId:     string;
  fileName:   string;
  fileSize:   number;
  extension:  string;
  fileType:   string;   // "IMAGE" | "FILE"
  reqRefYn:   string;   // "Y" | "N"
  uploadedAt: string;
};

type Props = {
  /** API 기본 경로 (예: /api/projects/{id}/areas/{areaId} 또는 /api/projects/{id}/functions/{funcId}) */
  basePath: string;
};

// ── 인증 이미지 컴포넌트 ─────────────────────────────────────────────────────
// <img src> 는 Authorization 헤더를 못 붙이므로, fetch로 blob URL 생성 후 표시

function useAuthBlobUrl(src: string) {
  const [blobUrl, setBlobUrl] = useState("");

  useEffect(() => {
    const at = typeof window !== "undefined" ? (sessionStorage.getItem("access_token") ?? "") : "";
    let objectUrl = "";

    fetch(src, { headers: at ? { Authorization: `Bearer ${at}` } : {} })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        }
      })
      .catch(() => {});

    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);

  return blobUrl;
}

function AuthThumb({ src, onClick }: { src: string; onClick?: () => void }) {
  const blobUrl = useAuthBlobUrl(src);
  return (
    <img
      src={blobUrl || undefined}
      alt=""
      onClick={onClick}
      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 4, cursor: onClick ? "zoom-in" : "default" }}
    />
  );
}

// ── 라이트박스 ───────────────────────────────────────────────────────────────

function Lightbox({ src, fileName, onClose }: { src: string; fileName: string; onClose: () => void }) {
  const blobUrl = useAuthBlobUrl(src);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--color-bg-card, #fff)", borderRadius: 10, boxShadow: "0 12px 48px rgba(0,0,0,0.35)", overflow: "hidden", maxWidth: "min(800px, 90vw)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 600 }}>{fileName}</span>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#999", lineHeight: 1, padding: "0 0 0 12px", flexShrink: 0 }}>×</button>
        </div>

        {/* 이미지 */}
        <div style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
          {blobUrl ? (
            <img src={blobUrl} alt={fileName} style={{ maxWidth: "100%", maxHeight: "calc(90vh - 80px)", objectFit: "contain", borderRadius: 4 }} />
          ) : (
            <div style={{ padding: "40px 60px", color: "#aaa", fontSize: 13 }}>로딩 중...</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function AreaAttachFiles({ basePath }: Props) {
  const queryClient  = useQueryClient();
  const queryKey     = ["attachFiles", basePath];
  const isHovered    = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<{ fileId: string; fileName: string } | null>(null);

  // ── 목록 조회 ──────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      authFetch<{ data: { items: AttachFile[] } }>(`${basePath}/files`).then((r) => r.data),
  });
  const files = data?.items ?? [];

  // ── 업로드 뮤테이션 ────────────────────────────────────────────────────────
  const uploadMutation = useMutation({
    mutationFn: async (fileList: File[]) => {
      const formData = new FormData();
      fileList.forEach((f) => formData.append("files", f));
      // authFetch는 Content-Type: application/json을 강제하므로 raw fetch 사용
      const at  = typeof window !== "undefined" ? (sessionStorage.getItem("access_token") ?? "") : "";
      const res = await fetch(`${basePath}/files`, {
        method:  "POST",
        body:    formData,
        headers: at ? { Authorization: `Bearer ${at}` } : {},
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { message?: string }).message ?? "업로드 실패");
      }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success("업로드되었습니다."); },
    onError:   (err: Error) => toast.error(err.message),
  });

  // ── 삭제 뮤테이션 ─────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (fileId: string) =>
      authFetch(`${basePath}/files/${fileId}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success("삭제되었습니다."); },
    onError:   (err: Error) => toast.error(err.message),
  });

  // ── req_ref_yn 토글 ───────────────────────────────────────────────────────
  const toggleRefMutation = useMutation({
    mutationFn: ({ fileId, reqRefYn }: { fileId: string; reqRefYn: string }) =>
      authFetch(`${basePath}/files/${fileId}`, {
        method: "PATCH",
        body:   JSON.stringify({ reqRefYn }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError:   (err: Error) => toast.error(err.message),
  });

  // ── Ctrl+V ────────────────────────────────────────────────────────────────
  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!isHovered.current) return;
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
    if (imageFiles.length > 0) { e.preventDefault(); uploadMutation.mutate(imageFiles); }
  }, [uploadMutation]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > 0) uploadMutation.mutate(selected);
    e.target.value = "";
  }

  function fmtSize(bytes: number) {
    if (bytes < 1024)        return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  const imageFiles = files.filter((f) => f.fileType === "IMAGE");
  const otherFiles = files.filter((f) => f.fileType !== "IMAGE");

  // ── 렌더링 ───────────────────────────────────────────────────────────────
  return (
    <div
      onMouseEnter={() => { isHovered.current = true;  }}
      onMouseLeave={() => { isHovered.current = false; }}
    >
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          {isLoading ? "로딩 중..." : `${files.length}개`}
          {uploadMutation.isPending && " · 업로드 중..."}
        </span>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending} style={uploadBtnStyle}>
          파일 선택
        </button>
        <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={handleFileChange} />
      </div>

      {/* Ctrl+V 힌트 */}
      <p style={{ margin: "0 0 10px", fontSize: 11, color: "var(--color-text-muted, #bbb)" }}>
        이미지 복사 후 마우스를 올리고 Ctrl+V
      </p>

      {files.length === 0 && !isLoading ? (
        <div style={{ padding: "16px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
          첨부파일이 없습니다.
        </div>
      ) : (
        <>
          {/* 이미지 썸네일 그리드 */}
          {imageFiles.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8, marginBottom: otherFiles.length > 0 ? 10 : 0 }}>
              {imageFiles.map((file) => (
                <div key={file.fileId} style={thumbCardStyle}>
                  {/* 썸네일 — 클릭 시 라이트박스 */}
                  <div style={{ width: "100%", height: 72, overflow: "hidden", borderRadius: "4px 4px 0 0", background: "var(--color-bg-muted, #f0f0f0)" }}>
                    <AuthThumb
                      src={`${basePath}/files/${file.fileId}/view`}
                      onClick={() => setLightbox({ fileId: file.fileId, fileName: file.fileName })}
                    />
                  </div>

                  {/* req_ref_yn 체크박스 — 이미지 좌상단 오버레이 */}
                  <label style={refOverlayStyle} title="AI 참조 여부">
                    <input
                      type="checkbox"
                      checked={file.reqRefYn === "Y"}
                      onChange={(e) => toggleRefMutation.mutate({ fileId: file.fileId, reqRefYn: e.target.checked ? "Y" : "N" })}
                      style={{ width: 12, height: 12, cursor: "pointer" }}
                    />
                  </label>

                  {/* 삭제 버튼 — 우상단 오버레이 */}
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(file.fileId)}
                    style={thumbDeleteBtnStyle}
                    title="삭제"
                  >
                    ×
                  </button>

                  {/* 파일명 */}
                  <div style={{ padding: "4px 6px", fontSize: 10, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {file.fileName}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 일반 파일 목록 (컴팩트 행) */}
          {otherFiles.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {otherFiles.map((file) => (
                <div key={file.fileId} style={fileRowStyle}>
                  {/* 참조 체크박스 */}
                  <label style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={file.reqRefYn === "Y"}
                      onChange={(e) => toggleRefMutation.mutate({ fileId: file.fileId, reqRefYn: e.target.checked ? "Y" : "N" })}
                      style={{ width: 12, height: 12 }}
                    />
                    <span style={{ fontSize: 10, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>참조</span>
                  </label>

                  <span style={{ fontSize: 13, flexShrink: 0 }}>📄</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {file.fileName}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>
                      {fmtSize(file.fileSize)} · {file.extension.toUpperCase()}
                    </div>
                  </div>

                  <button type="button" onClick={() => deleteMutation.mutate(file.fileId)} style={rowDeleteBtnStyle} title="삭제">×</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {/* 라이트박스 */}
      {lightbox && (
        <Lightbox
          src={`${basePath}/files/${lightbox.fileId}/view`}
          fileName={lightbox.fileName}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────────────────

const uploadBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--color-bg-elevated, #f5f5f5)",
  border: "1px solid var(--color-border)",
  borderRadius: 5,
  fontSize: 12,
  cursor: "pointer",
  color: "var(--color-text-primary)",
};

const thumbCardStyle: React.CSSProperties = {
  position:     "relative",
  border:       "1px solid var(--color-border)",
  borderRadius: 6,
  overflow:     "hidden",
  background:   "var(--color-bg-card)",
};

const refOverlayStyle: React.CSSProperties = {
  position:   "absolute",
  top:        4,
  left:       4,
  background: "rgba(255,255,255,0.85)",
  borderRadius: 3,
  padding:    "2px 3px",
  cursor:     "pointer",
  display:    "flex",
  alignItems: "center",
};

const thumbDeleteBtnStyle: React.CSSProperties = {
  position:   "absolute",
  top:        2,
  right:      4,
  background: "rgba(0,0,0,0.45)",
  border:     "none",
  borderRadius: "50%",
  width:      18,
  height:     18,
  color:      "#fff",
  fontSize:   13,
  lineHeight: "18px",
  textAlign:  "center",
  cursor:     "pointer",
  padding:    0,
};

const fileRowStyle: React.CSSProperties = {
  display:      "flex",
  alignItems:   "center",
  gap:          8,
  padding:      "6px 8px",
  background:   "var(--color-bg-elevated, #fafafa)",
  border:       "1px solid var(--color-border)",
  borderRadius: 5,
};

const rowDeleteBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  background: "none",
  border:     "none",
  cursor:     "pointer",
  fontSize:   15,
  color:      "#bbb",
  padding:    0,
  lineHeight: 1,
};
