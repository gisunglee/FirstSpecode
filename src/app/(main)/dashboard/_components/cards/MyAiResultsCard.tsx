"use client";

/**
 * MyAiResultsCard — 개발자뷰: 내 AI 결과 (최근 요청, 상태 무관)
 *
 * 역할:
 *   - 내가 요청한 AI 태스크 최근 5건 — 상태와 무관하게 요청일 내림차순으로 보여준다.
 *   - 2026-07-20(2차): 원래는 "완료(DONE)·미적용"만 보여줬는데, 결과를 받고 그냥 끝나는
 *     경우(적용 개념이 없는 태스크 등)가 많아 "미적용"만 필터하면 대부분이 안 보이는
 *     문제가 있었음 — 목록은 최근 결과 전체로 넓히고, 헤더 배지만 "액션 필요"(완료·미적용)
 *     건수로 유지해 강조 신호는 그대로 살린다.
 *   - 행마다 상태 배지(진행중/결과 도착/적용됨/실패)로 구분.
 *   - 클릭 → 해당 AI 태스크 결과 페이지(있다면)
 */

import Link from "next/link";
import DashboardCard from "../DashboardCard";
import HelpButton from "@/components/common/HelpButton";
import { formatRelativeKo } from "@/lib/utils";

type AiResultItem = {
  aiTaskId:   string;
  taskTyCode: string;
  refTyCode:  string;
  /** PENDING/IN_PROGRESS/DONE/APPLIED/REJECTED/FAILED/TIMEOUT */
  sttusCode:  string;
  reqDt:      string;
  complDt:    string | null;
};

type Props = {
  data: {
    actionableCount: number;
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

// 상태 코드 → 표시 라벨/배지 톤. DONE(결과 도착, 아직 미적용)이 가장 "액션 필요"한 상태라 warning.
const STATUS_LABEL: Record<string, string> = {
  PENDING:     "대기",
  IN_PROGRESS: "진행중",
  DONE:        "결과 도착",
  APPLIED:     "적용됨",
  REJECTED:    "거절함",
  FAILED:      "실패",
  TIMEOUT:     "시간초과",
};

const STATUS_BADGE: Record<string, string> = {
  PENDING:     "sp-badge-neutral",
  IN_PROGRESS: "sp-badge-info",
  DONE:        "sp-badge-warning",
  APPLIED:     "sp-badge-success",
  REJECTED:    "sp-badge-neutral",
  FAILED:      "sp-badge-error",
  TIMEOUT:     "sp-badge-error",
};

export default function MyAiResultsCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.items.length === 0;

  return (
    <DashboardCard
      icon={<SparkIcon />}
      title="내 AI 결과"
      badge={
        data && data.actionableCount > 0 ? (
          <span className="sp-badge sp-badge-info">
            <span className="dot" />
            액션 필요 {data.actionableCount}건
          </span>
        ) : null
      }
      help={
        <HelpButton title="내 AI 결과 기준">
          <p><b>뭐다</b> — 내가 요청한 AI 태스크의 최근 결과입니다.</p>
          <p><b>기준</b> — 상태와 무관하게 최근 요청 5건, 요청일 내림차순입니다.</p>
          <p><b>배지 숫자</b> — 목록과 별개로 "완료됐는데 아직 적용 안 한"(액션 필요) 건수를 강조용으로 보여줍니다.</p>
        </HelpButton>
      }
      linkHref={`/projects/${projectId}/ai-tasks`}
      linkLabel="AI 태스크 목록"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="아직 요청한 AI 태스크가 없습니다."
    >
      {data && data.items.length > 0 && (
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
                <span
                  className={`sp-badge ${STATUS_BADGE[it.sttusCode] ?? "sp-badge-neutral"}`}
                  style={{ fontSize: "var(--text-xs)", flexShrink: 0 }}
                >
                  {STATUS_LABEL[it.sttusCode] ?? it.sttusCode}
                </span>
                <span className="sp-badge sp-badge-info" style={{ fontSize: "var(--text-xs)", flexShrink: 0 }}>
                  {TASK_TYPE_LABEL[it.taskTyCode] ?? it.taskTyCode}
                </span>
                <span
                  style={{
                    color: "var(--color-text-secondary)",
                    fontSize: "var(--text-xs)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
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
                {formatRelativeKo(it.complDt ?? it.reqDt)}
              </span>
            </Link>
          ))}
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
