"use client";

/**
 * AdminSubscriptionDetailPage — 구독 상세·운영 액션 (/admin/billing/[subscriptionId])
 *
 * 역할:
 *   - 구독 정보(회원·상태·종료 사유·좌석 구매/사용·주기·다음 결제·카드·실패 회차) + 환불 판정 3플래그
 *   - 소유 프로젝트 표(잠금 상태·멤버 수) + 잠금 해제 대행(소유자 "활성화"와 같은 판정, 강제 없음)
 *   - 운영 액션: 즉시 재결제(PAST_DUE) · 다음 결제일 연기(ACTIVE, 1~90일) · 강제 종료(살아 있는 구독)
 *   - 결제 이력(최근 100건, 누적 환불·잔액) + 환불 기록(청약철회 / 운영 보정)
 *
 * 규칙 (정책 §1-7, §1-10):
 *   - 모든 액션은 사유 필수, 서버가 상태 변경과 같은 트랜잭션에 감사 로그를 남긴다.
 *   - 좌석·단가·플랜은 여기서 바꾸지 않는다. 보상은 "결제일 연기"로만.
 *   - PG 청구가 진행 중(opInProgress)이면 서버가 409 로 막는다 — 버튼도 잠시 비활성.
 */

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch } from "@/lib/authFetch";
import type { AdminPaymentDetailRow, AdminSubscriptionDetail } from "@/lib/billing/admin-queries";
import type { RecurringChargeResult } from "@/lib/billing/subscription";
import { ENDED_REASON_LABEL, PAYMENT_TYPE, PAYMENT_TYPE_LABEL, REFUND_REASON, REFUND_REASON_LABEL, WITHDRAWAL_REASON_LABEL, type RefundReason } from "@/lib/billing/constants";
import { formatWon } from "@/lib/billing/pricing";
import { PRICING } from "@/app/intro/_components/siteInfo";
import { fmtDate, fmtDateTime, PaymentStatusBadge, SubStatusBadge } from "../_shared";

type Modal =
  | { kind: "retry" } | { kind: "defer" } | { kind: "terminate" }
  | { kind: "refund"; payment: AdminPaymentDetailRow }
  | { kind: "unlock"; projectId: string; name: string };

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

  // 모달 상태 — 한 번에 하나. 사유는 전부 필수
  const [modal, setModal] = useState<Modal | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(7);
  const [refundReason, setRefundReason] = useState<RefundReason>(REFUND_REASON.ADJUSTMENT);
  const [refundAmount, setRefundAmount] = useState(0);

  function open(m: Modal) {
    setReason("");
    if (m.kind === "refund") {
      // 첫 결제·7일 이내면 청약철회를 기본으로, 그 외는 운영 보정
      const isInitialRecent = m.payment.type === PAYMENT_TYPE.INITIAL && m.payment.approvedAt !== null &&
        Date.now() - new Date(m.payment.approvedAt).getTime() <= 7 * 24 * 60 * 60 * 1000 && m.payment.refundedAmount === 0;
      setRefundReason(isInitialRecent ? REFUND_REASON.WITHDRAWAL : REFUND_REASON.ADJUSTMENT);
      setRefundAmount(m.payment.refundableAmount);
    }
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
        case "refund":    return post(`/api/admin/billing/payments/${modal.payment.paymentId}/refund`, {
          reason: refundReason, memo: reason,
          ...(refundReason === REFUND_REASON.ADJUSTMENT ? { amount: refundAmount } : {}),
        });
        case "unlock":    return post(`/api/admin/projects/${modal.projectId}/unlock`, { reason });
      }
    },
    onSuccess: (r) => {
      const kind = modal?.kind;
      if (kind === "retry") {
        const rr = r as RecurringChargeResult;
        toast[rr.ok ? "success" : "error"](
          rr.ok ? `재결제 성공 — ${formatWon(rr.amount)}${rr.applied ? "" : " (구독 반영 지연, 운영자 확인 필요)"}`
          : rr.skipped ? "다른 결제 처리가 진행 중이라 건너뛰었습니다."
          : rr.expired ? "재결제 실패 — 재시도 소진으로 구독이 종료되었습니다."
          : `재결제 실패 (fail_cnt=${rr.failCnt})`, { duration: 7000 });
      } else if (kind === "defer")     toast.success(`다음 결제일을 ${days}일 연기했습니다.`);
      else if (kind === "terminate")   toast.success("구독을 종료했습니다. 회원에게 강등 메일이 발송됩니다.");
      else if (kind === "refund")      toast.success((r as { subscriptionTerminated: boolean }).subscriptionTerminated ? "환불을 기록하고 구독을 종료했습니다(청약철회)." : "환불 이력을 기록했습니다.");
      else if (kind === "unlock")      toast.success("프로젝트 잠금을 해제했습니다.");
      setModal(null);
      refresh();
    },
    onError: (err: Error) => toast.error(err.message, { duration: 8000 }),
  });

  if (q.isLoading) return <div style={{ color: "var(--color-text-tertiary)" }}>불러오는 중…</div>;
  if (q.isError || !q.data) return <div className="sp-hint is-err">{(q.error as Error)?.message ?? "구독을 찾을 수 없습니다."}</div>;

  const { subscription: s, usedSeats, withdrawal, ownedProjects, payments } = q.data;
  const live = s.status === "ACTIVE" || s.status === "PAST_DUE" || s.status === "CANCEL_SCHEDULED";
  const busy = action.isPending || s.opInProgress;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", gap: 12, fontSize: "var(--text-sm)" }}>
        <Link href="/admin/billing" style={{ color: "var(--color-text-tertiary)", textDecoration: "none" }}>← 결제</Link>
        <Link href={`/admin/audit?targetType=SUBSCRIPTION&targetId=${s.subscriptionId}`} style={{ color: "var(--color-text-tertiary)", textDecoration: "none" }}>이 구독의 감사 로그</Link>
      </div>

      {s.opInProgress && (
        <div className="sp-hint is-warn" style={{ padding: "8px 12px", border: "1px solid var(--color-warning-border)", borderRadius: "var(--radius-sm)", background: "var(--color-warning-subtle)" }}>
          지금 PG 청구가 진행 중입니다. 결과가 반영될 때까지(최대 2분) 변경 액션은 잠깁니다.
        </div>
      )}

      {/* 구독 정보 */}
      <section className="sp-group">
        <div className="sp-group-header">
          <div className="sp-group-title">
            {s.member.email ?? s.member.mberId}{s.member.name && <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400, marginLeft: 8 }}>{s.member.name}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SubStatusBadge status={s.status} />
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
            <Info label="해지 요청 · 종료" value={`${fmtDate(s.cancelRequestedAt)} · ${fmtDate(s.endedAt)}`} hint={s.endedReason ? `사유: ${ENDED_REASON_LABEL[s.endedReason]}` : undefined} />
            <Info label="회원 플랜 미러" value={`${s.member.planCode} (${s.member.status})`} />
            <Info label="구독 생성 · 갱신" value={`${fmtDate(s.createdAt)} · ${fmtDateTime(s.updatedAt)}`} />
          </div>

          {/* 청약철회 — 첫 구독 결제 1건만, 승인 후 7일, 계정당 1회. 사용 여부는 보지 않는다(정책 §1-7) */}
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span>청약철회(첫 구독 결제 · 승인 후 {PRICING.refundWindowDays}일 · 계정당 1회):</span>
            {withdrawal.firstPaidAt ? (
              <>
                <span>첫 결제 {fmtDate(withdrawal.firstPaidAt)} · 기한 {fmtDate(withdrawal.deadline)}</span>
                <span className={`sp-badge ${withdrawal.eligible ? "sp-badge-success" : "sp-badge-neutral"}`}>
                  {withdrawal.eligible ? "가능" : `불가 · ${withdrawal.reason ? WITHDRAWAL_REASON_LABEL[withdrawal.reason] : ""}`}
                </span>
              </>
            ) : (
              <span className="is-muted">결제 이력 없음</span>
            )}
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
                        <button className="sp-btn sp-btn-secondary sp-btn-xs" disabled={action.isPending} onClick={() => open({ kind: "unlock", projectId: p.projectId, name: p.name })}>잠금 해제 대행</button>
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
              <thead><tr><th>일시</th><th>구분</th><th>좌석</th><th>기간</th><th style={{ textAlign: "right" }}>금액</th><th style={{ textAlign: "right" }}>환불 / 잔액</th><th>상태</th><th>주문 ID</th><th>영수증</th><th></th></tr></thead>
              <tbody>
                {payments.length === 0 && <tr><td colSpan={10} className="is-muted" style={{ textAlign: "center" }}>결제 이력 없음</td></tr>}
                {payments.map((p) => (
                  <tr key={p.paymentId}>
                    <td className="is-mono">{fmtDateTime(p.approvedAt ?? p.createdAt)}</td>
                    <td>
                      {PAYMENT_TYPE_LABEL[p.type] ?? p.type}
                      {p.type === PAYMENT_TYPE.REFUND && p.refundReason && <div className="is-muted" style={{ fontSize: "var(--text-xs)" }}>{REFUND_REASON_LABEL[p.refundReason as RefundReason]?.split(" (")[0] ?? p.refundReason}</div>}
                    </td>
                    <td className="is-mono">{p.type === "SEAT_ADD" ? `+${p.seatCnt}` : p.seatCnt}</td>
                    <td className="is-mono is-muted">{p.periodStart ? `${fmtDate(p.periodStart)} ~ ${fmtDate(p.periodEnd)}` : "-"}</td>
                    <td className="is-mono" style={{ textAlign: "right", color: p.amount < 0 ? "var(--color-error)" : undefined }}>{formatWon(p.amount)}</td>
                    <td className="is-mono is-muted" style={{ textAlign: "right" }}>{p.refundedAmount > 0 ? `${formatWon(p.refundedAmount)} / ${formatWon(p.refundableAmount)}` : "-"}</td>
                    <td><PaymentStatusBadge status={p.status} title={p.failReason ?? undefined} /></td>
                    <td className="is-mono is-muted" style={{ fontSize: "var(--text-xs)" }}>{p.orderId}</td>
                    <td>{p.receiptUrl ? <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer">보기</a> : <span className="is-muted">-</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      {p.refundableAmount > 0 && (
                        <button className="sp-btn sp-btn-ghost sp-btn-xs" disabled={action.isPending} onClick={() => open({ kind: "refund", payment: p })}>환불 기록</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 액션 모달 — 전부 사유 필수. 강제 종료·청약철회는 위험색 버튼 */}
      {modal && (
        <div className="sp-overlay" onClick={() => !action.isPending && setModal(null)}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ width: 480 }}>
            <div className="sp-modal-header">
              <div className="sp-modal-title">
                {modal.kind === "retry" && "즉시 재결제"}
                {modal.kind === "defer" && "다음 결제일 연기"}
                {modal.kind === "refund" && "환불 기록"}
                {modal.kind === "terminate" && "구독 강제 종료"}
                {modal.kind === "unlock" && "잠금 해제 대행"}
              </div>
              <button className="sp-modal-close" onClick={() => setModal(null)} aria-label="닫기">✕</button>
            </div>
            <div className="sp-modal-body" style={{ display: "grid", gap: "var(--space-3)", fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              {modal.kind === "retry" && <p style={{ margin: 0 }}>등록된 카드로 지금 청구합니다({formatWon(s.nextChargeAmount)}). 실패하면 실패 횟수가 올라가고, 소진되면 강등까지 배치와 같게 진행됩니다. 시도 자체가 감사 로그에 남습니다.</p>}

              {modal.kind === "defer" && (
                <>
                  <p style={{ margin: 0 }}>현재 다음 결제일 <b>{fmtDate(s.nextBillAt)}</b>. 좌석·단가는 그대로 두고 이용 기간만 늘립니다(장애 보상·민원 처리). 사전 안내 메일은 새 날짜 기준으로 다시 나갑니다.</p>
                  <div className="sp-field"><div className="sp-label">연기 일수 (1~90)</div><input className="sp-input" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
                </>
              )}

              {modal.kind === "terminate" && (
                <p style={{ margin: 0 }}>
                  즉시 <b>CANCELED</b>(사유: 관리자 강제 종료) 처리되고 회원은 FREE 로 강등, 소유 프로젝트 <b>{ownedProjects.length}개</b>가 읽기 전용으로 잠깁니다.
                  빌링키가 삭제되어 되돌리려면 회원이 카드를 다시 등록해 구독해야 합니다. 강등 안내 메일이 발송됩니다. 데이터는 삭제되지 않습니다.
                </p>
              )}

              {modal.kind === "refund" && (
                <>
                  <p style={{ margin: 0 }}>
                    <b>환불은 PG 콘솔에서 먼저 실행</b>하고, 여기서는 원장만 기록합니다.
                    원 결제 <b>{formatWon(modal.payment.amount)}</b> ({PAYMENT_TYPE_LABEL[modal.payment.type]}, {fmtDate(modal.payment.approvedAt)})
                    · 누적 환불 {formatWon(modal.payment.refundedAmount)} · 잔액 <b>{formatWon(modal.payment.refundableAmount)}</b>
                  </p>
                  <div className="sp-field">
                    <div className="sp-label">환불 유형</div>
                    <div className="sp-select-wrap">
                      <select className="sp-input" value={refundReason} onChange={(e) => setRefundReason(e.target.value as RefundReason)}>
                        {Object.entries(REFUND_REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  {refundReason === REFUND_REASON.WITHDRAWAL ? (
                    <p style={{ margin: 0, color: "var(--color-warning)" }}>
                      잔액 <b>{formatWon(modal.payment.refundableAmount)}</b> 전액. 서버가 "계정의 첫 구독 시작 결제 · 승인 {PRICING.refundWindowDays}일 이내 · 계정당 1회"를 검사하고(사용 여부 무관),
                      통과하면 <b>구독을 즉시 종료</b>합니다(사유: 청약철회 환불, 강등·잠금·메일 포함). 조건에 안 맞으면 운영 보정으로 기록하세요.
                    </p>
                  ) : (
                    <div className="sp-field">
                      <div className="sp-label">환불 금액 (원, 잔액 이하)</div>
                      <input className="sp-input" type="number" min={1} max={modal.payment.refundableAmount} value={refundAmount} onChange={(e) => setRefundAmount(Number(e.target.value))} />
                      <div className="sp-hint">구독은 그대로 유지됩니다. 잔액 전액이면 원 결제가 "환불", 일부면 "일부 환불"로 표시됩니다.</div>
                    </div>
                  )}
                </>
              )}

              {modal.kind === "unlock" && (
                <p style={{ margin: 0 }}>
                  <b>{modal.name}</b> 의 결제 잠금을 소유자 대신 풉니다. 소유자 "활성화" 버튼과 같은 상한 판정(FREE 는 편집 멤버 소유자 1명 + 열린 프로젝트 1개 / 구독은 좌석)을 탑니다.
                  초과 상태면 풀리지 않습니다 — 운영 판단으로 풀어야 하면 회원 상세에서 플랜을 부여한 뒤 다시 대행하세요.
                </p>
              )}

              <div className="sp-field">
                <div className="sp-label">사유 <span className="sp-label-req">필수</span></div>
                <textarea className="sp-input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="감사 로그에 남습니다" autoFocus style={{ width: "100%", resize: "vertical" }} />
              </div>
            </div>
            <div className="sp-modal-footer">
              <button className="sp-btn sp-btn-ghost" onClick={() => setModal(null)} disabled={action.isPending}>취소</button>
              <button
                className={modal.kind === "terminate" || (modal.kind === "refund" && refundReason === REFUND_REASON.WITHDRAWAL) ? "sp-btn sp-btn-danger" : "sp-btn sp-btn-primary"}
                disabled={
                  action.isPending || !reason.trim() ||
                  (modal.kind === "refund" && refundReason === REFUND_REASON.ADJUSTMENT && (refundAmount < 1 || refundAmount > modal.payment.refundableAmount)) ||
                  (modal.kind === "defer" && (days < 1 || days > 90))
                }
                onClick={() => action.mutate()}
              >
                {action.isPending ? "처리 중…" :
                  modal.kind === "retry" ? "지금 청구" :
                  modal.kind === "defer" ? `${days}일 연기` :
                  modal.kind === "refund" ? (refundReason === REFUND_REASON.WITHDRAWAL ? `전액 환불 기록 + 구독 종료` : `${formatWon(refundAmount)} 환불 기록`) :
                  modal.kind === "terminate" ? "강제 종료" : "해제"}
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

