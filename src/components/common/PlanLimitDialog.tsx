"use client";

/**
 * PlanLimitDialog — 플랜 상한 안내 다이얼로그
 *
 * 역할:
 *   - 상한에 걸렸을 때 "지금 무엇을 하면 되는지"를 한 화면에서 보여 준다.
 *   - 같은 "상한 초과"라도 해야 할 일이 다르므로 상황(kind)으로 갈라 제목·주 버튼을 바꾼다:
 *
 *     kind        | 언제                                   | 제목                  | 주 버튼
 *     ------------|----------------------------------------|-----------------------|------------------
 *     UPGRADE     | FREE 상한 (프로젝트 생성·초대·승격·업로드) | BASIC 플랜이 필요합니다 | BASIC 시작하기
 *     SEATS       | 구독 좌석 부족 (이미 BASIC)              | 좌석이 부족합니다      | 좌석 추가
 *     EDITORS     | 잠금 해제 실패 — 편집 멤버가 여럿          | 편집 멤버를 줄여야 합니다 | 멤버 관리로 가기
 *
 *     이미 BASIC 인 사람에게 "BASIC 플랜이 필요합니다 / BASIC 시작하기"를 띄우던 문제를 없앤다.
 *     열린 프로젝트 초과(FREE_PROJECTS)는 "교체"라는 행동이 따로 있어 ProjectSwapDialog 가 맡는다.
 *
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
import { isPlanLimitCode, PLAN_LIMIT_CODES, PRICING_PATH } from "@/lib/planLimits";
import { BILLING_ERROR_CODES, BILLING_PATH } from "@/lib/billing/constants";
import { formatWon } from "@/lib/billing/pricing";

/** 안내 상황 — 해야 할 일이 서로 달라서 제목·주 버튼이 갈린다 */
export type PlanLimitKind = "UPGRADE" | "SEATS" | "EDITORS";

export type PlanLimitInfo = {
  kind: PlanLimitKind;
  /** 서버가 내려준 안내 문구 */
  message: string;
  /** BASIC 으로 가면 필요한 좌석 수 — 초대·승격 상한 응답에만 실린다 */
  requiredSeats?: number;
  /** 그 좌석 수의 월 청구액(부가세 포함) */
  monthlyAmount?: number;
  /** EDITORS — "멤버 관리로 가기" 대상 프로젝트 */
  projectId?: string;
};

/** 이 다이얼로그가 처리하는 에러인지 (onError 에서 분기용). 잠금 해제 초과도 포함한다 */
export function isPlanLimitError(err: unknown): err is AuthFetchError {
  return (
    err instanceof AuthFetchError &&
    (isPlanLimitCode(err.code) || err.code === BILLING_ERROR_CODES.UNLOCK_OVER_LIMIT)
  );
}

/** 잠금 해제 실패가 "열린 프로젝트 초과"인지 — 이 경우만 교체 다이얼로그로 보낸다 */
export function isOpenProjectLimitError(err: unknown): err is AuthFetchError {
  return (
    err instanceof AuthFetchError &&
    err.code === BILLING_ERROR_CODES.UNLOCK_OVER_LIMIT &&
    err.details.reason === "FREE_PROJECTS"
  );
}

/** 에러 코드·사유로 상황을 정한다 */
function resolveKind(err: AuthFetchError): PlanLimitKind {
  if (err.code === BILLING_ERROR_CODES.UNLOCK_OVER_LIMIT) {
    // 잠금 해제 실패 — 사유에 따라 갈린다 (FREE_PROJECTS 는 여기 오지 않는다)
    return err.details.reason === "FREE_EDITORS" ? "EDITORS" : "SEATS";
  }
  return err.code === PLAN_LIMIT_CODES.seat ? "SEATS" : "UPGRADE";
}

/** 상한 에러 → 다이얼로그 입력. 서버 extra 중 쓰는 값만 타입 확인 후 담는다 */
export function toPlanLimitInfo(err: AuthFetchError, projectId?: string): PlanLimitInfo {
  const seats  = err.details.requiredSeats;
  const amount = err.details.monthlyAmount;
  return {
    kind:    resolveKind(err),
    message: err.message,
    ...(typeof seats  === "number" ? { requiredSeats: seats }  : {}),
    ...(typeof amount === "number" ? { monthlyAmount: amount } : {}),
    ...(projectId ? { projectId } : {}),
  };
}

const TITLE: Record<PlanLimitKind, string> = {
  UPGRADE: "BASIC 플랜이 필요합니다",
  SEATS:   "좌석이 부족합니다",
  EDITORS: "편집 멤버를 줄여야 합니다",
};

type Props = {
  /** null 이면 닫힘 */
  limit: PlanLimitInfo | null;
  onClose: () => void;
};

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

  /** UPGRADE·SEATS 공통 — 구독 화면으로. 좌석 기본값과 돌아올 화면을 실어 보낸다 */
  function goBilling() {
    const params = new URLSearchParams();
    if (limit?.requiredSeats) params.set("seats", String(limit.requiredSeats));
    params.set("returnTo", pathname);
    onClose();
    router.push(`${BILLING_PATH}?${params.toString()}`);
  }

  /** EDITORS — 그 프로젝트의 멤버 관리로. 잠긴 프로젝트에서도 뷰어 강등·제외는 허용된다(정책 §1-6) */
  function goMembers() {
    const target = limit?.projectId;
    onClose();
    if (target) router.push(`/projects/${target}/members`);
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
          {TITLE[limit.kind]}
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

          {/* UPGRADE 일 때만 요금제 안내 — 이미 구독 중인 사람에게는 볼 이유가 없다 */}
          {limit.kind === "UPGRADE" && (
            <button className="sp-btn sp-btn-ghost" onClick={openPricing} style={{ fontSize: 13, padding: "6px 14px" }}>
              요금제 보기
            </button>
          )}

          {limit.kind === "EDITORS" ? (
            <button className="sp-btn sp-btn-primary" onClick={goMembers} disabled={!limit.projectId} style={{ fontSize: 13, padding: "6px 14px" }}>
              멤버 관리로 가기
            </button>
          ) : (
            <button className="sp-btn sp-btn-primary" onClick={goBilling} style={{ fontSize: 13, padding: "6px 14px" }}>
              {limit.kind === "SEATS" ? "좌석 추가" : "BASIC 시작하기"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 스타일 — ConfirmDialog 와 동일 값 ─────────────────────────────────────────

export const overlayStyle: React.CSSProperties = {
  position:       "fixed",
  inset:          0,
  background:     "rgba(0,0,0,0.45)",
  display:        "flex",
  alignItems:     "center",
  justifyContent: "center",
  zIndex:         1000,
};

export const dialogStyle: React.CSSProperties = {
  background:   "var(--color-bg-card)",
  borderRadius: 10,
  padding:      "24px 28px",
  minWidth:     380,
  maxWidth:     480,
  boxShadow:    "0 8px 32px rgba(0,0,0,0.18)",
  border:       "1px solid var(--color-border)",
};
