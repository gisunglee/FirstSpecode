"use client";

/**
 * MyReviewsCard — 개발자뷰: 나에게 온 검토 요청 (미응답)
 *
 * 역할:
 *   - tb_ds_review_request 중 revwr_mber_id = me + REQUESTED/REVIEWING
 *   - 가장 오래된 요청부터 표시(SLA 위협 우선)
 *   - 클릭 → 검토 페이지 (현재 빌드된 review 라우트가 있으면 거기로)
 */

import Link from "next/link";
import DashboardCard from "../DashboardCard";
import { formatRelativeKo } from "@/lib/utils";

type ReviewItem = {
  reviewId:    string;
  title:       string;
  refTblNm:    string;
  refId:       string;
  sttusCode:   string;
  reqMberName: string | null;
  creatDt:     string;
};

type Props = {
  data: {
    pendingCount: number;
    items:        ReviewItem[];
  } | undefined;
  isLoading: boolean;
  error:     Error | null;
  projectId: string;
};

const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "요청됨",
  REVIEWING: "검토 중",
};

const STATUS_BADGE: Record<string, string> = {
  REQUESTED: "sp-badge-warning",
  REVIEWING: "sp-badge-info",
};

export default function MyReviewsCard({ data, isLoading, error, projectId }: Props) {
  const isEmpty = !!data && data.pendingCount === 0;

  return (
    <DashboardCard
      icon={<MailIcon />}
      title="나에게 온 검토 요청"
      badge={
        data && data.pendingCount > 0 ? (
          <span className="sp-badge sp-badge-warning">
            <span className="dot" />
            {data.pendingCount}건
          </span>
        ) : null
      }
      // 검토 통합 페이지가 아직 없으므로 reviews 라우트로 보냄(있다면 자동 매칭)
      linkHref={`/projects/${projectId}/reviews`}
      linkLabel="검토 요청 보기"
      isLoading={isLoading}
      error={error}
      isEmpty={isEmpty}
      emptyMessage="📭 미응답 검토 요청이 없습니다."
    >
      {data && data.pendingCount > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.items.map((r) => (
            <Link
              key={r.reviewId}
              href={`/projects/${projectId}/reviews/${r.reviewId}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "6px 8px",
                borderRadius: "var(--radius-sm)",
                textDecoration: "none",
                color: "var(--color-text-primary)",
              }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span
                  className={`sp-badge ${STATUS_BADGE[r.sttusCode] ?? "sp-badge-neutral"}`}
                  style={{ fontSize: "var(--text-xs)" }}
                >
                  {STATUS_LABEL[r.sttusCode] ?? r.sttusCode}
                </span>
                <span
                  style={{
                    fontSize: "var(--text-sm)",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                  title={r.title}
                >
                  {r.title}
                </span>
              </div>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-tertiary)",
                  display: "flex",
                  gap: 6,
                }}
              >
                {r.reqMberName && <span>{r.reqMberName}</span>}
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {formatRelativeKo(r.creatDt)}
                </span>
              </div>
            </Link>
          ))}

          {data.pendingCount > data.items.length && (
            <div
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-tertiary)",
                padding: "4px 8px",
              }}
            >
              외 {data.pendingCount - data.items.length}건
            </div>
          )}
        </div>
      )}
    </DashboardCard>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 6l-10 7L2 6" />
    </svg>
  );
}
