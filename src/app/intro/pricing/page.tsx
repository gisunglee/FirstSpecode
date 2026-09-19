/**
 * PricingPage — 요금제 (/intro/pricing)
 *
 * 역할:
 *   - 서버 컴포넌트: 페이지 메타데이터(제목·설명)만 담당
 *   - 실제 화면은 PricingContent(클라이언트) 가 렌더링
 *
 * 왜 둘로 나눴나:
 *   - FAQ 아코디언·PRO 알림 폼은 상태가 필요해 "use client" 가 필수인데,
 *     Next.js 는 클라이언트 컴포넌트에서 `export const metadata` 를 허용하지 않는다.
 *
 * 정책 근거: .claude/biz/B.결제정책.md §1-2 티어, §1-4 좌석, §1-5~1-7 결제·환불
 */

import type { Metadata } from "next";
import PricingContent from "./PricingContent";

export const metadata: Metadata = {
  title: "요금제 | SPECODE",
  description:
    "SPECODE 요금제 — FREE 는 카드 등록 없이 시작, BASIC 은 좌석당 월 9,900원(부가세 포함). 뷰어는 무료, 월 결제, 언제든 해지.",
};

export default function PricingPage() {
  return <PricingContent />;
}
