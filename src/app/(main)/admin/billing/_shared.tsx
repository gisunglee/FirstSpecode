"use client";

/**
 * 관리자 결제 화면 공용 — 상태 배지·날짜 포맷·페이저
 *
 * page.tsx 는 Next.js 규칙상 default 외 export 를 둘 수 없어 목록·상세가 함께 쓰는 조각을 여기에 둔다.
 * 라벨 문자열은 src/lib/billing/constants.ts 한 곳에서 온다(사용자 화면·회원 상세와 공용).
 */

import { formatKstDate } from "@/lib/billing/pricing";
import { PAYMENT_STATUS_LABEL, SUBSCRIPTION_STATUS_LABEL } from "@/lib/billing/constants";
import type { Pagination } from "@/lib/billing/admin-queries";

export const SUB_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "LIVE", label: "살아 있는 구독" },
  { value: "",     label: "전체" },
  ...Object.entries(SUBSCRIPTION_STATUS_LABEL).map(([value, label]) => ({ value, label })),
];

const SUB_STATUS_CLS: Record<string, string> = {
  ACTIVE: "sp-badge-success", PAST_DUE: "sp-badge-error", CANCEL_SCHEDULED: "sp-badge-warning",
  CANCELED: "sp-badge-neutral", EXPIRED: "sp-badge-neutral",
};

export function SubStatusBadge({ status }: { status: string }) {
  const label = (SUBSCRIPTION_STATUS_LABEL as Record<string, string>)[status] ?? status;
  return <span className={`sp-badge ${SUB_STATUS_CLS[status] ?? "sp-badge-neutral"}`}><span className="dot" />{label}</span>;
}

export function fmtDate(iso: string | null | undefined): string {
  return iso ? formatKstDate(new Date(iso)) : "-";
}
export function fmtDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "-";
}

const PAY_STATUS_CLS: Record<string, string> = {
  PAID: "sp-badge-success", FAILED: "sp-badge-error", PARTIALLY_REFUNDED: "sp-badge-warning", REFUNDED: "sp-badge-neutral",
};

export function PaymentStatusBadge({ status, title }: { status: string; title?: string }) {
  const label = (PAYMENT_STATUS_LABEL as Record<string, string>)[status] ?? status;
  return <span className={`sp-badge ${PAY_STATUS_CLS[status] ?? "sp-badge-neutral"}`} title={title}>{label}</span>;
}

export function Pager({ pg, page, setPage }: { pg: Pagination | undefined; page: number; setPage: (f: (p: number) => number) => void }) {
  if (!pg || pg.totalPages <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
      <button className="sp-btn sp-btn-ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>이전</button>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", padding: "0 12px" }}>{page} / {pg.totalPages}</span>
      <button className="sp-btn sp-btn-ghost" onClick={() => setPage((p) => Math.min(pg.totalPages, p + 1))} disabled={page >= pg.totalPages}>다음</button>
    </div>
  );
}
