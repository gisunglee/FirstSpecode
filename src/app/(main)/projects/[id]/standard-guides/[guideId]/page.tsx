"use client";

/**
 * StandardGuideDetailPage — 표준 가이드 상세/편집/신규 (/projects/[id]/standard-guides/[guideId])
 *
 * 역할:
 *   - guideId="new" → 신규 등록 모드
 *   - 그 외       → 기존 가이드 조회 + 편집 모드
 *   - 표준 가이드는 팀 공용 지식 베이스 → 수정은 MEMBER 이상, 삭제는 작성자/PL/PM만
 *   - 삭제는 ConfirmDialog 경유 (window.confirm 금지)
 *   - 본문은 편집·미리보기 탭을 지원하는 공용 MarkdownEditor 사용
 *
 * 주요 기술:
 *   - TanStack Query: 단건 조회 + 저장/삭제 뮤테이션 + 캐시 무효화
 *   - authFetch: 토큰 자동 갱신
 */

import { Suspense, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import MarkdownEditor, { MarkdownTabButtons } from "@/components/ui/MarkdownEditor";
import {
  GUIDE_CATEGORIES,
  GUIDE_CATEGORY_LABEL,
  GUIDE_CATEGORY_BADGE,
  type GuideCategory,
} from "@/constants/codes";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type GuideDetail = {
  guideId:       string;
  category:      string;
  subject:       string;
  content:       string;
  useYn:         string;          // "Y"=사용중, "N"=미사용
  creatMberId:   string;
  creatMberName: string;
  creatDt:       string;
  mdfcnDt:       string | null;
  canDelete:     boolean;
};

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, "0")}. ${String(d.getDate()).padStart(2, "0")}. ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function StandardGuideDetailPage() {
  // useParams 는 Suspense 경계 안에서 사용
  return (
    <Suspense fallback={null}>
      <StandardGuideDetailInner />
    </Suspense>
  );
}

function StandardGuideDetailInner() {
  const { id: projectId, guideId } = useParams<{ id: string; guideId: string }>();
  const router      = useRouter();
  const queryClient = useQueryClient();

  // guideId === "new" 은 신규 등록 모드를 의미하는 관례
  const isNew = guideId === "new";

  // ── 폼 상태 ──
  // 신규는 첫 카테고리(UI)로 기본값, 편집은 서버 데이터로 덮어씀
  const [category, setCategory] = useState<GuideCategory>("UI");
  const [subject, setSubject]   = useState("");
  const [content, setContent]   = useState("");
  // 사용여부 — 신규 기본 "Y"(사용중). 편집 시 서버 값으로 덮어씀
  const [useYn, setUseYn]       = useState<"Y" | "N">("Y");
  const [mdTab, setMdTab]       = useState<"edit" | "preview">("edit");
  const [deleteOpen, setDeleteOpen] = useState(false);

  // ── 기존 가이드 조회 (편집 모드) ──
  const { data, isLoading } = useQuery({
    queryKey: ["standard-guide", projectId, guideId],
    queryFn:  () =>
      authFetch<{ data: GuideDetail }>(
        `/api/projects/${projectId}/standard-guides/${guideId}`
      ).then((r) => r.data),
    enabled: !isNew, // 신규 모드에서는 조회하지 않음
  });

  // 조회 결과 → 폼에 반영
  useEffect(() => {
    if (data) {
      // 서버에서 온 category 문자열을 enum으로 내리기 — 타입 안전
      // DB에 이상한 값이 섞여 있어도 fallback 으로 UI 가 되도록
      const cat = (GUIDE_CATEGORIES as readonly string[]).includes(data.category)
                ? (data.category as GuideCategory)
                : "UI";
      setCategory(cat);
      setSubject(data.subject);
      setContent(data.content);
      // useYn은 Y/N 외 값은 기본 Y로 보정 (데이터 손상 방어)
      setUseYn(data.useYn === "N" ? "N" : "Y");
    }
  }, [data]);

  // ── 저장 뮤테이션 ──
  const saveMutation = useMutation({
    mutationFn: (body: { category: GuideCategory; subject: string; content: string; useYn: "Y" | "N" }) =>
      isNew
        ? authFetch<{ data: { guideId: string } }>(`/api/projects/${projectId}/standard-guides`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(body),
          })
        : authFetch<{ data: { guideId: string } }>(`/api/projects/${projectId}/standard-guides/${guideId}`, {
            method:  "PUT",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(body),
          }),
    onSuccess: (res) => {
      toast.success("저장되었습니다.");
      // 목록 캐시 무효화 — 다음 진입 시 최신 데이터
      queryClient.invalidateQueries({ queryKey: ["standard-guides", projectId] });
      if (isNew && res?.data?.guideId) {
        // 신규 → 방금 생성된 상세로 URL 교체 (뒤로가기 시 /new 중복 방지)
        router.replace(`/projects/${projectId}/standard-guides/${res.data.guideId}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ["standard-guide", projectId, guideId] });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── 삭제 뮤테이션 ──
  const deleteMutation = useMutation({
    mutationFn: () =>
      authFetch(`/api/projects/${projectId}/standard-guides/${guideId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("삭제되었습니다.");
      queryClient.invalidateQueries({ queryKey: ["standard-guides", projectId] });
      router.push(`/projects/${projectId}/standard-guides`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setDeleteOpen(false);
    },
  });

  function handleSave() {
    // 제목 공백만이면 저장 거부 — 서버도 같은 검증을 하지만 UX 개선 차원에서 선제적 차단
    if (!subject.trim()) {
      toast.error("제목을 입력해 주세요.");
      return;
    }
    saveMutation.mutate({
      category,
      subject: subject.trim(),
      content,
      useYn,
    });
  }

  if (!isNew && isLoading) {
    return <div style={{ padding: "40px 32px", color: "var(--color-text-tertiary)" }}>로딩 중...</div>;
  }

  const badge = GUIDE_CATEGORY_BADGE[category];
  // 삭제 버튼 노출 여부 — 서버가 계산해준 canDelete 사용 (신규 모드는 당연히 숨김)
  const showDelete = !isNew && (data?.canDelete ?? false);

  return (
    <div style={{ padding: 0 }}>
      {/* ── 헤더 타이틀 바 (우상단 [삭제][취소][저장]) ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 24px", minHeight: 52,
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => router.push(`/projects/${projectId}/standard-guides`)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 18, color: "var(--color-text-secondary)",
              lineHeight: 1, padding: "2px 4px",
            }}
          >
            ←
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
            {isNew ? "표준 가이드 신규 등록" : "표준 가이드 상세"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {showDelete && (
            <button
              onClick={() => setDeleteOpen(true)}
              disabled={deleteMutation.isPending}
              style={{
                fontSize: 12, padding: "5px 14px", minWidth: 60,
                borderRadius: 6, border: "1px solid var(--color-error, #e53935)",
                background: "none", color: "var(--color-error, #e53935)",
                cursor: "pointer", fontWeight: 600,
              }}
            >
              삭제
            </button>
          )}
          <button
            onClick={() => router.push(`/projects/${projectId}/standard-guides`)}
            disabled={saveMutation.isPending}
            style={{ ...secondaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px", minWidth: 60 }}
          >
            {saveMutation.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* ── 본문 ── */}
      <div style={{ padding: "4px 24px 48px", maxWidth: 960 }}>

        {/* ── 메타 카드 (기존 모드만 표시) ── */}
        {data && (
          <div style={metaCardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{
                display: "inline-flex", alignItems: "center",
                padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                background: badge?.bg ?? "#f5f5f5",
                color:      badge?.fg ?? "#757575",
              }}>
                {GUIDE_CATEGORY_LABEL[category]}
              </span>

              {/* 사용여부 배지 — 목록과 동일 규격 (목록·상세 일관성) */}
              {useYn === "Y" ? (
                <span style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  background: "#e8f5e9", color: "#2e7d32",
                }}>
                  사용중
                </span>
              ) : (
                <span style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "3px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  background: "#f5f5f5", color: "#757575",
                }}>
                  미사용
                </span>
              )}

              <span style={metaSepStyle}>·</span>
              <span style={metaItemStyle}>
                작성자 <strong style={metaValueStyle}>{data.creatMberName}</strong>
              </span>
              <span style={metaSepStyle}>·</span>
              <span style={metaItemStyle}>{formatDate(data.creatDt)} 작성</span>
              {data.mdfcnDt && (
                <>
                  <span style={metaSepStyle}>·</span>
                  <span style={metaItemStyle}>{formatDate(data.mdfcnDt)} 수정</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── 카테고리 · 제목 · 사용여부 카드 (한 줄 3열) ── */}
        {/* 제목을 가변(1fr), 카테고리·사용여부는 고정폭으로 좁게 — 본문 공간을 더 확보 */}
        <div style={contentCardStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 140px", gap: 16, alignItems: "end" }}>
            <div>
              <div style={cardLabelStyle}>카테고리</div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as GuideCategory)}
                // selectStyle = inputStyle + 커스텀 화살표 (브라우저 기본 제거)
                style={selectStyle}
              >
                {GUIDE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{GUIDE_CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={cardLabelStyle}>제목</div>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="가이드 제목을 입력하세요"
                style={inputStyle}
              />
            </div>
            <div>
              {/* 사용여부 — Y=사용중(AI 참조), N=미사용(보관만) */}
              <div style={cardLabelStyle}>사용여부</div>
              <select
                value={useYn}
                onChange={(e) => setUseYn(e.target.value === "N" ? "N" : "Y")}
                style={selectStyle}
              >
                <option value="Y">사용중</option>
                <option value="N">미사용</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── 본문 카드 (편집·미리보기 탭) ── */}
        <div style={contentCardStyle}>
          {/* 라벨과 탭 버튼을 한 줄에 배치 — MarkdownEditor 공용 패턴 */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={cardLabelStyle}>본문 (마크다운)</div>
            <MarkdownTabButtons tab={mdTab} onTabChange={setMdTab} />
          </div>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            tab={mdTab}
            onTabChange={setMdTab}
            // 카테고리/제목/사용여부를 한 줄로 합쳐 상단이 한 줄만큼 줄어든 만큼
            // 본문 영역을 그만큼 더 크게 확보 (rows 20 → 25, 약 +105px)
            rows={25}
            placeholder="마크다운 형식의 가이드 본문을 작성하세요. AI가 이 내용을 참조해 개발 작업 시 제약을 따릅니다."
          />
        </div>
      </div>

      {/* ── 삭제 확인 다이얼로그 ── */}
      <ConfirmDialog
        open={deleteOpen}
        title="표준 가이드 삭제"
        description="이 가이드를 삭제하시겠습니까?"
        confirmLabel="삭제"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const metaCardStyle: React.CSSProperties = {
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
  marginBottom: 10,
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

const inputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "8px 12px",
  borderRadius: 6,
  border:       "1px solid var(--color-border)",
  background:   "var(--color-bg-card)",
  color:        "var(--color-text-primary)",
  fontSize:     14,
  boxSizing:    "border-box",
  outline:      "none",
};

// select 전용 — 브라우저 기본 화살표 제거 + 커스텀 쉐브론 SVG 배경
// 요구사항 상세(requirements/[reqId])와 동일 규격
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  paddingRight:       "32px",
  appearance:         "none",
  WebkitAppearance:   "none",
  backgroundImage:    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
  backgroundRepeat:   "no-repeat",
  backgroundPosition: "right 10px center",
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
