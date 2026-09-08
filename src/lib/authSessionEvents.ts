/**
 * authSessionEvents — 세션 종료 알림 (lib → UI 단방향 이벤트)
 *
 * 역할:
 *   - authFetch / authRefreshClient(lib 계층)가 "로그인 세션이 끝났다"는 사실을
 *     UI(SessionExpiredModal)에 알리는 최소 pub/sub
 *   - lib 계층이 React·라우터에 의존하지 않도록 분리해 둔다
 *   - 구독자가 하나도 없으면 false 를 반환 → 호출부가 로그인 페이지 이동 폴백을 수행
 *
 * 왜 이벤트인가:
 *   세션 종료 시 페이지를 이동시키면 작성 중인 입력값이 통보 없이 사라진다.
 *   화면은 그대로 두고 그 위에 재로그인 모달만 띄우려면 lib 가 UI 를 직접
 *   알지 않고도 신호를 보낼 통로가 필요하다.
 */

export type SessionExpiredReason =
  | "expired"       // 이 탭의 RT 갱신이 최종 거부됨 (진짜 만료)
  | "unauthorized"  // 인증 정보 없이 요청 → 서버 UNAUTHORIZED
  | "cleared";      // 다른 탭의 로그아웃/세션 종료 알림(AUTH_CLEARED)을 받음

export type SessionExpiredEvent = {
  reason: SessionExpiredReason;
  /**
   * 종료 직전 이 탭이 쓰던 계정(mberId). 토큰을 지우기 전에 읽어 넘긴다.
   * 모달이 복구 후 "같은 계정인지" 비교해 다른 계정이면 화면을 새로 불러오게 한다
   * (공유 RT 쿠키라 다른 탭에서 다른 계정으로 로그인하면 이 탭도 그 계정이 된다).
   */
  previousMemberId: string | null;
};

type SessionExpiredListener = (event: SessionExpiredEvent) => void;

const listeners = new Set<SessionExpiredListener>();

/** 모달 등 UI 가 마운트 시 구독한다. 반환된 함수로 해제. */
export function subscribeSessionExpired(listener: SessionExpiredListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * 세션 종료를 UI 에 알린다.
 * @returns 구독자가 있어 처리됐으면 true, 없으면 false (호출부가 폴백 이동을 결정)
 */
export function notifySessionExpired(event: SessionExpiredEvent): boolean {
  if (listeners.size === 0) return false;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      // 한 구독자의 렌더 오류가 인증 흐름 전체를 막지 않도록 격리
      console.error("[authSessionEvents] 구독자 처리 중 오류:", err);
    }
  }
  return true;
}
