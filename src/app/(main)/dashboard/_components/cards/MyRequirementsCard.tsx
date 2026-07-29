"use client";

/**
 * MyRequirementsCard — 개발자뷰: 내 요구사항
 *
 * 역할:
 *   - 내가 담당자로 지정된 요구사항 총 건수 + 미리보기 5건(행마다 분석 기간·분석률)
 *   - 클릭 → 요구사항 목록(내 담당 필터)으로 이동
 */

import Link from "next/link";
import DashboardCard from "../DashboardCard";
import HelpButton from "@/components/common/HelpButton";

type RequirementItem = {
  reqId:     string;
  displayId: string;
  name:      string;
  startDate: string | null;
  endDate:   string | null;
  progress:  number;
};

type Props = {
  data: {
    count: number;
    items: RequirementItem[];
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

export default function MyRequirementsCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.count === 0;

  return (
    <DashboardCard
      icon={<ReqIcon />}
      title="내 요구사항"
      badge={
        data && data.count > 0 ? (
          <span className="sp-badge sp-badge-brand">
            <span className="dot" />
            {data.count}건
          </span>
        ) : null
      }
      help={
        <HelpButton title="내 요구사항 기준">
          <p>내가 담당자로 지정된 요구사항입니다.</p>
          <p><b>기간</b> — 분석 시작일 ~ 종료일. <b>%</b> — 분석 진척률(직접 입력값)입니다.</p>
        </HelpButton>
      }
      // assignedTo=me 필터 URL — 요구사항 목록 페이지가 querystring 받으면 자동 적용
      linkHref={`/projects/${projectId}/requirements?assignedTo=me`}
      linkLabel="내 담당 요구사항 모두 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="담당 요구사항이 없습니다."
    >
      {data && data.count > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {data.items.map((r) => (
            <Link
              key={r.reqId}
              href={`/projects/${projectId}/requirements/${r.reqId}`}
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
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={r.name}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize:  "var(--text-xs)",
                    color:     "var(--color-text-tertiary)",
                    marginRight: 6,
                  }}
                >
                  {r.displayId}
                </span>
                {r.name}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize:   "var(--text-xs)",
                  color:      "var(--color-text-secondary)",
                  whiteSpace: "nowrap",
                }}
              >
                {r.startDate ?? "-"} ~ {r.endDate ?? "-"} · {r.progress}%
              </span>
            </Link>
          ))}
        </div>
      )}
    </DashboardCard>
  );
}

function ReqIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  );
}
