"use client";

/**
 * BillingCallbackPage — PG 카드 등록 창에서 돌아오는 지점 (/settings/billing/callback)
 *
 * 역할:
 *   - PG 가 successUrl 에 붙여 준 authKey·customerKey 와, 우리가 successUrl 에 실어 둔
 *     purpose(start|change)·seatCnt 를 읽어 POST /api/billing/card/callback 으로 넘긴다.
 *   - ?result=fail 이면 사용자가 PG 창에서 취소/실패한 것 → 안내 후 구독 화면으로.
 *   - 성공하면 구독 화면으로 이동. 결제 거절(402) 등 실패는 이 화면에 사유를 남긴다.
 *
 * 왜 화면이 API 를 대신 호출하나:
 *   이 앱의 인증은 Authorization: Bearer 헤더라 PG 리다이렉트(GET)에 실리지 않는다.
 *   MainLayout 이 세션을 확인한 뒤 이 화면이 authFetch 로 서버를 호출한다.
 *
 * 중복 제출 방지: authKey 는 1회용이라 새로고침으로 두 번 보내면 두 번째는 실패한다.
 * useRef 로 한 번만 보낸다.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { authFetch, AuthFetchError } from "@/lib/authFetch";
import { BILLING_ERROR_CODES, BILLING_PATH, BILLING_RETURN_TO_STORAGE_KEY } from "@/lib/billing/constants";

/**
 * 구독 시작 카드가 PG 로 떠나기 전에 남긴 "돌아갈 화면"을 한 번 읽고 지운다.
 * 앱 내부 경로("/...", "//" 제외)만 믿는다. 없거나 막혀 있으면 구독 화면.
 */
function popReturnTo(): string {
  try {
    const raw = sessionStorage.getItem(BILLING_RETURN_TO_STORAGE_KEY);
    sessionStorage.removeItem(BILLING_RETURN_TO_STORAGE_KEY);
    if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  } catch {
    // sessionStorage 가 막힌 브라우저 — 구독 화면으로
  }
  return BILLING_PATH;
}

export default function BillingCallbackPage() {
  return (
    <Suspense fallback={null}>
      <BillingCallbackInner />
    </Suspense>
  );
}

type Phase =
  | { kind: "working" }
  | { kind: "error"; title: string; message: string };

function BillingCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sent   = useRef(false);
  const [phase, setPhase] = useState<Phase>({ kind: "working" });

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    const purpose = params.get("purpose") === "change" ? "change" : "start";

    // PG 창에서 실패/취소
    if (params.get("result") === "fail") {
      toast.error(purpose === "start" ? "카드 등록이 취소되어 구독을 시작하지 않았습니다." : "카드 변경이 취소되었습니다.");
      router.replace(BILLING_PATH);
      return;
    }

    const authKey     = params.get("authKey");
    const customerKey = params.get("customerKey");
    const seatCntRaw  = params.get("seatCnt");
    const seatCnt     = seatCntRaw ? Number(seatCntRaw) : undefined;

    if (!authKey || !customerKey || (purpose === "start" && !Number.isInteger(seatCnt))) {
      setPhase({ kind: "error", title: "카드 등록 정보가 없습니다", message: "결제창에서 정상적으로 돌아오지 않았습니다. 구독 화면에서 다시 시도해 주세요." });
      return;
    }

    authFetch<{ data: { purpose: string; retry?: { ok: boolean; expired?: boolean } | null } }>("/api/billing/card/callback", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ authKey, customerKey, purpose, ...(purpose === "start" ? { seatCnt } : {}) }),
    })
      .then((r) => {
        if (r.data.purpose === "start") {
          toast.success("BASIC 구독이 시작되었습니다.");
        } else if (r.data.retry) {
          toast[r.data.retry.ok ? "success" : "error"](
            r.data.retry.ok
              ? "결제 수단을 변경하고 밀린 결제를 완료했습니다."
              : r.data.retry.expired
                ? "결제 수단은 변경됐지만 재결제가 실패해 구독이 종료되었습니다."
                : "결제 수단은 변경됐지만 재결제가 또 실패했습니다. 카드 상태를 확인해 주세요.",
            { duration: 7000 },
          );
        } else {
          toast.success("결제 수단이 변경되었습니다.");
        }
        // 구독 시작이면 상한 안내에서 넘어온 원래 화면으로 돌아간다(초대·생성은 사용자가 다시 누른다). 카드 변경은 구독 화면.
        router.replace(r.data.purpose === "start" ? popReturnTo() : BILLING_PATH);
      })
      .catch((err: unknown) => {
        const isDeclined = err instanceof AuthFetchError && err.code === BILLING_ERROR_CODES.PAYMENT_FAILED;
        setPhase({
          kind:    "error",
          title:   isDeclined ? "결제가 거절되었습니다" : "카드 등록을 처리하지 못했습니다",
          message: err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.",
        });
      });
  }, [params, router]);

  return (
    <div style={{ padding: 32, maxWidth: 560 }}>
      {phase.kind === "working" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--color-text-secondary)" }}>
          <div className="sp-spinner" />
          카드 등록 결과를 처리하고 있습니다…
        </div>
      ) : (
        <div className="sp-group">
          <div className="sp-group-header">
            <div className="sp-group-title" style={{ color: "var(--color-error)" }}>{phase.title}</div>
          </div>
          <div className="sp-group-body">
            <p style={{ margin: "0 0 var(--space-4)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{phase.message}</p>
            <Link href={BILLING_PATH} className="sp-btn sp-btn-primary">구독·결제 화면으로</Link>
          </div>
        </div>
      )}
    </div>
  );
}
