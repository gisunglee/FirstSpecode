"use client";

/**
 * ReviewDetailPage — 리뷰 요청 상세 (PID-REVIEW-02)
 *
 * 역할:
 *   - 리뷰 요청 내용 / 답변 내용 표시 (RichEditor)
 *   - 상태 변경 (답변자: 검토중·완료)
 *   - 하단 코멘트 스레드 (작성·수정·삭제)
 *   - 권한: 요청자 수정/삭제(코멘트 없을 때), 답변자 결과 입력, 관리자 모두 가능
 */

import { Suspense, useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import dynamic from "next/dynamic";
// TipTap 번들이 초기 로드에 포함되지 않도록 dynamic import
const RichEditor = dynamic(() => import("@/components/ui/RichEditor"), { ssr: false });
import { useAppStore } from "@/store/appStore";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type ReviewDetail = {
  reviewId:      string;
  titleNm:       string;
  reviewCn:      string;
  resultCn:      string | null;
  stsfScr:       number | null;
  fdbkCode:      string | null;
  statusCode:    string;
  reqMemberId:   string;
  reqMemberNm:   string;
  revwrMemberId: string;
  revwrMemberNm: string;
  isRequester:   boolean;
  isReviewer:    boolean;
  createdAt:     string;
  completedAt:   string | null;
};

type CommentRow = {
  commentId:     string;
  content:       string;
  writeMemberId: string;
  writeMemberNm: string;
  isOwn:         boolean;
  createdAt:     string;
  updatedAt:     string;
};

// ── 상수 ─────────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  REQUESTED:  { label: "요청됨",  color: "#1565c0", bg: "#e3f2fd" },
  REVIEWING:  { label: "검토 중",  color: "#e65100", bg: "#fff3e0" },
  COMPLETED:  { label: "완료",    color: "#2e7d32", bg: "#e8f5e9" },
};

// 답변자가 설정할 수 있는 상태
const REVIEWER_STATUSES = ["REVIEWING", "COMPLETED"];

// 피드백 코드 표시 맵
const FDBK_MAP: Record<string, { label: string; color: string; bg: string }> = {
  GOOD:               { label: "굿!",    color: "#1b5e20", bg: "#e8f5e9" },
  WELL:               { label: "잘함",   color: "#1565c0", bg: "#e3f2fd" },
  NEEDS_IMPROVEMENT:  { label: "보완 필요", color: "#e65100", bg: "#fff3e0" },
};

// 내용 크기 경고 임계값 (2MB)
const WARN_SIZE = 2 * 1024 * 1024;

function getHtmlByteSize(html: string) {
  return new Blob([html]).size;
}

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function ReviewDetailPage() {
  return (
    <Suspense fallback={null}>
      <ReviewDetailPageInner />
    </Suspense>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function ReviewDetailPageInner() {
  const params      = useParams<{ id: string; reviewId: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const { setBreadcrumb } = useAppStore();
  const projectId   = params.id;
  const reviewId    = params.reviewId;

  // ── 상세 조회 ──────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["review", projectId, reviewId],
    queryFn:  () =>
      authFetch<{ data: ReviewDetail }>(`/api/projects/${projectId}/reviews/${reviewId}`)
        .then((r) => r.data),
  });

  // 브레드크럼
  useEffect(() => {
    setBreadcrumb([
      { label: "리뷰 요청", href: `/projects/${projectId}/reviews` },
      { label: data?.titleNm ?? "상세" },
    ]);
    return () => setBreadcrumb([]);
  }, [projectId, data?.titleNm, setBreadcrumb]);

  // ── 요청 내용 편집 상태 ────────────────────────────────────────────────────
  const [editMode,      setEditMode]      = useState(false);
  const [titleNm,       setTitleNm]       = useState("");
  const [reviewCn,      setReviewCn]      = useState("");
  const [revwrMemberId, setRevwrMemberId] = useState("");

  // ── 답변 내용 상태 ─────────────────────────────────────────────────────────
  const [resultCn,     setResultCn]     = useState("");
  const [resultMode,   setResultMode]   = useState(false);
  // 답변 저장 시 선택할 상태 코드 (답변자가 직접 결정)
  const [resultStatus, setResultStatus] = useState("COMPLETED");

  useEffect(() => {
    if (data) {
      setTitleNm(data.titleNm);
      setReviewCn(data.reviewCn);
      setRevwrMemberId(data.revwrMemberId);
      setResultCn(data.resultCn ?? "");
      // COMPLETED면 COMPLETED 유지, 그 외(REQUESTED·REVIEWING)는 REVIEWING 기본값
      setResultStatus(
        data.statusCode === "COMPLETED" ? "COMPLETED" : "REVIEWING"
      );
    }
  }, [data]);

  // ── 프로젝트 멤버 목록 (답변자 선택용) ────────────────────────────────────
  const { data: membersData } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn:  () =>
      authFetch<{ data: { members: { memberId: string; name: string | null; email: string }[] } }>(
        `/api/projects/${projectId}/members`
      ).then((r) => r.data.members),
    // 편집 모드 진입 시에만 필요하므로 항상 fetching
    staleTime: 60_000,
  });
  const memberOptions = membersData ?? [];

  // ── 코멘트 목록 조회 ───────────────────────────────────────────────────────
  const { data: commentsData } = useQuery({
    queryKey: ["review-comments", reviewId],
    queryFn:  () =>
      authFetch<{ data: { items: CommentRow[] } }>(
        `/api/projects/${projectId}/reviews/${reviewId}/comments`
      ).then((r) => r.data),
  });
  const comments = commentsData?.items ?? [];

  // ── 상태 변경 뮤테이션 ─────────────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: (statusCode: string) =>
      authFetch(`/api/projects/${projectId}/reviews/${reviewId}`, {
        method: "PUT",
        body:   JSON.stringify({ statusCode }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review", projectId, reviewId] });
      queryClient.invalidateQueries({ queryKey: ["reviews", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 요청 내용 수정 뮤테이션 ────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/reviews/${reviewId}`, {
        method: "PUT",
        body:   JSON.stringify({ titleNm, reviewCn, revwrMemberId }),
      }),
    onSuccess: () => {
      toast.success("수정되었습니다.");
      setEditMode(false);
      queryClient.invalidateQueries({ queryKey: ["review", projectId, reviewId] });
      queryClient.invalidateQueries({ queryKey: ["reviews", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 답변 저장 뮤테이션 ─────────────────────────────────────────────────────
  const resultMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/reviews/${reviewId}`, {
        method: "PUT",
        body:   JSON.stringify({ resultCn, statusCode: resultStatus }),
      }),
    onSuccess: () => {
      toast.success("답변이 저장되었습니다.");
      setResultMode(false);
      queryClient.invalidateQueries({ queryKey: ["review", projectId, reviewId] });
      queryClient.invalidateQueries({ queryKey: ["reviews", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 만족도 점수 뮤테이션 ───────────────────────────────────────────────────
  const stsfMutation = useMutation({
    mutationFn: (score: number) =>
      authFetch(`/api/projects/${projectId}/reviews/${reviewId}`, {
        method: "PUT",
        body:   JSON.stringify({ stsfScr: score }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review", projectId, reviewId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 뮤테이션 ──────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/reviews/${reviewId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      router.push(`/projects/${projectId}/reviews`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !data) return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;

  const st = STATUS_MAP[data.statusCode] ?? { label: data.statusCode, color: "#555", bg: "#f5f5f5" };
  // 요청자: 검토 전(REQUESTED) 상태에서만 본문 수정 가능
  const canEditRequest = data.isRequester && data.statusCode === "REQUESTED";
  // 답변자: 언제든지 답변 작성/수정 가능 (종료 상태 없음)
  const canReply       = data.isReviewer;
  // 요청자: 완료 상태에서 별점 평가 가능
  const canRate        = data.isRequester && data.statusCode === "COMPLETED";

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px", minHeight: 52,
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/reviews`)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", lineHeight: 1, padding: "2px 4px" }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>리뷰 요청 상세</span>
        </div>
      </div>

      {/* 2-column grid: 좌(요청+답변) 7 / 우(코멘트) 3 — 사이드바 너비에 비례하여 함께 조정됨 */}
      <div style={{ display: "grid", gridTemplateColumns: "6fr 4fr", gap: "0 20px", padding: "4px 24px 48px", alignItems: "start" }}>

        {/* ── 왼쪽 컬럼: 메타·요청·답변 ──────────────────────────── */}
        <div>
          {/* ── 메타 카드 ─────────────────────────────────────────── */}
          <div style={titleCardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {/* 상태 배지 */}
              <span className="sp-badge" style={{ display: "inline-flex", alignItems: "center", padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700, background: st.bg, color: st.color }}>
                {st.label}
              </span>
              {/* 피드백 코드 배지 */}
              {data.fdbkCode && FDBK_MAP[data.fdbkCode] && (
                <span className="sp-badge" style={{ display: "inline-flex", alignItems: "center", padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: FDBK_MAP[data.fdbkCode].bg, color: FDBK_MAP[data.fdbkCode].color }}>
                  {FDBK_MAP[data.fdbkCode].label}
                </span>
              )}
              {/* 별점 수치 */}
              {data.stsfScr != null && (
                <span className="sp-badge" style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "#fffbeb", color: "#b45309" }}>
                  <span style={{ fontSize: 13 }}>★</span> {data.stsfScr}/5
                </span>
              )}
              <span style={metaSepStyle}>·</span>
              <span style={metaItemStyle}>요청자 <strong style={metaValueStyle}>{data.reqMemberNm}</strong></span>
              <span style={metaSepStyle}>·</span>
              {editMode ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>답변자</span>
                  <select
                    value={revwrMemberId}
                    onChange={(e) => setRevwrMemberId(e.target.value)}
                    style={{ padding: "3px 8px", borderRadius: 5, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", fontSize: 12, cursor: "pointer", outline: "none" }}
                  >
                    {memberOptions.map((m) => (
                      <option key={m.memberId} value={m.memberId}>
                        {m.name ?? m.email}
                      </option>
                    ))}
                  </select>
                </span>
              ) : (
                <span style={metaItemStyle}>답변자 <strong style={metaValueStyle}>{data.revwrMemberNm}</strong></span>
              )}
              <span style={metaSepStyle}>·</span>
              <span style={metaItemStyle}>{new Date(data.createdAt).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} 요청</span>
              {data.completedAt && (
                <>
                  <span style={metaSepStyle}>·</span>
                  <span style={metaItemStyle}>{new Date(data.completedAt).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })} 완료</span>
                </>
              )}

              {/* 답변 평가 별점 (완료 상태, 요청자) */}
              {canRate && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, borderLeft: "1px solid var(--color-border)", paddingLeft: 10, marginLeft: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 500, flexShrink: 0 }}>평가</span>
                  <div style={{ display: "flex", gap: 1 }}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => stsfMutation.mutate(star)}
                        disabled={stsfMutation.isPending}
                        title={`${star}점`}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 1px", color: star <= (data.stsfScr ?? 0) ? "#f59e0b" : "#d1d5db" }}
                      >★</button>
                    ))}
                  </div>
                </div>
              )}

              {/* 수정/삭제/저장 버튼 */}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {canEditRequest && !editMode && (
                  <>
                    <button onClick={() => setEditMode(true)} style={{ ...ghostBtnStyle }}>수정</button>
                    <button onClick={() => { if (!confirm("삭제하시겠습니까?")) return; deleteMutation.mutate(); }} style={{ ...ghostBtnStyle, color: "#e53935", borderColor: "#e5393550" }}>삭제</button>
                  </>
                )}
                {editMode && (
                  <>
                    <button onClick={() => editMutation.mutate()} disabled={editMutation.isPending} style={{ ...solidBtnStyle }}>
                      {editMutation.isPending ? "저장 중..." : "저장"}
                    </button>
                    <button onClick={() => { setEditMode(false); setTitleNm(data.titleNm); setReviewCn(data.reviewCn); setRevwrMemberId(data.revwrMemberId); }} style={{ ...ghostBtnStyle }}>취소</button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── 요청 내용 카드 ────────────────────────────────────── */}
          <div style={contentCardStyle}>
            {/* 제목 */}
            <div style={{ marginBottom: 20 }}>
              <div style={cardLabelStyle}>제목</div>
              {editMode ? (
                <input
                  value={titleNm}
                  onChange={(e) => setTitleNm(e.target.value)}
                  style={inputStyle}
                  placeholder="리뷰 제목을 입력하세요"
                  autoFocus
                />
              ) : (
                <div style={{ padding: "14px 16px", borderRadius: 6, background: "var(--color-bg-muted)", fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>
                  {data.titleNm}
                </div>
              )}
            </div>

            <div style={cardLabelStyle}>요청 내용</div>
            {editMode ? (
              <>
                {getHtmlByteSize(reviewCn) > WARN_SIZE && (
                  <div style={warnBannerStyle}>⚠ 내용이 큽니다. 이미지를 줄이거나 내용을 나눠 작성해 주세요.</div>
                )}
                <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
                  <RichEditor value={reviewCn} onChange={setReviewCn} minHeight={200} />
                </div>
              </>
            ) : (
              <div
                className="sp-markdown"
                style={{ padding: "14px 16px", background: "var(--color-bg-muted)", borderRadius: 6, minHeight: 80, lineHeight: 1.7 }}
                dangerouslySetInnerHTML={{ __html: data.reviewCn || "<p style='color:#aaa'>내용 없음</p>" }}
              />
            )}
          </div>

          {/* ── 답변 내용 카드 ────────────────────────────────────── */}
          <div style={contentCardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={cardLabelStyle}>답변 내용</span>
              {canReply && !resultMode && (
                <button onClick={() => setResultMode(true)} style={{ ...ghostBtnStyle }}>
                  답변 {data.resultCn ? "수정" : "작성"}
                </button>
              )}
              {resultMode && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--color-text-secondary)", flexShrink: 0 }}>저장 후 상태:</span>
                  <select
                    value={resultStatus}
                    onChange={(e) => setResultStatus(e.target.value)}
                    style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, border: "1px solid var(--color-border)", background: "var(--color-bg-card)", color: "var(--color-text-primary)", cursor: "pointer", outline: "none" }}
                  >
                    {REVIEWER_STATUSES.map((code) => (
                      <option key={code} value={code}>{STATUS_MAP[code]?.label ?? code}</option>
                    ))}
                  </select>
                  <button onClick={() => { setResultMode(false); setResultCn(data.resultCn ?? ""); }} style={{ ...ghostBtnStyle }}>취소</button>
                  <button onClick={() => resultMutation.mutate()} disabled={resultMutation.isPending} style={{ ...solidBtnStyle }}>
                    {resultMutation.isPending ? "저장 중..." : "답변 저장"}
                  </button>
                </div>
              )}
            </div>
            {resultMode ? (
              <>
                {getHtmlByteSize(resultCn) > WARN_SIZE && (
                  <div style={warnBannerStyle}>⚠ 내용이 큽니다. 이미지를 줄이거나 내용을 나눠 작성해 주세요.</div>
                )}
                <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
                  <RichEditor value={resultCn} onChange={setResultCn} placeholder="답변 내용을 작성하세요. 이미지는 Ctrl+V로 붙여넣기 가능합니다." minHeight={320} />
                </div>
              </>
            ) : data.resultCn ? (
              <div
                className="sp-markdown"
                style={{ padding: "14px 16px", background: "var(--color-bg-muted)", borderRadius: 6, minHeight: 60, lineHeight: 1.7 }}
                dangerouslySetInnerHTML={{ __html: data.resultCn }}
              />
            ) : (
              <div style={{ padding: "32px 0", textAlign: "center", color: "#bbb", fontSize: 13 }}>
                아직 답변이 없습니다.
              </div>
            )}
          </div>
        </div>

        {/* ── 오른쪽 컬럼: 코멘트 스레드 ─────────────────────────── */}
        <div style={{ paddingTop: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 14, marginTop: 4 }}>
            코멘트{comments.length > 0 && <span style={{ color: "var(--color-primary, #1976d2)", marginLeft: 6 }}>({comments.length})</span>}
          </div>

          {comments.map((c) => (
            <CommentItem
              key={c.commentId}
              comment={c}
              projectId={projectId}
              reviewId={reviewId}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["review-comments", reviewId] })}
            />
          ))}

          {/* 새 코멘트 입력 */}
          <NewCommentForm
            projectId={projectId}
            reviewId={reviewId}
            onCreated={() => queryClient.invalidateQueries({ queryKey: ["review-comments", reviewId] })}
          />
        </div>
      </div>
    </div>
  );
}

// ── 코멘트 아이템 ──────────────────────────────────────────────────────────────

function CommentItem({
  comment, projectId, reviewId, onChanged,
}: {
  comment:   CommentRow;
  projectId: string;
  reviewId:  string;
  onChanged: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [content,  setContent]  = useState(comment.content);

  const editMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/reviews/${reviewId}/comments/${comment.commentId}`, {
        method: "PUT",
        body:   JSON.stringify({ content }),
      }),
    onSuccess: () => { toast.success("수정되었습니다."); setEditMode(false); onChanged(); },
    onError:   (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/reviews/${reviewId}/comments/${comment.commentId}`, {
        method: "DELETE",
      }),
    onSuccess: () => { toast.success("삭제되었습니다."); onChanged(); },
    onError:   (err: Error) => toast.error(err.message),
  });

  return (
    <div style={{ marginBottom: 16, padding: "14px 16px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-bg-card)" }}>
      {/* 코멘트 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>{comment.writeMemberNm}</span>
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
            {new Date(comment.createdAt).toLocaleString("ko-KR")}
            {comment.updatedAt !== comment.createdAt && " (수정됨)"}
          </span>
        </div>
        {comment.isOwn && (
          <div style={{ display: "flex", gap: 6 }}>
            {!editMode && (
              <button onClick={() => setEditMode(true)} style={ghostSmBtnStyle}>수정</button>
            )}
            <button
              onClick={() => { if (!confirm("삭제하시겠습니까?")) return; deleteMutation.mutate(); }}
              style={{ ...ghostSmBtnStyle, color: "#e53935", borderColor: "#e5393540" }}
            >
              삭제
            </button>
          </div>
        )}
      </div>

      {/* 코멘트 내용 */}
      {editMode ? (
        <>
          {getHtmlByteSize(content) > WARN_SIZE && (
            <div style={warnBannerStyle}>⚠ 내용이 큽니다. 이미지를 줄이거나 내용을 나눠 작성해 주세요.</div>
          )}
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
            <RichEditor value={content} onChange={setContent} minHeight={120} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
            <button onClick={() => { setEditMode(false); setContent(comment.content); }} style={{ ...ghostBtnStyle, fontSize: 12, padding: "4px 10px" }}>취소</button>
            <button onClick={() => editMutation.mutate()} disabled={editMutation.isPending} style={{ ...solidBtnStyle, fontSize: 12, padding: "4px 10px" }}>
              {editMutation.isPending ? "저장 중..." : "저장"}
            </button>
          </div>
        </>
      ) : (
        <div
          className="sp-markdown"
          style={{ fontSize: 13 }}
          dangerouslySetInnerHTML={{ __html: comment.content }}
        />
      )}
    </div>
  );
}

// ── 새 코멘트 입력 폼 ────────────────────────────────────────────────────────

function NewCommentForm({
  projectId, reviewId, onCreated,
}: {
  projectId: string;
  reviewId:  string;
  onCreated: () => void;
}) {
  const [content, setContent] = useState("");
  const [open,    setOpen]    = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/reviews/${reviewId}/comments`, {
        method: "POST",
        body:   JSON.stringify({ content }),
      }),
    onSuccess: () => {
      toast.success("코멘트가 등록되었습니다.");
      setContent("");
      setOpen(false);
      onCreated();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit() {
    if (!content.trim()) { toast.error("내용을 입력해 주세요."); return; }
    if (getHtmlByteSize(content) > 5 * 1024 * 1024) {
      toast.error("내용이 너무 큽니다. 이미지를 줄이거나 나눠서 작성해 주세요.");
      return;
    }
    mutation.mutate();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ ...ghostBtnStyle, fontSize: 12, padding: "5px 14px" }}
      >
        + 코멘트 작성
      </button>
    );
  }

  return (
    <div style={{ padding: "14px 16px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-bg-card)" }}>
      {getHtmlByteSize(content) > WARN_SIZE && (
        <div style={warnBannerStyle}>⚠ 내용이 큽니다. 이미지를 줄이거나 내용을 나눠 작성해 주세요.</div>
      )}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
        <RichEditor
          value={content}
          onChange={setContent}
          placeholder="코멘트를 입력하세요. 이미지는 Ctrl+V로 붙여넣기 가능합니다."
          minHeight={120}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button onClick={() => { setOpen(false); setContent(""); }} style={{ ...ghostBtnStyle, fontSize: 12, padding: "4px 12px" }}>취소</button>
        <button onClick={handleSubmit} disabled={mutation.isPending} style={{ ...solidBtnStyle, fontSize: 12, padding: "4px 12px" }}>
          {mutation.isPending ? "등록 중..." : "등록"}
        </button>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

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
const warnBannerStyle: React.CSSProperties = {
  padding: "8px 12px", borderRadius: 6, marginBottom: 10,
  background: "#fff8e1", border: "1px solid #ffe082",
  fontSize: 12, color: "#795548",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)", fontSize: 14,
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  boxSizing: "border-box",
};
// 외곽선 버튼
const ghostBtnStyle: React.CSSProperties = {
  padding: "5px 14px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "transparent",
  color: "var(--color-text-primary)", fontSize: 12, fontWeight: 500, cursor: "pointer",
};
// 채움 버튼 (저장·답변 저장)
const solidBtnStyle: React.CSSProperties = {
  padding: "5px 16px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const ghostSmBtnStyle: React.CSSProperties = {
  padding: "3px 9px", borderRadius: 5,
  border: "1px solid var(--color-border)", background: "none",
  color: "var(--color-text-secondary)", fontSize: 12, cursor: "pointer",
};
