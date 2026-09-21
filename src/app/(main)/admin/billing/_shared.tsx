"use client";

/**
 * 관리자 결제 화면 공용 — 상태 라벨·배지·날짜 포맷·페이저
 *
 * page.tsx 는 Next.js 규칙상 default 외 export 를 둘 수 없어 목록·상세가 함께 쓰는 조각을 여기에 둔다.
 */

import { formatKstDate } from "@/lib/billing/pricing";
import type { Pagination } from "@/lib/billing/admin";

export const SUB_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "LIVE",             label: "살아 있는 구독" },
  { value: "",                 label: "전체" },
  { value: "ACTIVE",           label: "이용 중" },
  { value: "PAST_DUE",         label: "결제 실패 · 재시도 중" },
  { value: "CANCEL_SCHEDULED", label: "해지 예약" },
  { value: "CANCELED",         label: "해지됨" },
  { value: "EXPIRED",          label: "결제 실패로 종료" },
];

export const SUB_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ACTIVE:           { label: "이용 중",   cls: "sp-badge-success" },
  PAST_DUE:         { label: "재시도 중", cls: "sp-badge-error" },
  CANCEL_SCHEDULED: { label: "해지 예약", cls: "sp-badge-warning" },
  CANCELED:         { label: "해지됨",    cls: "sp-badge-neutral" },
  EXPIRED:          { label: "실패 종료", cls: "sp-badge-neutral" },
};

export const PAYMENT_TYPE_LABEL: Record<string, string> = {
  INITIAL: "구독 시작", RECURRING: "정기 결제", SEAT_ADD: "좌석 추가", REFUND: "환불",
};

export function fmtDate(iso: string | null | undefined): string {
  return iso ? formatKstDate(new Date(iso)) : "-";
}
export function fmtDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "-";
}

export function PaymentStatusBadge({ status, title }: { status: string; title?: string }) {
  if (status === "PAID")     return <span className="sp-badge sp-badge-success">완료</span>;
  if (status === "FAILED")   return <span className="sp-badge sp-badge-error" title={title}>실패</span>;
  if (status === "REFUNDED") return <span className="sp-badge sp-badge-neutral" title={title}>환불</span>;
  return <span className="sp-badge sp-badge-neutral">{status}</span>;
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
