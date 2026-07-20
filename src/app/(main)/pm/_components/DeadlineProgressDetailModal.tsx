"use client";

/**
 * DeadlineProgressDetailModal — 마감 임박 × 진척률 히트맵 상세 팝업 (드릴다운)
 *
 * 역할:
 *   - 히트맵 셀(엔티티 × 마감버킷 × 진척버킷) 하나를 클릭하면 그 조합의 실제 항목을 보여줌.
 *   - 항목명은 상세 페이지로 바로가기 링크.
 *   - 페이징 없이 최대 100건 — /api/projects/[id]/pm-deadline-progress-detail
 *
 * AnalysisDetailModal.tsx/MissingDetailModal.tsx 와 동일한 톤(링크 색은 검정, 긴 이름은 폰트 축소).
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { authFetch } from "@/lib/authFetch";
import { DEADLINE_ENTITY_LABELS, DEADLINE_BUCKET_LABELS, PROGRESS_BUCKET_LABELS, PROGRESS_KIND_LABELS } from "@/types/pm";
import type {
  DeadlineEntityKind, DeadlineBucket, ProgressBucket, DeadlineProgressDetailItem, ProgressKind,
} from "@/types/pm";

type Props = {
  projectId: string;
  onClose:   () => void;
  entity:         DeadlineEntityKind;
  progressKind:   ProgressKind;
  asOf:           string;
  deadlineBucket: DeadlineBucket;
  progressBucket: ProgressBucket;
};

export default function DeadlineProgressDetailModal({
  projectId, onClose, entity, progressKind, asOf, deadlineBucket, progressBucket,
}: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pm-deadline-progress-detail", projectId, entity, progressKind, asOf, deadlineBucket, progressBucket],
    queryFn: () =>
      authFetch<{ data: { items: DeadlineProgressDetailItem[]; total: number } }>(
        `/api/projects/${projectId}/pm-deadline-progress-detail?entity=${entity}&progressKind=${progressKind}&asOf=${asOf}&deadlineBucket=${deadlineBucket}&progressBucket=${progressBucket}`
      ).then((r) => r.data),
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(760px, 95vw)", maxHeight: "85vh",
          background: "var(--color-bg-card)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-muted)",
        }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
            마감 임박 상세
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-brand)", background: "var(--color-brand-subtle)", padding: "2px 8px", borderRadius: "var(--radius-sm)" }}>
              {DEADLINE_ENTITY_LABELS[entity]} · {PROGRESS_KIND_LABELS[progressKind]} · {DEADLINE_BUCKET_LABELS[deadlineBucket]} · {PROGRESS_BUCKET_LABELS[progressBucket]} · 기준일 {asOf}
            </span>
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-secondary)", padding: "0 4px", lineHeight: 1 }}
          >×</button>
        </div>

        {/* 본문 — 표 */}
        <div style={{ overflow: "auto", flex: 1 }}>
          {isLoading ? (
            <div style={{ padding: 20, color: "var(--color-text-tertiary)", fontSize: 15 }}>불러오는 중...</div>
          ) : error ? (
            <div style={{ padding: 20, color: "var(--color-error)", fontSize: 15 }}>⚠ {(error as Error).message}</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 15 }}>조건에 맞는 항목이 없습니다.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
              <thead>
                <tr style={{ background: "var(--color-bg-muted)", borderBottom: "1px solid var(--color-border)" }}>
                  <Th>항목</Th>
                  <Th>담당자</Th>
                  <Th>시작일</Th>
                  <Th>종료일</Th>
                  <Th align="right">진척률</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <Td>
                      <Link
                        href={it.href}
                        style={{ color: "var(--color-text-primary)", textDecoration: "none", fontSize: it.name.length > 10 ? 11 : undefined }}
                      >
                        {it.name || <Muted>(이름 없음)</Muted>}
                      </Link>
                    </Td>
                    <Td>{it.memberName ?? <Muted>미지정</Muted>}</Td>
                    <Td mono>{it.startDate ?? <Muted>-</Muted>}</Td>
                    <Td mono>{it.endDate ?? <Muted>-</Muted>}</Td>
                    <Td align="right" mono>{it.progress}%</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ padding: "8px 20px", fontSize: 14, color: "var(--color-text-tertiary)", borderTop: "1px solid var(--color-border)" }}>
          {total > items.length
            ? `총 ${total}건 중 ${items.length}건 표시 (최대 100건)`
            : `총 ${total}건`}
        </div>
      </div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) {
  return (
    <th style={{
      textAlign: align, padding: "8px 12px", fontSize: "var(--text-base)", fontWeight: 600,
      color: "var(--color-text-tertiary)", whiteSpace: "nowrap",
    }}>
      {children}
    </th>
  );
}

function Td({ children, align = "left", mono = false }: { children: React.ReactNode; align?: "left" | "right" | "center"; mono?: boolean }) {
  return (
    <td style={{
      textAlign: align, padding: "7px 12px", color: "var(--color-text-primary)",
      fontFamily: mono ? "var(--font-mono)" : undefined,
      whiteSpace: "nowrap",
    }}>
      {children}
    </td>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--color-text-tertiary)" }}>{children}</span>;
}
