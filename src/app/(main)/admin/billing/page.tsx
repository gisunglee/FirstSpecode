"use client";

/**
 * AdminBillingPage — 관리자 > 결제 (/admin/billing)
 *
 * 역할:
 *   - 요약 카드: 구독 중·재시도 중·해지 예약·좌석 합·월 예정 청구액·7일 내 결제 예정·잠긴 프로젝트·
 *     최근 30일 실패·이번 달 순매출·마지막 배치 결과
 *   - [구독] 탭: 상태 필터·검색·페이지네이션. 행 클릭 → 구독 상세(운영 액션)
 *   - [결제 이력] 탭: 기간·상태·유형·검색 필터, 금액 합계, 엑셀 다운로드(PG 정산 대조용)
 *
 * URL: /admin/billing?tab=subscriptions|payments&status=...
 * 정책 근거: .claude/biz/B.결제정책.md §3-1 (2026-09-21 관리자 결제 화면)
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import ExcelDownloadButton from "@/components/common/ExcelDownloadButton";
import type { AdminPaymentRow, AdminSubscriptionRow, BillingSummary, Pagination } from "@/lib/billing/admin";
import { formatKstDate, formatWon } from "@/lib/billing/pricing";
import { fmtDate, fmtDateTime, Pager, PAYMENT_TYPE_LABEL, PaymentStatusBadge, SUB_STATUS_BADGE, SUB_STATUS_OPTIONS } from "./_shared";

const PAGE_SIZE = 50;

// ─── 페이지 ──────────────────────────────────────────────────────────────────

export default function AdminBillingPage() {
  return (
    <Suspense fallback={null}>
      <AdminBillingInner />
    </Suspense>
  );
}

function AdminBillingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") === "payments" ? "payments" : "subscriptions";

  const summary = useQuery({
    queryKey: ["admin", "billing", "summary", "full"],
    queryFn:  () => authFetch<{ data: BillingSummary }>("/api/admin/billing/summary").then((r) => r.data),
    staleTime: 60 * 1000,
  });

  function switchTab(next: "subscriptions" | "payments") {
    const sp = new URLSearchParams(params.toString());
    sp.set("tab", next);
    router.replace(`/admin/billing?${sp.toString()}`);
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {summary.data && <SummaryCards s={summary.data} />}
      {summary.isError && <div className="sp-hint is-err">{(summary.error as Error).message}</div>}

      <div className="sp-tab-bar">
        <div className={`sp-tab${tab === "subscriptions" ? " is-active" : ""}`} onClick={() => switchTab("subscriptions")}>구독</div>
        <div className={`sp-tab${tab === "payments" ? " is-active" : ""}`} onClick={() => switchTab("payments")}>결제 이력</div>
      </div>

      {tab === "subscriptions" ? <SubscriptionsTab initialStatus={params.get("status") ?? "LIVE"} /> : <PaymentsTab />}
    </div>
  );
}

// ─── 요약 카드 ───────────────────────────────────────────────────────────────

function SummaryCards({ s }: { s: BillingSummary }) {
  const batchTone =
    !s.lastBatch ? "var(--color-text-tertiary)" :
    s.lastBatch.status === "SUCCESS" ? "var(--color-success)" :
    s.lastBatch.status === "RUNNING" ? "var(--color-info)" : "var(--color-error)";
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {s.provider === "MOCK" && (
        <div className="sp-hint is-warn" style={{ padding: "8px 12px", border: "1px solid var(--color-warning-border)", borderRadius: "var(--radius-sm)", background: "var(--color-warning-subtle)" }}>
          현재 PG 는 Mock 입니다. 아래 금액은 실제 매출이 아닙니다. 토스 전환 후 이 안내가 사라집니다.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <Card label="구독 중 (살아 있는)" value={String(s.liveCount)} hint={`이용 중 ${s.activeCount} · 재시도 ${s.pastDueCount} · 해지 예약 ${s.cancelScheduledCount}`} />
        <Card label="재시도 중 (강등 임박)" value={String(s.pastDueCount)} tone={s.pastDueCount > 0 ? "var(--color-error)" : undefined} hint="3일 간격 3회 실패 시 FREE 강등" />
        <Card label="월 예정 청구액" value={formatWon(s.monthlyExpectedAmount)} hint={`좌석 합 ${s.seatTotal} · 해지 예약 제외`} />
        <Card label="7일 내 결제 예정" value={String(s.dueWithin7Days)} hint="사전 안내 메일 대상" />
        <Card label="이번 달 순매출 (KST)" value={formatWon(s.paidAmountThisMonth)} hint="완료 − 환불" />
        <Card label="최근 30일 결제 실패" value={String(s.failedPaymentsLast30d)} tone={s.failedPaymentsLast30d > 0 ? "var(--color-warning)" : undefined} />
        <Card label="잠긴 프로젝트" value={String(s.lockedProjectCount)} tone={s.lockedProjectCount > 0 ? "var(--color-warning)" : undefined} hint="강등으로 읽기 전용" />
        <Card
          label="마지막 일일 배치"
          value={s.lastBatch ? s.lastBatch.status : "실행 기록 없음"}
          tone={batchTone}
          hint={s.lastBatch ? `${fmtDateTime(s.lastBatch.startedAt)} · 대상 ${s.lastBatch.targetCnt} / 처리 ${s.lastBatch.successCnt} / 실패 ${s.lastBatch.failCnt}` : "cron 등록 여부 확인"}
          href="/admin/batch"
        />
      </div>
    </div>
  );
}

function Card({ label, value, hint, tone, href }: { label: string; value: string; hint?: string; tone?: string; href?: string }) {
  const body = (
    <div style={{ padding: 16, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-card)", height: "100%" }}>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone ?? "var(--color-text-heading)", lineHeight: 1.2 }}>{value}</div>
      {hint && <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: 6 }}>{hint}</div>}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none" }}>{body}</Link> : body;
}

// ─── 구독 탭 ─────────────────────────────────────────────────────────────────

function SubscriptionsTab({ initialStatus }: { initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ["admin", "billing", "subscriptions", { status, search, page }],
    queryFn: () =>
      authFetch<{ data: { items: AdminSubscriptionRow[]; pagination: Pagination } }>(
        `/api/admin/billing/subscriptions?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}&page=${page}&pageSize=${PAGE_SIZE}`,
      ).then((r) => r.data),
  });
  const items = q.data?.items ?? [];
  const pg = q.data?.pagination;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select className="sp-input sp-input-fixed sp-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 200 }}>
          {SUB_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          className="sp-input sp-input-fixed" placeholder="회원 이메일 또는 이름" value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
          onBlur={() => { setSearch(searchInput); setPage(1); }}
          style={{ width: 260 }}
        />
        <div style={{ marginLeft: "auto", fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>총 {pg?.totalCount ?? 0}건</div>
      </div>

      {q.isError && <div className="sp-hint is-err">{(q.error as Error).message}</div>}

      <div className="sp-table-wrap">
        <table className="sp-table">
          <thead>
            <tr>
              <th>회원</th><th>상태</th><th>좌석 (구매)</th><th>다음 결제</th><th style={{ textAlign: "right" }}>예정 금액</th><th>결제 수단</th><th>실패</th><th>PG</th><th>종료일</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={9} className="is-muted" style={{ textAlign: "center" }}>불러오는 중…</td></tr>}
            {!q.isLoading && items.length === 0 && <tr><td colSpan={9} className="is-muted" style={{ textAlign: "center" }}>조건에 맞는 구독이 없습니다.</td></tr>}
            {items.map((s) => {
              const b = SUB_STATUS_BADGE[s.status] ?? { label: s.status, cls: "sp-badge-neutral" };
              return (
                <tr key={s.subscriptionId}>
                  <td>
                    <Link href={`/admin/billing/${s.subscriptionId}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 600 }}>
                      {s.member.email ?? s.member.mberId.slice(0, 8)}
                    </Link>
                    {s.member.name && <span className="is-muted" style={{ marginLeft: 6, fontSize: "var(--text-xs)" }}>{s.member.name}</span>}
                  </td>
                  <td><span className={`sp-badge ${b.cls}`}>{b.label}</span></td>
                  <td className="is-mono">{s.seatCnt}{s.pendingSeatCnt !== null && <span className="is-muted"> → {s.pendingSeatCnt}</span>}</td>
                  <td className="is-mono">{s.status === "CANCEL_SCHEDULED" ? `${fmtDate(s.currentPeriodEnd)} 종료` : fmtDate(s.nextBillAt)}</td>
                  <td className="is-mono" style={{ textAlign: "right" }}>{s.status === "CANCEL_SCHEDULED" || s.endedAt ? "-" : formatWon(s.nextChargeAmount)}</td>
                  <td className="is-muted">{s.card ? `${s.card.company} ${s.card.numberMasked.slice(-4)}` : "-"}</td>
                  <td className="is-mono" style={{ color: s.failCnt > 0 ? "var(--color-error)" : undefined }}>{s.failCnt > 0 ? `${s.failCnt}회` : "-"}</td>
                  <td className="is-muted">{s.provider}</td>
                  <td className="is-mono is-muted">{fmtDate(s.endedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager pg={pg} page={page} setPage={setPage} />
    </div>
  );
}

// ─── 결제 이력 탭 ────────────────────────────────────────────────────────────

function PaymentsTab() {
  const today = formatKstDate(new Date());
  const monthStart = today.slice(0, 8) + "01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const qs = `from=${from}&to=${to}&status=${status}&type=${type}&search=${encodeURIComponent(search)}`;
  const q = useQuery({
    queryKey: ["admin", "billing", "payments", { from, to, status, type, search, page }],
    queryFn: () =>
      authFetch<{ data: { items: AdminPaymentRow[]; pagination: Pagination; sumAmount: number } }>(
        `/api/admin/billing/payments?${qs}&page=${page}&pageSize=${PAGE_SIZE}`,
      ).then((r) => r.data),
  });
  const items = q.data?.items ?? [];
  const pg = q.data?.pagination;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input className="sp-input sp-input-fixed" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} style={{ width: 150 }} />
        <span className="is-muted">~</span>
        <input className="sp-input sp-input-fixed" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} style={{ width: 150 }} />
        <select className="sp-input sp-input-fixed sp-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 130 }}>
          <option value="">전체 상태</option><option value="PAID">완료</option><option value="FAILED">실패</option><option value="REFUNDED">환불</option>
        </select>
        <select className="sp-input sp-input-fixed sp-select" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} style={{ width: 140 }}>
          <option value="">전체 구분</option>
          {Object.entries(PAYMENT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input
          className="sp-input sp-input-fixed" placeholder="회원 이메일 또는 이름" value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
          onBlur={() => { setSearch(searchInput); setPage(1); }}
          style={{ width: 220 }}
        />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)" }}>
          <span>총 {pg?.totalCount ?? 0}건 · 순액 <b style={{ color: "var(--color-text-primary)" }}>{formatWon(q.data?.sumAmount ?? 0)}</b></span>
          <ExcelDownloadButton href={`/api/admin/billing/payments/export?${qs}`} entityKey="billing-payments" disabled={q.isLoading} />
        </div>
      </div>

      {q.isError && <div className="sp-hint is-err">{(q.error as Error).message}</div>}

      <div className="sp-table-wrap">
        <table className="sp-table">
          <thead>
            <tr><th>일시</th><th>회원</th><th>구분</th><th>좌석</th><th>기간</th><th style={{ textAlign: "right" }}>금액</th><th>상태</th><th>주문 ID</th><th>PG</th><th>영수증</th></tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={10} className="is-muted" style={{ textAlign: "center" }}>불러오는 중…</td></tr>}
            {!q.isLoading && items.length === 0 && <tr><td colSpan={10} className="is-muted" style={{ textAlign: "center" }}>조건에 맞는 결제 이력이 없습니다.</td></tr>}
            {items.map((p) => (
              <tr key={p.paymentId}>
                <td className="is-mono">{fmtDateTime(p.approvedAt ?? p.createdAt)}</td>
                <td>{p.member.email ?? p.member.mberId.slice(0, 8)}</td>
                <td>{PAYMENT_TYPE_LABEL[p.type] ?? p.type}</td>
                <td className="is-mono">{p.type === "SEAT_ADD" ? `+${p.seatCnt}` : p.seatCnt}</td>
                <td className="is-mono is-muted">{p.periodStart ? `${fmtDate(p.periodStart)} ~ ${fmtDate(p.periodEnd)}` : "-"}</td>
                <td className="is-mono" style={{ textAlign: "right", color: p.amount < 0 ? "var(--color-error)" : undefined }}>{formatWon(p.amount)}</td>
                <td><PaymentStatusBadge status={p.status} title={p.failReason ?? undefined} /></td>
                <td className="is-mono is-muted" style={{ fontSize: "var(--text-xs)" }}>{p.orderId}</td>
                <td className="is-muted">{p.provider}</td>
                <td>{p.receiptUrl ? <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer">보기</a> : <span className="is-muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager pg={pg} page={page} setPage={setPage} />
    </div>
  );
}
