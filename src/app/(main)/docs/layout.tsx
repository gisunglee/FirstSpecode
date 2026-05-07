"use client";

/**
 * DocsLayout — Docs Hub 공통 레이아웃 (트리 + 본문 outlet)
 *
 * 역할:
 *   - /docs 하위 모든 페이지에 좌측 트리를 일관되게 노출
 *   - 트리 데이터는 한 번만 fetch — 서브 페이지 이동 시 캐시 재사용
 *   - 트리 펼침 상태/검색 상태는 DocsTree 가 sessionStorage 로 자체 보관
 *
 * 데이터:
 *   - useQuery(["docs", "tree"]) — staleTime 5분 (자주 안 바뀜)
 *
 * 레이아웃:
 *   ┌──────────┬─────────────────────────┐
 *   │ DocsTree │ {children}              │
 *   │ 240px    │ (페이지별 본문)          │
 *   └──────────┴─────────────────────────┘
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import DocsTree from "@/components/docs/DocsTree";

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

type TreeResponse = { sections: DocsSection[] };

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  // 트리 한 번만 fetch — 페이지 이동마다 재조회되면 좌측 트리가 깜빡거림
  const { data, isLoading, error } = useQuery<TreeResponse>({
    queryKey: ["docs", "tree"],
    queryFn:  () =>
      authFetch<{ data: TreeResponse }>("/api/docs/tree").then((r) => r.data),
    // 5분 캐시 — 관리자 편집 직후엔 invalidate 해야 하지만 그건 관리자 화면에서 처리
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div style={{
      display:   "flex",
      height:    "100%",     // (main) 레이아웃의 컨텐츠 영역 전체 사용
      minHeight: 0,           // flex 자식이 overflow 가능하도록
    }}>
      <DocsTree sections={data?.sections ?? []} />

      {/* 본문 영역 — 로딩/에러는 컴팩트하게, 정상 시 outlet 그대로 */}
      <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
        {isLoading ? (
          <div style={{
            flex:        1,
            display:     "flex",
            alignItems:  "center",
            justifyContent: "center",
            color:       "var(--color-text-tertiary)",
            fontSize:    "var(--text-sm)",
          }}>
            문서를 불러오는 중...
          </div>
        ) : error ? (
          <div style={{
            flex:    1,
            padding: 32,
            color:   "var(--color-error)",
          }}>
            문서 트리를 불러오지 못했습니다: {(error as Error).message}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
