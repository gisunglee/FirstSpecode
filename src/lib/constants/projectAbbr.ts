/**
 * projectAbbr.ts — 프로젝트 약어/이니셜 정책 (단일 진실)
 *
 * 역할:
 *   - 약어 형식·길이·메시지를 한 곳에서 관리
 *   - UI(생성·수정 폼)와 API(POST·PUT) 양쪽이 동일 상수·헬퍼 참조
 *   - 정책 변경 시 이 파일만 수정 — 4곳에 흩어진 정규식이 어긋날 위험 제거
 *
 * 정책:
 *   - 영문 대소문자 + 숫자 2~10자 (ASCII 한정)
 *   - ASCII 한정 이유: docx 파일명 prefix·Content-Disposition 인코딩 단순화,
 *     표지 폰트 깨짐 우려 회피
 */

export const PROJECT_ABBR_MAX_LEN = 10;
export const PROJECT_ABBR_REGEX   = /^[A-Za-z0-9]{2,10}$/;

export const PROJECT_ABBR_MESSAGES = {
  required: "프로젝트 약어를 입력해 주세요.",
  format:   "약어는 영문/숫자 2~10자로 입력해 주세요.",
} as const;

export const PROJECT_ABBR_PLACEHOLDER = "예) GBMS, ESG2026";

/**
 * 입력 파싱 — UI/API 공통 검증.
 *   - required=true : 빈 값 거부 (POST 신규 생성)
 *   - required=false: 빈 값은 null 로 변환 (PUT 수정 — 약어 제거 의도 허용)
 *   - undefined 입력은 항상 "변경 의도 없음" 으로 판정 → undefined 반환
 *
 * 반환:
 *   - { value }       : 정상 파싱 — value 가 string | null | undefined
 *   - { error }       : 검증 실패 — 사용자 표시 메시지
 */
export function parseProjectAbbrInput(
  raw:  unknown,
  opts: { required: boolean },
):
  | { value: string | null | undefined }
  | { error: string } {
  if (raw === undefined) return { value: undefined };
  if (typeof raw !== "string") return { error: PROJECT_ABBR_MESSAGES.format };

  const trimmed = raw.trim();
  if (trimmed === "") {
    return opts.required
      ? { error: PROJECT_ABBR_MESSAGES.required }
      : { value: null };
  }
  if (!PROJECT_ABBR_REGEX.test(trimmed)) {
    return { error: PROJECT_ABBR_MESSAGES.format };
  }
  return { value: trimmed };
}
