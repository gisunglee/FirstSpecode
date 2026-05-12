"use client";

/**
 * FeedItem — 활동 피드의 한 행
 *
 * 역할:
 *   - ActivityEvent 한 건을 "아이콘 + 행위자 + 동작 + 대상 + 시각" 한 줄로 표시
 *   - 종류별로 아이콘/색/문장 모양만 다르고 레이아웃은 동일
 */

import { formatRelativeKo } from "@/lib/utils";
import type { ActivityEvent } from "@/types/activity";

type Props = { event: ActivityEvent };

// 종류별 시각적 메타 — 한 곳에서 관리해 새 이벤트 타입 추가 시 이곳만 수정.
const KIND_VISUAL: Record<ActivityEvent["kind"], {
  icon:    string; // 이모지 — 색상 시그널 + 의미 전달
  tone:    string; // sp-badge-* 클래스 매핑
}> = {
  DESIGN_CHANGE:  { icon: "✏️", tone: "sp-badge-info" },
  REVIEW_REQUEST: { icon: "📬", tone: "sp-badge-warning" },
  AI_TASK_DONE:   { icon: "🤖", tone: "sp-badge-brand" },
};

export default function FeedItem({ event }: Props) {
  const v = KIND_VISUAL[event.kind];
  const sentence = composeSentence(event);

  return (
    <div
      className="sp-feed-row"
      style={{
        display: "flex",
        gap: 12,
        padding: "10px 12px",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      {/* 아이콘 영역 */}
      <div
        aria-hidden
        style={{
          flexShrink: 0,
          width: 32, height: 32,
          borderRadius: "var(--radius-full)",
          background: "var(--color-bg-elevated)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16,
        }}
      >
        {v.icon}
      </div>

      {/* 본문 */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            // 행위자 이름은 굵게, 동사는 보통, 대상은 모노 코드 + 타입 라벨
            display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline",
          }}
        >
          {sentence}
        </div>
        {event.meta.reason || event.meta.title ? (
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={(event.meta.reason ?? event.meta.title) ?? undefined}
          >
            {event.meta.reason ?? event.meta.title}
          </div>
        ) : null}
      </div>

      {/* 시각 — 우측 정렬, 모노 */}
      <div
        style={{
          flexShrink: 0,
          fontSize: "var(--text-xs)",
          color: "var(--color-text-tertiary)",
          fontFamily: "var(--font-mono)",
          whiteSpace: "nowrap",
        }}
        title={event.occurredAt}
      >
        {formatRelativeKo(event.occurredAt)}
      </div>
    </div>
  );
}

// ── 문장 조립 ───────────────────────────────────────────────────────────────
//
// 종류별로 "누가 — 무엇을 — 어떻게" 어순을 맞춤.
// React 노드로 반환 — 굵게/색 강조를 인라인 span 으로.
function composeSentence(e: ActivityEvent): React.ReactNode {
  const actor = (
    <strong style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
      {e.actorName ?? "(알 수 없음)"}
    </strong>
  );
  const target = e.targetLabel ? (
    <span
      style={{
        fontSize: "var(--text-xs)",
        color: "var(--color-text-secondary)",
        fontFamily: "var(--font-mono)",
      }}
    >
      [{e.targetLabel}]
    </span>
  ) : null;

  switch (e.kind) {
    case "DESIGN_CHANGE":
      return (
        <>
          {actor}
          <span style={{ color: "var(--color-text-secondary)" }}>
            {e.meta.chgTypeLbl ?? "변경"}
          </span>
          {target}
        </>
      );
    case "REVIEW_REQUEST":
      return (
        <>
          {actor}
          <span style={{ color: "var(--color-text-secondary)" }}>→</span>
          <span style={{ color: "var(--color-text-primary)" }}>
            {e.meta.reviewerName ?? "(검토자)"}
          </span>
          <span style={{ color: "var(--color-text-secondary)" }}>검토 요청</span>
          {target}
        </>
      );
    case "AI_TASK_DONE":
      return (
        <>
          {actor}
          <span style={{ color: "var(--color-text-secondary)" }}>
            요청한 AI {e.meta.taskTyLbl ?? "작업"} 완료
          </span>
          {target}
        </>
      );
  }
}
