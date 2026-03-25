/**
 * apiFetch — API 호출 공통 래퍼
 *
 * 역할:
 *   - 모든 API 호출을 이 함수를 통해 수행 (직접 fetch() 호출 금지)
 *   - HTTP 에러를 일관된 방식으로 처리
 *   - 서버에서 내려온 에러 메시지를 Error 객체로 변환
 *
 * 사용 예:
 *   const users = await apiFetch<User[]>("/api/users");
 *   const user  = await apiFetch<User>("/api/users/1");
 */

export async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, options);

  // HTTP 에러 처리 — 서버가 내려준 메시지 우선 사용
  if (!response.ok) {
    let message = `요청 실패 (${response.status})`;

    try {
      const errorBody = await response.json();
      // 서버 응답의 message 필드를 에러 메시지로 사용 (apiError() 포맷과 일치)
      if (errorBody?.message) {
        message = errorBody.message;
      }
    } catch {
      // JSON 파싱 실패 시 기본 메시지 사용 (response.text()는 스트림 소진으로 불가)
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
