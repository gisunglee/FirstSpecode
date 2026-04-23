"use client";

/**
 * ReviewsPage — 리뷰 요청 목록 (PID-REVIEW-01)
 *
 * 역할:
 *   - 프로젝트 내 리뷰 요청 목록 조회
 *   - 신규 리뷰 요청 모달 (제목·요청 내용·답변자 선택 — RichEditor)
 *   - 상태·요청자·답변자·코멘트 수·일자 표시
 */

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import dynamic from "next/dynamic";
// TipTap 번들이 초기 로드에 포함되지 않도록 dynamic import
const RichEditor = dynamic(() => import("@/components/ui/RichEditor"), { ssr: false });

// ── 타입 ─────────────────────────────────────────────────────────────────────

type ReviewRow = {
  reviewId:      string;
  titleNm:       string;
  statusCode:    string;
  reqMemberId:   string;
  reqMemberNm:   string;
  revwrMemberId: string;
  revwrMemberNm: string;
  commentCount:  number;
  fdbkCode:    string | null;
  stsfScr:     number | null;
  createdAt:   string;
  completedAt: string | null;
};

type MemberOption = {
  memberId: string;
  name:     string;
  email:    string;
};

// ── 상수 ─────────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  REQUESTED:  { label: "요청됨",  color: "#1565c0", bg: "#e3f2fd" },
  REVIEWING:  { label: "검토 중",  color: "#e65100", bg: "#fff3e0" },
  COMPLETED:  { label: "완료",    color: "#2e7d32", bg: "#e8f5e9" },
};

const FDBK_MAP: Record<string, { label: string; color: string; bg: string }> = {
  GOOD:             { label: "굿!",      color: "#1b5e20", bg: "#e8f5e9" },
  WELL:             { label: "잘함",     color: "#1565c0", bg: "#e3f2fd" },
  NEEDS_IMPROVEMENT:{ label: "보완 필요", color: "#e65100", bg: "#fff3e0" },
};

// ── 페이지 래퍼 ──────────────────────────────────────────────────────────────

export default function ReviewsPage() {
  return (
    <Suspense fallback={null}>
      <ReviewsPageInner />
    </Suspense>
  );
}

// 연도 생략 — MM-DD HH:mm 형식으로 컬럼 너비 절약
function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

function ReviewsPageInner() {
  const params      = useParams<{ id: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();
  const projectId   = params.id;

  const [modalOpen, setModalOpen] = useState(false);

  // ── 목록 조회 ──────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["reviews", projectId],
    queryFn:  () =>
      authFetch<{ data: { items: ReviewRow[] } }>(`/api/projects/${projectId}/reviews`)
        .then((r) => r.data),
  });
  const items = data?.items ?? [];

  if (isLoading) return <div style={{ padding: "40px 32px", color: "#888" }}>로딩 중...</div>;

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>
          리뷰 요청 목록
        </div>
        <button
          onClick={() => setModalOpen(true)}
          style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
        >
          + 리뷰 요청
        </button>
      </div>

      {/* 총 건수 */}
      <div style={{ marginBottom: 12, fontSize: 14, color: "var(--color-text-secondary)", padding: "0 24px" }}>
        총 {items.length}건
      </div>

      {/* 목록 테이블 */}
      {items.length === 0 ? (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#aaa", fontSize: 14 }}>
          등록된 리뷰 요청이 없습니다.
        </div>
      ) : (
        <div style={{ padding: "0 24px 24px" }}>
          <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
            {/* 헤더 행 */}
            <div style={gridHeaderStyle}>
              <div>제목</div>
              <div>요청자</div>
              <div>답변자</div>
              <div>상태</div>
              <div style={{ textAlign: "center" }}>코멘트</div>
              <div>요청 일시</div>
              <div>답변 일시</div>
            </div>

            {items.map((item, idx) => {
              const st = STATUS_MAP[item.statusCode] ?? { label: item.statusCode, color: "#555", bg: "#f5f5f5" };
              return (
                <div
                  key={item.reviewId}
                  onClick={() => router.push(`/projects/${projectId}/reviews/${item.reviewId}`)}
                  style={{
                    ...gridRowStyle,
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                  }}
                >
                  {/* 제목 */}
                  <div style={{ fontWeight: 500, fontSize: 13, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.titleNm}
                  </div>

                  {/* 요청자 — 이메일 주소일 때 말줄임 */}
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.reqMemberNm}>
                    {item.reqMemberNm}
                  </div>

                  {/* 답변자 — 이메일 주소일 때 말줄임 */}
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.revwrMemberNm}>
                    {item.revwrMemberNm}
                  </div>

                  {/* 상태 배지 + 피드백 + 별점 (가로 배치) */}
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
                    <span style={{ whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                    {item.fdbkCode && (() => {
                      const fb = FDBK_MAP[item.fdbkCode!];
                      return fb ? (
                        <span style={{ whiteSpace: "nowrap", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: fb.bg, color: fb.color }}>
                          {fb.label}
                        </span>
                      ) : null;
                    })()}
                    {item.stsfScr != null && (
                      <span style={{ fontSize: 12, color: "#f59e0b", letterSpacing: 1, whiteSpace: "nowrap" }}>
                        {"★".repeat(item.stsfScr)}{"☆".repeat(5 - item.stsfScr)}
                      </span>
                    )}
                  </div>

                  {/* 코멘트 수 */}
                  <div style={{ textAlign: "center", fontSize: 13, color: item.commentCount > 0 ? "var(--color-primary, #1976d2)" : "var(--color-text-secondary)" }}>
                    {item.commentCount > 0 ? `💬 ${item.commentCount}` : "—"}
                  </div>

                  {/* 요청 일시 — MM-DD HH:mm 단축 포맷 */}
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {formatDateShort(item.createdAt)}
                  </div>

                  {/* 답변 일시 — MM-DD HH:mm 단축 포맷 */}
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {item.completedAt ? formatDateShort(item.completedAt) : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 신규 리뷰 요청 모달 */}
      {modalOpen && (
        <NewReviewModal
          projectId={projectId}
          onClose={() => setModalOpen(false)}
          onCreated={(reviewId) => {
            setModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ["reviews", projectId] });
            router.push(`/projects/${projectId}/reviews/${reviewId}`);
          }}
        />
      )}
    </div>
  );
}

// ── 신규 리뷰 요청 모달 ──────────────────────────────────────────────────────

function NewReviewModal({
  projectId, onClose, onCreated,
}: {
  projectId: string;
  onClose:   () => void;
  onCreated: (reviewId: string) => void;
}) {
  const [titleNm,       setTitleNm]       = useState("");
  const [reviewCn,      setReviewCn]      = useState("");
  const [revwrMemberId, setRevwrMemberId] = useState("");

  // 프로젝트 멤버 목록 (답변자 선택)
  const { data: membersData } = useQuery({
    queryKey: ["members", projectId],
    queryFn:  () =>
      authFetch<{ data: { members: MemberOption[] } }>(
        `/api/projects/${projectId}/members`
      ).then((r) => r.data),
  });

  const memberItems: MemberOption[] = membersData?.members ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: { reviewId: string } }>(`/api/projects/${projectId}/reviews`, {
        method: "POST",
        body:   JSON.stringify({ titleNm, reviewCn, revwrMemberId }),
      }).then((r) => r.data),
    onSuccess: (res) => {
      toast.success("리뷰 요청이 등록되었습니다.");
      onCreated(res.reviewId);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleSubmit() {
    if (!titleNm.trim())       { toast.error("제목을 입력해 주세요."); return; }
    if (!reviewCn.trim())      { toast.error("요청 내용을 입력해 주세요."); return; }
    if (!revwrMemberId)        { toast.error("답변자를 선택해 주세요."); return; }
    createMutation.mutate();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 760,
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column",
          maxHeight: "90vh",
        }}
      >
        {/* 모달 헤더 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>새 리뷰 요청</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#888" }}>×</button>
        </div>

        {/* 모달 본문 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {/* 제목 */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>제목 <span style={{ color: "#e53935" }}>*</span></label>
            <input
              type="text"
              value={titleNm}
              onChange={(e) => setTitleNm(e.target.value)}
              placeholder="리뷰 요청 제목을 입력하세요"
              style={inputStyle}
            />
          </div>

          {/* 답변자 */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>답변자 <span style={{ color: "#e53935" }}>*</span></label>
            <select value={revwrMemberId} onChange={(e) => setRevwrMemberId(e.target.value)} style={selectStyle}>
              <option value="">답변자를 선택하세요</option>
              {memberItems.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          </div>

          {/* 요청 내용 — RichEditor */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>요청 내용 <span style={{ color: "#e53935" }}>*</span></label>
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
              <RichEditor
                value={reviewCn}
                onChange={setReviewCn}
                placeholder="리뷰 요청 내용을 입력하세요. 이미지는 Ctrl+V로 붙여넣을 수 있습니다."
                minHeight={200}
              />
            </div>
          </div>
        </div>

        {/* 모달 푸터 */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--color-border)" }}>
          <button onClick={onClose} style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 16px" }}>
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 16px" }}
          >
            {createMutation.isPending ? "등록 중..." : "요청 등록"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

// 제목(가변) | 요청자 | 답변자 | 상태 | 코멘트 | 요청일시 | 답변일시
// 제목(가변) | 요청자 | 답변자 | 상태 | 코멘트 | 요청일시 | 답변일시
// 제목(가변) | 요청자 | 답변자 | 상태 | 코멘트 | 요청일시 | 답변일시
const GRID_TEMPLATE = "1fr 10.5% 10.5% 7.7% 8.9% 9.5% 9.5%";

const gridHeaderStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID_TEMPLATE, gap: 8,
  padding: "10px 16px", background: "var(--color-bg-muted)",
  fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border)", alignItems: "center",
};

const gridRowStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: GRID_TEMPLATE, gap: 8,
  padding: "12px 16px", alignItems: "center",
  background: "var(--color-bg-card)", cursor: "pointer",
  transition: "background 0.1s",
};

const formGroupStyle: React.CSSProperties  = { marginBottom: 16 };
const labelStyle: React.CSSProperties = {
  display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600,
  color: "var(--color-text-secondary)",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)", fontSize: 14,
  background: "var(--color-bg-card)", color: "var(--color-text-primary)",
  boxSizing: "border-box",
};
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  paddingRight: 32,
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
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
