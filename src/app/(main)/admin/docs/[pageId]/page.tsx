"use client";

/**
 * AdminDocsEditorPage — Docs 페이지 본문 편집기 (시스템 관리자 전용)
 *
 * 역할:
 *   - 페이지 단건 조회 → MarkdownEditor 로 본문 편집
 *   - 변경사항 추적 (dirty 플래그) → 저장 안 한 채 이탈 시 경고
 *   - 발행 토글 — 한 클릭으로 DRAFT ↔ PUBLISHED 전환
 *   - 인라인 이미지 업로드 — 본문 커서 위치에 ![](url) 자동 삽입
 *   - 별첨 관리 — 페이지 하단 "다운로드 파일" 영역
 *
 * URL: /admin/docs/[pageId]
 *
 * 데이터 패턴:
 *   - useQuery(["admin", "docs", "page", pageId])
 *   - 저장 후 invalidate → 트리/뷰어 캐시까지 함께 갱신
 *
 * 안전:
 *   - 본문(contentMd) 은 "명시적 저장 시"에만 서버 전송 (자동저장 미도입)
 *   - PUT 요청에 contentMd 미포함하면 서버는 본문 보존 → 메타만 바꾸는 토글이 안전
 */

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";
import ConfirmDialog from "@/components/common/ConfirmDialog";

// ── 타입 ──────────────────────────────────────────────────────────────────
type PageDetail = {
  pageId:      string;
  sectId:      string;
  pageSlug:    string;
  pageSj:      string;
  pageExcerpt: string | null;
  contentMd:   string;
  statusCode:  "DRAFT" | "PUBLISHED" | "ARCHIVED" | string;
  badgeCode:   string | null;
  sortOrdr:    number;
  useYn:       string;
  sectSlug:    string;
  sectNm:      string;
  createdAt:   string;
  updatedAt:   string | null;
};

type AttachKind = "INLINE" | "ATTACH";

type AttachItem = {
  fileId:    string;
  kind:      AttachKind;
  fileName:  string;
  fileSize:  number;
  extension: string;
  mimeType:  string;
  viewUrl:   string;
  uploadedAt: string;
};

// ── 페이지 본체 ───────────────────────────────────────────────────────────
type Props = { params: Promise<{ pageId: string }> };

export default function AdminDocsEditorPage({ params }: Props) {
  const { pageId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();

  // 페이지 단건 조회
  const { data, isLoading, error } = useQuery<PageDetail>({
    queryKey: ["admin", "docs", "page", pageId],
    queryFn:  () =>
      authFetch<{ data: PageDetail }>(`/api/admin/docs/pages/${pageId}`).then((r) => r.data),
    staleTime: 0, // 편집기는 항상 최신
    retry: false,
  });

  // 첨부 목록 — INLINE / ATTACH 모두 가져와서 화면에서 분리 표시
  const { data: attachData } = useQuery<{ items: AttachItem[] }>({
    queryKey: ["admin", "docs", "page", pageId, "files"],
    queryFn:  () =>
      authFetch<{ data: { items: AttachItem[] } }>(
        `/api/admin/docs/pages/${pageId}/files`
      ).then((r) => r.data),
    staleTime: 30 * 1000,
  });

  // 본문 로컬 상태 — data 가 도착하면 한 번만 초기화
  const [contentMd, setContentMd] = useState<string>("");
  const [dirty,     setDirty]     = useState<boolean>(false);
  const [tab,       setTab]       = useState<"edit" | "preview">("edit");
  const initializedRef = useRef(false);

  useEffect(() => {
    if (data && !initializedRef.current) {
      setContentMd(data.contentMd ?? "");
      initializedRef.current = true;
    }
  }, [data]);

  // 저장 안 한 채 이탈 시 경고 — 닫기/뒤로가기/새로고침 모두 잡힘
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // 본문 저장 뮤테이션 — contentMd 만 보냄 (메타는 보존)
  const saveBody = useMutation({
    mutationFn: () =>
      authFetch(`/api/admin/docs/pages/${pageId}`, {
        method: "PUT",
        body:   JSON.stringify({ contentMd }),
      }),
    onSuccess: () => {
      toast.success("본문이 저장되었습니다.");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["admin", "docs", "page", pageId] });
      qc.invalidateQueries({ queryKey: ["admin", "docs", "tree"] });
      qc.invalidateQueries({ queryKey: ["docs", "tree"] });
    },
    onError: (e: Error) => toast.error("저장 실패: " + e.message),
  });

  // 발행 상태 토글 — DRAFT ↔ PUBLISHED
  const togglePublish = useMutation({
    mutationFn: (next: "DRAFT" | "PUBLISHED") =>
      authFetch(`/api/admin/docs/pages/${pageId}`, {
        method: "PUT",
        body:   JSON.stringify({ statusCode: next }),
      }),
    onSuccess: (_resp, next) => {
      toast.success(next === "PUBLISHED" ? "공개되었습니다." : "비공개로 변경되었습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "docs", "page", pageId] });
      qc.invalidateQueries({ queryKey: ["admin", "docs", "tree"] });
      qc.invalidateQueries({ queryKey: ["docs", "tree"] });
    },
    onError: (e: Error) => toast.error("상태 변경 실패: " + e.message),
  });

  // Ctrl/Cmd + S 단축키 — 변경 사항이 있을 때만 저장
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (dirty && !saveBody.isPending) saveBody.mutate();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saveBody]);

  // ── 인라인 이미지 업로드 — 커서 위치에 ![](url) 삽입 ─────────────────────
  const editorTextareaRef = useRef<HTMLDivElement>(null); // textarea 의 부모 ref
  const inlineUploadRef   = useRef<HTMLInputElement>(null);

  function pickInlineImage() {
    inlineUploadRef.current?.click();
  }

  async function uploadInlineImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 가능하게
    if (!file) return;

    try {
      const ret = await uploadFile(pageId, file, "INLINE");
      const md = `\n![${ret.fileName}](${ret.viewUrl})\n`;
      insertAtCursor(md);
      toast.success("이미지를 본문에 삽입했습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "docs", "page", pageId, "files"] });
    } catch (err) {
      toast.error("업로드 실패: " + (err as Error).message);
    }
  }

  // 현재 textarea(편집 탭) 의 커서 위치에 텍스트 삽입
  function insertAtCursor(text: string) {
    const wrapper = editorTextareaRef.current;
    const ta = wrapper?.querySelector("textarea") as HTMLTextAreaElement | null;
    if (!ta) {
      // 미리보기 탭이거나 ref 없음 → 본문 끝에 추가
      setContentMd((cur) => cur + text);
      setDirty(true);
      return;
    }
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const next  = contentMd.substring(0, start) + text + contentMd.substring(end);
    setContentMd(next);
    setDirty(true);
    // 커서를 삽입한 텍스트 끝으로
    queueMicrotask(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + text.length;
    });
  }

  // ── 별첨 업로드 ──────────────────────────────────────────────────────────
  const attachUploadRef = useRef<HTMLInputElement>(null);
  async function uploadAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await uploadFile(pageId, file, "ATTACH");
      toast.success("첨부파일이 추가되었습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "docs", "page", pageId, "files"] });
    } catch (err) {
      toast.error("첨부 실패: " + (err as Error).message);
    }
  }

  // 첨부 삭제
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<AttachItem | null>(null);
  const deleteFile = useMutation({
    mutationFn: (fileId: string) =>
      authFetch(`/api/admin/docs/files/${fileId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("첨부가 삭제되었습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "docs", "page", pageId, "files"] });
      setConfirmDeleteFile(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inlineFiles = useMemo(
    () => (attachData?.items ?? []).filter((f) => f.kind === "INLINE"),
    [attachData]
  );
  const attachFiles = useMemo(
    () => (attachData?.items ?? []).filter((f) => f.kind === "ATTACH"),
    [attachData]
  );

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div style={loadingMsg}>페이지를 불러오는 중...</div>;
  }
  if (error || !data) {
    const msg = error instanceof Error ? error.message : "페이지를 찾을 수 없습니다.";
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: "var(--color-error)", marginBottom: 12 }}>{msg}</div>
        <Link href="/admin/docs" style={linkBtn}>← 문서 관리로</Link>
      </div>
    );
  }

  const isPublished = data.statusCode === "PUBLISHED";

  return (
    // 페이지 outer — 다른 admin 페이지(design-templates 등)와 동일한 패턴.
    // fullHeight + flex 체인은 깨지기 쉬워서 사용 안 함. 자연스러운 흐름 +
    // 에디터는 rows 기반 고정 높이로 안정적으로 큼직하게.
    <div>
      {/* 헤더 */}
      <div style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
        gap:            12,
        padding:        "10px 24px",
        background:     "var(--color-bg-card)",
        borderBottom:   "1px solid var(--color-border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <button
            onClick={() => {
              if (dirty && !confirm("저장하지 않은 변경사항이 있습니다. 정말 이동하시겠습니까?")) return;
              router.push("/admin/docs");
            }}
            style={smallButton}
          >
            ← 목록
          </button>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
            {data.sectNm} ›
          </span>
          <span style={{
            fontSize:   17,
            fontWeight: 700,
            color:      "var(--color-text-heading)",
            overflow:   "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {data.pageSj}
          </span>
          <StatusChip status={data.statusCode} />
          {dirty && <span style={dirtyChip}>● 변경됨</span>}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => togglePublish.mutate(isPublished ? "DRAFT" : "PUBLISHED")}
            disabled={togglePublish.isPending}
            style={isPublished ? secondaryButton : primaryButton}
            title={isPublished ? "공개를 취소하고 초안으로" : "사용자 뷰어에 공개"}
          >
            {isPublished ? "비공개로" : "공개로"}
          </button>
          <button
            onClick={() => saveBody.mutate()}
            disabled={!dirty || saveBody.isPending}
            style={{ ...primaryButton, opacity: !dirty ? 0.5 : 1 }}
          >
            {saveBody.isPending ? "저장 중..." : "본문 저장 (Ctrl+S)"}
          </button>
        </div>
      </div>

      {/* 에디터 툴바 */}
      <div style={{
        display:    "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap:        8,
        padding:    "8px 24px",
        background: "var(--color-bg-elevated)",
        borderBottom:"1px solid var(--color-border-subtle)",
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={pickInlineImage} style={smallButton}>🖼 이미지 삽입</button>
          <input
            ref={inlineUploadRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            style={{ display: "none" }}
            onChange={uploadInlineImage}
          />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
            인라인 이미지: jpg/png/gif/webp · 최대 5MB
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* 사용자 화면에서 보기 — 본문/이미지가 실제로 어떻게 보이는지 확인용
              에디터 미리보기 탭은 인증 이슈로 이미지가 깨지므로 권장 동선 */}
          <a
            href={`/docs/${data.sectSlug}/${data.pageSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            style={smallButton}
            title="새 탭에서 사용자 화면 미리보기"
          >
            🔎 사용자 화면
          </a>
          <MarkdownTabButtons tab={tab} onTabChange={setTab} />
        </div>
      </div>

      {/* 미리보기 탭일 때 — 이미지 401 안내 */}
      {tab === "preview" && (
        <div style={{
          padding:    "6px 24px",
          fontSize:   "var(--text-xs)",
          color:      "var(--color-warning)",
          background: "var(--color-warning-subtle)",
          borderBottom: "1px solid var(--color-warning-border)",
        }}>
          ℹ️ 미리보기 탭에서는 인증 이미지가 보이지 않을 수 있습니다. 실제 모습은 우측 상단 [🔎 사용자 화면] 버튼으로 확인하세요.
        </div>
      )}

      {/* 본문 에디터 — rows 고정 높이.
          fullHeight (flex chain) 는 부모 <main> 의 overflow:auto 등과 만나
          깨지기 쉬워 의도적으로 미사용. 다른 admin 페이지 패턴 동일.

          horizontal padding 을 12px 로 둔 이유:
            textarea 내부에 12px padding 이 있어 글자가 또 한 번 들여써지는데
            wrapper 24px + textarea 12px = 36px 가 되면 헤더(24px) 와 어긋남.
            wrapper 12px + textarea 12px = 24px 로 헤더와 정렬. */}
      <div ref={editorTextareaRef} style={{ padding: "12px 12px" }}>
        <MarkdownEditor
          value={contentMd}
          onChange={(v) => { setContentMd(v); setDirty(true); }}
          tab={tab}
          onTabChange={setTab}
          placeholder="# 페이지 제목&#10;&#10;여기에 Markdown 으로 작성..."
          rows={26}
        />
      </div>

      {/* 첨부 영역 — 본문이 주, 첨부는 보조이므로 컴팩트하게.
          각 섹션은 [+ 추가] 버튼 + 카운트만 한 줄에 노출.
          파일이 있을 때만 펼쳐서 목록 표시 (빈 상태에서는 줄만 차지) */}
      <div style={{
        padding:    "8px 24px 12px",
        borderTop:  "1px solid var(--color-border)",
        background: "var(--color-bg-card)",
      }}>
        <CompactAttachSection
          icon="📎"
          title="다운로드 첨부"
          files={attachFiles}
          actionLabel="+ 파일"
          onAdd={() => attachUploadRef.current?.click()}
          onDelete={(f) => setConfirmDeleteFile(f)}
        />
        <input
          ref={attachUploadRef}
          type="file"
          style={{ display: "none" }}
          onChange={uploadAttach}
        />
        <CompactAttachSection
          icon="🖼"
          title="본문 인라인 이미지"
          files={inlineFiles}
          // 인라인 추가는 본문 툴바의 [이미지 삽입] 으로만 — 여기는 목록·삭제 전용
          onDelete={(f) => setConfirmDeleteFile(f)}
          deleteHint="삭제 후 본문 markdown 의 ![](...) 부분도 함께 제거하세요."
        />
      </div>

      <ConfirmDialog
        open={!!confirmDeleteFile}
        title="첨부 삭제"
        description={
          confirmDeleteFile
            ? `"${confirmDeleteFile.fileName}" 파일을 삭제하시겠습니까?` +
              (confirmDeleteFile.kind === "INLINE"
                ? " 본문 markdown 의 이미지 링크는 자동 제거되지 않습니다."
                : "")
            : ""
        }
        confirmLabel="삭제"
        loading={deleteFile.isPending}
        onConfirm={() => confirmDeleteFile && deleteFile.mutate(confirmDeleteFile.fileId)}
        onCancel={() => setConfirmDeleteFile(null)}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트
// ────────────────────────────────────────────────────────────────────────
function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    DRAFT:     { label: "초안",   bg: "var(--color-bg-elevated)",    color: "var(--color-text-tertiary)" },
    PUBLISHED: { label: "공개",   bg: "var(--color-success-subtle)", color: "var(--color-success)" },
    ARCHIVED:  { label: "보관",   bg: "var(--color-warning-subtle)", color: "var(--color-warning)" },
  };
  const s = map[status] ?? map.DRAFT!;
  return (
    <span style={{
      fontSize:     "var(--text-xs)",
      fontWeight:   700,
      padding:      "2px 8px",
      borderRadius: "var(--radius-sm)",
      background:   s.bg,
      color:        s.color,
    }}>
      {s.label}
    </span>
  );
}

// 첨부 섹션 — 빈 상태에서는 한 줄, 파일이 있을 때만 펼쳐서 목록 표시.
// 본문이 주(主)이므로 첨부 영역이 세로 공간을 적게 잡도록 디자인.
function CompactAttachSection({
  icon, title, files, onAdd, actionLabel, onDelete, deleteHint,
}: {
  icon:         string;
  title:        string;
  files:        AttachItem[];
  onAdd?:       () => void;
  actionLabel?: string;
  onDelete:     (f: AttachItem) => void;
  deleteHint?:  string;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasFiles = files.length > 0;
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        display:    "flex",
        alignItems: "center",
        gap:        10,
        padding:    "4px 0",
      }}>
        {/* 토글 — 파일 있을 때만 펼침/접힘 의미. 빈 상태에서는 항상 펼쳐있음 표기 */}
        <button
          type="button"
          onClick={() => hasFiles && setExpanded((v) => !v)}
          style={{
            background: "transparent",
            border:     "none",
            cursor:     hasFiles ? "pointer" : "default",
            padding:    0,
            display:    "flex",
            alignItems: "center",
            gap:        6,
            fontSize:   "var(--text-sm)",
            fontWeight: 600,
            color:      "var(--color-text-heading)",
          }}
        >
          {hasFiles && (
            <span style={{
              width: 10, fontSize: 10,
              color: "var(--color-text-tertiary)",
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 0.15s",
            }}>▶</span>
          )}
          <span>{icon} {title} <span style={{
            color: "var(--color-text-tertiary)",
            fontWeight: 400,
          }}>({files.length})</span></span>
        </button>
        {onAdd && (
          <button onClick={onAdd} style={smallButton}>{actionLabel ?? "+ 추가"}</button>
        )}
      </div>
      {hasFiles && expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {files.map((f) => (
            <FileRow
              key={f.fileId}
              file={f}
              onDelete={() => onDelete(f)}
              hint={deleteHint}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ file, onDelete, hint }: {
  file:     AttachItem;
  onDelete: () => void;
  hint?:    string;
}) {
  return (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      gap:          10,
      padding:      "8px 12px",
      background:   "var(--color-bg-elevated)",
      border:       "1px solid var(--color-border-subtle)",
      borderRadius: "var(--radius-sm)",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize:     "var(--text-sm)",
          fontWeight:   500,
          color:        "var(--color-text-primary)",
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
        }}>
          {file.fileName}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: 2 }}>
          {formatBytes(file.fileSize)} · {file.extension.toUpperCase()}
          {hint && <span style={{ marginLeft: 8, color: "var(--color-warning)" }}>· {hint}</span>}
        </div>
      </div>
      <a
        href={`${file.viewUrl}${file.kind === "ATTACH" ? "?download=1" : ""}`}
        target="_blank"
        rel="noopener noreferrer"
        style={smallButton}
      >
        {file.kind === "ATTACH" ? "다운로드" : "보기"}
      </a>
      <button onClick={onDelete} style={{ ...smallButton, color: "var(--color-error)" }}>
        삭제
      </button>
    </div>
  );
}

// ── 파일 업로드 직접 fetch ───────────────────────────────────────────────
// authFetch 는 Content-Type: application/json 을 강제로 부착하므로 multipart
// 업로드에 부적합 (boundary 가 깨짐). 기존 프로젝트의 다른 업로드 화면
// (예: requirements/[reqId]/files) 도 동일한 이유로 fetch 직접 호출 패턴.
// 만료 시 401 자동 갱신은 받지 못하지만, 관리자 세션 재로그인으로 충분.
async function uploadFile(
  pageId: string,
  file:   File,
  kind:   "INLINE" | "ATTACH"
): Promise<{ fileName: string; viewUrl: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);

  const at =
    typeof window !== "undefined"
      ? (sessionStorage.getItem("access_token") ?? "")
      : "";

  const res = await fetch(`/api/admin/docs/pages/${pageId}/files`, {
    method:  "POST",
    headers: at ? { Authorization: `Bearer ${at}` } : {},
    body:    fd,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? "파일 업로드에 실패했습니다.");
  }

  const body = await res.json() as { data: { fileName: string; viewUrl: string } };
  return body.data;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── 스타일 ───────────────────────────────────────────────────────────────
const primaryButton: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  background: "var(--color-brand)",
  color: "var(--color-text-inverse)",
  border: "1px solid var(--color-brand)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
const secondaryButton: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: "var(--text-sm)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
const smallButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 28,
  padding: "0 10px",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  textDecoration: "none",
  boxSizing: "border-box",
};
const linkBtn: React.CSSProperties = {
  ...smallButton,
  background: "var(--color-brand-subtle)",
  color:      "var(--color-brand)",
  border:     "1px solid var(--color-brand-border)",
};
const dirtyChip: React.CSSProperties = {
  fontSize:     "var(--text-xs)",
  fontWeight:   700,
  padding:      "2px 8px",
  borderRadius: "var(--radius-sm)",
  background:   "var(--color-warning-subtle)",
  color:        "var(--color-warning)",
};
const loadingMsg: React.CSSProperties = {
  padding:        32,
  textAlign:      "center",
  color:          "var(--color-text-tertiary)",
  fontSize:       "var(--text-sm)",
};
