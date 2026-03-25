"use client";

/**
 * StatusBar — 하단 상태 바 (AR-00096)
 *
 * 역할:
 *   - 미반영 설계 변경 건수 배지 (unsyncedChanges)
 *   - 팀 액티비티 뉴스 티커 (rolling text)
 *   - 최근 이벤트 10건 팝업 (쉐브론 클릭, FID-00205)
 *   - AI 태스크 상태별 집계 배지 (FID-00206, 30초 폴링)
 *
 * 주요 기술:
 *   - TanStack Query: status-summary 30초 폴링, events 온디맨드 조회
 *   - Zustand: currentProjectId
 *   - sp-statusbar CSS 클래스 사용
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/store/appStore";
import { apiFetch } from "@/lib/apiFetch";
import type { RecentEvent, StatusSummary } from "@/types/layout";

// 상태 요약 폴링 주기 (ms)
const POLL_INTERVAL = 30_000;

export default function StatusBar() {
  const { currentProjectId } = useAppStore();
  const [eventPopupOpen, setEventPopupOpen] = useState(false);

  // AI 지표 실시간 폴링 — 프로젝트 선택 시만 활성화
  const { data: summary } = useQuery<StatusSummary>({
    queryKey: ["status-summary", currentProjectId],
    queryFn: () =>
      apiFetch<{ data: StatusSummary }>(
        `/api/projects/${currentProjectId}/status-summary`
      ).then((res) => res.data!),
    enabled: !!currentProjectId,
    refetchInterval: POLL_INTERVAL,
    // 창이 백그라운드일 때도 폴링 유지 (실시간성 우선)
    refetchIntervalInBackground: true,
  });

  // 최근 이벤트 — 팝업 열릴 때만 조회 (enabled: eventPopupOpen)
  const { data: events = [] } = useQuery<RecentEvent[]>({
    queryKey: ["events-recent", currentProjectId],
    queryFn: () =>
      apiFetch<{ data: RecentEvent[] }>(
        `/api/projects/${currentProjectId}/events/recent`
      ).then((res) => res.data ?? []),
    enabled: !!currentProjectId && eventPopupOpen,
  });

  const unsynced = summary?.unsyncedChanges ?? 0;
  const aiStats  = summary?.aiStats ?? { pending: 0, inProgress: 0, done: 0 };

  return (
    <footer className="sp-statusbar" style={{ position: "relative" }}>
      {/* 미반영 설계 변경 경고 배지 */}
      <div className={`sp-status-cell${unsynced > 0 ? " is-warn" : ""}`}>
        {unsynced > 0 && <span className="dot" />}
        <span>
          {unsynced > 0 ? `개발 이후 변경 ${unsynced}건` : "설계 동기화 완료"}
        </span>
      </div>

      {/* 뉴스 피드 티커 — 이벤트가 없으면 기본 메시지 */}
      <div className="sp-status-cell" style={{ flex: 1, overflow: "hidden" }}>
        <TickerText projectId={currentProjectId} />
      </div>

      {/* 이벤트 팝업 토글 쉐브론 */}
      <div className="sp-status-cell" style={{ cursor: "pointer" }} onClick={() => setEventPopupOpen((o) => !o)}>
        <span title="최근 이벤트 보기">
          {eventPopupOpen ? "▲" : "▾"}
        </span>
      </div>

      {/* AI 지표 배지 */}
      <div className="sp-status-cell">
        <span title="AI 대기">
          대기 {aiStats.pending}
        </span>
      </div>
      <div className="sp-status-cell">
        <span title="AI 진행 중">
          진행 {aiStats.inProgress}
        </span>
      </div>
      <div className={`sp-status-cell${aiStats.done > 0 ? " is-ok" : ""}`}>
        <span title="AI 오늘 완료">
          완료 {aiStats.done}
        </span>
      </div>

      {/* 최근 이벤트 팝업 — 하단에서 위로 솟아오르는 오버레이 */}
      {eventPopupOpen && (
        <EventPopup events={events} onClose={() => setEventPopupOpen(false)} />
      )}
    </footer>
  );
}

// ── TickerText: 티커 메시지 — 추후 marquee/animation 적용 예정
function TickerText({ projectId }: { projectId: string | null }) {
  if (!projectId) {
    return <span style={{ color: "var(--color-text-disabled)" }}>프로젝트를 선택하세요</span>;
  }
  return <span>팀 액티비티 로딩 중...</span>;
}

// ── EventPopup: 최근 이벤트 10건 목록
function EventPopup({
  events,
  onClose,
}: {
  events: RecentEvent[];
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "100%",
        right: 0,
        width: 380,
        maxHeight: 320,
        overflowY: "auto",
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "var(--radius-card) var(--radius-card) 0 0",
        boxShadow: "var(--shadow-lg)",
        zIndex: 200,
      }}
    >
      {/* 팝업 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          borderBottom: "1px solid var(--color-border-subtle)",
        }}
      >
        <span
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            color: "var(--color-text-heading)",
          }}
        >
          최근 팀 액티비티
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-tertiary)",
            fontSize: 14,
          }}
        >
          ✕
        </button>
      </div>

      {/* 이벤트 목록 */}
      {events.length === 0 ? (
        <div
          style={{
            padding: "16px 14px",
            fontSize: "var(--text-sm)",
            color: "var(--color-text-tertiary)",
            textAlign: "center",
          }}
        >
          최근 이벤트가 없습니다.
        </div>
      ) : (
        events.map((e) => (
          <div
            key={e.id}
            style={{
              display: "flex",
              gap: 10,
              padding: "7px 14px",
              borderBottom: "1px solid var(--color-border-subtle)",
            }}
          >
            {/* 액터 아바타 */}
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "var(--radius-full)",
                background: "var(--color-brand-subtle)",
                border: "1px solid var(--color-brand-border)",
                color: "var(--color-brand)",
                fontSize: 9,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {e.actor_nm.charAt(0)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--color-text-primary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <strong>{e.actor_nm}</strong> {e.content}
              </div>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-tertiary)",
                  marginTop: 1,
                }}
              >
                {formatRelativeTime(e.event_dt)}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// 상대 시간 포맷 (예: '방금 전', '3분 전', '2시간 전')
function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60)  return "방금 전";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  return `${Math.floor(diffSec / 86400)}일 전`;
}
