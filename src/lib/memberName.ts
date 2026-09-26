/**
 * memberName — 회원 표시 이름 규칙
 *
 * 가입 시 이름을 필수로 받는다 (2026-09-24 결정). 서비스 안에서 멤버 목록·담당자·댓글 작성자 등이
 * 모두 이 이름으로 보이기 때문에, 이메일 앞자리 자동 채움보다 사용자가 직접 정한 이름이 낫다.
 * 소셜 가입은 Provider 이름을 기본값으로 보여주고 고칠 수 있게 한다.
 */

export const MEMBER_NAME_MAX_LENGTH = 50;

/**
 * 이름 입력 검증 — 통과하면 정리된(trim) 이름, 아니면 사용자에게 보여줄 메시지.
 * 이메일 가입·소셜 가입 API 가 같은 규칙을 쓴다.
 */
export function normalizeMemberName(input: unknown): { name: string } | { error: string } {
  if (typeof input !== "string" || input.trim().length === 0) {
    return { error: "이름을 입력해 주세요." };
  }
  const name = input.trim();
  if (name.length > MEMBER_NAME_MAX_LENGTH) {
    return { error: `이름은 ${MEMBER_NAME_MAX_LENGTH}자 이하로 입력해 주세요.` };
  }
  return { name };
}
