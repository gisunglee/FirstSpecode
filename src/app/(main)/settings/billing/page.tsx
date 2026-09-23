"use client";

/**
 * BillingSettingsPage — 설정 > 구독·결제 (/settings/billing)
 *
 * 역할 (정책 §3 2단계 화면):
 *   - 현재 플랜 카드: 상태, 좌석(구매/사용), 다음 결제일·금액, 결제 수단
 *   - 버튼: BASIC 시작(좌석 수 입력 → 금액 미리보기 → 카드 등록) / 좌석 추가(일할 금액 모달) /
 *           좌석 축소(다음 결제일 적용) / 결제 수단 변경 / 해지(확인 1회) / 해지 취소
 *   - 결제 내역 표 (영수증 링크, 실패 사유)
 *   - 잠긴 프로젝트가 있으면 안내 + 프로젝트 목록 링크
 *
 * 카드 등록은 서버가 준 mode 로 분기한다:
 *   redirect → Mock "PG 창"으로 이동 (돌아오는 곳: /settings/billing/callback)
 *   sdk      → 토스 브라우저 SDK (심사 후 연결 — 지금은 안내만)
 *
 * 주요 기술: TanStack Query(조회·무효화), sp-* 디자인 시스템 클래스, ConfirmDialog(해지)
 */

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authFetch, AuthFetchError } from "@/lib/authFetch";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import SeatBreakdown from "@/components/billing/SeatBreakdown";
import type { BillingOverview, PaymentDto, SeatAdditionPreview, SeatChangeResult, CancelResult, SubscriptionDto } from "@/lib/billing/subscription";
import type { CardRegistrationStart } from "@/lib/billing/gateway";
import { PAYMENT_STATUS_LABEL, PAYMENT_TYPE_LABEL, SEAT_INPUT_LIMITS, SUBSCRIPTION_STATUS as S, SUBSCRIPTION_STATUS_LABEL } from "@/lib/billing/constants";
import { formatKstDate, formatWon } from "@/lib/billing/pricing";

// ─── 표시 라벨 ────────────────────────────────────────────────────────────────

// 라벨은 constants.ts 한 곳 — 여기서는 배지 색만 정한다
const STATUS_CLS: Record<string, string> = {
  ACTIVE: "sp-badge-success", PAST_DUE: "sp-badge-error", CANCEL_SCHEDULED: "sp-badge-warning",
  CANCELED: "sp-badge-neutral", EXPIRED: "sp-badge-neutral",
};
const STATUS_BADGE: Record<string, { label: string; cls: string }> = Object.fromEntries(
  Object.entries(SUBSCRIPTION_STATUS_LABEL).map(([k, label]) => [k, { label, cls: STATUS_CLS[k] ?? "sp-badge-neutral" }]),
);

function fmtDate(iso: string | null): string {
  return iso ? formatKstDate(new Date(iso)) : "-";
}

// ─── 페이지 ──────────────────────────────────────────────────────────────────

export default function BillingSettingsPage() {
  const queryClient = useQueryClient();

  const overviewQuery = useQuery({
    queryKey: ["billing", "overview"],
    queryFn:  () => authFetch<{ data: BillingOverview }>("/api/billing/subscription").then((r) => r.data),
  });
  const paymentsQuery = useQuery({
    queryKey: ["billing", "payments"],
    queryFn:  () => authFetch<{ data: { items: PaymentDto[] } }>("/api/billing/payments").then((r) => r.data.items),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["billing"] });
    // 플랜 배지(GNB)·프로젝트 잠금 상태도 바뀔 수 있다
    queryClient.invalidateQueries({ queryKey: ["member", "profile"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["my-role"] });
  }

  // 모달 상태
  const [seatAddOpen, setSeatAddOpen]       = useState(false);
  const [seatReduceOpen, setSeatReduceOpen] = useState(false);
  const [cancelOpen, setCancelOpen]         = useState(false);

  // ── 카드 등록 시작 (BASIC 시작 / 결제 수단 변경) — 서버가 준 mode 로 분기 ──
  function goToCardRegistration(start: CardRegistrationStart) {
    if (start.mode === "redirect") {
      window.location.assign(start.url);
      return;
    }
    // 토스 SDK 는 가맹 심사 후 연결 — 지금 이 분기로 오면 서버 설정이 잘못된 것
    toast.error("토스 결제창 연동은 준비 중입니다. 운영자에게 문의해 주세요.");
  }

  const changeCardMutation = useMutation({
    mutationFn: () => authFetch<{ data: CardRegistrationStart }>("/api/billing/card/change", { method: "POST" }).then((r) => r.data),
    onSuccess: goToCardRegistration,
    onError:   (err: Error) => toast.error(err.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => authFetch<{ data: CancelResult }>("/api/billing/cancel", { method: "POST" }).then((r) => r.data),
    onSuccess: (r) => {
      setCancelOpen(false);
      if (r.status === S.CANCEL_SCHEDULED && r.periodEnd) {
        toast.success(`해지가 예약되었습니다. ${fmtDate(r.periodEnd)}까지 이용할 수 있습니다.`);
      } else {
        toast.success("구독이 종료되었습니다.");
      }
      refresh();
    },
    onError: (err: Error) => { setCancelOpen(false); toast.error(err.message); },
  });

  const uncancelMutation = useMutation({
    mutationFn: () => authFetch<{ data: SubscriptionDto }>("/api/billing/cancel", { method: "DELETE" }).then((r) => r.data),
    onSuccess: () => { toast.success("해지가 취소되었습니다. 구독이 계속됩니다."); refresh(); },
    onError:   (err: Error) => toast.error(err.message),
  });

  const overview = overviewQuery.data;

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 — 프로필 설정과 같은 sticky 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", position: "sticky", top: 0, zIndex: 10, background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>구독·결제</div>
        <Link href="/intro/pricing" target="_blank" rel="noopener" className="sp-btn sp-btn-ghost sp-btn-sm">요금제 안내</Link>
      </div>

      <div style={{ padding: "0 24px 32px", maxWidth: 760, display: "grid", gap: "var(--space-4)" }}>
        {overviewQuery.isLoading && <div style={{ color: "var(--color-text-tertiary)" }}>불러오는 중...</div>}
        {overviewQuery.error && <div className="sp-hint is-err">{(overviewQuery.error as Error).message}</div>}

        {overview && (
          <>
            {/* Mock 환경 안내 — 운영에서도 내부 사용자만 쓰는 동안은 Mock (정책 §3) */}
            {overview.provider === "MOCK" && (
              <div className="sp-hint is-warn" style={{ padding: "8px 12px", border: "1px solid var(--color-warning-border)", borderRadius: "var(--radius-sm)", background: "var(--color-warning-subtle)" }}>
                모의 결제 환경입니다. 카드 등록·결제는 "PG 창"에서 흉내만 내며 실제 결제는 일어나지 않습니다.
              </div>
            )}

            <PlanCard
              overview={overview}
              onStart={goToCardRegistration}
              onAddSeats={() => setSeatAddOpen(true)}
              onReduceSeats={() => setSeatReduceOpen(true)}
              onChangeCard={() => changeCardMutation.mutate()}
              onCancel={() => setCancelOpen(true)}
              onUncancel={() => uncancelMutation.mutate()}
              busy={changeCardMutation.isPending || uncancelMutation.isPending}
            />

            {overview.lockedProjectCount > 0 && (
              <div className="sp-group">
                <div className="sp-group-header">
                  <div className="sp-group-title">🔒 잠긴 프로젝트 {overview.lockedProjectCount}개</div>
                </div>
                <div className="sp-group-body" style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  구독 종료로 소유 프로젝트가 읽기 전용입니다. 데이터는 삭제되지 않습니다.
                  멤버 5명 이하인 프로젝트는 <Link href="/projects">프로젝트 목록</Link>에서 <b>활성화</b> 버튼으로 바로 풀 수 있고,
                  다시 구독하면 전부 즉시 해제됩니다.
                </div>
              </div>
            )}

            <PaymentsTable items={paymentsQuery.data ?? []} loading={paymentsQuery.isLoading} />
          </>
        )}
      </div>

      {/* 모달 */}
      {seatAddOpen && overview?.subscription && (
        <SeatAddModal
          subscription={overview.subscription}
          onClose={() => setSeatAddOpen(false)}
          onDone={() => { setSeatAddOpen(false); refresh(); }}
        />
      )}
      {seatReduceOpen && overview?.subscription && (
        <SeatReduceModal
          subscription={overview.subscription}
          usedSeats={overview.usedSeats}
          onClose={() => setSeatReduceOpen(false)}
          onDone={() => { setSeatReduceOpen(false); refresh(); }}
        />
      )}
      <ConfirmDialog
        open={cancelOpen}
        title="구독을 해지할까요?"
        description={
          overview?.subscription?.status === S.PAST_DUE
            ? "결제가 실패한 상태라 남은 유료 기간이 없습니다. 지금 해지하면 즉시 FREE 로 전환되고 소유 프로젝트가 읽기 전용으로 잠깁니다. 데이터는 삭제되지 않습니다."
            : `이미 결제한 기간이 끝나는 ${fmtDate(overview?.subscription?.currentPeriodEnd ?? null)}까지 그대로 이용할 수 있고, 그 이후 결제되지 않습니다. 그 전에는 언제든 해지를 취소할 수 있습니다.`
        }
        confirmLabel="해지"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}

// ─── 플랜 카드 ───────────────────────────────────────────────────────────────

function PlanCard(props: {
  overview: BillingOverview;
  onStart: (start: CardRegistrationStart) => void;
  onAddSeats: () => void;
  onReduceSeats: () => void;
  onChangeCard: () => void;
  onCancel: () => void;
  onUncancel: () => void;
  busy: boolean;
}) {
  const { overview, busy } = props;
  const sub  = overview.subscription;
  const live = !!sub && (sub.status === S.ACTIVE || sub.status === S.PAST_DUE || sub.status === S.CANCEL_SCHEDULED);

  // 살아 있는 구독이 없으면 "BASIC 시작" 카드
  if (!live) {
    return (
      <StartBasicCard overview={overview} onStart={props.onStart} />
    );
  }

  const badge = STATUS_BADGE[sub!.status] ?? { label: sub!.status, cls: "sp-badge-neutral" };

  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <div className="sp-group-title">현재 플랜 — {overview.plan}</div>
        <span className={`sp-badge ${badge.cls}`}><span className="dot" />{badge.label}</span>
      </div>
      <div className="sp-group-body" style={{ display: "grid", gap: "var(--space-4)" }}>
        {/* 상태별 안내 */}
        {sub!.status === S.PAST_DUE && (
          <div className="sp-hint is-err" style={{ padding: "8px 12px", border: "1px solid var(--color-error-border)", borderRadius: "var(--radius-sm)", background: "var(--color-error-subtle)" }}>
            정기 결제에 {sub!.failCnt}회 실패했습니다. 3일 간격으로 다시 시도하며, 모두 실패하면 FREE 로 전환됩니다.
            결제 수단을 변경하면 즉시 다시 결제를 시도합니다.
          </div>
        )}
        {sub!.status === S.CANCEL_SCHEDULED && (
          <div className="sp-hint is-warn" style={{ padding: "8px 12px", border: "1px solid var(--color-warning-border)", borderRadius: "var(--radius-sm)", background: "var(--color-warning-subtle)" }}>
            해지가 예약되어 {fmtDate(sub!.currentPeriodEnd)}까지 이용할 수 있습니다. 그 이후 결제되지 않고 소유 프로젝트가 읽기 전용으로 바뀝니다.
          </div>
        )}

        {/* 핵심 수치 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-4)" }}>
          <Stat label="좌석" value={`${sub!.seatCnt}개 구매 · ${overview.usedSeats}개 사용`}
                hint={sub!.pendingSeatCnt !== null ? `다음 결제일부터 ${sub!.pendingSeatCnt}개로 축소 예약` : "뷰어는 좌석을 차지하지 않습니다"} />
          <Stat label={sub!.status === S.CANCEL_SCHEDULED ? "이용 종료일" : "다음 결제일"}
                value={fmtDate(sub!.status === S.CANCEL_SCHEDULED ? sub!.currentPeriodEnd : sub!.nextBillAt)}
                hint={sub!.status === S.CANCEL_SCHEDULED ? "추가 결제 없음" : `${formatWon(sub!.nextChargeAmount)} (좌석 × ${formatWon(sub!.unitPrice)}, 부가세 포함)`} />
          <Stat label="결제 수단" value={sub!.card ? `${sub!.card.company} ${sub!.card.numberMasked}` : "미등록"}
                hint={`이용 기간 ${fmtDate(sub!.currentPeriodStart)} ~ ${fmtDate(sub!.currentPeriodEnd)}`} />
        </div>

        {/* 좌석에 누가 포함되나 — 숫자만 보면 "왜 N명?"이 생긴다 */}
        <SeatBreakdown usedSeats={overview.usedSeats} />

        {/* 버튼 — 해지는 설정 화면에 바로 (다크패턴 규제) */}
        <div className="sp-btn-row" style={{ flexWrap: "wrap" }}>
          <button className="sp-btn sp-btn-primary" onClick={props.onAddSeats} disabled={busy || sub!.status !== S.ACTIVE}
                  title={sub!.status !== S.ACTIVE ? "이용 중 상태에서만 좌석을 추가할 수 있습니다" : undefined}>
            좌석 추가
          </button>
          <button className="sp-btn sp-btn-secondary" onClick={props.onReduceSeats} disabled={busy || sub!.seatCnt <= 1}>
            좌석 축소
          </button>
          <button className="sp-btn sp-btn-secondary" onClick={props.onChangeCard} disabled={busy}>
            결제 수단 변경
          </button>
          <div className="sp-btn-row-spacer" />
          {sub!.status === S.CANCEL_SCHEDULED ? (
            <button className="sp-btn sp-btn-secondary" onClick={props.onUncancel} disabled={busy}>해지 취소</button>
          ) : (
            <button className="sp-btn sp-btn-danger" onClick={props.onCancel} disabled={busy}>해지</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-text-tertiary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--color-text-primary)" }}>{value}</div>
      {hint && <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

// ─── BASIC 시작 카드 ─────────────────────────────────────────────────────────

function StartBasicCard({ overview, onStart }: { overview: BillingOverview; onStart: (s: CardRegistrationStart) => void }) {
  const minSeats = Math.max(SEAT_INPUT_LIMITS.min, overview.usedSeats);
  const [seatCnt, setSeatCnt] = useState<number>(minSeats);
  const ended = overview.subscription; // 종료된 구독 이력 (재구독)

  const startMutation = useMutation({
    mutationFn: (n: number) =>
      authFetch<{ data: CardRegistrationStart }>("/api/billing/subscription/start", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seatCnt: n }),
      }).then((r) => r.data),
    onSuccess: onStart,
    onError:   (err: Error) => toast.error(err.message),
  });

  const valid = Number.isInteger(seatCnt) && seatCnt >= minSeats && seatCnt <= SEAT_INPUT_LIMITS.max;
  const monthly = valid ? seatCnt * overview.product.unitPrice : 0;

  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <div className="sp-group-title">현재 플랜 — {overview.plan}</div>
        {ended && <span className="sp-badge sp-badge-neutral">{STATUS_BADGE[ended.status]?.label ?? ended.status}</span>}
      </div>
      <div className="sp-group-body" style={{ display: "grid", gap: "var(--space-4)" }}>
        {overview.plan !== "FREE" && (
          <div className="sp-hint" style={{ color: "var(--color-text-secondary)" }}>
            현재 플랜은 운영자가 부여한 것입니다. 결제 구독을 시작하면 구독이 플랜의 기준이 됩니다.
          </div>
        )}
        <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          <b style={{ color: "var(--color-text-primary)" }}>{overview.product.name}</b> — 좌석당 월 {formatWon(overview.product.unitPrice)} (부가세 포함).
          좌석 = 소유한 프로젝트 전체의 편집 멤버 수(중복 제외, 본인 포함). 뷰어는 무료입니다.
          현재 편집 멤버 <b>{overview.usedSeats}명</b>이라 좌석은 {minSeats}개 이상이어야 합니다.
        </div>
        <SeatBreakdown usedSeats={overview.usedSeats} />

        <div className="sp-field-row" style={{ alignItems: "flex-end" }}>
          <div className="sp-field" style={{ flex: "0 0 160px" }}>
            <div className="sp-label">좌석 수</div>
            <input
              className={`sp-input${valid ? "" : " is-err"}`}
              type="number" min={minSeats} max={SEAT_INPUT_LIMITS.max} value={seatCnt}
              onChange={(e) => setSeatCnt(Number(e.target.value))}
            />
          </div>
          <div className="sp-field">
            <div className="sp-label">월 청구액</div>
            <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--color-text-primary)", lineHeight: "30px" }}>
              {valid ? formatWon(monthly) : "-"}
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 400, color: "var(--color-text-tertiary)", marginLeft: 6 }}>/ 월</span>
            </div>
          </div>
        </div>
        {!valid && <div className="sp-hint is-err">좌석 수는 {minSeats}~{SEAT_INPUT_LIMITS.max} 사이여야 합니다.</div>}

        <div className="sp-btn-row">
          <button className="sp-btn sp-btn-primary sp-btn-lg" disabled={!valid || startMutation.isPending} onClick={() => startMutation.mutate(seatCnt)}>
            {startMutation.isPending ? "결제창 준비 중…" : ended ? "다시 구독하기" : "BASIC 시작하기"}
          </button>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
            카드 등록 후 첫 달 요금이 즉시 결제되고, 매월 같은 날 자동 결제됩니다. 해지는 이 화면에서 언제든 가능합니다.
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── 좌석 추가 모달 (일할 금액 미리보기 → 즉시 결제) ───────────────────────

function SeatAddModal({ subscription, onClose, onDone }: { subscription: SubscriptionDto; onClose: () => void; onDone: () => void }) {
  const [add, setAdd] = useState(1);
  const valid = Number.isInteger(add) && add >= 1 && subscription.seatCnt + add <= SEAT_INPUT_LIMITS.max;

  const preview = useQuery({
    queryKey: ["billing", "seat-preview", add],
    queryFn:  () => authFetch<{ data: SeatAdditionPreview }>(`/api/billing/seats/preview?add=${add}`).then((r) => r.data),
    enabled:  valid,
  });

  const mutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: SeatChangeResult }>("/api/billing/seats", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatCnt: subscription.seatCnt + add }),
      }).then((r) => r.data),
    onSuccess: (r) => {
      if (r.action === "ADDED") toast.success(`좌석 ${r.addedSeats}개를 추가하고 ${formatWon(r.amount)}을 결제했습니다.`);
      onDone();
    },
    onError: (err: Error) => {
      const declined = err instanceof AuthFetchError && err.code === "BILLING_PAYMENT_FAILED";
      toast.error(err.message, { duration: declined ? 8000 : 4000 });
    },
  });

  const p = preview.data;
  return (
    <div className="sp-overlay" onClick={() => !mutation.isPending && onClose()}>
      <div className="sp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sp-modal-header">
          <div className="sp-modal-title">좌석 추가</div>
          <button className="sp-modal-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="sp-modal-body" style={{ display: "grid", gap: "var(--space-3)" }}>
          <div className="sp-field">
            <div className="sp-label">추가할 좌석 수</div>
            <input className={`sp-input${valid ? "" : " is-err"}`} type="number" min={1} value={add} onChange={(e) => setAdd(Number(e.target.value))} autoFocus />
          </div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
            {preview.isLoading && "일할 금액 계산 중…"}
            {p && (
              <>
                현재 주기 종료({fmtDate(p.periodEnd)})까지 <b>{p.remainingDays}일</b> 남아 (주기 {p.periodDays}일)
                지금 <b style={{ color: "var(--color-text-primary)", fontSize: "var(--text-lg)" }}>{formatWon(p.amount)}</b>이 결제됩니다.<br />
                다음 결제부터는 {p.newSeatCnt}좌석 × {formatWon(p.unitPrice)} = <b>{formatWon(p.newMonthlyAmount)}</b>/월 입니다.
                {subscription.pendingSeatCnt !== null && (
                  <><br /><span style={{ color: "var(--color-warning)" }}>기존 좌석 축소 예약은 취소됩니다.</span></>
                )}
              </>
            )}
            {preview.error && <span className="sp-hint is-err">{(preview.error as Error).message}</span>}
          </div>
        </div>
        <div className="sp-modal-footer">
          <button className="sp-btn sp-btn-ghost" onClick={onClose} disabled={mutation.isPending}>취소</button>
          <button className="sp-btn sp-btn-primary" onClick={() => mutation.mutate()} disabled={!valid || !p || mutation.isPending}>
            {mutation.isPending ? "결제 중…" : p ? `${formatWon(p.amount)} 결제하고 추가` : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 좌석 축소 모달 (다음 결제일 적용 예약) ──────────────────────────────────

function SeatReduceModal({ subscription, usedSeats, onClose, onDone }: { subscription: SubscriptionDto; usedSeats: number; onClose: () => void; onDone: () => void }) {
  const minSeats = Math.max(SEAT_INPUT_LIMITS.min, usedSeats);
  const [target, setTarget] = useState(subscription.pendingSeatCnt ?? Math.max(minSeats, subscription.seatCnt - 1));
  const valid = Number.isInteger(target) && target >= minSeats && target <= subscription.seatCnt;

  const mutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: SeatChangeResult }>("/api/billing/seats", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seatCnt: target }),
      }).then((r) => r.data),
    onSuccess: (r) => {
      if (r.action === "REDUCE_SCHEDULED") toast.success(`다음 결제일(${fmtDate(r.appliesAt)})부터 좌석이 ${r.pendingSeatCnt}개로 줄어듭니다.`);
      else if (r.action === "REDUCE_CANCELED") toast.success("좌석 축소 예약을 취소했습니다.");
      else toast.success("변경 사항이 없습니다.");
      onDone();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="sp-overlay" onClick={() => !mutation.isPending && onClose()}>
      <div className="sp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ width: 560 }}>
        <div className="sp-modal-header">
          <div className="sp-modal-title">좌석 축소</div>
          <button className="sp-modal-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="sp-modal-body" style={{ display: "grid", gap: "var(--space-3)" }}>
          <div className="sp-field">
            <div className="sp-label">다음 결제일부터 적용할 좌석 수</div>
            <input className={`sp-input${valid ? "" : " is-err"}`} type="number" min={minSeats} max={subscription.seatCnt} value={target} onChange={(e) => setTarget(Number(e.target.value))} autoFocus />
            {!valid && <div className="sp-hint is-err">현재 편집 멤버 {usedSeats}명 이상, 구매 좌석 {subscription.seatCnt}개 이하로 입력해 주세요.</div>}
          </div>
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
            축소는 <b>다음 결제일({fmtDate(subscription.nextBillAt)})부터</b> 적용되고, 이미 결제한 금액은 환불되지 않습니다.
            예약 후에는 예약한 좌석 수가 초대 상한으로 적용됩니다. 현재 좌석 수({subscription.seatCnt})를 그대로 입력하면 예약이 취소됩니다.
          </div>
          {/* 누굴 뷰어로 바꾸면 줄일 수 있는지 바로 보이게 — 모달에서는 처음부터 펼친다 */}
          <SeatBreakdown usedSeats={usedSeats} defaultOpen />
        </div>
        <div className="sp-modal-footer">
          <button className="sp-btn sp-btn-ghost" onClick={onClose} disabled={mutation.isPending}>취소</button>
          <button className="sp-btn sp-btn-primary" onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
            {mutation.isPending ? "처리 중…" : target === subscription.seatCnt ? "예약 취소" : "축소 예약"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 결제 내역 ───────────────────────────────────────────────────────────────

function PaymentsTable({ items, loading }: { items: PaymentDto[]; loading: boolean }) {
  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <div className="sp-group-title">결제 내역</div>
        <span className="sp-badge sp-badge-neutral">{items.length}건</span>
      </div>
      <div className="sp-group-body" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 16, color: "var(--color-text-tertiary)" }}>불러오는 중...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-sm)" }}>결제 내역이 없습니다.</div>
        ) : (
          <div className="sp-table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="sp-table">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>구분</th>
                  <th>좌석</th>
                  <th>기간</th>
                  <th style={{ textAlign: "right" }}>금액</th>
                  <th>상태</th>
                  <th>영수증</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.paymentId}>
                    <td className="is-mono">{new Date(p.approvedAt ?? p.createdAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td>{PAYMENT_TYPE_LABEL[p.type] ?? p.type}</td>
                    <td className="is-mono">{p.type === "SEAT_ADD" ? `+${p.seatCnt}` : p.seatCnt}</td>
                    <td className="is-mono is-muted">{p.periodStart ? `${fmtDate(p.periodStart)} ~ ${fmtDate(p.periodEnd)}` : "-"}</td>
                    <td className="is-mono" style={{ textAlign: "right" }}>{formatWon(p.amount)}</td>
                    <td>
                      {p.status === "PAID"   && <span className="sp-badge sp-badge-success">{PAYMENT_STATUS_LABEL.PAID}</span>}
                      {p.status === "FAILED" && <span className="sp-badge sp-badge-error" title={p.failReason ?? undefined}>{PAYMENT_STATUS_LABEL.FAILED}</span>}
                      {p.status === "PARTIALLY_REFUNDED" && <span className="sp-badge sp-badge-warning">{PAYMENT_STATUS_LABEL.PARTIALLY_REFUNDED}</span>}
                      {p.status === "REFUNDED" && <span className="sp-badge sp-badge-neutral">{PAYMENT_STATUS_LABEL.REFUNDED}</span>}
                    </td>
                    <td>
                      {p.receiptUrl ? <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer">보기</a> : <span className="is-muted">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
