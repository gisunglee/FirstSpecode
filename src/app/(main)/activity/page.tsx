"use client";

/**
 * ActivityPage — 활동 피드 대시보드 (URL: /activity)
 *
 * 역할:
 *   - 프로젝트의 최근 변경/검토/AI 완료 이벤트를 시간 역순 스트림으로 표시
 *   - 기간 필터 + 무한 스크롤
 *   - 카드 그리드 대시보드와 다른 패러다임 (단일 컬럼 스트림)
 *
 * 격리:
 *   - dashboard/ 폴더와 완전 분리
 *   - 공유는 lib/utils.ts 의 formatRelativeKo, layout 컴포넌트만
 *
 * 데이터:
 *   GET /api/projects/[id]/activity?range=...&cursor=...
 *
 * 주요 기술:
 *   - useInfiniteQuery (페이지 누적)
 *   - IntersectionObserver (스크롤 끝 감지)
 *   - 날짜 그룹핑 (오늘/어제/2일 전/날짜)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/appStore";
import type { ActivityEvent, ActivityRangeKey } from "@/types/activity";

import { useActivityFeed } from "./_components/useActivityFeed";
import FeedFilters from "./_components/FeedFilters";
import FeedItem    from "./_components/FeedItem";
import DateDivider from "./_components/DateDivider";

export default function ActivityPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const [range, setRange] = useState<ActivityRangeKey>("7d");

  const {
    data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage, error,
  } = useActivityFeed(currentProjectId, range);

  // 모든 페이지의 이벤트를 평탄화
  const allEvents = useMemo<ActivityEvent[]>(
    () => (data?.pages ?? []).flatMap((p) => p.events),
    [data]
  );

  // 날짜 그룹 — "오늘"/"어제"/"2일 전"/"YYYY-MM-DD" 별로 묶기
  const grouped = useMemo(() => groupByDay(allEvents), [allEvents]);

  // 무한 스크롤 — 페이지 끝 감지용 sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        // sentinel 이 보이면 다음 페이지 — fetchNextPage 가 중복 호출 안전(Query 가 처리)
        if (entries.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" } // 화면 끝 200px 전부터 미리 로드
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px", position: "sticky", top: 0, zIndex: 10,
          background: "var(--color-bg-card)",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>
          활동 피드
        </div>
        <FeedFilters range={range} onChange={setRange} />
      </div>

      <div style={{ padding: "0 24px 24px", maxWidth: 920, margin: "0 auto" }}>
        {!currentProjectId ? (
          <NoProjectSelected />
        ) : isLoading ? (
          <FeedSkeleton />
        ) : error ? (
          <FeedError message={(error as Error).message} />
        ) : allEvents.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            className="sp-group"
            style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            {grouped.map((g) => (
              <div key={g.label}>
                <DateDivider label={g.label} />
                {g.events.map((e) => (
                  <FeedItem key={e.eventId} event={e} />
                ))}
              </div>
            ))}

            {/* 페이지 끝 sentinel — 보이는 순간 다음 페이지 자동 로드 */}
            <div ref={sentinelRef} style={{ height: 1 }} aria-hidden />

            {isFetchingNextPage && (
              <div
                style={{
                  padding: "12px",
                  textAlign: "center",
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-tertiary)",
                }}
              >
                불러오는 중…
              </div>
            )}
            {!hasNextPage && !isFetchingNextPage && (
              <div
                style={{
                  padding: "16px 12px",
                  textAlign: "center",
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-tertiary)",
                }}
              >
                — 끝 —
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 날짜 그룹핑 (오늘/어제/N일 전/날짜) ───────────────────────────────────
//
// 입력은 occurredAt 내림차순 정렬된 이벤트 목록.
// 같은 KST 날짜끼리 묶고, 라벨은 사람 친화 형식으로.
function groupByDay(events: ActivityEvent[]): Array<{ label: string; events: ActivityEvent[] }> {
  const groups: Array<{ label: string; events: ActivityEvent[] }> = [];
  let currentKey: string | null = null;
  let currentBucket: ActivityEvent[] = [];

  for (const e of events) {
    // YYYY-MM-DD 키 — 로컬 시간대 기준(KST)
    const d = new Date(e.occurredAt);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    if (key !== currentKey) {
      if (currentBucket.length > 0 && currentKey) {
        groups.push({ label: labelForKey(currentKey), events: currentBucket });
      }
      currentKey   = key;
      currentBucket = [];
    }
    currentBucket.push(e);
  }
  if (currentBucket.length > 0 && currentKey) {
    groups.push({ label: labelForKey(currentKey), events: currentBucket });
  }
  return groups;
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }

function labelForKey(key: string): string {
  const today = new Date();
  const t = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  if (key === t) return "오늘";
  // 어제·N일 전 계산 — 로컬 자정 기준 일수 차이
  const [y, m, d] = key.split("-").map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round((todayMs - target) / (1000 * 60 * 60 * 24));
  if (days === 1) return "어제";
  if (days >= 2 && days <= 7) return `${days}일 전`;
  return key; // 일주일 넘어가면 날짜 그대로
}

// ── 상태 컴포넌트 ─────────────────────────────────────────────────────────

function FeedSkeleton() {
  return (
    <div className="sp-group">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 12,
            padding: "10px 12px",
            borderBottom: "1px solid var(--color-border-subtle)",
          }}
        >
          <div
            style={{
              width: 32, height: 32,
              borderRadius: "var(--radius-full)",
              background: "var(--color-bg-elevated)",
              opacity: 0.6,
            }}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                width: "60%", height: 12,
                background: "var(--color-bg-elevated)",
                borderRadius: "var(--radius-sm)",
                opacity: 0.6,
              }}
            />
            <div
              style={{
                width: "40%", height: 10,
                background: "var(--color-bg-elevated)",
                borderRadius: "var(--radius-sm)",
                opacity: 0.4,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedError({ message }: { message: string }) {
  return (
    <div
      className="sp-group"
      style={{
        padding: 16,
        color: "var(--color-error)",
        fontSize: "var(--text-sm)",
      }}
    >
      ⚠ 활동을 불러오지 못했습니다: {message}
    </div>
  );
}

function EmptyState() {
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
      <div className="sp-empty-icon">📭</div>
      <div className="sp-empty-title">선택한 기간에 활동이 없습니다.</div>
      <div className="sp-empty-desc">
        상단에서 기간을 더 길게 잡아 보세요.
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
        상단 프로젝트 선택기에서 프로젝트를 고르면 활동 피드가 표시됩니다.
      </div>
    </div>
  );
}
