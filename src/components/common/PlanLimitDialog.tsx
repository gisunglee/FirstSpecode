"use client";

/**
 * PlanLimitDialog — 플랜 상한 안내 다이얼로그
 *
 * 역할:
 *   - 프로젝트 생성·복사·멤버 초대·뷰어 승격이 FREE 상한(PLAN_LIMIT_*)에 걸렸을 때
 *     서버 메시지를 보여 주고, 서버가 계산한 "필요 좌석 · 월 금액"이 있으면 같이 보여 준다.
 *   - "BASIC 시작하기" → 구독 시작 화면(/settings/billing)으로 이동. 좌석 수 기본값(seats)과
 *     결제 뒤 돌아올 화면(returnTo)을 쿼리로 넘긴다. 결제 뒤 초대·생성을 자동으로 이어 주지는
 *     않는다(정책 §5) — 사용자가 돌아와서 다시 누른다.
 *   - ConfirmDialog 는 확인 버튼이 위험(빨강) 색이라 안내 용도에 맞지 않아 분리했다.
 *
 * 사용 예:
 *   const [limit, setLimit] = useState<PlanLimitInfo | null>(null);
 *   onError: (err) => isPlanLimitError(err) ? setLimit(toPlanLimitInfo(err)) : toast.error(err.message)
 *   <PlanLimitDialog limit={limit} onClose={() => setLimit(null)} />
 *
 * 스타일: ConfirmDialog 와 동일한 오버레이·카드 패턴 (CSS 변수 기반 inline style)
 */

import { usePathname, useRouter } from "next/navigation";
import { AuthFetchError } from "@/lib/authFetch";
import { isPlanLimitCode, PRICING_PATH } from "@/lib/planLimits";
import { BILLING_PATH } from "@/lib/billing/constants";
import { formatWon } from "@/lib/billing/pricing";

export type PlanLimitInfo = {
  /** 서버가 내려준 안내 문구 */
  message: string;
  /** BASIC 으로 가면 필요한 좌석 수 — 초대·승격 상한 응답에만 실린다 */
  requiredSeats?: number;
  /** 그 좌석 수의 월 청구액(부가세 포함) */
  monthlyAmount?: number;
};

type Props = {
  /** null 이면 닫힘 */
  limit: PlanLimitInfo | null;
  onClose: () => void;
};

/** authFetch 에러가 플랜 상한 에러인지 판별 (onError 에서 분기용) */
export function isPlanLimitError(err: unknown): err is AuthFetchError {
  return err instanceof AuthFetchError && isPlanLimitCode(err.code);
}

/** 상한 에러 → 다이얼로그 입력. 서버 extra 중 숫자만 골라 담는다 (타입은 여기서 확인) */
export function toPlanLimitInfo(err: AuthFetchError): PlanLimitInfo {
  const seats  = err.details.requiredSeats;
  const amount = err.details.monthlyAmount;
  return {
    message: err.message,
    ...(typeof seats  === "number" ? { requiredSeats: seats }  : {}),
    ...(typeof amount === "number" ? { monthlyAmount: amount } : {}),
  };
}

export default function PlanLimitDialog({ limit, onClose }: Props) {
  // 훅은 조건 없이 먼저 — 아래 early return 보다 앞에 있어야 한다
  const router   = useRouter();
  const pathname = usePathname();
  if (!limit) return null;

  function openPricing() {
    // 앱 안의 작업 맥락을 잃지 않도록 요금제는 새 탭으로 연다
    window.open(PRICING_PATH, "_blank", "noopener");
    onClose();
  }

  function startBasic() {
    // 좌석 기본값 + 결제 뒤 돌아올 화면. returnTo 는 구독 화면이 앱 내부 경로인지 다시 검증한다.
    const params = new URLSearchParams();
    if (limit?.requiredSeats) params.set("seats", String(limit.requiredSeats));
    params.set("returnTo", pathname);
    onClose();
    router.push(`${BILLING_PATH}?${params.toString()}`);
  }

  const hasEstimate = typeof limit.requiredSeats === "number" && typeof limit.monthlyAmount === "number";

  return (
    <div style={overlayStyle} onClick={onClose} role="presentation">
      <div
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-limit-dialog-title"
      >
        <h3
          id="plan-limit-dialog-title"
          style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}
        >
          BASIC 플랜이 필요합니다
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          {limit.message}
        </p>

        {/* 결정에 필요한 숫자 한 줄 — 서버가 계산한 값 그대로 (화면에서 다시 계산하지 않는다) */}
        {hasEstimate && (
          <div
            style={{
              margin: "0 0 24px",
              padding: "10px 14px",
              borderRadius: "var(--radius-card)",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              fontSize: 14,
              color: "var(--color-text-primary)",
            }}
          >
            BASIC 좌석 <b>{limit.requiredSeats}개</b> · 월 <b>{formatWon(limit.monthlyAmount!)}</b>
            <span style={{ color: "var(--color-text-tertiary)", fontSize: 12, marginLeft: 8 }}>부가세 포함 · 언제든 해지</span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: hasEstimate ? 0 : 8 }}>
          <button className="sp-btn" onClick={onClose} style={{ fontSize: 13, padding: "6px 14px" }}>
            닫기
          </button>
          <button className="sp-btn sp-btn-ghost" onClick={openPricing} style={{ fontSize: 13, padding: "6px 14px" }}>
            요금제 보기
          </button>
          <button className="sp-btn sp-btn-primary" onClick={startBasic} style={{ fontSize: 13, padding: "6px 14px" }}>
            BASIC 시작하기
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 — ConfirmDialog 와 동일 값 ─────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(0,0,0,0.45)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  zIndex:         1000,
};

const dialogStyle: React.CSSProperties = {
  background:   "var(--color-bg-card)",
  borderRadius: 10,
  padding:      "24px 28px",
  minWidth:     380,
  maxWidth:     480,
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
  border:       "1px solid var(--color-border)",
};
