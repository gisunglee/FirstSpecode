/**
 * PricingContent — 요금제 페이지 본문 (클라이언트)
 *
 * 역할:
 *   - 3열 플랜 카드: FREE(왼쪽, 담담) · BASIC(가운데, 추천 강조) · PRO(오른쪽, 준비중 회색)
 *   - ENTERPRISE 한 줄 문의 안내
 *   - 좌석 계산 방식 설명 (예시 포함)
 *   - "알아두실 점" — 결제·해지·환불·강등 규칙을 결제 전에 전부 고지 (전자상거래법 사전 고지)
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
    q: "좌석이란 무엇인가요? 어떻게 세나요?",
    a: [
      "좌석은 결제자(프로젝트 소유자)가 소유한 모든 활성 프로젝트에서 편집 권한을 가진 사람(소유자·관리자·멤버)을 중복 없이 센 수입니다. 결제자 본인도 1좌석입니다.",
      "같은 사람이 내 프로젝트 3개에 참여해도 1좌석만 차감됩니다. 프로젝트 수가 아니라 사람 수로 셉니다.",
      `좌석은 미리 구매해 두고, 편집 멤버 수가 구매 좌석 수를 넘지 않게 유지하는 방식입니다. 매월 청구액은 "좌석 수 × ${formatKrw(PRICING.basicSeatMonthlyKrw)}원"이며 별도 기본료는 없습니다.`,
    ],
  },
  {
    q: "뷰어(읽기 전용 멤버)도 좌석을 차지하나요?",
    a: [
      "아니요. 뷰어는 좌석을 차감하지 않으며 인원 제한도 없습니다. 고객사 담당자·검수자처럼 설계를 읽기만 하는 분은 비용 없이 초대할 수 있습니다.",
      "단, FREE 플랜의 프로젝트당 5명 상한에는 뷰어와 소유자도 포함됩니다.",
    ],
  },
  {
    q: "좌석을 늘리거나 줄이면 요금은 어떻게 되나요?",
    a: [
      "좌석 추가는 즉시 적용되며, 이번 결제 주기의 남은 일수만큼 일할 계산한 금액을 한 번 결제합니다. (일할 금액 = 좌석 단가 × 추가 좌석 × 남은 일수 ÷ 주기 일수)",
      "좌석 축소는 다음 결제일부터 적용되고 이미 결제한 금액은 환불되지 않습니다. 현재 사용 중인 편집 멤버 수보다 적게는 줄일 수 없습니다.",
    ],
  },
  {
    q: "해지와 환불은 어떻게 되나요?",
    a: [
      "해지는 로그인 후 설정 화면에서 버튼 한 번으로 즉시 신청할 수 있습니다. 해지하면 결제한 기간이 끝날 때까지 그대로 이용하고, 다음 결제부터 청구되지 않습니다. 기간 중에는 해지를 취소할 수도 있습니다.",
      `환불은 결제 후 ${PRICING.refundWindowDays}일 이내이고 유료 기능을 사용하지 않은 경우 전액 환불됩니다. 유료 기능 사용이란 ① 두 번째 소유 프로젝트 생성 ② 6번째 이상 편집 멤버 초대 ③ 첨부파일 업로드 중 하나라도 발생한 경우입니다.`,
      "유료 기능을 사용한 뒤에는 환불되지 않습니다. FREE 플랜이 별도 체험 기간 역할을 하므로, 결제 전에 FREE 로 충분히 사용해 보시길 권합니다.",
    ],
  },
  {
    q: "결제를 중단하거나 FREE 로 내려가면 데이터는 어떻게 되나요?",
    a: [
      "데이터는 절대 삭제되지 않습니다. 해지 확정 또는 결제 실패로 FREE 가 되면 소유한 프로젝트가 읽기 전용으로 잠깁니다. 조회·MCP 읽기는 계속 되고, 편집·생성·초대·업로드만 막힙니다.",
      `FREE 상한(프로젝트 1개, 멤버 ${PRICING.freeMemberLimit}명)에 맞는 프로젝트는 프로젝트 목록의 "활성화" 버튼으로 직접 골라 다시 편집할 수 있습니다. 다시 결제하면 모든 프로젝트가 즉시 풀립니다.`,
    ],
  },
  {
    q: "결제에 실패하면 바로 이용이 중단되나요?",
    a: [
      `아니요. 카드 한도·만료 등으로 결제에 실패하면 ${PRICING.retryIntervalDays}일 간격으로 ${PRICING.retryCount}회 재시도하며, 그동안은 정상적으로 이용할 수 있습니다. 실패할 때마다 이메일로 안내하니 설정에서 결제 수단을 바꿔 주시면 됩니다.`,
      "재시도가 모두 실패하면 FREE 로 전환되고 안내 메일을 보냅니다. 이 경우에도 데이터는 삭제되지 않습니다.",
    ],
  },
  {
    q: "AI 사용 비용도 요금에 포함되나요?",
    a: [
      "포함되지 않습니다. SPECODE 의 AI 기능은 회원이 직접 등록한 본인의 AI API 키(예: Anthropic·OpenAI)로 동작하며, AI 호출 비용은 해당 AI 제공사에 직접 결제하게 됩니다.",
      "그래서 AI 설계·MCP 연동 등 모든 기능은 FREE 를 포함한 전 플랜에서 제한 없이 제공합니다. 플랜은 프로젝트 수·멤버 수·첨부 용량만 다릅니다.",
    ],
  },
  {
    q: "세금계산서를 받을 수 있나요?",
    a: [
      "현재는 세금계산서를 발행하지 않으며, 카드 결제 시 발급되는 카드 매출전표(부가세 포함)로 증빙을 대체합니다.",
      `사업자 명의 세금계산서가 꼭 필요하시면 ${BUSINESS.contactEmail} 로 문의해 주세요. 요청 상황을 보고 지원을 검토하고 있습니다.`,
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
            필요한 사람 수만큼만,
            <br />
            <span className="grad-text">월 단위로 내세요.</span>
          </h1>
          <p className="pg-sub reveal d2">
            FREE 는 카드 등록 없이 바로 시작합니다. 팀이 커지면 편집하는 사람 수만큼 좌석을 구매하세요.
            <b> 읽기만 하는 뷰어는 무료</b>, AI 기능은 모든 플랜에서 제한 없이 제공됩니다.
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
              <p className="plan-desc">혼자 또는 소규모 팀이 SPECODE 를 충분히 써 보는 플랜입니다.</p>
              <ul className="plan-feats">
                <li>소유 프로젝트 {PRICING.freeProjectLimit}개</li>
                <li>프로젝트당 멤버 {PRICING.freeMemberLimit}명 (소유자·뷰어 포함)</li>
                <li>AI 설계 · MCP 연동 · 산출물 발행 등 모든 기능</li>
                <li>다른 사람 프로젝트에 초대받아 참여 — 무제한·무료</li>
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
              <p className="plan-desc">프로젝트를 여러 개 만들고 팀과 함께 설계하는 플랜입니다.</p>
              <ul className="plan-feats">
                <li>소유 프로젝트 무제한</li>
                <li>편집 멤버 = 구매한 좌석 수 (여러 프로젝트에 걸쳐 중복 없이 계산)</li>
                <li>
                  <b>뷰어는 무료 · 인원 제한 없음</b>
                </li>
                <li>첨부파일 {PRICING.basicStorageLabel}</li>
                <li>AI 설계 · MCP 연동 · 산출물 발행 등 모든 기능</li>
                <li>좌석 추가는 즉시(일할 결제), 축소는 다음 결제일부터</li>
              </ul>
              {BILLING_OPEN ? (
                <Link href={INTRO_PATHS.billing} className="btn btn-primary plan-cta">
                  BASIC 시작하기 <span className="arr">→</span>
                </Link>
              ) : (
                <div className="plan-cta-soon">
                  <span className="btn btn-primary plan-cta is-disabled" aria-disabled>
                    결제 오픈 준비 중
                  </span>
                  <small>지금은 FREE 로 시작하세요. 결제가 열리면 설정 화면에서 바로 전환할 수 있습니다.</small>
                </div>
              )}
            </article>

            {/* PRO — 준비중 */}
            <article className="plan is-soon">
              <div className="plan-name">
                PRO <span className="soon-badge">준비 중</span>
              </div>
              <div className="plan-price">
                <b>—</b>
              </div>
              <div className="plan-period">가격은 출시 시 공개</div>
              <p className="plan-desc">BASIC 의 모든 것에, 더 큰 저장 공간과 데이터 표준화 기능을 더합니다.</p>
              <ul className="plan-feats">
                <li>BASIC 의 모든 기능</li>
                <li>첨부파일 {PRICING.proStorageLabel}</li>
                <li>AI 데이터 표준화 활용 — 설계한 테이블·컬럼을 표준 용어·도메인 사전과 대조하고 정리</li>
              </ul>
            </article>
          </div>

          <p className="enterprise-line reveal">
            <b>ENTERPRISE</b> — 대규모 조직, 별도 계약·정산이 필요하시면{" "}
            <a href={`mailto:${BUSINESS.contactEmail}`}>{BUSINESS.contactEmail}</a> 로 문의해 주세요.
          </p>
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
              김OO 은 두 프로젝트에 있지만 1좌석입니다. 최OO 은 뷰어라 좌석에 들어가지 않습니다.
            </p>
          </div>
        </div>
      </section>

      {/* ===================== 알아두실 점 ===================== */}
      <section className="sec notes-sec" data-screen-label="알아두실 점">
        <div className="wrap">
          <div className="sec-head reveal">
            <div className="kicker dot">BEFORE YOU PAY</div>
            <h2>결제 전에 알아두실 점</h2>
            <p>나중에 놀라는 일이 없도록, 결제·해지·환불 규칙을 미리 전부 적어 둡니다.</p>
          </div>

          <ol className="notes reveal d1">
            <li>
              <b>표시 가격은 부가세 포함</b>이며 월 결제만 제공합니다. 연간 결제는 없습니다.
            </li>
            <li>
              결제는 <b>토스페이먼츠 카드 자동결제</b>로 진행되며, 매 결제 {PRICING.prenoticeDays}일 전에 결제
              예정 금액을 이메일로 안내합니다. 결제 수단(카드)은 설정에서 언제든 변경할 수 있습니다.
            </li>
            <li>
              결제 실패 시 {PRICING.retryIntervalDays}일 간격으로 {PRICING.retryCount}회 재시도하며 그동안 정상
              이용됩니다. 모두 실패하면 FREE 로 전환되고 이메일로 안내합니다.
            </li>
            <li>
              <b>해지는 설정 화면에서 즉시</b> 가능하며, 결제한 기간이 끝날 때까지 이용한 뒤 다음 결제부터 청구되지
              않습니다. 기간 중 해지 취소도 가능합니다.
            </li>
            <li>
              환불은 결제 후 {PRICING.refundWindowDays}일 이내 + 유료 기능 미사용 시 전액 환불됩니다. 유료 기능
              사용(두 번째 프로젝트 생성, 6번째 이상 편집 멤버 초대, 첨부파일 업로드) 후에는 환불되지 않습니다.
              자세한 내용은{" "}
              <Link href={INTRO_PATHS.terms}>이용약관</Link>의 환불 조항을 참고하세요.
            </li>
            <li>
              FREE 로 전환되어도 <b>데이터는 삭제되지 않습니다.</b> 멤버 {PRICING.freeMemberLimit}명 이하 프로젝트만
              활성 상태로 고를 수 있고, 나머지는 읽기 전용으로 잠깁니다. 다시 결제하면 즉시 모두 풀립니다.
            </li>
            <li>
              AI 호출 비용은 회원이 등록한 <b>본인 API 키</b>로 AI 제공사에 직접 결제되며 SPECODE 요금에 포함되지
              않습니다.
            </li>
            <li>
              첨부파일 용량 한도는 초과 시 사전 안내 후 적용됩니다. 세금계산서는 현재 발행하지 않으며 카드 매출전표로
              대체됩니다.
            </li>
            <li>
              가격을 인상하거나 무료 기능을 유료로 바꿀 때는 <b>최소 30일 전</b> 이메일로 알리고 동의를 받습니다.
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
