/**
 * siteInfo — 인트로(공개) 사이트의 법정 표기·요금 상수 (한 곳에서 관리)
 *
 * 역할:
 *   - 푸터 사업자 정보, 약관·개인정보처리방침 시행일, 고객 문의 채널
 *   - 요금제 페이지가 표시하는 가격·상한 숫자
 *
 * 왜 한 파일인가:
 *   - 사업자 정보는 요금제·약관·개인정보처리방침·푸터 4곳에 반복 노출된다.
 *     값이 바뀌면(주소 이전, 담당자 변경) 여기 한 줄만 고치면 되도록.
 *   - 가격은 정책 문서(.claude/biz/B.결제정책.md §1-2)와 반드시 일치해야 한다.
 *     페이지 본문에 숫자를 직접 쓰지 말고 이 상수를 쓴다.
 *
 * ⚠ 임시값 (2026-09-19):
 *   TODO 주석이 붙은 값(사업자등록번호·통신판매업신고번호·주소·문의 이메일·전화)은
 *   실제 값이 확정되기 전의 임시값이다. 토스페이먼츠 가맹 심사·전자상거래법 표시 의무 모두
 *   이 값을 보므로 결제 오픈(2단계) 전에 반드시 교체한다. 목록: .claude/biz/B.결제정책.md §2
 */

// ─── 사업자 정보 (전자상거래법 §10 표시 의무 항목) ─────────────────────────────
import { CURRENT_CONSENT_VERSION, formatConsentVersionKo } from "@/lib/consent";

export const BUSINESS = {
  /** 서비스명 */
  serviceName: "SPECODE",
  /** 상호(법인명 또는 개인사업자 상호) */
  companyName: "(주)바른아이오",
  /** 대표자 성명 */
  ceoName: "이강선",
  /** 사업자등록번호 */
  bizRegNo: "000-00-00000", // TODO 임시값 — 실제 번호로 교체 (정책 문서 §2 후속)
  /** 통신판매업 신고번호 — 토스 가맹 심사 필수 */
  mailOrderNo: "신고 준비 중", // TODO 관할 구청 신고 후 번호로 교체 (정책 문서 §2 후속)
  /** 사업장 주소 */
  address: "서울특별시 (상세 주소 입력 예정)", // TODO 임시값 — 실제 주소로 교체 (정책 문서 §2 후속)
  /**
   * 대표 전화 — 전자상거래법 §10 필수 항목. 유선일 필요는 없다.
   * 회사가 유선 전화를 쓰지 않아 자리표시자로 배포하고, 070/안심번호 또는 대표 휴대폰으로 교체 예정.
   */
  phone: "000-0000-0000",
  /** 고객 문의·환불·세금계산서 문의 이메일 */
  contactEmail: "contact@bareun.io", // TODO 임시값 — 실제 수신 가능한 주소인지 확인 후 확정 (정책 문서 §2 후속)
  /** 호스팅 서비스 제공자 상호 — 전자상거래법 시행령 §10 표시 항목 */
  hostingProvider: "Vercel Inc.",
  /** 개인정보 보호책임자 — 개인정보보호법 §31 */
  privacyOfficer: {
    name: "이강선", // 대표자 겸임
    email: "contact@bareun.io", // TODO contactEmail 과 함께 확정
  },
} as const;

// ─── 약관·방침 시행일 ─────────────────────────────────────────────────────────
// 단일 출처는 src/lib/consent.ts CURRENT_CONSENT_VERSION (동의 기록의 버전값과 같은 날짜여야 한다).
// 여기서는 화면 표기용 한글 형식으로만 변환한다. 개정 시 consent.ts 만 바꾼다.
// 개정 시에는 이전 버전 링크를 남겨야 하므로(전자상거래법 시행령) 개정이 실제로 발생하면 그때 이력 표기 방식을 결정한다.
export const TERMS_EFFECTIVE_DATE   = formatConsentVersionKo(CURRENT_CONSENT_VERSION.TERMS);
export const PRIVACY_EFFECTIVE_DATE = formatConsentVersionKo(CURRENT_CONSENT_VERSION.PRIVACY);

// ─── 결제 오픈 여부 ───────────────────────────────────────────────────────────
// true 이면 요금제 페이지의 BASIC 버튼이 설정 > 구독·결제 화면으로 이어진다.
// PG 심사와 운영 점검이 끝나기 전에는 false 로 유지한다.
// false 이면 실제 결제 화면으로 보내지 않고 "결제 준비 중" 안내를 표시한다.
export const BILLING_OPEN = false;

// ─── 요금 (정책 문서 §1-2, §1-4 와 동일해야 함) ────────────────────────────────
export const PRICING = {
  /** BASIC 좌석당 월 요금 — 부가세 포함 표시 금액 */
  basicSeatMonthlyKrw: 9_900,
  /** FREE 프로젝트당 편집 멤버(OWNER/ADMIN/MEMBER) 상한 — 소유자 본인뿐. 뷰어는 무료·무제한 */
  freeEditorLimit: 1,
  /** FREE 소유 프로젝트 상한 */
  freeProjectLimit: 1,
  /** 첨부파일 용량 표기 (집계·차단은 후속 과제 — 표기만) */
  basicStorageLabel: "5GB",
  proStorageLabel: "20GB",
  /** 결제 실패 재시도 — 3일 간격 3회 */
  retryCount: 3,
  retryIntervalDays: 3,
  /** 청약철회 가능 기간(일) */
  refundWindowDays: 7,
  /** 정기결제 사전 안내 메일 — 결제 N일 전 */
  prenoticeDays: 7,
} as const;

/** 원화 표기 — 9900 → "9,900" */
export function formatKrw(amount: number): string {
  return amount.toLocaleString("ko-KR");
}

// ─── 인트로 내부 경로 ────────────────────────────────────────────────────────
export const INTRO_PATHS = {
  home: "/intro",
  about: "/intro/about",
  pricing: "/intro/pricing",
  terms: "/intro/terms",
  privacy: "/intro/privacy",
  login: "/auth/login",
  /** 로그인 후 구독·결제 설정 — 비로그인이면 앱이 로그인으로 보낸 뒤 되돌아온다 */
  billing: "/settings/billing",
} as const;
