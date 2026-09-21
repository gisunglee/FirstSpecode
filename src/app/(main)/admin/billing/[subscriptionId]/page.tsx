"use client";

/**
 * AdminSubscriptionDetailPage — 구독 상세·운영 액션 (/admin/billing/[subscriptionId])
 *
 * 역할:
 *   - 구독 정보(회원·상태·좌석 구매/사용·주기·다음 결제·카드·실패 회차) + 환불 판정 3플래그
 *   - 소유 프로젝트 표(잠금 상태·멤버 수) + 잠금 해제 대행(상한 초과면 force + 사유)
 *   - 운영 액션: 즉시 재결제(PAST_DUE) · 다음 결제일 연기(ACTIVE) · 강제 종료(살아 있는 구독)
 *   - 결제 이력(최근 100건) + 완료 건마다 환불 기록
 *
 * 모든 액션은 사유 필수, 서버가 감사 로그를 남긴다. 좌석·단가·플랜은 여기서 바꾸지 않는다(정책 §1-10).
 */

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch, AuthFetchError } from "@/lib/authFetch";
import type { AdminSubscriptionDetail } from "@/lib/billing/admin";
import type { PaymentDto, RecurringChargeResult } from "@/lib/billing/subscription";
import { formatWon } from "@/lib/billing/pricing";
import { fmtDate, fmtDateTime, PAYMENT_TYPE_LABEL, PaymentStatusBadge, SUB_STATUS_BADGE } from "../_shared";

export default function AdminSubscriptionDetailPage() {
  const { subscriptionId } = useParams<{ subscriptionId: string }>();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["admin", "billing", "subscription", subscriptionId],
    queryFn:  () => authFetch<{ data: AdminSubscriptionDetail }>(`/api/admin/billing/subscriptions/${subscriptionId}`).then((r) => r.data),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["admin", "billing"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  }

  // 모달 상태 — 한 번에 하나
  type Modal =
    | { kind: "retry" } | { kind: "defer" } | { kind: "terminate" }
    | { kind: "refund"; payment: PaymentDto }
    | { kind: "unlock"; projectId: string; name: string; force: boolean };
  const [modal, setModal] = useState<Modal | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(7);
  const [refundAmount, setRefundAmount] = useState(0);

  function open(m: Modal) {
    setReason("");
    if (m.kind === "refund") setRefundAmount(m.payment.amount);
    setModal(m);
  }

  const post = <T,>(url: string, body: unknown) =>
    authFetch<{ data: T }>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.data);

  const action = useMutation({
    mutationFn: async () => {
      if (!modal) return null;
      const base = `/api/admin/billing/subscriptions/${subscriptionId}`;
      switch (modal.kind) {
        case "retry":     return post<RecurringChargeResult>(`${base}/retry`, { reason });
        case "defer":     return post(`${base}/defer`, { days, reason });
        case "terminate": return post(`${base}/terminate`, { reason });
        case "refund":    return post(`/api/admin/billing/payments/${modal.payment.paymentId}/refund`, { amount: refundAmount, reason });
        case "unlock":    return post(`/api/admin/projects/${modal.projectId}/unlock`, { reason, force: modal.force });
      }
    },
    onSuccess: (r) => {
      const kind = modal?.kind;
      if (kind === "retry") {
        const rr = r as RecurringChargeResult;
        toast[rr.ok ? "success" : "error"](rr.ok ? `재결제 성공 — ${formatWon(rr.amount)}` : rr.skipped ? "다른 결제 처리가 진행 중이라 건너뛰었습니다." : rr.expired ? "재결제 실패 — 재시도 소진으로 구독이 종료되었습니다." : `재결제 실패 (fail_cnt=${rr.failCnt})`, { duration: 7000 });
      } else if (kind === "defer")     toast.success(`다음 결제일을 ${days}일 연기했습니다.`);
      else if (kind === "terminate")   toast.success("구독을 종료했습니다. 회원에게 강등 메일이 발송됩니다.");
      else if (kind === "refund")      toast.success("환불 이력을 기록했습니다.");
      else if (kind === "unlock")      toast.success("프로젝트 잠금을 해제했습니다.");
      setModal(null);
      refresh();
    },
    onError: (err: Error) => {
      // 상한 초과 → 강제 해제 안내로 전환
      if (modal?.kind === "unlock" && err instanceof AuthFetchError && err.code === "PROJECT_UNLOCK_OVER_LIMIT" && !modal.force) {
        toast.error(err.message, { duration: 8000 });
        setModal({ ...modal, force: true });
        return;
      }
      toast.error(err.message, { duration: 7000 });
    },
  });

  if (q.isLoading) return <div style={{ color: "var(--color-text-tertiary)" }}>불러오는 중…</div>;
  if (q.isError || !q.data) return <div className="sp-hint is-err">{(q.error as Error)?.message ?? "구독을 찾을 수 없습니다."}</div>;

  const { subscription: s, usedSeats, paidUsage, ownedProjects, payments } = q.data;
  const live = s.status === "ACTIVE" || s.status === "PAST_DUE" || s.status === "CANCEL_SCHEDULED";
  const badge = SUB_STATUS_BADGE[s.status] ?? { label: s.status, cls: "sp-badge-neutral" };
  const busy = action.isPending;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div><Link href="/admin/billing" style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", textDecoration: "none" }}>← 결제</Link></div>

      {/* 구독 정보 */}
      <section className="sp-group">
        <div className="sp-group-header">
          <div className="sp-group-title">
            {s.member.email ?? s.member.mberId}{s.member.name && <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400, marginLeft: 8 }}>{s.member.name}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={`sp-badge ${badge.cls}`}><span className="dot" />{badge.label}</span>
            <Link href={`/admin/users/${s.member.mberId}`} className="sp-btn sp-btn-ghost sp-btn-xs">회원 상세</Link>
          </div>
        </div>
        <div className="sp-group-body" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, fontSize: "var(--text-sm)" }}>
            <Info label="상품" value={`${s.productName} · ${s.provider}`} />
            <Info label="좌석" value={`${s.seatCnt}개 구매 · ${usedSeats}개 사용`} hint={s.pendingSeatCnt !== null ? `다음 결제부터 ${s.pendingSeatCnt}개로 축소 예약` : undefined} />
            <Info label="단가 · 다음 청구" value={`${formatWon(s.unitPrice)} · ${formatWon(s.nextChargeAmount)}`} />
            <Info label="이용 기간" value={`${fmtDate(s.currentPeriodStart)} ~ ${fmtDate(s.currentPeriodEnd)}`} />
            <Info label="다음 결제일" value={fmtDate(s.nextBillAt)} />
            <Info label="결제 수단" value={s.card ? `${s.card.company} ${s.card.numberMasked}` : "없음"} />
            <Info label="연속 실패" value={`${s.failCnt}회`} hint={s.lastFailAt ? `마지막 ${fmtDateTime(s.lastFailAt)}` : undefined} tone={s.failCnt > 0 ? "var(--color-error)" : undefined} />
            <Info label="해지 요청 · 종료" value={`${fmtDate(s.cancelRequestedAt)} · ${fmtDate(s.endedAt)}`} />
            <Info label="회원 플랜 미러" value={`${s.member.planCode} (${s.member.status})`} />
            <Info label="구독 생성 · 갱신" value={`${fmtDate(s.createdAt)} · ${fmtDateTime(s.updatedAt)}`} />
          </div>

          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
            환불 판정(결제 후 유료 기능 사용){paidUsage.firstPaidAt && <span className="is-muted"> · 기준 {fmtDate(paidUsage.firstPaidAt)}</span>}:
            {" "}① 두 번째 프로젝트 <Flag v={paidUsage.secondProjectCreated} /> ② 6번째 편집 멤버 <Flag v={paidUsage.sixthEditorJoined} /> ③ 첨부 업로드 <Flag v={paidUsage.fileUploaded} />
          </div>

          {/* 운영 액션 */}
          <div className="sp-btn-row" style={{ flexWrap: "wrap" }}>
            <button className="sp-btn sp-btn-primary" disabled={busy || s.status !== "PAST_DUE"} onClick={() => open({ kind: "retry" })}
                    title={s.status !== "PAST_DUE" ? "재시도 중(PAST_DUE) 구독에서만" : undefined}>즉시 재결제</button>
            <button className="sp-btn sp-btn-secondary" disabled={busy || s.status !== "ACTIVE"} onClick={() => open({ kind: "defer" })}
                    title={s.status !== "ACTIVE" ? "이용 중(ACTIVE) 구독에서만" : undefined}>다음 결제일 연기</button>
            <div className="sp-btn-row-spacer" />
            <button className="sp-btn sp-btn-danger" disabled={busy || !live} onClick={() => open({ kind: "terminate" })}>강제 종료</button>
          </div>
        </div>
      </section>

      {/* 소유 프로젝트 */}
      <section className="sp-group">
        <div className="sp-group-header">
          <div className="sp-group-title">소유 프로젝트</div>
          <span className="sp-badge sp-badge-neutral">{ownedProjects.length}개 · 잠김 {ownedProjects.filter((p) => p.locked).length}</span>
        </div>
        <div className="sp-group-body" style={{ padding: 0 }}>
          <div className="sp-table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="sp-table">
              <thead><tr><th>프로젝트</th><th>멤버 (편집)</th><th>잠금</th><th>잠긴 시각</th><th></th></tr></thead>
              <tbody>
                {ownedProjects.length === 0 && <tr><td colSpan={5} className="is-muted" style={{ textAlign: "center" }}>소유 프로젝트 없음</td></tr>}
                {ownedProjects.map((p) => (
                  <tr key={p.projectId}>
                    <td><Link href={`/admin/projects/${p.projectId}`} style={{ color: "var(--color-text-primary)", textDecoration: "none" }}>{p.name}</Link></td>
                    <td className="is-mono">{p.memberCount} ({p.editorCount})</td>
                    <td>{p.locked ? <span className="sp-badge sp-badge-warning">🔒 잠김</span> : <span className="is-muted">-</span>}</td>
                    <td className="is-mono is-muted">{fmtDateTime(p.lockedAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      {p.locked && (
                        <button className="sp-btn sp-btn-secondary sp-btn-xs" disabled={busy} onClick={() => open({ kind: "unlock", projectId: p.projectId, name: p.name, force: false })}>잠금 해제 대행</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 결제 이력 */}
      <section className="sp-group">
        <div className="sp-group-header">
          <div className="sp-group-title">결제 이력</div>
          <span className="sp-badge sp-badge-neutral">{payments.length}건</span>
        </div>
        <div className="sp-group-body" style={{ padding: 0 }}>
          <div className="sp-table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="sp-table">
              <thead><tr><th>일시</th><th>구분</th><th>좌석</th><th>기간</th><th style={{ textAlign: "right" }}>금액</th><th>상태</th><th>주문 ID</th><th>영수증</th><th></th></tr></thead>
              <tbody>
                {payments.length === 0 && <tr><td colSpan={9} className="is-muted" style={{ textAlign: "center" }}>결제 이력 없음</td></tr>}
                {payments.map((p) => (
                  <tr key={p.paymentId}>
                    <td className="is-mono">{fmtDateTime(p.approvedAt ?? p.createdAt)}</td>
                    <td>{PAYMENT_TYPE_LABEL[p.type] ?? p.type}</td>
                    <td className="is-mono">{p.type === "SEAT_ADD" ? `+${p.seatCnt}` : p.seatCnt}</td>
                    <td className="is-mono is-muted">{p.periodStart ? `${fmtDate(p.periodStart)} ~ ${fmtDate(p.periodEnd)}` : "-"}</td>
                    <td className="is-mono" style={{ textAlign: "right", color: p.amount < 0 ? "var(--color-error)" : undefined }}>{formatWon(p.amount)}</td>
                    <td><PaymentStatusBadge status={p.status} title={p.failReason ?? undefined} /></td>
                    <td className="is-mono is-muted" style={{ fontSize: "var(--text-xs)" }}>{p.orderId}</td>
                    <td>{p.receiptUrl ? <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer">보기</a> : <span className="is-muted">-</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      {p.status === "PAID" && p.type !== "REFUND" && (
                        <button className="sp-btn sp-btn-ghost sp-btn-xs" disabled={busy} onClick={() => open({ kind: "refund", payment: p })}>환불 기록</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 액션 모달 — 전부 사유 필수. 강제 종료·강제 해제는 위험색 버튼 */}
      {modal && (
        <div className="sp-overlay" onClick={() => !busy && setModal(null)}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="sp-modal-header">
              <div className="sp-modal-title">
                {modal.kind === "retry" && "즉시 재결제"}
                {modal.kind === "defer" && "다음 결제일 연기"}
                {modal.kind === "refund" && "환불 기록"}
                {modal.kind === "terminate" && "구독 강제 종료"}
                {modal.kind === "unlock" && (modal.force ? "잠금 강제 해제" : "잠금 해제 대행")}
              </div>
              <button className="sp-modal-close" onClick={() => setModal(null)} aria-label="닫기">✕</button>
            </div>
            <div className="sp-modal-body" style={{ display: "grid", gap: "var(--space-3)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              {modal.kind === "retry" && <p style={{ margin: 0 }}>등록된 카드로 지금 청구합니다({formatWon(s.nextChargeAmount)}). 실패하면 실패 횟수가 올라가고, 소진되면 강등까지 배치와 같게 진행됩니다.</p>}
              {modal.kind === "defer" && (
                <>
                  <p style={{ margin: 0 }}>현재 다음 결제일 <b>{fmtDate(s.nextBillAt)}</b>. 좌석·단가는 그대로 두고 이용 기간만 늘립니다(장애 보상·민원 처리).</p>
                  <div className="sp-field"><div className="sp-label">연기 일수 (1~90)</div><input className="sp-input" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
                </>
              )}
              {modal.kind === "refund" && (
                <>
                  <p style={{ margin: 0 }}>
                    <b>환불은 PG 콘솔에서 먼저 실행</b>하고, 여기서는 이력만 기록합니다. 원 결제 {formatWon(modal.payment.amount)} ({PAYMENT_TYPE_LABEL[modal.payment.type]}, {fmtDate(modal.payment.approvedAt)}).
                    7일 이내 + 유료 기능 미사용이면 전액 환불 대상입니다(정책 §1-7).
                  </p>
                  <div className="sp-field"><div className="sp-label">환불 금액 (원)</div><input className="sp-input" type="number" min={1} max={modal.payment.amount} value={refundAmount} onChange={(e) => setRefundAmount(Number(e.target.value))} /></div>
                </>
              )}
              {modal.kind === "terminate" && (
                <p style={{ margin: 0 }}>
                  즉시 <b>CANCELED</b> 처리되고 회원은 FREE 로 강등, 소유 프로젝트 <b>{ownedProjects.length}개</b>가 읽기 전용으로 잠깁니다.
                  강등 안내 메일이 발송됩니다. 데이터는 삭제되지 않으며, 되돌리려면 회원이 다시 구독해야 합니다.
                </p>
              )}
              {modal.kind === "unlock" && (
                <p style={{ margin: 0 }}>
                  <b>{modal.name}</b> 의 결제 잠금을 소유자 대신 풉니다.
                  {modal.force
                    ? <> 상한(FREE 멤버 5명 / 구독 좌석)을 <b style={{ color: "var(--color-error)" }}>초과한 상태로 강제 해제</b>합니다. 사유가 감사 로그에 남습니다.</>
                    : <> 소유자 "활성화" 버튼과 같은 상한 판정을 탑니다. 초과면 강제 해제 여부를 다시 묻습니다.</>}
                </p>
              )}
              <div className="sp-field">
                <div className="sp-label">사유 <span className="sp-label-req">필수</span></div>
                <textarea className="sp-input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="감사 로그에 남습니다" autoFocus style={{ width: "100%", resize: "vertical" }} />
              </div>
            </div>
            <div className="sp-modal-footer">
              <button className="sp-btn sp-btn-ghost" onClick={() => setModal(null)} disabled={busy}>취소</button>
              <button
                className={modal.kind === "terminate" || (modal.kind === "unlock" && modal.force) ? "sp-btn sp-btn-danger" : "sp-btn sp-btn-primary"}
                disabled={busy || !reason.trim() || (modal.kind === "refund" && (refundAmount < 1 || refundAmount > modal.payment.amount)) || (modal.kind === "defer" && (days < 1 || days > 90))}
                onClick={() => action.mutate()}
              >
                {busy ? "처리 중…" :
                  modal.kind === "retry" ? "지금 청구" :
                  modal.kind === "defer" ? `${days}일 연기` :
                  modal.kind === "refund" ? `${formatWon(refundAmount)} 환불 기록` :
                  modal.kind === "terminate" ? "강제 종료" :
                  modal.force ? "강제 해제" : "해제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 600, color: tone ?? "var(--color-text-primary)" }}>{value}</div>
      {hint && <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Flag({ v }: { v: boolean }) {
  return <span className={`sp-badge ${v ? "sp-badge-warning" : "sp-badge-neutral"}`}>{v ? "사용" : "미사용"}</span>;
}
