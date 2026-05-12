"use client";

/**
 * MyAiResultsCard — 개발자뷰: 내가 요청한 AI 태스크 결과 (DONE + 미적용)
 *
 * 역할:
 *   - 내가 요청한 AI 태스크 중 task_sttus_code='DONE' AND apply_dt IS NULL 인 항목
 *   - 사용자가 결과를 확인·반영하지 않은 것이므로 "행동 필요" 카드.
 *   - 클릭 → 해당 AI 태스크 결과 페이지(있다면)
 */

import Link from "next/link";
import DashboardCard from "../DashboardCard";
import { formatRelativeKo } from "@/lib/utils";

type AiResultItem = {
  aiTaskId:   string;
  taskTyCode: string;
  refTyCode:  string;
  complDt:    string | null;
};

type Props = {
  data: {
    count: number;
    items: AiResultItem[];
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

const TASK_TYPE_LABEL: Record<string, string> = {
  INSPECT:   "명세 검토",
  DESIGN:    "설계",
  IMPLEMENT: "구현",
  MOCKUP:    "목업",
  IMPACT:    "영향도",
  CUSTOM:    "자유",
};

const REF_TYPE_LABEL: Record<string, string> = {
  UNIT_WORK: "단위업무",
  AREA:      "영역",
  FUNCTION:  "기능",
  SCREEN:    "화면",
};

export default function MyAiResultsCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.count === 0;

  return (
    <DashboardCard
      icon={<SparkIcon />}
      title="내 AI 결과 — 미적용"
      badge={
        data && data.count > 0 ? (
          <span className="sp-badge sp-badge-info">
            <span className="dot" />
            {data.count}건
          </span>
        ) : null
      }
      linkHref={`/projects/${projectId}/ai-tasks`}
      linkLabel="AI 태스크 목록"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="확인할 AI 결과가 없습니다."
    >
      {data && data.count > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.items.map((it) => (
            <Link
              key={it.aiTaskId}
              href={`/projects/${projectId}/ai-tasks/${it.aiTaskId}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 8px",
                borderRadius: "var(--radius-sm)",
                textDecoration: "none",
                color: "var(--color-text-primary)",
                fontSize: "var(--text-sm)",
                gap: 8,
              }}
            >
              <span style={{ display: "flex", gap: 6, alignItems: "center", flex: 1, minWidth: 0 }}>
                <span className="sp-badge sp-badge-info" style={{ fontSize: "var(--text-xs)" }}>
                  {TASK_TYPE_LABEL[it.taskTyCode] ?? it.taskTyCode}
                </span>
                <span
                  style={{
                    color: "var(--color-text-secondary)",
                    fontSize: "var(--text-xs)",
                  }}
                >
                  {REF_TYPE_LABEL[it.refTyCode] ?? it.refTyCode}
                </span>
              </span>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-tertiary)",
                  fontFamily: "var(--font-mono)",
                  whiteSpace: "nowrap",
                }}
              >
                {it.complDt ? formatRelativeKo(it.complDt) : "-"}
              </span>
            </Link>
          ))}

          {data.count > data.items.length && (
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-tertiary)",
                padding: "4px 8px",
              }}
            >
              외 {data.count - data.items.length}건
            </div>
          )}
        </div>
      )}
    </DashboardCard>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M18.4 5.6l-4.2 4.2M9.8 14.2l-4.2 4.2" />
    </svg>
  );
}
