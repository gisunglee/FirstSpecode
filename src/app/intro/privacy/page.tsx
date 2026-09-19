/**
 * PrivacyPage — 개인정보처리방침 (/intro/privacy)
 *
 * 역할:
 *   - 개인정보 보호법 §30 이 요구하는 항목을 순서대로 공개한다:
 *     처리 목적 / 항목 / 보유기간 / 제3자 제공 / 처리 위탁 / 국외 이전 / 정보주체 권리 /
 *     파기 / 안전성 확보 조치 / 자동 수집 장치(쿠키) / 보호책임자 / 변경 고지
 *   - 결제 도입에 따라 결제 관련 항목(빌링키·결제 이력, 토스페이먼츠 위탁)을 포함한다.
 *
 * 사실 확인 근거(코드 기준, 2026-09-19):
 *   - 회원: 이메일·비밀번호 해시·이름·프로필 이미지·소셜 계정 식별자(tb_cm_member, tb_cm_social_account)
 *   - 접속 기록: 로그인 시도·세션·IP(tb_cm_login_attempt, tb_cm_member_session, tb_cm_rate_limit)
 *   - 외부 AI API 키: 프로젝트 단위 암호화 저장(tb_pj_project_api_key, src/lib/encrypt.ts)
 *   - 이메일 발송: SMTP(nodemailer). 호스팅·DB: Vercel / Supabase(PostgreSQL)
 *
 * 값 출처: 사업자·보호책임자·시행일은 siteInfo.ts
 */

import type { Metadata } from "next";
import IntroNav from "../_components/IntroNav";
import IntroFooter from "../_components/IntroFooter";
import { BUSINESS, PRIVACY_EFFECTIVE_DATE } from "../_components/siteInfo";

export const metadata: Metadata = {
  title: "개인정보처리방침 | SPECODE",
  description: "SPECODE 개인정보처리방침 — 수집 항목, 이용 목적, 보유 기간, 처리 위탁, 정보주체의 권리",
};

export default function PrivacyPage() {
  return (
    <div className="sp-intro is-white is-sub">
      <IntroNav solid />

      <header className="pg-head legal-head">
        <div className="wrap">
          <div className="kicker dot">PRIVACY POLICY</div>
          <h1>개인정보처리방침</h1>
          <p className="pg-sub">시행일: {PRIVACY_EFFECTIVE_DATE}</p>
        </div>
      </header>

      <main className="sec light legal-sec">
        <div className="wrap">
          <article className="legal">
            <p className="legal-intro">
              {BUSINESS.companyName}(이하 &quot;회사&quot;)은 개인정보 보호법 등 관련 법령을 준수하며, 회원의 개인정보를
              보호하고 이와 관련한 고충을 신속하게 처리하기 위하여 다음과 같이 개인정보처리방침을 수립·공개합니다.
            </p>

            <h3>제1조 (개인정보의 처리 목적)</h3>
            <p>회사는 다음 목적을 위해 개인정보를 처리하며, 목적이 변경되는 경우 별도 동의를 받습니다.</p>
            <ol>
              <li>회원 가입 및 관리 — 가입 의사 확인, 본인 식별·인증, 계정 유지·관리, 부정 이용 방지, 고지·통지</li>
              <li>서비스 제공 — 프로젝트·설계 산출물 저장 및 표시, 멤버 초대·권한 관리, AI 기능 처리 요청 전달, 산출물 생성</li>
              <li>유료 서비스 결제 — 정기결제 처리, 결제 예정·완료·실패 안내, 영수증 제공, 청약철회·환불 처리</li>
              <li>보안 및 서비스 안정성 — 로그인 시도 제한, 계정 잠금, 비정상 트래픽 차단, 접속 기록 보관</li>
              <li>고객 문의 응대 — 문의 접수·확인, 처리 결과 회신</li>
            </ol>

            <h3>제2조 (처리하는 개인정보의 항목)</h3>
            <table className="legal-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>항목</th>
                  <th>수집 방법</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>회원 가입(이메일)</td>
                  <td>이메일 주소, 비밀번호(암호화 저장), 이름</td>
                  <td>회원 입력</td>
                </tr>
                <tr>
                  <td>회원 가입(소셜)</td>
                  <td>소셜 계정 고유 식별자, 이메일 주소, 이름, 프로필 이미지 URL</td>
                  <td>Google · GitHub 계정 연동 시 제공받음</td>
                </tr>
                <tr>
                  <td>프로필</td>
                  <td>프로필 이미지, 직무 등 회원이 선택 입력한 정보</td>
                  <td>회원 입력(선택)</td>
                </tr>
                <tr>
                  <td>유료 결제</td>
                  <td>
                    결제 수단 식별 정보(빌링키, 카드사명, 카드번호 앞·뒤 일부), 결제 금액·일시·상태, 좌석 수, 영수증 URL
                  </td>
                  <td>결제 대행사(토스페이먼츠)로부터 제공받음</td>
                </tr>
                <tr>
                  <td>외부 AI API 키</td>
                  <td>회원이 프로젝트에 등록한 AI 제공사 API 키(암호화 저장)</td>
                  <td>회원 입력(선택)</td>
                </tr>
                <tr>
                  <td>자동 수집</td>
                  <td>IP 주소, 접속 일시, 브라우저·기기 정보, 로그인 시도 기록, 서비스 이용 기록, 쿠키</td>
                  <td>서비스 이용 과정에서 자동 생성</td>
                </tr>
              </tbody>
            </table>
            <p>
              회사는 카드 번호 전체, 유효기간, CVC 등 카드 원본 정보를 저장하지 않습니다. 이 정보는 결제 대행사의 결제창에서
              직접 입력되어 결제 대행사가 처리합니다.
            </p>

            <h3>제3조 (개인정보의 처리 및 보유 기간)</h3>
            <ol>
              <li>회사는 회원 탈퇴 시 개인정보를 지체 없이 파기합니다. 단, 다음 정보는 명시한 기간 동안 보관합니다.</li>
            </ol>
            <table className="legal-table">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>보유 기간</th>
                  <th>근거</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>계약 또는 청약철회 등에 관한 기록</td>
                  <td>5년</td>
                  <td>전자상거래 등에서의 소비자보호에 관한 법률</td>
                </tr>
                <tr>
                  <td>대금 결제 및 재화 등의 공급에 관한 기록</td>
                  <td>5년</td>
                  <td>전자상거래 등에서의 소비자보호에 관한 법률</td>
                </tr>
                <tr>
                  <td>소비자의 불만 또는 분쟁 처리에 관한 기록</td>
                  <td>3년</td>
                  <td>전자상거래 등에서의 소비자보호에 관한 법률</td>
                </tr>
                <tr>
                  <td>서비스 접속 기록(IP 등)</td>
                  <td>3개월</td>
                  <td>통신비밀보호법</td>
                </tr>
                <tr>
                  <td>탈퇴 회원이 소유했던 프로젝트 데이터</td>
                  <td>탈퇴 후 14일(삭제 대기) 후 영구 삭제</td>
                  <td>오조작 복구 기회 제공 — 회원 안내 사항</td>
                </tr>
              </tbody>
            </table>
            <p>
              회원이 다른 회원의 프로젝트에 편집 멤버로 참여하여 작성한 설계 내용은 해당 프로젝트 소유자의 데이터로서 탈퇴
              후에도 프로젝트에 남습니다.
            </p>

            <h3>제4조 (개인정보의 제3자 제공)</h3>
            <p>
              회사는 회원의 개인정보를 제1조의 목적 범위 안에서만 처리하며, 회원의 사전 동의 또는 법률의 특별한 규정이 있는
              경우를 제외하고 제3자에게 제공하지 않습니다.
            </p>

            <h3>제5조 (개인정보 처리의 위탁)</h3>
            <p>회사는 원활한 서비스 제공을 위해 다음과 같이 개인정보 처리 업무를 위탁하고 있습니다.</p>
            <table className="legal-table">
              <thead>
                <tr>
                  <th>수탁자</th>
                  <th>위탁 업무</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>(주)토스페이먼츠</td>
                  <td>카드 정기결제 처리, 빌링키 발급·관리, 결제 승인·취소</td>
                </tr>
                <tr>
                  <td>Vercel Inc.</td>
                  <td>애플리케이션 호스팅 및 운영</td>
                </tr>
                <tr>
                  <td>Supabase Inc.</td>
                  <td>데이터베이스 및 파일 저장소 운영</td>
                </tr>
                <tr>
                  <td>이메일 발송 서비스(SMTP 사업자)</td>
                  <td>인증·비밀번호 재설정·결제 안내 등 이메일 발송</td>
                </tr>
              </tbody>
            </table>
            <p>
              회원이 AI 기능을 사용하면, 회원이 등록한 API 키로 회원이 선택한 AI 제공사(예: Anthropic, OpenAI)에 설계
              내용이 전송됩니다. 이는 회원의 요청에 따른 처리로, 해당 제공사의 개인정보 처리 기준이 함께 적용됩니다.
            </p>

            <h3>제6조 (개인정보의 국외 이전)</h3>
            <p>
              제5조의 Vercel Inc., Supabase Inc. 및 회원이 선택한 AI 제공사는 국외에 서버를 둘 수 있습니다. 이전되는
              항목은 제2조의 항목 중 서비스 제공에 필요한 범위이며, 이전 시점은 서비스 이용 시 네트워크를 통해 이전됩니다.
              보유 기간은 제3조와 같습니다. 회원은 국외 이전을 거부할 수 있으나 이 경우 서비스 이용이 제한됩니다.
            </p>

            <h3>제7조 (정보주체의 권리·의무 및 행사 방법)</h3>
            <ol>
              <li>회원은 언제든지 개인정보 열람·정정·삭제·처리정지를 요구할 수 있습니다.</li>
              <li>
                이메일·이름·프로필 이미지는 설정 화면에서 직접 수정할 수 있고, 회원 탈퇴는 설정 화면에서 직접 할 수
                있습니다. 그 외 요구는 {BUSINESS.contactEmail} 로 하면 회사는 지체 없이 조치합니다.
              </li>
              <li>권리 행사는 법정대리인이나 위임을 받은 자를 통해서도 할 수 있으며, 이 경우 위임장을 제출해야 합니다.</li>
              <li>법령에서 수집 대상으로 명시한 정보의 삭제는 요구할 수 없습니다.</li>
            </ol>

            <h3>제8조 (개인정보의 파기)</h3>
            <ol>
              <li>회사는 보유 기간이 경과하거나 처리 목적이 달성된 개인정보를 지체 없이 파기합니다.</li>
              <li>
                전자적 파일은 복구할 수 없는 방법으로 영구 삭제하고, 출력물은 분쇄 또는 소각합니다. 법령에 따라 보관하는
                정보는 별도 분리하여 보관하며 해당 목적 외로 이용하지 않습니다.
              </li>
            </ol>

            <h3>제9조 (개인정보의 안전성 확보 조치)</h3>
            <ol>
              <li>비밀번호는 복호화할 수 없는 단방향 해시로 저장하며, 외부 AI API 키는 암호화하여 저장합니다.</li>
              <li>모든 통신은 TLS 로 암호화되며, 인증 토큰은 보안 쿠키로 관리합니다.</li>
              <li>로그인 시도 횟수 제한, 계정 잠금, 요청 빈도 제한으로 무차별 대입 및 비정상 접근을 차단합니다.</li>
              <li>개인정보 접근 권한을 최소 인원으로 제한하고, 관리자 조작은 감사 기록으로 남깁니다.</li>
            </ol>

            <h3>제10조 (쿠키 등 자동 수집 장치)</h3>
            <p>
              회사는 로그인 상태 유지와 보안을 위해 인증 쿠키를 사용하며, 광고·행태정보 수집 목적의 쿠키는 사용하지
              않습니다. 회원은 브라우저 설정에서 쿠키를 거부할 수 있으나 이 경우 로그인이 필요한 서비스 이용이 제한됩니다.
            </p>

            <h3>제11조 (개인정보 보호책임자)</h3>
            <p>
              회사는 개인정보 처리에 관한 업무를 총괄하고 관련 고충을 처리하기 위하여 아래와 같이 개인정보 보호책임자를
              지정하고 있습니다.
            </p>
            <div className="legal-biz">
              <p>
                <b>개인정보 보호책임자</b> {BUSINESS.privacyOfficer.name}
                <br />
                이메일: <a href={`mailto:${BUSINESS.privacyOfficer.email}`}>{BUSINESS.privacyOfficer.email}</a>
              </p>
            </div>
            <p>
              기타 개인정보 침해에 대한 신고나 상담은 개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118),
              개인정보분쟁조정위원회(kopico.go.kr, 1833-6972), 대검찰청 사이버수사과(spo.go.kr, 1301), 경찰청
              사이버수사국(ecrm.police.go.kr, 182)에 문의할 수 있습니다.
            </p>

            <h3>제12조 (개인정보처리방침의 변경)</h3>
            <p>
              이 방침은 {PRIVACY_EFFECTIVE_DATE}부터 적용됩니다. 내용의 추가·삭제·수정이 있는 경우 시행 7일 전부터
              서비스 화면을 통해 공지하며, 회원의 권리에 중요한 변경이 있는 경우 30일 전에 공지하고 이메일로 통지합니다.
            </p>

            <div className="legal-biz">
              <p>
                <b>{BUSINESS.companyName}</b>
                <br />
                대표 {BUSINESS.ceoName} · 사업자등록번호 {BUSINESS.bizRegNo}
                <br />
                {BUSINESS.address}
                <br />
                전화 {BUSINESS.phone} · 문의: <a href={`mailto:${BUSINESS.contactEmail}`}>{BUSINESS.contactEmail}</a>
              </p>
            </div>
          </article>
        </div>
      </main>

      <IntroFooter />
    </div>
  );
}
