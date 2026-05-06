"use client";

/**
 * StandardGuideListPage — 표준 가이드 목록 (/projects/[id]/standard-guides)
 *
 * 역할:
 *   - 프로젝트별 표준 가이드 목록 조회
 *   - 카테고리 탭 필터 (10종 + 전체)
 *   - 사용여부 필터 (전체/사용중/미사용) — use_yn='Y'=사용중, 'N'=미사용
 *   - 제목/본문 검색
 *   - 행 클릭 → 상세 페이지, [신규 등록] → /new
 *
 * 주요 기술:
 *   - TanStack Query: queryKey에 카테고리·사용여부·검색어 포함해 자동 재조회
 *   - authFetch: 토큰 자동 갱신 포함 fetch 래퍼
 */

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  GUIDE_CATEGORIES,
  GUIDE_CATEGORY_LABEL,
  GUIDE_CATEGORY_BADGE,
  type GuideCategory,
} from "@/constants/codes";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type GuideRow = {
  guideId:       string;
  category:      string;          // 서버에서 문자열로 오므로 narrow 캐스팅은 렌더링 시
  subject:       string;
  useYn:         string;          // "Y"=사용중, "N"=미사용
  creatMberId:   string;
  creatMberName: string;
  creatDt:       string;
  mdfcnDt:       string | null;
};

type ListResponse = {
  items:      GuideRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

// ── 상수 ──────────────────────────────────────────────────────────────────────

// 사용여부 필터 탭 — 값이 빈 문자열이면 전체
const USE_FILTERS: Array<{ value: "" | "Y" | "N"; label: string }> = [
  { value: "",  label: "전체" },
  { value: "Y", label: "사용중" },
  { value: "N", label: "미사용" },
];

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatDateShort(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default function StandardGuideListPage() {
  // useSearchParams/useParams는 Suspense 내부에서 안전하게 사용
  return (
    <Suspense fallback={null}>
      <StandardGuideListInner />
    </Suspense>
  );
}

function StandardGuideListInner() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();

  // "" = 전체, 그 외 = 10종 중 하나
  const [category, setCategory]     = useState<"" | GuideCategory>("");
  const [useFilter, setUseFilter]   = useState<"" | "Y" | "N">("");
  const [search, setSearch]         = useState("");

  // ── 데이터 조회 ──
  const queryParams = new URLSearchParams();
  if (category)      queryParams.set("category", category);
  if (useFilter)     queryParams.set("use", useFilter);
  if (search.trim()) queryParams.set("search", search.trim());
  const qs = queryParams.toString();

  const { data, isLoading } = useQuery({
    // queryKey에 필터값을 모두 포함 — 하나라도 빠지면 필터 변경 시 캐시 갱신 안 됨
    queryKey: ["standard-guides", projectId, category, useFilter, search],
    queryFn: () =>
      authFetch<{ data: ListResponse }>(
        `/api/projects/${projectId}/standard-guides${qs ? `?${qs}` : ""}`
      ).then((r) => r.data),
  });

  const items = data?.items ?? [];
  const total = data?.pagination?.total ?? 0;

  if (isLoading) {
    return <div style={{ padding: "40px 32px", color: "var(--color-text-tertiary)" }}>로딩 중...</div>;
  }

  // 카테고리 탭 옵션: 전체 + 10종
  // "전체"는 빈 문자열을 값으로 사용 — URL 파라미터 생략과 일관
  const categoryTabs: Array<{ value: "" | GuideCategory; label: string }> = [
    { value: "", label: "전체" },
    ...GUIDE_CATEGORIES.map((c) => ({ value: c, label: GUIDE_CATEGORY_LABEL[c] })),
  ];

  return (
    <div style={{ padding: 0 }}>
      {/* ── 헤더 바 ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 24px",
        background: "var(--color-bg-card)",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", flex: 1 }}>
          표준 가이드
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/standard-guides/new`)}
          style={{ ...primaryBtnStyle, fontSize: 12, padding: "5px 14px" }}
        >
          + 신규 등록
        </button>
      </div>

      {/* ── 카테고리 underline 탭 (서브 네비게이션 성격) ── */}
      {/* chip 스타일은 선택된 항목만 눈에 띄고 "탭 영역"이라는 맥락이 흐려지므로
          모든 탭이 같은 라인에 걸친 underline 스타일로 정리. active만 brand 색 언더라인 + 진한 텍스트 */}
      <div style={{
        display: "flex", gap: 2, flexWrap: "wrap",
        padding: "0 24px",
        borderBottom: "1px solid var(--color-border)",
        marginBottom: 14,
      }}>
        {categoryTabs.map((t) => {
          const isActive = category === t.value;
          return (
            <button
              key={t.value || "ALL"}
              onClick={() => setCategory(t.value)}
              style={{
                padding: "8px 14px",
                // 하단 border와 겹쳐서 active 라인이 섹션 구분선을 덮도록 -1px 오프셋
                marginBottom: -1,
                fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                cursor: "pointer",
                background: "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid var(--color-brand, #1976d2)" : "2px solid transparent",
                color: isActive ? "var(--color-brand, #1976d2)" : "var(--color-text-secondary)",
                transition: "color 0.1s, border-color 0.1s",
                outline: "none",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "var(--color-text-primary)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "var(--color-text-secondary)"; }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── 사용여부 세그먼트 + 검색 + 건수 (한 줄) ── */}
      <div style={{
        display: "flex", gap: 10, alignItems: "center",
        padding: "0 24px", marginBottom: 14,
      }}>
        {/* 사용여부 — ai-tasks 등 다른 목록과 동일한 세그먼트 컨트롤 규격 */}
        <div style={segmentGroupStyle}>
          {USE_FILTERS.map((u) => (
            <button
              key={u.value || "ALL"}
              type="button"
              onClick={() => setUseFilter(u.value)}
              style={segmentBtnStyle(useFilter === u.value)}
            >
              {u.label}
            </button>
          ))}
        </div>

        {/* 검색 input — 돋보기 아이콘 포함 */}
        <div style={{ position: "relative", width: 280 }}>
          {/* 돋보기 아이콘 — input 좌측 내부에 고정 */}
          <svg
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 10, top: "50%", transform: "translateY(-50%)",
              color: "var(--color-text-tertiary)", pointerEvents: "none",
            }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="제목·본문 검색"
            style={{ ...inputStyle, width: "100%", paddingLeft: 32 }}
          />
        </div>

        <span style={{ fontSize: 13, color: "var(--color-text-secondary)", marginLeft: "auto" }}>
          총 <strong style={{ color: "var(--color-text-primary)", fontWeight: 700 }}>{total}</strong>건
        </span>
      </div>

      {/* ── 테이블 ──
          데이터 0건이어도 테이블 구조(테두리 + 컬럼 헤더)는 항상 노출.
          빈 상태는 데이터 영역에만 메시지로 표시 — 다른 목록 페이지와 동일한 표준 패턴 */}
      <div style={{ padding: "0 24px 24px" }}>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={gridHeaderStyle}>
            <div>카테고리</div>
            <div>제목</div>
            <div>사용여부</div>
            <div>작성자</div>
            <div>최근 수정일</div>
          </div>

          {items.length === 0 ? (
            // 빈 상태는 배경 없이 투명 — AI 태스크 목록 등 다른 페이지와 통일
            <div style={{
              padding: "60px 0", textAlign: "center",
              color: "var(--color-text-tertiary)", fontSize: 14,
            }}>
              {search || category || useFilter ? "검색 결과가 없습니다." : "등록된 표준 가이드가 없습니다."}
            </div>
          ) : (
            items.map((g, idx) => {
              // 서버에서 오는 category 값은 문자열이므로 badge 룩업 전에 narrow
              const cat = g.category as GuideCategory;
              const badge = GUIDE_CATEGORY_BADGE[cat];
              const label = GUIDE_CATEGORY_LABEL[cat] ?? g.category;
              // 수정일 우선, 없으면 작성일
              const lastDt = g.mdfcnDt ?? g.creatDt;
              // 미사용 상태는 본문 전체를 흐리게 처리해 시각적으로 즉시 구분
              const isInactive = g.useYn === "N";

              return (
                <div
                  key={g.guideId}
                  onClick={() => router.push(`/projects/${projectId}/standard-guides/${g.guideId}`)}
                  style={{
                    ...gridRowStyle,
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                    opacity: isInactive ? 0.55 : 1,
                  }}
                >
                  {/* 카테고리 배지 */}
                  <div>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 10px",
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 700,
                      background: badge?.bg ?? "#f5f5f5",
                      color:      badge?.fg ?? "#757575",
                    }}>
                      {label}
                    </span>
                  </div>

                  {/* 제목 */}
                  <div style={{
                    fontWeight: 500, fontSize: 13, color: "var(--color-text-primary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {g.subject || "(제목 없음)"}
                  </div>

                  {/* 사용여부 배지 */}
                  <div>
                    {g.useYn === "Y" ? (
                      <span style={{
                        display: "inline-block",
                        padding: "2px 10px", borderRadius: 12,
                        fontSize: 11, fontWeight: 700,
                        background: "#e8f5e9", color: "#2e7d32",
                      }}>
                        사용중
                      </span>
                    ) : (
                      <span style={{
                        display: "inline-block",
                        padding: "2px 10px", borderRadius: 12,
                        fontSize: 11, fontWeight: 700,
                        background: "#f5f5f5", color: "#757575",
                      }}>
                        미사용
                      </span>
                    )}
                  </div>

                  {/* 작성자 */}
                  <div style={{
                    fontSize: 13, color: "var(--color-text-secondary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }} title={g.creatMberName}>
                    {g.creatMberName}
                  </div>

                  {/* 최근 수정일 */}
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                    {formatDateShort(lastDt)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────
// 카테고리 | 제목(가변) | 사용여부 | 작성자 | 수정일
const GRID_TEMPLATE = "120px 1fr 90px 12% 14%";

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
  transition: "background 0.1s, opacity 0.1s",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 20px", borderRadius: 6, border: "1px solid transparent",
  background: "var(--color-primary, #1976d2)", color: "#fff",
  fontSize: 14, fontWeight: 600, cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg-card)",
  color: "var(--color-text-primary)", fontSize: 13, outline: "none",
  boxSizing: "border-box",
};

// 세그먼트 컨트롤 — ai-tasks 등 다른 목록 페이지와 동일 규격 (프로젝트 표준)
// 외곽 border로 한 덩어리를 감싸고 내부 버튼은 테두리 없이 배치
const segmentGroupStyle: React.CSSProperties = {
  display:      "inline-flex",
  border:       "1px solid var(--color-border)",
  borderRadius: 6,
  overflow:     "hidden",
  background:   "var(--color-bg-card)",
};

const segmentBtnStyle = (active: boolean): React.CSSProperties => ({
  padding:    "7px 14px",
  fontSize:   13,
  fontWeight: active ? 600 : 400,
  border:     "none",
  background: active ? "var(--color-brand-subtle)" : "transparent",
  color:      active ? "var(--color-brand)" : "var(--color-text-secondary)",
  cursor:     "pointer",
  outline:    "none",
});
