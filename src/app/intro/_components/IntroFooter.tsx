/**
 * IntroFooter — 인트로(공개) 사이트 공용 푸터
 *
 * 역할:
 *   - 브랜드 + 한 줄 소개
 *   - 법정 표기: 상호·대표·사업자등록번호·통신판매업신고번호·주소·문의 이메일
 *     (전자상거래법 §10 — 사이버몰 운영자 신원 표시 의무, 토스페이먼츠 가맹 심사 요건)
 *   - 이용약관 · 개인정보처리방침 · 요금제 링크
 *
 * 값은 전부 siteInfo.ts 에서 가져온다 — 이 파일에 문자열을 직접 쓰지 않는다.
 */

import Link from "next/link";
import { BILLING_OPEN, BUSINESS, INTRO_PATHS } from "./siteInfo";

export default function IntroFooter() {
  return (
    <footer className="foot">
      <div className="wrap foot-grid">
        <div className="foot-brand-col">
          <div className="brand f-brand">
            <span className="b-spec">SPE</span>
            <span className="b-code">CODE</span>
            <span className="b-dot" />
          </div>
          <p className="f-disc">
            스펙코드는 요구사항과 설계 결정, 제출 산출물을 연결해 구축 이후 운영·유지보수까지 기준을 이어가는 공공 SI
            개발팀용 AI 설계 플랫폼입니다.
          </p>
          <nav className="f-links" aria-label="법적 고지">
            <Link href={INTRO_PATHS.pricing}>요금제</Link>
            <Link href={INTRO_PATHS.terms}>이용약관</Link>
            {/* 개인정보처리방침은 개인정보보호법 §30 에 따라 다른 링크보다 눈에 띄게 표시 */}
            <Link href={INTRO_PATHS.privacy} className="is-strong">
              개인정보처리방침
            </Link>
          </nav>
        </div>

        <dl className="f-biz">
          <div>
            <dt>상호</dt>
            <dd>{BUSINESS.companyName}</dd>
          </div>
          <div>
            <dt>대표</dt>
            <dd>{BUSINESS.ceoName}</dd>
          </div>
          {/* 결제 오픈 전에는 심사용 임시값을 공개하지 않는다. 실제 값 확정 후 BILLING_OPEN과 함께 노출된다. */}
          {BILLING_OPEN && (
            <>
              <div>
                <dt>사업자등록번호</dt>
                <dd>{BUSINESS.bizRegNo}</dd>
              </div>
              <div>
                <dt>통신판매업신고</dt>
                <dd>{BUSINESS.mailOrderNo}</dd>
              </div>
              <div>
                <dt>주소</dt>
                <dd>{BUSINESS.address}</dd>
              </div>
              <div>
                <dt>전화</dt>
                <dd>{BUSINESS.phone}</dd>
              </div>
            </>
          )}
          <div>
            <dt>문의</dt>
            <dd>
              <a href={`mailto:${BUSINESS.contactEmail}`}>{BUSINESS.contactEmail}</a>
            </dd>
          </div>
          <div>
            <dt>호스팅</dt>
            <dd>{BUSINESS.hostingProvider}</dd>
          </div>
        </dl>
      </div>
      <div className="wrap f-copy">
        © {new Date().getFullYear()} {BUSINESS.companyName}. All rights reserved.
      </div>
    </footer>
  );
}
