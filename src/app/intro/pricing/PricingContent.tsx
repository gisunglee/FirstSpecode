/**
 * PricingContent — 요금제 페이지 본문 (클라이언트)
 *
 * 역할:
 *   - 2열 플랜 카드: FREE(왼쪽) · BASIC(오른쪽, 추천 강조)
 *   - 준비 중인 PRO와 별도 계약이 필요한 ENTERPRISE 안내
 *   - 좌석 계산 방식 설명 (예시 포함)
 *   - "결제 핵심 안내" — 구매 결정에 필요한 결제·해지·환불·전환 정책 요약
 *   - FAQ 아코디언
 *
 * 스타일:
 *   - intro.css 의 `.sp-intro.is-white` 스코프 + 요금제 전용 `.plans / .faq / .notes` 규칙
 *   - 숫자·문구는 siteInfo.ts 상수에서 가져온다 (정책 문서와 단일 출처)
 *
 * 정책 근거: .claude/biz/B.결제정책.md §1-2 ~ §1-9
 */

"use client";

import Link from "next/link";
import { useRef } from "react";
import IntroNav from "../_components/IntroNav";
import IntroFooter from "../_components/IntroFooter";
import { useIntroEffects } from "../_components/useIntroEffects";
import { BILLING_OPEN, BUSINESS, INTRO_PATHS, PRICING, formatKrw } from "../_components/siteInfo";
import FaqAccordion, { type FaqItem } from "./FaqAccordion";

// 좌석 계산 예시 — 본문 설명과 숫자가 어긋나지 않도록 상수로 계산
const SEAT_EXAMPLE_SEATS = 4;
const SEAT_EXAMPLE_MONTHLY = SEAT_EXAMPLE_SEATS * PRICING.basicSeatMonthlyKrw;

const FAQ_ITEMS: FaqItem[] = [
  {
    q: "좌석을 늘리거나 줄이면 요금은 어떻게 되나요?",
    a: [
      "좌석을 추가하면 즉시 사용할 수 있으며, 이번 결제 주기의 남은 기간만큼 일할 계산한 금액을 결제합니다.",
      "좌석 축소는 다음 결제일부터 적용됩니다. 현재 편집 권한을 가진 인원보다 적은 수로는 줄일 수 없습니다.",
    ],
  },
  {
    q: "정기결제는 어떻게 진행되고, 실패하면 어떻게 되나요?",
    a: [
      `토스페이먼츠 카드 자동결제로 진행하며, 결제 ${PRICING.prenoticeDays}일 전에 예정 금액을 이메일로 안내합니다. 결제 카드는 설정에서 변경할 수 있습니다.`,
      `카드 한도·만료 등으로 결제에 실패하면 ${PRICING.retryIntervalDays}일 간격으로 ${PRICING.retryCount}회 재시도합니다. 그동안은 정상적으로 이용할 수 있으며, 모두 실패하면 FREE로 전환하고 이메일로 안내합니다.`,
    ],
  },
  {
    q: "해지와 환불은 어떻게 되나요?",
    a: [
      "해지는 로그인 후 설정 화면에서 버튼 한 번으로 즉시 신청할 수 있습니다. 해지하면 결제한 기간이 끝날 때까지 그대로 이용하고, 다음 결제부터 청구되지 않습니다. 기간 중에는 해지를 취소할 수도 있습니다.",
      `환불은 결제 후 ${PRICING.refundWindowDays}일 이내이고 유료 기능을 사용하지 않은 경우 전액 환불됩니다. 유료 기능 사용이란 ① 두 번째 소유 프로젝트 생성 ② 6번째 이상 편집 멤버 초대 ③ 첨부파일 업로드 중 하나라도 발생한 경우입니다.`,
      "유료 기능을 사용한 뒤에는 환불되지 않습니다. 결제 전에 FREE 플랜에서 필요한 기능을 충분히 확인해 주세요.",
    ],
  },
  {
    q: "결제를 중단하거나 FREE로 전환하면 데이터는 어떻게 되나요?",
    a: [
      "FREE 전환만으로 데이터가 삭제되지는 않습니다. 소유한 프로젝트는 읽기 전용으로 전환되며 조회와 MCP 읽기는 계속할 수 있습니다.",
      `FREE 기준(소유 프로젝트 1개, 프로젝트당 멤버 ${PRICING.freeMemberLimit}명)에 맞는 프로젝트를 직접 선택해 다시 편집할 수 있습니다. 재결제하면 나머지 프로젝트도 다시 활성화됩니다.`,
    ],
  },
  {
    q: "AI 사용 비용도 요금에 포함되나요?",
    a: [
      "포함되지 않습니다. SPECODE의 AI 기능은 회원이 등록한 본인의 AI API 키(예: Anthropic·OpenAI)로 동작하며, AI 호출 비용은 해당 AI 제공사에 직접 결제합니다.",
      "AI 설계와 MCP 연동 기능은 FREE를 포함한 모든 플랜에서 사용할 수 있습니다. 플랜에 따라 달라지는 것은 프로젝트 수, 편집 인원, 첨부파일 용량입니다.",
    ],
  },
  {
    q: "세금계산서를 받을 수 있나요?",
    a: [
      "현재는 세금계산서를 발행하지 않으며, 카드 결제 시 발급되는 카드 매출전표(부가세 포함)로 증빙을 대체합니다.",
      `별도 계약이나 사업자 명의 세금계산서가 필요하시면 ${BUSINESS.contactEmail}로 문의해 주세요.`,
    ],
  },
];

export default function PricingContent() {
  const rootRef = useRef<HTMLDivElement>(null);
  useIntroEffects(rootRef);

  return (
    <div className="sp-intro is-white is-sub" ref={rootRef}>
      <IntroNav active="pricing" solid />

      {/* ===================== 페이지 머리 ===================== */}
      <header className="pg-head" data-screen-label="요금제 머리">
        <div className="wrap">
          <div className="kicker dot reveal">PRICING</div>
          <h1 className="reveal d1">
            편집하는 사람만큼만,
            <br />
            <span className="grad-text">월 단위로 결제하세요.</span>
          </h1>
          <p className="pg-sub reveal d2">
            FREE는 카드 등록 없이 시작합니다. BASIC은 편집 권한이 필요한 사람 수만큼 좌석을 구매합니다.{" "}
            <b>읽기 전용 뷰어는 무료</b>이며, AI 모델 사용료는 등록한 API 키로 AI 제공사에 직접 결제합니다.
          </p>
        </div>
      </header>

      {/* ===================== 플랜 카드 ===================== */}
      <section className="sec plans-sec" data-screen-label="플랜 카드">
        <div className="wrap">
          <div className="plans reveal">
            {/* FREE */}
            <article className="plan">
              <div className="plan-name">FREE</div>
              <div className="plan-price">
                <b>0</b>
                <span className="unit">원</span>
              </div>
              <div className="plan-period">카드 등록 없이 · 기간 제한 없음</div>
              <p className="plan-desc">혼자 시작하거나 소규모 팀에서 SPECODE를 충분히 검토하는 플랜입니다.</p>
              <ul className="plan-feats">
                <li>소유 프로젝트 {PRICING.freeProjectLimit}개</li>
                <li>프로젝트당 멤버 {PRICING.freeMemberLimit}명 (소유자·뷰어 포함)</li>
                <li>AI 설계 · MCP 연동 · 산출물 발행 기능</li>
                <li>다른 사람의 프로젝트 참여는 무료 · 무제한</li>
                <li className="no">첨부파일 업로드 불가</li>
              </ul>
              <Link href={INTRO_PATHS.login} className="btn btn-ghost plan-cta">
                무료로 시작하기
              </Link>
            </article>

            {/* BASIC — 추천 */}
            <article className="plan is-rec">
              <div className="ribbon">추천</div>
              <div className="plan-name">BASIC</div>
              <div className="plan-price">
                <b>{formatKrw(PRICING.basicSeatMonthlyKrw)}</b>
                <span className="unit">원</span>
                <span className="per">/ 좌석 · 월</span>
              </div>
              <div className="plan-period">부가세 포함 · 월 결제 · 언제든 해지</div>
              <p className="plan-desc">여러 프로젝트를 팀과 함께 설계하고, 제출 산출물까지 관리하는 플랜입니다.</p>
              <ul className="plan-feats">
                <li>소유 프로젝트 무제한</li>
                <li>편집 권한이 필요한 인원만 좌석으로 계산</li>
                <li>
                  <b>뷰어는 무료 · 인원 제한 없음</b>
                </li>
                <li>첨부파일 저장 공간 {PRICING.basicStorageLabel}</li>
                <li>AI 설계 · MCP 연동 · 산출물 발행 기능</li>
              </ul>
              {BILLING_OPEN ? (
                <Link href={INTRO_PATHS.billing} className="btn btn-primary plan-cta">
                  BASIC 구독하기 <span className="arr">→</span>
                </Link>
              ) : (
                <div className="plan-cta-soon">
                  <span className="btn btn-primary plan-cta is-disabled" aria-disabled>
                    결제 오픈 준비 중
                  </span>
                  <small>지금은 FREE로 시작하세요. 결제가 열리면 설정 화면에서 바로 전환할 수 있습니다.</small>
                </div>
              )}
            </article>

          </div>

          <div className="plan-followup reveal">
            <p>
              <b>PRO</b> — 더 큰 저장 공간과 데이터 표준화 기능을 준비하고 있습니다.
            </p>
            <p>
              <b>ENTERPRISE</b> — 별도 계약, 세금계산서, 조직 단위 도입이 필요하시면{" "}
              <a href={`mailto:${BUSINESS.contactEmail}`}>{BUSINESS.contactEmail}</a>로 문의해 주세요.
            </p>
          </div>
        </div>
      </section>

      {/* ===================== 좌석 계산 ===================== */}
      <section className="sec light seat-sec" data-screen-label="좌석 계산">
        <div className="wrap">
          <div className="sec-head reveal">
            <div className="kicker dot">HOW SEATS WORK</div>
            <h2>좌석은 사람 수로 셉니다</h2>
            <p>
              프로젝트 수가 아니라, 내가 소유한 모든 프로젝트에서 <b>편집 권한을 가진 사람</b>을 중복 없이 센
              수가 좌석입니다. 결제자 본인도 포함됩니다.
            </p>
          </div>

          <div className="seat-ex reveal d1">
            <div className="seat-ex-row">
              <div className="seat-ex-proj">
                <div className="seat-ex-pn">프로젝트 A</div>
                <ul>
                  <li>
                    나 <em>소유자</em>
                  </li>
                  <li>
                    김OO <em>멤버</em>
                  </li>
                  <li>
                    이OO <em>멤버</em>
                  </li>
                </ul>
              </div>
              <div className="seat-ex-proj">
                <div className="seat-ex-pn">프로젝트 B</div>
                <ul>
                  <li>
                    나 <em>소유자</em>
                  </li>
                  <li>
                    김OO <em>관리자</em>
                  </li>
                  <li>
                    박OO <em>멤버</em>
                  </li>
                  <li className="viewer">
                    최OO <em>뷰어 · 무료</em>
                  </li>
                </ul>
              </div>
              <div className="seat-ex-result">
                <div className="seat-ex-pn">좌석 계산</div>
                <div className="seat-ex-count">
                  <b>{SEAT_EXAMPLE_SEATS}</b>좌석
                </div>
                <div className="seat-ex-who">나 · 김OO · 이OO · 박OO</div>
                <div className="seat-ex-total">
                  월 {formatKrw(SEAT_EXAMPLE_MONTHLY)}원
                  <small>
                    {SEAT_EXAMPLE_SEATS} × {formatKrw(PRICING.basicSeatMonthlyKrw)}원 · 부가세 포함
                  </small>
                </div>
              </div>
            </div>
            <p className="seat-ex-cap">
              김OO은 두 프로젝트에 참여하지만 1좌석으로 계산합니다. 최OO은 뷰어이므로 좌석에 포함하지 않습니다.
            </p>
          </div>
        </div>
      </section>

      {/* ===================== 결제 핵심 안내 ===================== */}
      <section className="sec notes-sec" data-screen-label="결제 핵심 안내">
        <div className="wrap">
          <div className="sec-head reveal">
            <div className="kicker dot">BEFORE YOU PAY</div>
            <h2>결제 전에 꼭 확인하세요</h2>
            <p>결제·해지·환불·플랜 전환에 필요한 핵심 기준만 정리했습니다.</p>
          </div>

          <ol className="notes reveal d1">
            <li>
              <b>표시 가격은 부가세 포함</b>이며 월 단위로 결제합니다.
            </li>
            <li>
              <b>해지는 설정 화면에서 즉시</b> 가능하며, 결제한 기간이 끝날 때까지 이용한 뒤 다음 결제부터 청구되지
              않습니다. 기간 중 해지 취소도 가능합니다.
            </li>
            <li>
              환불은 결제 후 {PRICING.refundWindowDays}일 이내이며 유료 기능을 사용하지 않은 경우에 전액 처리합니다.
              유료 기능을 사용한 뒤에는 환불되지 않습니다.
              자세한 내용은{" "}
              <Link href={INTRO_PATHS.terms}>이용약관</Link>의 환불 조항을 참고하세요.
            </li>
            <li>
              FREE로 전환되어도 <b>데이터는 바로 삭제되지 않습니다.</b> FREE 기준에 맞는 프로젝트를 선택해 편집할 수
              있고, 나머지는 읽기 전용으로 보관됩니다. 다시 결제하면 모두 활성화됩니다.
            </li>
          </ol>
        </div>
      </section>

      {/* ===================== FAQ ===================== */}
      <section className="sec light faq-sec" data-screen-label="FAQ">
        <div className="wrap">
          <div className="sec-head reveal">
            <div className="kicker dot">FAQ</div>
            <h2>자주 묻는 질문</h2>
          </div>
          <div className="reveal d1">
            <FaqAccordion items={FAQ_ITEMS} />
          </div>
          <p className="faq-more reveal">
            더 궁금한 점은 <a href={`mailto:${BUSINESS.contactEmail}`}>{BUSINESS.contactEmail}</a> 로 문의해
            주세요.
          </p>
        </div>
      </section>

      {/* ===================== 마무리 CTA ===================== */}
      <section className="sec final final-sub" data-screen-label="마무리">
        <div className="wrap" style={{ textAlign: "center" }}>
          <h2 className="reveal">먼저 무료로 설계해 보세요</h2>
          <p className="reveal d1">카드 등록 없이 시작하고, 팀이 커질 때 좌석을 추가하면 됩니다.</p>
          <div className="final-cta reveal d2">
            <Link href={INTRO_PATHS.login} className="btn btn-primary">
              무료로 시작하기 <span className="arr">→</span>
            </Link>
            <Link href={INTRO_PATHS.about} className="btn btn-ghost">
              스펙코드 소개 보기
            </Link>
          </div>
        </div>
      </section>

      <IntroFooter />
    </div>
  );
}
