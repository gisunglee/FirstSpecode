"use client";

/**
 * FocusPage — 포커스 모드 (URL: /focus)
 *
 * 역할:
 *   - "오늘 가장 먼저 해야 할 일 1건" 을 화면 중앙에 크게 강조 (PrimaryCard)
 *   - 그 아래 다음 후보 2건을 작게 미리보기 (NextCard)
 *   - 우측 상단에 "내 오픈/지연" 미니 통계 (의사결정 컨텍스트)
 *
 * 격리:
 *   - dashboard/, activity/ 와 완전 분리
 *   - 우선순위 산정은 lib/focus/prioritize.ts (순수 함수)
 *
 * 데이터:
 *   GET /api/projects/[id]/focus
 */

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useAppStore } from "@/store/appStore";
import type { FocusResponse } from "@/types/focus";

import PrimaryCard from "./_components/PrimaryCard";
import NextCard    from "./_components/NextCard";

// 포커스는 사용자 행동 변화에 비교적 민감 — 1분 캐싱.
const STALE_TIME_MS = 60 * 1000;

export default function FocusPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);

  const { data, isLoading, error } = useQuery<FocusResponse>({
    queryKey: ["focus", currentProjectId],
    queryFn: () =>
      authFetch<{ data: FocusResponse }>(
        `/api/projects/${currentProjectId}/focus`
      ).then((r) => r.data),
    enabled:   !!currentProjectId,
    staleTime: STALE_TIME_MS,
  });

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px",
          background: "var(--color-bg-card)",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          🎯 오늘 집중
        </div>
        {/* 미니 통계 — 의사결정 컨텍스트 */}
        {data?.context && (
          <div
            style={{
              display: "flex",
              gap: 16,
              fontSize: "var(--text-sm)",
              color: "var(--color-text-secondary)",
            }}
          >
            <span>
              내 오픈 <strong style={{ color: "var(--color-text-primary)" }}>{data.context.myOpenCount}건</strong>
            </span>
            {data.context.myOverdueCount > 0 && (
              <span style={{ color: "var(--color-error)" }}>
                지연 <strong>{data.context.myOverdueCount}건</strong>
              </span>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          padding: "0 24px 24px",
          maxWidth: 880,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : isLoading ? (
          <FocusSkeleton />
        ) : error ? (
          <FocusError message={(error as Error).message} />
        ) : !data?.primary ? (
          <EmptyState hasOpenItems={(data?.context.myOpenCount ?? 0) > 0} />
        ) : (
          <>
            <PrimaryCard item={data.primary} />

            {data.next.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--color-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontWeight: 600,
                    marginTop: 8,
                  }}
                >
                  다음 작업
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                    gap: 12,
                  }}
                >
                  {data.next.map((it) => (
                    <NextCard key={it.itemId} item={it} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── 상태 컴포넌트 ─────────────────────────────────────────────────────────

function FocusSkeleton() {
  return (
    <>
      {/* Primary 자리 */}
      <div className="sp-group" style={{ padding: 28, minHeight: 280 }}>
        <div
          style={{
            width: "30%", height: 14,
            background: "var(--color-bg-elevated)",
            borderRadius: "var(--radius-sm)",
            opacity: 0.5,
            marginBottom: 16,
          }}
        />
        <div
          style={{
            width: "80%", height: 28,
            background: "var(--color-bg-elevated)",
            borderRadius: "var(--radius-sm)",
            opacity: 0.5,
            marginBottom: 24,
          }}
        />
        <div
          style={{
            width: "100%", height: 8,
            background: "var(--color-bg-elevated)",
            borderRadius: "var(--radius-full)",
            opacity: 0.4,
          }}
        />
      </div>
      {/* Next 2개 자리 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {[0, 1].map((i) => (
          <div key={i} className="sp-group" style={{ padding: 16, minHeight: 120, opacity: 0.5 }} />
        ))}
      </div>
    </>
  );
}

function FocusError({ message }: { message: string }) {
  return (
    <div
      className="sp-group"
      style={{
        padding: 24,
        color: "var(--color-error)",
        fontSize: "var(--text-sm)",
      }}
    >
      ⚠ 포커스 데이터를 불러오지 못했습니다: {message}
    </div>
  );
}

// 두 경우:
//   1) hasOpenItems=true  → 담당 단위업무는 있는데 마감 임박 항목이 없음
//   2) hasOpenItems=false → 담당 단위업무 자체가 없음
function EmptyState({ hasOpenItems }: { hasOpenItems: boolean }) {
  return (
    <div
      className="sp-empty"
      style={{
        padding: "64px 24px",
        textAlign: "center",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="sp-empty-icon" style={{ fontSize: 48 }}>🌤</div>
      <div className="sp-empty-title">
        {hasOpenItems ? "모든 작업이 여유 있어요." : "담당 중인 단위업무가 없습니다."}
      </div>
      <div className="sp-empty-desc">
        {hasOpenItems
          ? "마감 임박한 일이 없으니 호흡을 가다듬어도 좋아요."
          : "단위업무 목록에서 담당을 지정받으시면 여기 표시됩니다."}
      </div>
    </div>
  );
}

function NoProjectSelected() {
  return (
    <div
      className="sp-empty"
      style={{
        padding: "48px 24px",
        textAlign: "center",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      <div className="sp-empty-icon">📁</div>
      <div className="sp-empty-title">프로젝트를 선택해 주세요</div>
      <div className="sp-empty-desc">
        상단 프로젝트 선택기에서 프로젝트를 고르면 포커스가 표시됩니다.
      </div>
    </div>
  );
}
