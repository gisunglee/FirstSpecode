"use client";

/**
 * BillingSettingsPage — 설정 > 구독·결제 (/settings/billing)
 *
 * 역할 (정책 §3 2단계 화면):
 *   - 현재 플랜 카드: 금액·다음 결제일을 맨 위 한 줄로, 좌석·결제 수단·이용 기간은 행 + 우측 [변경]
 *   - 버튼: BASIC 시작(좌석 수 입력 → 금액 미리보기 → 카드 등록) / 좌석 변경 / 결제 수단 변경 / 해지·해지 취소
 *   - 결제 내역 표 (영수증 링크, 실패 사유) — 내역이 없으면 카드를 아예 그리지 않는다
 *   - 잠긴 프로젝트가 있으면 안내 + 프로젝트 목록 링크
 *
 * 화면 구성 원칙 (2026-09-23 사용자 피드백 "정신없다"):
 *   이 화면에서 사용자가 내리는 결정은 하나뿐이다 — "좌석 N개, 월 얼마로 시작/변경".
 *   그래서 금액을 화면에서 가장 큰 요소로 두고, 좌석 정의·주의사항 같은 설명은
 *   반복하지 않고 접힘(SeatBreakdown) 또는 작은 회색 한 줄로 내린다.
 *   좌석 추가/축소는 서버가 이미 `PATCH /api/billing/seats` 하나로 처리하므로 모달도 하나다.
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
import { formatKstDate, formatWon, kstDayOfMonth } from "@/lib/billing/pricing";

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
  const [seatChangeOpen, setSeatChangeOpen] = useState(false);
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
  const payments = paymentsQuery.data ?? [];

  return (
    <div style={{ padding: 0 }}>
      {/* 헤더 — 프로필 설정과 같은 sticky 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", position: "sticky", top: 0, zIndex: 10, background: "var(--color-bg-card)", borderBottom: "1px solid var(--color-border)", marginBottom: 16 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)" }}>구독·결제</div>
        <Link href="/intro/pricing" target="_blank" rel="noopener" className="sp-btn sp-btn-ghost sp-btn-sm">요금제 안내</Link>
      </div>

      <div style={{ padding: "0 24px 32px", maxWidth: 720, display: "grid", gap: "var(--space-4)" }}>
        {overviewQuery.isLoading && <div style={{ color: "var(--color-text-tertiary)" }}>불러오는 중...</div>}
        {overviewQuery.error && <div className="sp-hint is-err">{(overviewQuery.error as Error).message}</div>}

        {overview && (
          <>
            {/* Mock 환경 안내 — 운영에서도 내부 사용자만 쓰는 동안은 Mock (정책 §3).
                실제 결제가 아니라는 사실만 알면 되므로 한 줄로 조용히 둔다 */}
            {overview.provider === "MOCK" && (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--color-warning)" }}>
                모의 결제 환경 — 카드 등록·결제는 &quot;PG 창&quot;에서 흉내만 내며 실제 결제는 일어나지 않습니다.
              </div>
            )}

            <PlanCard
              overview={overview}
              onStart={goToCardRegistration}
              onChangeSeats={() => setSeatChangeOpen(true)}
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

            {/* 결제 내역은 있을 때만 — 구독 전에는 늘 비어 있어 빈 카드가 화면만 먹는다 */}
            {payments.length > 0 && <PaymentsTable items={payments} />}
          </>
        )}
      </div>

      {/* 모달 */}
      {seatChangeOpen && overview?.subscription && (
        <SeatChangeModal
          subscription={overview.subscription}
          usedSeats={overview.usedSeats}
          onClose={() => setSeatChangeOpen(false)}
          onDone={() => { setSeatChangeOpen(false); refresh(); }}
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

// ─── 공용 조각 ───────────────────────────────────────────────────────────────

/** 큰 금액 한 줄 — 이 화면의 주인공. 값 하나만 크게 두고 나머지는 전부 작게 */
function BigAmount({ amount, suffix, sub }: { amount: number; suffix: string; sub: string }) {
  return (
    <div>
      <div style={{ fontSize: "var(--text-4xl)", fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1.2 }}>
        {formatWon(amount)}
        <span style={{ fontSize: "var(--text-lg)", fontWeight: 400, color: "var(--color-text-tertiary)", marginLeft: 6 }}>{suffix}</span>
      </div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

/** 라벨 | 값 | 우측 액션 한 줄 — 카드 안의 부차 정보는 전부 이 모양으로 통일 */
function InfoRow({ label, value, hint, action }: { label: string; value: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "8px 0", borderTop: "1px solid var(--color-border-subtle)" }}>
      <div style={{ width: 76, flexShrink: 0, fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-base)", color: "var(--color-text-primary)" }}>{value}</div>
        {hint && <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", marginTop: 2 }}>{hint}</div>}
      </div>
      {action}
    </div>
  );
}

// ─── 플랜 카드 ───────────────────────────────────────────────────────────────

function PlanCard(props: {
  overview: BillingOverview;
  onStart: (start: CardRegistrationStart) => void;
  onChangeSeats: () => void;
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
    return <StartBasicCard overview={overview} onStart={props.onStart} />;
  }

  const s = sub!;
  const badge = STATUS_BADGE[s.status] ?? { label: s.status, cls: "sp-badge-neutral" };
  const scheduled = s.status === S.CANCEL_SCHEDULED;

  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <div className="sp-group">
        <div className="sp-group-header">
          <div className="sp-group-title">{overview.product.name}</div>
          <span className={`sp-badge ${badge.cls}`}><span className="dot" />{badge.label}</span>
        </div>
        <div className="sp-group-body" style={{ display: "grid", gap: "var(--space-4)" }}>
          {/* 상태별 안내 — 조치가 필요한 상태에서는 그 조치 버튼을 안내 안에 둔다 */}
          {s.status === S.PAST_DUE && (
            <div className="sp-hint is-err" style={{ display: "block", padding: "8px 12px", border: "1px solid var(--color-error-border)", borderRadius: "var(--radius-sm)", background: "var(--color-error-subtle)", lineHeight: 1.6 }}>
              정기 결제에 {s.failCnt}회 실패했습니다. 3일 간격으로 다시 시도하며, 모두 실패하면 FREE 로 전환됩니다.
              아래 <b>결제 수단</b>을 변경하면 즉시 다시 결제를 시도합니다.
            </div>
          )}
          {scheduled && (
            <div className="sp-hint is-warn" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "8px 12px", border: "1px solid var(--color-warning-border)", borderRadius: "var(--radius-sm)", background: "var(--color-warning-subtle)", lineHeight: 1.6 }}>
              <span style={{ flex: 1 }}>
                해지가 예약되어 {fmtDate(s.currentPeriodEnd)}까지 이용할 수 있습니다. 그 이후 결제되지 않고 소유 프로젝트가 읽기 전용으로 바뀝니다.
              </span>
              <button className="sp-btn sp-btn-secondary sp-btn-sm" onClick={props.onUncancel} disabled={busy} style={{ flexShrink: 0 }}>해지 취소</button>
            </div>
          )}

          {/* 금액 한 줄 — 매달 얼마가 언제 빠지는지가 이 화면의 핵심 */}
          <BigAmount
            amount={scheduled ? 0 : s.nextChargeAmount}
            suffix={scheduled ? "" : "/ 월"}
            sub={
              scheduled
                ? `추가 결제 없음 · ${fmtDate(s.currentPeriodEnd)} 이용 종료`
                : `다음 결제 ${fmtDate(s.nextBillAt)} · 좌석 ${s.seatCnt}개 × ${formatWon(s.unitPrice)} (부가세 포함)`
            }
          />

          {/* 부차 정보 — 라벨·값·[변경] 세 칸으로 통일 */}
          <div>
            <InfoRow
              label="좌석"
              value={`${s.seatCnt}개 구매 · ${overview.usedSeats}개 사용`}
              hint={s.pendingSeatCnt !== null ? `다음 결제일부터 ${s.pendingSeatCnt}개로 축소 예약됨` : "뷰어는 좌석을 쓰지 않습니다"}
              action={<button className="sp-btn sp-btn-secondary sp-btn-sm" onClick={props.onChangeSeats} disabled={busy}>변경</button>}
            />
            <InfoRow
              label="결제 수단"
              value={s.card ? `${s.card.company} ${s.card.numberMasked}` : "미등록"}
              action={<button className="sp-btn sp-btn-secondary sp-btn-sm" onClick={props.onChangeCard} disabled={busy}>변경</button>}
            />
            <InfoRow
              label="이용 기간"
              value={`${fmtDate(s.currentPeriodStart)} ~ ${fmtDate(s.currentPeriodEnd)}`}
            />
          </div>

          {/* 좌석 숫자만 보면 "왜 N명?"이 생긴다 — 궁금할 때만 펼친다 */}
          <SeatBreakdown />
        </div>
      </div>

      {/* 해지는 설정 화면에 바로(다크패턴 규제). 다만 결제 액션과 나란히 두면 오조작 위험이라
          카드 밖 아래에 조용히 둔다 — 찾는 사람은 바로 찾을 수 있는 위치다 */}
      {!scheduled && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="sp-btn sp-btn-ghost sp-btn-sm" onClick={props.onCancel} disabled={busy} style={{ color: "var(--color-text-tertiary)" }}>
            구독 해지
          </button>
        </div>
      )}
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

  // 다음 결제일은 "카드 등록한 날"의 같은 날짜 — 시작 전에는 오늘 날짜로 안내한다 (정책 §1-5 anchor)
  const billingDay = kstDayOfMonth(new Date());

  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <div className="sp-group-title">{overview.product.name}</div>
        <span className="sp-badge sp-badge-neutral">
          현재 {ended ? (STATUS_BADGE[ended.status]?.label ?? ended.status) : overview.plan}
        </span>
      </div>
      <div className="sp-group-body" style={{ display: "grid", gap: "var(--space-4)" }}>
        {overview.plan !== "FREE" && (
          <div className="sp-hint" style={{ color: "var(--color-text-secondary)" }}>
            현재 플랜은 운영자가 부여한 것입니다. 결제 구독을 시작하면 구독이 플랜의 기준이 됩니다.
          </div>
        )}

        {/* 결정 한 줄: 좌석 수 × 단가 */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-3)" }}>
          <div className="sp-field" style={{ flex: "0 0 108px", marginBottom: 0 }}>
            <div className="sp-label">좌석 수</div>
            <input
              className={`sp-input${valid ? "" : " is-err"}`}
              type="number" min={minSeats} max={SEAT_INPUT_LIMITS.max} value={seatCnt}
              onChange={(e) => setSeatCnt(Number(e.target.value))}
            />
          </div>
          <div style={{ fontSize: "var(--text-base)", color: "var(--color-text-tertiary)", paddingBottom: 8 }}>
            × {formatWon(overview.product.unitPrice)} / 좌석
          </div>
        </div>

        {/* 결과: 매달 얼마 */}
        <BigAmount
          amount={monthly}
          suffix="/ 월"
          sub={`부가세 포함 · 카드 등록 즉시 첫 달 결제, 이후 매월 ${billingDay}일 자동 결제`}
        />

        {!valid && (
          <div className="sp-hint is-err">
            좌석 수는 {minSeats}~{SEAT_INPUT_LIMITS.max} 사이여야 합니다.
            {overview.usedSeats > SEAT_INPUT_LIMITS.min && ` 지금 편집 멤버가 ${overview.usedSeats}명이라 그보다 적게는 시작할 수 없습니다.`}
          </div>
        )}

        <div className="sp-btn-row">
          <button className="sp-btn sp-btn-primary sp-btn-lg" disabled={!valid || startMutation.isPending} onClick={() => startMutation.mutate(seatCnt)}>
            {startMutation.isPending ? "결제창 준비 중…" : ended ? "다시 구독하기" : "BASIC 시작하기"}
          </button>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>언제든 이 화면에서 해지할 수 있습니다</span>
        </div>

        <div className="sp-divider" style={{ margin: 0 }} />

        {/* 좌석 정의는 여기 한 줄 + 접힘으로만 — 본문에서 반복하지 않는다 */}
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
            좌석 {minSeats}개는 지금 소유 프로젝트의 편집 멤버 {overview.usedSeats}명 기준입니다. 뷰어는 좌석을 쓰지 않습니다.
          </div>
          <SeatBreakdown />
        </div>
      </div>
    </div>
  );
}

// ─── 좌석 변경 모달 (추가 = 일할 즉시 결제 / 축소 = 다음 결제일 예약) ─────────
//
// 서버 `PATCH /api/billing/seats` 가 좌석 수 하나만 받아 크면 추가·작으면 축소 예약·
// 같으면 예약 취소로 갈라지므로 화면도 모달 하나로 둔다. 사용자가 "추가냐 축소냐"를
// 먼저 고르게 하면 버튼만 늘고 결정은 그대로다.

function SeatChangeModal({ subscription, usedSeats, onClose, onDone }: { subscription: SubscriptionDto; usedSeats: number; onClose: () => void; onDone: () => void }) {
  const current  = subscription.seatCnt;
  // 줄일 수 있는 하한 = 지금 쓰고 있는 좌석 수 (정책 §1-4: 사용 좌석보다 작게는 못 줄임)
  const minSeats = Math.max(SEAT_INPUT_LIMITS.min, usedSeats);
  const [target, setTarget] = useState<number>(subscription.pendingSeatCnt ?? current);

  const isAdd    = target > current;
  const isReduce = target < current;
  const isSame   = target === current;
  // 좌석 추가는 결제가 일어나므로 ACTIVE 에서만 (정책 §1-4)
  const addBlocked = isAdd && subscription.status !== S.ACTIVE;

  const valid =
    Number.isInteger(target) && target >= minSeats && target <= SEAT_INPUT_LIMITS.max && !addBlocked;

  // 추가일 때만 서버에 일할 금액을 물어본다 (계산은 서버가 원천)
  const preview = useQuery({
    queryKey: ["billing", "seat-preview", target],
    queryFn:  () => authFetch<{ data: SeatAdditionPreview }>(`/api/billing/seats/preview?add=${target - current}`).then((r) => r.data),
    enabled:  valid && isAdd,
  });
  const p = preview.data;

  const mutation = useMutation({
    mutationFn: () =>
      authFetch<{ data: SeatChangeResult }>("/api/billing/seats", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seatCnt: target }),
      }).then((r) => r.data),
    onSuccess: (r) => {
      if (r.action === "ADDED")                 toast.success(`좌석 ${r.addedSeats}개를 추가하고 ${formatWon(r.amount)}을 결제했습니다.`);
      else if (r.action === "REDUCE_SCHEDULED") toast.success(`다음 결제일(${fmtDate(r.appliesAt)})부터 좌석이 ${r.pendingSeatCnt}개로 줄어듭니다.`);
      else if (r.action === "REDUCE_CANCELED")  toast.success("좌석 축소 예약을 취소했습니다.");
      else                                       toast.success("변경 사항이 없습니다.");
      onDone();
    },
    onError: (err: Error) => {
      const declined = err instanceof AuthFetchError && err.code === "BILLING_PAYMENT_FAILED";
      toast.error(err.message, { duration: declined ? 8000 : 4000 });
    },
  });

  // 예약 취소(현재 좌석 수를 그대로 입력)도 "변경 없음"이 아니라 할 일이 있는 경우다
  const hasPending = subscription.pendingSeatCnt !== null;
  const submitDisabled = !valid || mutation.isPending || (isSame && !hasPending) || (isAdd && !p);

  function submitLabel(): string {
    if (mutation.isPending) return isAdd ? "결제 중…" : "처리 중…";
    if (isAdd)    return p ? `${formatWon(p.amount)} 결제하고 추가` : "추가";
    if (isReduce) return "축소 예약";
    return hasPending ? "축소 예약 취소" : "변경 없음";
  }

  return (
    <div className="sp-overlay" onClick={() => !mutation.isPending && onClose()}>
      <div className="sp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ width: 560 }}>
        <div className="sp-modal-header">
          <div className="sp-modal-title">좌석 변경</div>
          <button className="sp-modal-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <div className="sp-modal-body" style={{ display: "grid", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-3)" }}>
            <div className="sp-field" style={{ flex: "0 0 108px", marginBottom: 0 }}>
              <div className="sp-label">좌석 수</div>
              <input
                className={`sp-input${target >= minSeats && target <= SEAT_INPUT_LIMITS.max ? "" : " is-err"}`}
                type="number" min={minSeats} max={SEAT_INPUT_LIMITS.max} value={target}
                onChange={(e) => setTarget(Number(e.target.value))} autoFocus
              />
            </div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", paddingBottom: 8 }}>
              현재 {current}개 구매 · {usedSeats}개 사용
            </div>
          </div>

          {/* 방향에 따라 안내가 완전히 달라진다 — 한 덩어리에서 갈라 쓴다 */}
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
            {target < minSeats && (
              <span className="sp-hint is-err" style={{ display: "block" }}>
                지금 편집 멤버가 {usedSeats}명이라 {minSeats}개 미만으로는 줄일 수 없습니다. 먼저 편집 멤버를 뷰어로 바꾸거나 제외하세요.
              </span>
            )}
            {addBlocked && (
              <span className="sp-hint is-err" style={{ display: "block" }}>
                이용 중 상태에서만 좌석을 추가할 수 있습니다. 결제 실패 중이면 결제 수단을, 해지 예약 중이면 해지 취소를 먼저 해 주세요.
              </span>
            )}

            {isAdd && !addBlocked && (
              <>
                {preview.isLoading && "일할 금액 계산 중…"}
                {preview.error && <span className="sp-hint is-err">{(preview.error as Error).message}</span>}
                {p && (
                  <>
                    현재 주기 종료({fmtDate(p.periodEnd)})까지 <b>{p.remainingDays}일</b> 남아 (주기 {p.periodDays}일)
                    지금 <b style={{ color: "var(--color-text-primary)", fontSize: "var(--text-lg)" }}>{formatWon(p.amount)}</b>이 결제됩니다.<br />
                    다음 결제부터는 {p.newSeatCnt}좌석 × {formatWon(p.unitPrice)} = <b>{formatWon(p.newMonthlyAmount)}</b>/월 입니다.
                    {hasPending && (
                      <><br /><span style={{ color: "var(--color-warning)" }}>기존 좌석 축소 예약은 취소됩니다.</span></>
                    )}
                  </>
                )}
              </>
            )}

            {isReduce && target >= minSeats && (
              <>
                축소는 <b>다음 결제일({fmtDate(subscription.nextBillAt)})부터</b> 적용되고, 이미 결제한 금액은 환불되지 않습니다.
                다음 결제부터 {target}좌석 × {formatWon(subscription.unitPrice)} = <b>{formatWon(target * subscription.unitPrice)}</b>/월 입니다.<br />
                예약 후에는 예약한 좌석 수가 초대·승격 상한으로 적용됩니다.
              </>
            )}

            {isSame && (hasPending
              ? <>예약된 축소({subscription.pendingSeatCnt}개)를 취소하고 {current}개를 유지합니다.</>
              : <>늘리면 남은 기간만큼 일할 계산해 즉시 결제하고, 줄이면 다음 결제일부터 적용됩니다.</>)}
          </div>

          {/* 줄이려면 누구를 뷰어로 바꿔야 하는지 바로 볼 수 있게 */}
          <SeatBreakdown defaultOpen={isReduce || target < minSeats} />
        </div>

        <div className="sp-modal-footer">
          <button className="sp-btn sp-btn-ghost" onClick={onClose} disabled={mutation.isPending}>취소</button>
          <button className="sp-btn sp-btn-primary" onClick={() => mutation.mutate()} disabled={submitDisabled}>
            {submitLabel()}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 결제 내역 ───────────────────────────────────────────────────────────────

function PaymentsTable({ items }: { items: PaymentDto[] }) {
  return (
    <div className="sp-group">
      <div className="sp-group-header">
        <div className="sp-group-title">결제 내역</div>
        <span className="sp-badge sp-badge-neutral">{items.length}건</span>
      </div>
      <div className="sp-group-body" style={{ padding: 0 }}>
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
      </div>
    </div>
  );
}
