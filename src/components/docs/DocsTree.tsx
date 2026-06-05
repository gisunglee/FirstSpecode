"use client";

/**
 * DocsTree — Docs Hub 좌측 트리 (사용자 뷰어 전용)
 *
 * 역할:
 *   - 섹션(1단계) 펼침/접힘 + 페이지(2단계) 링크
 *   - 검색박스: 페이지 제목·요약에 LIKE 매칭 — 결과는 트리 위에 인라인 노출
 *   - 펼침 상태는 sessionStorage 에 보관해서 페이지 이동·새로고침 후에도 유지
 *   - 현재 활성 페이지는 활성 스타일(브랜드색) 강조
 *
 * 디자인:
 *   - sp-* 클래스 활용 (sp-tree-* 류는 도움창고 전용으로 신규 정의)
 *   - 모든 색/간격 토큰 사용 — 하드코딩 없음
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

// 트리 응답 타입 — /api/docs/tree 와 동일 구조
type DocsPage = {
  pageId:      string;
  pageSlug:    string;
  pageSj:      string;
  pageExcerpt: string | null;
  badgeCode:   string | null;
  sortOrdr:    number;
};

type DocsSection = {
  sectId:       string;
  sectSlug:     string;
  sectNm:       string;
  sectIconCode: string | null;
  sortOrdr:     number;
  pages:        DocsPage[];
};

// 섹션 펼침 상태 sessionStorage 키 — 페이지 이동·새로고침 시 보존
const STORAGE_KEY = "specode-docs-expanded-sections";

function loadExpanded(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    // 파싱 실패는 무시하고 빈 set — 사용자 데이터 손실보다 새 시작이 안전
    return new Set();
  }
}

function saveExpanded(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // QuotaExceeded 등은 그냥 무시 — 펼침 상태는 부수적 UX
  }
}

export default function DocsTree({ sections }: { sections: DocsSection[] }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search,   setSearch]   = useState("");
  const [hasInitialized, setHasInitialized] = useState(false);

  // 첫 렌더 후 sessionStorage 복원 — SSR 일치를 위해 초기값은 빈 Set 으로 시작
  // (서버에서 sessionStorage 접근 불가 → hydration mismatch 방지)
  //
  // 저장된 상태가 없으면(최초 진입) 모든 섹션을 펼친 상태로 시작한다.
  // — 사용자가 트리를 일일이 클릭하지 않아도 전체 문서 구조를 한눈에 볼 수 있도록.
  // sections 가 비동기로 로드되므로 sections.length > 0 일 때까지 기다림.
  useEffect(() => {
    if (hasInitialized) return;
    if (sections.length === 0) return;

    const raw = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      setExpanded(loadExpanded());
    } else {
      setExpanded(new Set(sections.map((s) => s.sectSlug)));
    }
    setHasInitialized(true);
  }, [sections, hasInitialized]);

  // 활성 페이지 자동 펼침 — 직접 URL로 진입해도 해당 섹션이 자동 열림
  // 현재 path 가 /docs/<section>/<page> 형태인지 확인
  useEffect(() => {
    const match = pathname.match(/^\/docs\/([^/]+)\//);
    if (!match) return;
    const activeSlug = match[1]!;
    setExpanded((prev) => {
      if (prev.has(activeSlug)) return prev;
      const next = new Set(prev);
      next.add(activeSlug);
      saveExpanded(next);
      return next;
    });
  }, [pathname]);

  function toggleSection(slug: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      saveExpanded(next);
      return next;
    });
  }

  // 검색 필터링 — 페이지 제목/요약에서 부분일치 (대소문자 무시)
  // 매칭된 페이지가 1개라도 있는 섹션만 결과에 포함, 매칭된 페이지만 표시
  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;

    return sections
      .map((s) => {
        const matchedPages = s.pages.filter((p) => {
          const sj = p.pageSj.toLowerCase();
          const ex = (p.pageExcerpt ?? "").toLowerCase();
          return sj.includes(q) || ex.includes(q);
        });
        return { ...s, pages: matchedPages };
      })
      .filter((s) => s.pages.length > 0);
  }, [sections, search]);

  // 검색 중에는 전부 펼친 상태로 보여줌 (결과 확인 즉시 가능)
  const isSearching = search.trim().length > 0;

  return (
    <aside
      style={{
        width:        260,
        flexShrink:   0,
        // 본문과 같은 흰 서피스 — 트리·본문이 하나의 깨끗한 면처럼 이어지고
        // 둘 사이는 옅은 세로선으로만 구분 (OpenAI/Claude docs 패턴).
        background:   "var(--color-bg-surface)",
        borderRight:  "1px solid var(--color-border-subtle)",
        display:      "flex",
        flexDirection: "column",
        overflow:     "hidden",
      }}
    >
      {/* 검색박스 */}
      <div style={{ padding: "14px 14px 10px" }}>
        <div style={{ position: "relative" }}>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            aria-hidden
            style={{
              position: "absolute", left: 10, top: "50%",
              transform: "translateY(-50%)",
              color: "var(--color-text-tertiary)",
              pointerEvents: "none",
            }}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="문서 검색"
            style={{
              width:        "100%",
              padding:      "8px 10px 8px 32px",
              fontSize:     "var(--text-sm)",
              border:       "1px solid var(--color-border-subtle)",
              borderRadius: "var(--radius-md, 6px)",
              background:   "var(--color-bg-card)",
              color:        "var(--color-text-primary)",
              outline:      "none",
              boxSizing:    "border-box",
            }}
          />
        </div>
      </div>

      {/* 트리 본체 */}
      <nav
        aria-label="문서 트리"
        style={{ flex: 1, overflowY: "auto", padding: "8px 8px 16px" }}
      >
        {filteredSections.length === 0 ? (
          <div style={{
            padding:    "16px",
            fontSize:   "var(--text-sm)",
            color:      "var(--color-text-tertiary)",
            textAlign:  "center",
          }}>
            {isSearching ? "검색 결과가 없습니다." : "공개된 문서가 없습니다."}
          </div>
        ) : (
          filteredSections.map((s) => {
            const isOpen = isSearching || expanded.has(s.sectSlug);
            return (
              <div key={s.sectId} style={{ marginBottom: 4 }}>
                {/* 섹션 헤더 (펼침/접힘 토글) */}
                <button
                  onClick={() => !isSearching && toggleSection(s.sectSlug)}
                  style={{
                    display:        "flex",
                    alignItems:     "center",
                    gap:            6,
                    width:          "100%",
                    padding:        "8px 10px",
                    background:     "transparent",
                    border:         "none",
                    borderRadius:   "var(--radius-sm)",
                    color:          "var(--color-text-heading)",
                    fontSize:       "var(--text-md)",
                    fontWeight:     600,
                    cursor:         isSearching ? "default" : "pointer",
                    textAlign:      "left",
                  }}
                >
                  <span
                    style={{
                      display:    "inline-block",
                      width:      10,
                      fontSize:   9,
                      color:      "var(--color-text-tertiary)",
                      transform:  isOpen ? "rotate(90deg)" : "none",
                      transition: "transform 0.15s",
                    }}
                  >
                    ▶
                  </span>
                  <span>{s.sectNm}</span>
                </button>

                {/* 페이지 목록 */}
                {isOpen && (
                  <div>
                    {s.pages.map((p) => {
                      const href = `/docs/${s.sectSlug}/${p.pageSlug}`;
                      const isActive = pathname === href;
                      return (
                        <Link
                          key={p.pageId}
                          href={href}
                          style={{
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "space-between",
                            gap:            6,
                            // 활성 항목은 좌측 스트립 대신 둥근 알약 배경으로 — 더 표준적이고 부드럽다.
                            margin:         "1px 0",
                            padding:        "6px 10px 6px 26px",
                            borderRadius:   "var(--radius-sm)",
                            fontSize:       "var(--text-md)",
                            textDecoration: "none",
                            color:          isActive
                              ? "var(--color-brand)"
                              : "var(--color-text-secondary)",
                            background:     isActive
                              ? "var(--color-brand-subtle)"
                              : "transparent",
                            fontWeight:     isActive ? 600 : 400,
                          }}
                        >
                          <span style={{
                            overflow:     "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace:   "nowrap",
                          }}>
                            {p.pageSj}
                          </span>
                          {p.badgeCode && (
                            <BadgeChip code={p.badgeCode} />
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </nav>
    </aside>
  );
}

// ── 배지 칩 (NEW / BETA / DEPRECATED) ─────────────────────────────────────
// 각 배지마다 토큰 기반 색상 — 다크/라이트 자동 대응
const BADGE_STYLE: Record<string, { bg: string; color: string }> = {
  NEW:        { bg: "var(--color-success-subtle)", color: "var(--color-success)" },
  BETA:       { bg: "var(--color-info-subtle)",    color: "var(--color-info)" },
  DEPRECATED: { bg: "var(--color-warning-subtle)", color: "var(--color-warning)" },
};

function BadgeChip({ code }: { code: string }) {
  const style = BADGE_STYLE[code] ?? {
    bg: "var(--color-bg-elevated)", color: "var(--color-text-tertiary)",
  };
  return (
    <span
      style={{
        flexShrink:   0,
        fontSize:     10,
        fontWeight:   700,
        padding:      "1px 5px",
        borderRadius: "var(--radius-sm)",
        background:   style.bg,
        color:        style.color,
        letterSpacing:"0.04em",
      }}
    >
      {code}
    </span>
  );
}
