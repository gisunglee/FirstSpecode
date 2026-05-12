"use client";

/**
 * FeedFilters — 활동 피드 상단 필터 바
 *
 * MVP 분량:
 *   - 기간 토글 (오늘 / 7일 / 30일 / 전체)
 *
 * 추후 확장:
 *   - 이벤트 타입 다중 체크
 *   - "내 활동만" 토글
 */

import { ACTIVITY_RANGE_LABEL, type ActivityRangeKey } from "@/types/activity";

type Props = {
  range:    ActivityRangeKey;
  onChange: (next: ActivityRangeKey) => void;
};

const ORDER: ActivityRangeKey[] = ["today", "7d", "30d", "all"];

export default function FeedFilters({ range, onChange }: Props) {
  return (
    <div className="sp-tab-seg" role="tablist" aria-label="기간 필터">
      {ORDER.map((key) => (
        <div
          key={key}
          role="tab"
          aria-selected={range === key}
          className={`sp-tab-seg-item ${range === key ? "is-active" : ""}`}
          onClick={() => onChange(key)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onChange(key);
            }
          }}
        >
          {ACTIVITY_RANGE_LABEL[key]}
        </div>
      ))}
    </div>
  );
}
