"use client";

/**
 * DocsLandingPage — /docs 진입 시 첫 PUBLISHED 페이지로 자동 이동
 *
 * 역할:
 *   - /docs 경로로 들어오면 트리의 첫 섹션, 첫 페이지로 redirect
 *   - 트리가 비어있으면 안내 메시지
 *
 * 왜 redirect 인가?
 *   - "랜딩 = 첫 페이지" 가 가장 직관적 (Stripe Docs / Vercel Docs 동일)
 *   - 별도의 카드 그리드 랜딩은 콘텐츠가 많이 쌓인 후 검토 (지금은 과함)
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";

type DocsPage = { pageSlug: string };
type DocsSection = { sectSlug: string; pages: DocsPage[] };
type TreeResponse = { sections: DocsSection[] };

export default function DocsLandingPage() {
  const router = useRouter();

  // 같은 queryKey 사용 — DocsLayout 의 트리 캐시와 공유 (재호출 없음)
  const { data, isLoading } = useQuery<TreeResponse>({
    queryKey: ["docs", "tree"],
    queryFn:  () =>
      authFetch<{ data: TreeResponse }>("/api/docs/tree").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // 첫 섹션의 첫 페이지로 redirect — useEffect 안에서 처리해
  // 서버사이드 렌더링과 일치 (router.replace 는 클라이언트 전용)
  useEffect(() => {
    if (!data) return;
    const firstSect = data.sections[0];
    const firstPage = firstSect?.pages[0];
    if (firstSect && firstPage) {
      router.replace(`/docs/${firstSect.sectSlug}/${firstPage.pageSlug}`);
    }
  }, [data, router]);

  return (
    <div style={{
      flex:           1,
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      flexDirection:  "column",
      gap:            12,
      padding:        32,
      color:          "var(--color-text-tertiary)",
    }}>
      {isLoading ? (
        <span style={{ fontSize: "var(--text-sm)" }}>문서를 불러오는 중...</span>
      ) : data && data.sections.length === 0 ? (
        <>
          <span style={{ fontSize: "var(--text-md)", color: "var(--color-text-secondary)" }}>
            아직 공개된 문서가 없습니다.
          </span>
          <span style={{ fontSize: "var(--text-sm)" }}>
            관리자가 문서를 작성하면 여기에 표시됩니다.
          </span>
        </>
      ) : (
        <span style={{ fontSize: "var(--text-sm)" }}>이동 중...</span>
      )}
    </div>
  );
}
