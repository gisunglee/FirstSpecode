"use client";

/**
 * PlanLimitDialog — 플랜 상한 안내 다이얼로그
 *
 * 역할:
 *   - 프로젝트 생성·복사·멤버 초대가 FREE 상한(PLAN_LIMIT_*)에 걸렸을 때
 *     서버 메시지를 보여 주고 요금제 페이지로 안내한다.
 *   - ConfirmDialog 는 확인 버튼이 위험(빨강) 색이라 안내 용도에 맞지 않아 분리했다.
 *
 * 사용 예:
 *   const [limitMsg, setLimitMsg] = useState<string | null>(null);
 *   onError: (err) => isPlanLimitError(err) ? setLimitMsg(err.message) : toast.error(err.message)
 *   <PlanLimitDialog message={limitMsg} onClose={() => setLimitMsg(null)} />
 *
 * 스타일: ConfirmDialog 와 동일한 오버레이·카드 패턴 (CSS 변수 기반 inline style)
 */

import { AuthFetchError } from "@/lib/authFetch";
import { isPlanLimitCode, PRICING_PATH } from "@/lib/planLimits";

type Props = {
  /** 서버가 내려준 안내 문구. null 이면 닫힘 */
  message: string | null;
  onClose: () => void;
};

/** authFetch 에러가 플랜 상한 에러인지 판별 (onError 에서 분기용) */
export function isPlanLimitError(err: unknown): err is AuthFetchError {
  return err instanceof AuthFetchError && isPlanLimitCode(err.code);
}

export default function PlanLimitDialog({ message, onClose }: Props) {
  if (!message) return null;

  function openPricing() {
    // 앱 안의 작업 맥락을 잃지 않도록 요금제는 새 탭으로 연다
    window.open(PRICING_PATH, "_blank", "noopener");
    onClose();
  }

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
          FREE 플랜 상한에 도달했습니다
        </h3>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          {message}
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="sp-btn" onClick={onClose} style={{ fontSize: 13, padding: "6px 14px" }}>
            닫기
          </button>
          <button className="sp-btn sp-btn-primary" onClick={openPricing} style={{ fontSize: 13, padding: "6px 14px" }}>
            요금제 보기
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
