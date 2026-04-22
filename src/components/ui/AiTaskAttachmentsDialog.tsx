"use client";

/**
 * AiTaskAttachmentsDialog — AI 태스크 첨부 자료 보기 모달 (공용)
 *
 * 역할:
 *   - AI 태스크 상세/이력 다이얼로그에서 "첨부 자료 보기" 클릭 시 열리는 팝업
 *   - 읽기 전용: 업로드/삭제/수정 없음 (AI 요청 시점에 확정된 자료만 표시)
 *   - 이미지: 썸네일 그리드 + 클릭 시 라이트박스 확대
 *   - 비이미지: 파일명·크기·다운로드 버튼
 *
 * 향후 확장 여지 (모달 방식으로 inline보다 유연):
 *   - 파일별 코멘트/설명 추가
 *   - AI 참조 여부 토글 표시
 *   - 다중 선택 후 일괄 다운로드
 *
 * Props:
 *   projectId, taskId — 조회 대상
 *   onClose           — 모달 닫기 콜백
 *
 * 인증:
 *   - 목록 조회: authFetch (JWT)
 *   - 이미지 썸네일/다운로드: fetch + Authorization 헤더 (AreaAttachFiles의 AuthThumb 패턴과 동일)
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  projectId: string;
  taskId:    string;
  onClose:   () => void;
};

// ── 인증 헤더 fetch → blob URL 훅 ───────────────────────────────────────────
// <img src>에는 Authorization 헤더를 붙일 수 없어 blob URL 경유가 필수

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
      .catch(() => { /* 렌더링에서는 빈 src로 폴백 처리 */ });

    // unmount / src 변경 시 이전 blob URL 해제 — 메모리 누수 방지
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

// ── 라이트박스 (이미지 확대 보기) ──────────────────────────────────────────

function Lightbox({
  src, fileName, onClose, onDownload,
}: {
  src: string; fileName: string; onClose: () => void; onDownload: () => void;
}) {
  const blobUrl = useAuthBlobUrl(src);

  // ESC로 닫힘 — 외부 모달도 ESC로 닫힌다면 라이트박스가 먼저 닫히도록 stopPropagation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  return (
    <div
      // Lightbox 는 Attachments overlay 위에 떠 있으므로 부모 overlay 로의 이벤트 전파를 막음
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1300,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-bg-card, #fff)", borderRadius: 10,
          boxShadow: "0 12px 48px rgba(0,0,0,0.45)", overflow: "hidden",
          maxWidth: "min(90vw, 1200px)", maxHeight: "90vh",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* 헤더 — 파일명 + 다운로드/닫기 버튼 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", borderBottom: "1px solid var(--color-border)",
          gap: 10,
        }}>
          <span style={{
            fontSize: 13, color: "var(--color-text-secondary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1, minWidth: 0,
          }}>
            {fileName}
          </span>
          <button
            type="button"
            onClick={onDownload}
            style={{
              padding: "4px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600,
              border: "1px solid var(--color-border)", background: "var(--color-bg-elevated, #f5f5f5)",
              color: "var(--color-text-primary)", cursor: "pointer", flexShrink: 0,
            }}
          >
            ↓ 다운로드
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "#999", lineHeight: 1, padding: 0, flexShrink: 0 }}
          >
            ×
          </button>
        </div>

        {/* 이미지 */}
        <div style={{
          padding: 16, display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "auto", background: "var(--color-bg-muted, #fafafa)",
        }}>
          {blobUrl ? (
            <img
              src={blobUrl}
              alt={fileName}
              style={{ maxWidth: "100%", maxHeight: "calc(90vh - 80px)", objectFit: "contain", borderRadius: 4 }}
            />
          ) : (
            <div style={{ padding: "40px 60px", color: "#aaa", fontSize: 13 }}>로딩 중...</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────

export default function AiTaskAttachmentsDialog({ projectId, taskId, onClose }: Props) {
  const basePath = `/api/projects/${projectId}/ai-tasks/${taskId}`;

  const { data, isLoading, error } = useQuery({
    queryKey: ["ai-task-attachments", projectId, taskId],
    queryFn:  () => authFetch<{ data: { items: AttachFile[] } }>(`${basePath}/files`).then((r) => r.data),
    // 기본 재시도 off — 404/403 등 실제 에러를 즉시 UI에 노출
    retry: false,
  });
  const files = data?.items ?? [];

  const [lightbox, setLightbox] = useState<{ fileId: string; fileName: string } | null>(null);

  // ESC 핸들러 — 라이트박스가 열려 있으면 그쪽이 먼저 가로챔 (capture phase + stopPropagation)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // 다운로드 — Authorization 헤더 필요하므로 blob fetch 후 anchor 트릭
  // (href 직접 지정은 헤더를 못 붙여서 401 발생)
  async function handleDownload(fileId: string, fileName: string) {
    try {
      const at = typeof window !== "undefined" ? (sessionStorage.getItem("access_token") ?? "") : "";
      const res = await fetch(`${basePath}/files/${fileId}/view`, {
        headers: at ? { Authorization: `Bearer ${at}` } : {},
      });
      if (!res.ok) throw new Error(`다운로드 실패 (${res.status})`);
      const blob = await res.blob();

      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href     = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "다운로드에 실패했습니다.");
    }
  }

  function fmtSize(bytes: number) {
    if (bytes < 1024)        return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  const imageFiles = files.filter((f) => f.fileType === "IMAGE");
  const otherFiles = files.filter((f) => f.fileType !== "IMAGE");

  return (
    <div
      // 부모 다이얼로그(AiTaskDetailDialog)의 overlay 로 클릭 이벤트가 전파되면 부모까지 닫힘.
      // stopPropagation 으로 이 모달만 닫히도록 한다.
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1200,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background:   "var(--color-bg-card)",
          border:       "1px solid var(--color-border)",
          borderRadius: 10,
          boxShadow:    "0 12px 40px rgba(0,0,0,0.25)",
          width:        "min(90vw, 720px)",
          maxHeight:    "80vh",
          display:      "flex",
          flexDirection: "column",
          overflow:     "hidden",
        }}
      >
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>
              첨부 자료
            </span>
            <span style={{
              fontSize: 11, fontWeight: 600,
              padding: "2px 8px", borderRadius: 10,
              background: "var(--color-bg-muted)", color: "var(--color-text-secondary)",
            }}>
              {isLoading ? "…" : files.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "#999", lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {isLoading ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#aaa", fontSize: 13 }}>
              로딩 중...
            </div>
          ) : error ? (
            /*
             * 조회 실패 — 404(라우트 미인식) / 403(권한) / 500(DB) 등을 숨기지 않고 명시적으로 표시
             * "첨부 자료 없음"과 구분되어야 진단 가능
             */
            <div style={{
              padding: "24px 20px", textAlign: "center",
              background: "#fff5f5", border: "1px solid #fecaca", borderRadius: 6,
              color: "#c62828", fontSize: 13, lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>첨부 자료 조회에 실패했습니다.</div>
              <div style={{ fontSize: 12, color: "#e53935" }}>
                {error instanceof Error ? error.message : "알 수 없는 오류"}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 10 }}>
                개발 서버를 재시작하거나 권한 설정을 확인해 주세요.
              </div>
            </div>
          ) : files.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#aaa", fontSize: 13 }}>
              첨부 자료가 없습니다.
            </div>
          ) : (
            <>
              {/* 이미지 썸네일 그리드 — 클릭 시 라이트박스 확대 */}
              {imageFiles.length > 0 && (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                  gap: 10,
                  marginBottom: otherFiles.length > 0 ? 16 : 0,
                }}>
                  {imageFiles.map((file) => (
                    <div
                      key={file.fileId}
                      style={{
                        position:     "relative",
                        border:       "1px solid var(--color-border)",
                        borderRadius: 6,
                        overflow:     "hidden",
                        background:   "var(--color-bg-card)",
                      }}
                    >
                      <div style={{
                        width: "100%", height: 90, overflow: "hidden",
                        background: "var(--color-bg-muted, #f0f0f0)",
                      }}>
                        <AuthThumb
                          src={`${basePath}/files/${file.fileId}/view`}
                          onClick={() => setLightbox({ fileId: file.fileId, fileName: file.fileName })}
                        />
                      </div>
                      <div style={{
                        padding: "4px 6px",
                        fontSize: 10,
                        color: "var(--color-text-secondary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {file.fileName}
                      </div>
                      <div style={{ padding: "0 6px 4px", fontSize: 9, color: "var(--color-text-muted, #bbb)" }}>
                        {fmtSize(file.fileSize)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 비이미지 파일 — 행 + 다운로드 버튼 */}
              {otherFiles.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {otherFiles.map((file) => (
                    <div
                      key={file.fileId}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 12px",
                        background: "var(--color-bg-elevated, #fafafa)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 6,
                      }}
                    >
                      <span style={{ fontSize: 16, flexShrink: 0 }}>📄</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, color: "var(--color-text-primary)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {file.fileName}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                          {fmtSize(file.fileSize)} · {file.extension.toUpperCase()}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownload(file.fileId, file.fileName)}
                        style={{
                          padding: "4px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600,
                          border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
                          color: "var(--color-text-primary)", cursor: "pointer", flexShrink: 0,
                        }}
                      >
                        ↓ 다운로드
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 라이트박스 — 이미지 확대 + 다운로드 */}
      {lightbox && (
        <Lightbox
          src={`${basePath}/files/${lightbox.fileId}/view`}
          fileName={lightbox.fileName}
          onClose={() => setLightbox(null)}
          onDownload={() => handleDownload(lightbox.fileId, lightbox.fileName)}
        />
      )}
    </div>
  );
}
