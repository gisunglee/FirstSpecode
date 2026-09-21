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
  /** 진단용 — 어떤 응답 조합으로 종료를 판정했는지 (모달 하단에 작게 표시) */
  detail?: string;
};

type SessionExpiredListener = (event: SessionExpiredEvent) => void;

const listeners = new Set<SessionExpiredListener>();

// 사용자가 직접 로그아웃한 현재 탭에서는 로그아웃 API 완료와 로그인 화면 이동 사이에
// 남아 있던 요청이 401을 받아도 "세션 만료" 모달을 띄우지 않는다. 이 값은 탭의
// 자바스크립트 메모리에만 있으므로 다른 탭의 작성 중 화면 보호 동작에는 영향을 주지 않는다.
let intentionalLogoutGeneration = 0;
let activeIntentionalLogoutGeneration: number | null = null;

/**
 * 현재 탭에서 의도적인 로그아웃을 시작한다.
 * 반환 함수는 로그아웃 실패 또는 MainLayout 이탈 시 호출해 억제를 해제한다.
 */
export function beginIntentionalLogout(): () => void {
  intentionalLogoutGeneration += 1;
  const generation = intentionalLogoutGeneration;
  activeIntentionalLogoutGeneration = generation;

  return () => {
    // 중복 로그아웃 시 이전 요청의 정리가 더 최신 로그아웃 상태를 해제하지 않게 한다.
    if (activeIntentionalLogoutGeneration === generation) {
      activeIntentionalLogoutGeneration = null;
    }
  };
}

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
  // 의도적인 로그아웃 중 발생한 401은 예상된 결과다. 처리 완료(true)로 반환해야
  // 호출부가 로그인 이동 폴백이나 세션 만료 UI를 추가로 실행하지 않는다.
  if (activeIntentionalLogoutGeneration !== null) return true;
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
