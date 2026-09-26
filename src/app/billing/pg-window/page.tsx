"use client";

/**
 * MockPgWindowPage — 모의 PG 창 (/billing/pg-window, PAYMENT_GATEWAY=mock 전용)
 *
 * 역할:
 *   - 토스 카드 등록창을 흉내낸다. 카드사·끝 4자리(선택)·"항상 실패 카드" 체크 → [등록 성공] / [실패·취소]
 *   - 성공: successUrl 에 authKey(카드 정보 인코딩)·customerKey 를 붙여 이동
 *     실패: failUrl 로 이동
 *   - ?view=receipt 로 열리면 모의 영수증을 보여 준다 (결제 내역의 "영수증" 링크)
 *
 * 보안: successUrl/failUrl 은 같은 출처(origin)의 경로만 허용 — 오픈 리다이렉트 방지.
 * 이 페이지는 (main) 그룹 밖이라 GNB/LNB 없이 뜬다. 로그인은 필요 없다(PG 창이니까).
 * 돈이 오가지 않는다는 것을 화면에 크게 표시한다.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { encodeMockAuthKey } from "@/lib/billing/mock-auth-key";
import { formatWon } from "@/lib/billing/pricing";

const CARD_COMPANIES = ["신한", "국민", "현대", "삼성", "롯데", "우리", "하나", "BC", "NH농협"];

export default function MockPgWindowPage() {
  return (
    <Suspense fallback={null}>
      <MockPgWindowInner />
    </Suspense>
  );
}

/** 같은 출처의 URL 만 허용 — 상대 경로("/...") 또는 현재 origin 으로 시작하는 절대 URL */
function sameOriginUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (typeof window === "undefined") return null;
  try {
    const u = new URL(raw, window.location.origin);
    return u.origin === window.location.origin ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 브라우저에 마운트된 뒤에만 true.
 *
 * 이 창은 화면 전체가 두 가지에 의존한다 — 쿼리스트링(customerKey·successUrl)과
 * window.location.origin(같은 출처 검사). 둘 다 서버 렌더에는 없어서, 서버는 "정보 없음"
 * 에러 화면을 그리고 클라이언트는 입력 폼을 그려 hydration 이 깨졌다(2026-09-26).
 * 마운트 전에는 양쪽 모두 준비 화면만 그려 서버·첫 클라이언트 렌더를 일치시킨다.
 */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function MockPgWindowInner() {
  const params  = useSearchParams();
  const mounted = useMounted();

  if (!mounted) {
    return (
      <Shell>
        <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "var(--text-base)" }}>
          결제창을 준비하고 있습니다…
        </div>
      </Shell>
    );
  }

  if (params.get("view") === "receipt") return <MockReceipt params={params} />;
  return <MockCardRegistration params={params} />;
}

// ─── 카드 등록 창 ────────────────────────────────────────────────────────────

function MockCardRegistration({ params }: { params: URLSearchParams }) {
  const customerKey = params.get("customerKey");
  const successUrl  = useMemo(() => sameOriginUrl(params.get("successUrl")), [params]);
  const failUrl     = useMemo(() => sameOriginUrl(params.get("failUrl")), [params]);

  const [cardCompany, setCardCompany] = useState(CARD_COMPANIES[0]!);
  const [last4, setLast4]             = useState("");
  const [alwaysFail, setAlwaysFail]   = useState(false);

  const invalid = !customerKey || !successUrl || !failUrl;
  const last4Ok = last4 === "" || /^\d{4}$/.test(last4);

  function succeed() {
    if (invalid || !last4Ok) return;
    const authKey = encodeMockAuthKey({ cardCompany, last4: last4 || "0000", alwaysFail });
    const u = new URL(successUrl!);
    u.searchParams.set("authKey", authKey);
    u.searchParams.set("customerKey", customerKey!);
    window.location.assign(u.toString());
  }

  function fail() {
    if (invalid) return;
    window.location.assign(failUrl!);
  }

  return (
    <Shell>
      <div style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
        <div style={{ fontSize: "var(--text-4xl)", fontWeight: 800, letterSpacing: "-0.02em", color: "var(--color-text-heading)" }}>PG 창</div>
        <div style={{ marginTop: "var(--space-2)", color: "var(--color-text-secondary)", fontSize: "var(--text-base)" }}>
          모의 결제 환경입니다. <b>실제 결제는 일어나지 않습니다.</b> 토스 심사 후 실제 결제창으로 교체됩니다.
        </div>
      </div>

      {invalid ? (
        <div className="sp-hint is-err" style={{ textAlign: "center" }}>
          결제 요청 정보가 없거나 허용되지 않은 돌아갈 주소입니다. 앱의 구독·결제 화면에서 다시 시작해 주세요.
        </div>
      ) : (
        <>
          <div className="sp-field">
            <div className="sp-label">카드사</div>
            <div className="sp-select-wrap">
              <select className="sp-input" value={cardCompany} onChange={(e) => setCardCompany(e.target.value)}>
                {CARD_COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="sp-field">
            <div className="sp-label">카드번호 끝 4자리 <span className="sp-label-opt">선택</span></div>
            <input
              className={`sp-input${last4Ok ? "" : " is-err"}`}
              inputMode="numeric"
              maxLength={4}
              placeholder="0000"
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
            {!last4Ok && <div className="sp-hint is-err">숫자 4자리만 입력해 주세요.</div>}
          </div>

          <label className="sp-checkbox-wrap" style={{ marginTop: "var(--space-2)" }}>
            <input className="sp-checkbox" type="checkbox" checked={alwaysFail} onChange={(e) => setAlwaysFail(e.target.checked)} />
            <span>이 카드로 하는 결제는 항상 실패 (결제 실패 · 재시도 · 강등 흐름 테스트용)</span>
          </label>

          <div className="sp-btn-row" style={{ marginTop: "var(--space-6)" }}>
            <button className="sp-btn sp-btn-primary sp-btn-lg" onClick={succeed} disabled={!last4Ok}>
              카드 등록 성공
            </button>
            <button className="sp-btn sp-btn-secondary sp-btn-lg" onClick={fail}>
              실패 · 취소
            </button>
          </div>

          <div style={{ marginTop: "var(--space-5)", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
            customerKey: {customerKey}
          </div>
        </>
      )}
    </Shell>
  );
}

// ─── 모의 영수증 ─────────────────────────────────────────────────────────────

function MockReceipt({ params }: { params: URLSearchParams }) {
  const amount     = Number(params.get("amount") ?? 0);
  const approvedAt = params.get("approvedAt");
  const rows: Array<[string, string]> = [
    ["주문번호",   params.get("orderId") ?? "-"],
    ["상품",       params.get("orderName") ?? "-"],
    ["결제 금액",  Number.isFinite(amount) ? `${formatWon(amount)} (부가세 포함)` : "-"],
    ["승인 시각",  approvedAt ? new Date(approvedAt).toLocaleString("ko-KR") : "-"],
    ["결제 키",    params.get("paymentKey") ?? "-"],
  ];
  return (
    <Shell>
      <div style={{ textAlign: "center", marginBottom: "var(--space-5)" }}>
        <div style={{ fontSize: "var(--text-3xl)", fontWeight: 800, color: "var(--color-text-heading)" }}>모의 영수증</div>
        <div style={{ marginTop: "var(--space-1)", color: "var(--color-text-secondary)" }}>실제 결제가 아닌 Mock PG 승인 내역입니다.</div>
      </div>
      <div className="sp-table-wrap">
        <table className="sp-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="is-muted" style={{ width: 120 }}>{k}</td>
                <td className="is-mono">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: "var(--space-5)", textAlign: "center" }}>
        <button className="sp-btn sp-btn-secondary" onClick={() => window.close()}>닫기</button>
      </div>
    </Shell>
  );
}

// ─── 공통 껍데기 ─────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg-root)", display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-6)" }}>
      <div
        style={{
          width: "100%", maxWidth: 480,
          background: "var(--color-bg-card)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: "var(--space-8)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
