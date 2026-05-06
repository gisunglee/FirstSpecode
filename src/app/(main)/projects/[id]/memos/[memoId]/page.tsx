"use client";

/**
 * MemoDetailPage — 메모 상세/편집/신규 (/projects/[id]/memos/[memoId])
 *
 * 역할:
 *   - memoId="new" → 신규 작성 모드
 *   - 기존 메모 → 조회 + 편집 모드 (본인 메모만 편집 가능)
 *   - RichEditor(이미지 업로드 지원)로 내용 작성
 *   - 공유 여부 토글, 연결 대상 표시
 */

import { Suspense, useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import dynamic from "next/dynamic";
// TipTap 번들이 초기 로드에 포함되지 않도록 dynamic import
const RichEditor = dynamic(() => import("@/components/ui/RichEditor"), { ssr: false });

// ── 타입 ──────────────────────────────────────────────────────────────────────

type MemoDetail = {
  memoId:        string;
  subject:       string;
  content:       string;
  shareYn:       string;
  refTyCode:     string | null;
  refId:         string | null;
  viewCnt:       number;
  creatMberId:   string;
  creatMberName: string;
  isMine:        boolean;
  creatDt:       string;
  mdfcnDt:       string | null;
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

const REF_TYPE_LABEL: Record<string, string> = {
  FUNCTION:  "기능",
  AREA:      "영역",
  SCREEN:    "화면",
  UNIT_WORK: "단위업무",
};

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, "0")}. ${String(d.getDate()).padStart(2, "0")}. ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function MemoDetailPage() {
  return (
    <Suspense fallback={null}>
      <MemoDetailInner />
    </Suspense>
  );
}

function MemoDetailInner() {
  const { id: projectId, memoId } = useParams<{ id: string; memoId: string }>();
  const router       = useRouter();
  const queryClient  = useQueryClient();
  const searchParams = useSearchParams();

  const isNew = memoId === "new";

  // URL 쿼리에서 연결 대상 프리셋 (상세 페이지에서 "메모 추가" 시)
  const presetRefType = searchParams.get("refType") ?? undefined;
  const presetRefId   = searchParams.get("refId") ?? undefined;

  // ── 폼 상태 ──
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [shareYn, setShareYn] = useState("N");
  const [refTyCode, setRefTyCode] = useState<string | null>(presetRefType ?? null);
  const [refId, setRefId]         = useState<string | null>(presetRefId ?? null);

  // ── 기존 메모 조회 (편집 모드) ──
  const { data, isLoading } = useQuery({
    queryKey: ["memo", projectId, memoId],
    queryFn:  () =>
      authFetch<{ data: MemoDetail }>(
        `/api/projects/${projectId}/memos/${memoId}`
      ).then((r) => r.data),
    enabled: !isNew,
  });

  // 조회 데이터 → 폼에 반영
  useEffect(() => {
    if (data) {
      setSubject(data.subject);
      setContent(data.content);
      setShareYn(data.shareYn);
      setRefTyCode(data.refTyCode);
      setRefId(data.refId);
    }
  }, [data]);

  // 편집 가능 여부
  const canEdit = isNew || (data?.isMine ?? false);

  // ── 저장 뮤테이션 ──
  const saveMutation = useMutation({
    mutationFn: (body: { subject: string; content: string; shareYn: string; refTyCode?: string; refId?: string }) =>
      isNew
        ? authFetch<{ data: { memoId: string } }>(`/api/projects/${projectId}/memos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : authFetch<{ data: { memoId: string } }>(`/api/projects/${projectId}/memos/${memoId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    onSuccess: (res) => {
      toast.success("저장되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["memos", projectId] });
      if (isNew && res?.data?.memoId) {
        router.replace(`/projects/${projectId}/memos/${res.data.memoId}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ["memo", projectId, memoId] });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 뮤테이션 ──
  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/memos/${memoId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["memos", projectId] });
      router.push(`/projects/${projectId}/memos`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSave() {
    if (!subject.trim()) { toast.error("제목을 입력해 주세요."); return; }
    saveMutation.mutate({
      subject: subject.trim(),
      content,
      shareYn,
      ...(refTyCode && refId ? { refTyCode, refId } : {}),
    });
  }

  function handleDelete() {
    if (!window.confirm("이 메모를 삭제하시겠습니까?")) return;
    deleteMutation.mutate();
  }

  if (!isNew && isLoading) {
    return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;
  }

  return (
    <div style={{ padding: 0 }}>
      {/* ── 헤더 바 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px", minHeight: 52,
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/memos`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1, padding: "2px 4px" }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "새 메모" : "메모 상세"}
          </span>
        </div>
      </div>

      {/* ── 본문 ── */}
      <div style={{ padding: "4px 24px 48px", maxWidth: 960 }}>

        {/* ── 메타 카드 (기존 메모만 표시) ── */}
        {data && (
          <div style={titleCardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {/* 공유 배지 */}
              <span className="sp-badge" style={{
                display: "inline-flex", alignItems: "center",
                padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                ...(data.shareYn === "Y"
                  ? { background: "#e8f5e9", color: "#2e7d32" }
                  : { background: "#f5f5f5", color: "#888" }),
              }}>
                {data.shareYn === "Y" ? "공유" : "비공개"}
              </span>

              {/* 연결 대상 배지 */}
              {data.refTyCode && (
                <span className="sp-badge" style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                  background: "#e3f2fd", color: "#1565c0",
                }}>
                  {REF_TYPE_LABEL[data.refTyCode] ?? data.refTyCode}
                </span>
              )}

              <span style={metaSepStyle}>·</span>
              <span style={metaItemStyle}>작성자 <strong style={metaValueStyle}>{data.creatMberName}</strong></span>
              <span style={metaSepStyle}>·</span>
              <span style={metaItemStyle}>{formatDate(data.creatDt)} 작성</span>
              <span style={metaSepStyle}>·</span>
              <span style={metaItemStyle}>조회 {data.viewCnt}</span>
            </div>

            {/* 수정·삭제 버튼은 하단 버튼 영역으로 이동 */}
          </div>
        )}

        {/* ── 제목 카드 ── */}
        <div style={contentCardStyle}>
          <div style={cardLabelStyle}>제목</div>
          {canEdit ? (
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="메모 제목을 입력하세요"
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 6,
                border: "1px solid var(--color-border)", fontSize: 14, fontWeight: 400,
                background: "var(--color-bg-card)", color: "var(--color-text-primary)",
                boxSizing: "border-box", outline: "none",
              }}
            />
          ) : (
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>
              {subject || "(제목 없음)"}
            </div>
          )}

          {/* 공유 토글 (신규 or 편집 가능 시) */}
          {canEdit && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>공유</span>
              <button
                onClick={() => setShareYn((p) => (p === "Y" ? "N" : "Y"))}
                className="sp-badge"
                style={{
                  padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  border: "1px solid", cursor: "pointer",
                  ...(shareYn === "Y"
                    ? { background: "#e8f5e9", color: "#2e7d32", borderColor: "#a5d6a7" }
                    : { background: "var(--color-bg-muted)", color: "var(--color-text-secondary)", borderColor: "var(--color-border)" }),
                }}
              >
                {shareYn === "Y" ? "팀 공유" : "비공개"}
              </button>
            </div>
          )}
        </div>

        {/* ── 내용 카드 ── */}
        <div style={contentCardStyle}>
          <div style={cardLabelStyle}>내용</div>
          <RichEditor
            value={content}
            onChange={setContent}
            placeholder="메모 내용을 작성하세요..."
            minHeight={360}
            readOnly={!canEdit}
          />
        </div>

        {/* ── 하단 버튼 ── */}
        {canEdit && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            {/* 삭제 (기존 메모만) */}
            <div>
              {!isNew && (
                <button onClick={handleDelete} disabled={deleteMutation.isPending} style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px", color: "#e53935", borderColor: "#e53935" }}>
                  삭제
                </button>
              )}
            </div>
            {/* 취소·저장 */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => router.push(`/projects/${projectId}/memos`)}
                style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 16px" }}
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 16px" }}
              >
                {saveMutation.isPending ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 스타일 (리뷰 요청 상세 패턴 준수) ────────────────────────────────────────

const titleCardStyle: React.CSSProperties = {
  padding: "20px 24px",
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  boxShadow: "0 2px 10px rgba(0,0,0,0.07)",
  marginBottom: 12,
};

const contentCardStyle: React.CSSProperties = {
  padding: "20px 24px",
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
  marginBottom: 12,
};

const cardLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
  textTransform: "uppercase", color: "var(--color-text-secondary)",
  marginBottom: 14,
};

const metaItemStyle: React.CSSProperties = {
  fontSize: 12, color: "var(--color-text-secondary)",
};

const metaValueStyle: React.CSSProperties = {
  fontWeight: 600, color: "var(--color-text-primary)",
};

const metaSepStyle: React.CSSProperties = {
  fontSize: 12, color: "var(--color-border)", userSelect: "none",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 14, fontWeight: 600, cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 14, cursor: "pointer",
};
