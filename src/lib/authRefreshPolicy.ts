export type AccessTokenRefreshResult =
  | { status: "success"; accessToken: string }
  /** detail: 진단용 — Refresh API 가 돌려준 HTTP 상태와 code (예: "401 INVALID_TOKEN") */
  | { status: "terminal"; detail?: string }
  | { status: "transient"; detail?: string };

/**
 * 동시에 시작된 비동기 작업은 하나로 합치되, 작업이 끝나면 반드시 다음 실행을 허용한다.
 *
 * Promise를 async IIFE 안의 finally에서 직접 비우면 바깥 대입보다 finally가 먼저
 * 실행되어 완료된 Promise가 영구 캐시될 수 있다. 현재 작업의 참조를 먼저 저장하고,
 * 그 작업이 settle된 뒤 같은 참조일 때만 해제해 해당 순서 문제를 피한다.
 */
export function createAsyncSingleFlight<T>() {
  let pending: Promise<T> | null = null;

  return (task: () => Promise<T>): Promise<T> => {
    if (pending) return pending;

    const current = Promise.resolve().then(task);
    pending = current;

    const clearCurrent = () => {
      if (pending === current) pending = null;
    };
    void current.then(clearCurrent, clearCurrent);

    return current;
  };
}

/** Refresh API의 401만 실제 로그인 세션 종료로 취급한다. */
export function classifyRefreshFailure(status: number): "terminal" | "transient" {
  return status === 401 ? "terminal" : "transient";
}
