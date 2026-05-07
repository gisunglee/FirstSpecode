"use client";

/**
 * DocsViewerPage — Docs Hub 페이지 본문 뷰어 (/docs/[section]/[page])
 *
 * 역할:
 *   - URL slug 두 단계로 페이지 단건 fetch
 *   - DocsContent 에 위임해 Markdown 본문 + 페이저 렌더링
 *   - 404 시 안내 메시지 + 트리 첫 페이지로 돌아가기 안내
 *   - 브레드크럼: GNB 에 "DOCS / 섹션명 / 페이지명" 표시
 *
 * 데이터:
 *   - useQuery(["docs", section, page]) — 페이지 단위 캐시
 */

import { use, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import DocsContent from "@/components/docs/DocsContent";

type DocsPageDetail = {
  page: {
    pageId:      string;
    pageSj:      string;
    pageExcerpt: string | null;
    contentMd:   string;
    badgeCode:   string | null;
    lastUpdated: string;
  };
  section: {
    sectSlug: string;
    sectNm:   string;
  };
  prev: { sectSlug: string; pageSlug: string; pageSj: string } | null;
  next: { sectSlug: string; pageSlug: string; pageSj: string } | null;
};

// Next.js 16 — params 가 Promise 타입. React.use() 로 풀어 사용
type Props = { params: Promise<{ section: string; page: string }> };

export default function DocsViewerPage({ params }: Props) {
  const { section, page } = use(params);
  const setBreadcrumb = useAppStore((s) => s.setBreadcrumb);

  const { data, isLoading, error } = useQuery<DocsPageDetail>({
    // 섹션·페이지 슬러그를 모두 key 에 포함 — slug 바뀌면 별도 캐시
    queryKey: ["docs", "page", section, page],
    queryFn:  () =>
      authFetch<{ data: DocsPageDetail }>(
        `/api/docs/${encodeURIComponent(section)}/${encodeURIComponent(page)}`
      ).then((r) => r.data),
    staleTime: 60 * 1000, // 1분 — 사용자 뷰는 자주 바뀌지 않음
    retry: false,         // 404 는 재시도 의미 없음
  });

  // GNB 브레드크럼 동기화 — 페이지가 바뀔 때마다 갱신
  useEffect(() => {
    if (!data) {
      setBreadcrumb([]);
      return;
    }
    setBreadcrumb([
      { label: "DOCS",            href: "/docs" },
      { label: data.section.sectNm, href: `/docs/${data.section.sectSlug}` },
      { label: data.page.pageSj }, // 마지막 — 현재 위치, href 없음
    ]);
    // 언마운트 시 정리
    return () => setBreadcrumb([]);
  }, [data, setBreadcrumb]);

  if (isLoading) {
    return (
      <div style={{
        flex:           1,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        color:          "var(--color-text-tertiary)",
        fontSize:       "var(--text-sm)",
      }}>
        페이지를 불러오는 중...
      </div>
    );
  }

  if (error || !data) {
    // 에러 메시지 — 404 도 여기로 옴 (retry:false 라 즉시 표시)
    const msg = error instanceof Error ? error.message : "페이지를 찾을 수 없습니다.";
    return (
      <div style={{
        flex:           1,
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        gap:            12,
        padding:        32,
        textAlign:      "center",
      }}>
        <span style={{
          fontSize:   "var(--text-lg)",
          fontWeight: 600,
          color:      "var(--color-text-primary)",
        }}>
          문서를 찾을 수 없습니다
        </span>
        <span style={{
          fontSize: "var(--text-sm)",
          color:    "var(--color-text-tertiary)",
          maxWidth: 360,
        }}>
          {msg}
        </span>
        <a
          href="/docs"
          style={{
            marginTop:    8,
            padding:      "8px 16px",
            fontSize:     "var(--text-sm)",
            color:        "var(--color-brand)",
            background:   "var(--color-brand-subtle)",
            border:       "1px solid var(--color-brand-border)",
            borderRadius: "var(--radius-card)",
            textDecoration: "none",
          }}
        >
          DOCS 처음으로 돌아가기
        </a>
      </div>
    );
  }

  return <DocsContent data={data} />;
}
