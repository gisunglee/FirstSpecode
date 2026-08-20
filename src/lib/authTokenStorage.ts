/**
 * 브라우저 인증 토큰 저장소 접근을 한곳에서 관리한다.
 *
 * Access Token은 탭별 sessionStorage에 저장한다.
 * Refresh Token 관련 함수는 HttpOnly 쿠키 전환 전 기존 브라우저 값을 한 번
 * 승계하고 제거하기 위한 호환 계층이며, 신규 로그인에는 사용하지 않는다.
 */

export const ACCESS_TOKEN_KEY = "access_token";
export const SESSION_REFRESH_TOKEN_KEY = "refresh_token";
export const PERSISTENT_REFRESH_TOKEN_KEY = "lc_refresh_token";

export type RefreshTokenStorageKind = "local" | "session";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type AuthTokenStorage = {
  local: StorageLike;
  session: StorageLike;
};

export type StoredRefreshToken = {
  token: string;
  kind: RefreshTokenStorageKind;
};

function browserStorage(): AuthTokenStorage | null {
  if (typeof window === "undefined") return null;

  try {
    return {
      local: window.localStorage,
      session: window.sessionStorage,
    };
  } catch {
    return null;
  }
}

function resolveStorage(storage?: AuthTokenStorage): AuthTokenStorage | null {
  return storage ?? browserStorage();
}

export function getStoredAccessToken(storage?: AuthTokenStorage): string {
  const target = resolveStorage(storage);
  if (!target) return "";

  try {
    return target.session.getItem(ACCESS_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function readStoredRefreshToken(
  requiredKind?: RefreshTokenStorageKind,
  storage?: AuthTokenStorage,
): StoredRefreshToken | null {
  const target = resolveStorage(storage);
  if (!target) return null;

  try {
    if (requiredKind !== "session") {
      const persistentToken = target.local.getItem(PERSISTENT_REFRESH_TOKEN_KEY);
      if (persistentToken) return { token: persistentToken, kind: "local" };
    }

    if (requiredKind !== "local") {
      const sessionToken = target.session.getItem(SESSION_REFRESH_TOKEN_KEY);
      if (sessionToken) return { token: sessionToken, kind: "session" };
    }
  } catch {
    return null;
  }

  return null;
}

/** @deprecated HttpOnly 쿠키 전환 전 저장값의 테스트·호환 처리에만 사용한다. */
export function storeAuthTokens(
  accessToken: string,
  refreshToken: string,
  kind: RefreshTokenStorageKind,
  storage?: AuthTokenStorage,
): boolean {
  const target = resolveStorage(storage);
  if (!target || !accessToken || !refreshToken) return false;

  try {
    if (kind === "local") {
      target.local.setItem(PERSISTENT_REFRESH_TOKEN_KEY, refreshToken);
      target.session.removeItem(SESSION_REFRESH_TOKEN_KEY);
    } else {
      target.session.setItem(SESSION_REFRESH_TOKEN_KEY, refreshToken);
      target.local.removeItem(PERSISTENT_REFRESH_TOKEN_KEY);
    }
    target.session.setItem(ACCESS_TOKEN_KEY, accessToken);
    return true;
  } catch {
    return false;
  }
}

/** @deprecated HttpOnly 쿠키 전환 전 회전 로직의 테스트·호환 처리에만 사용한다. */
export function replaceAuthTokensIfCurrent(
  expectedRefreshToken: string,
  accessToken: string,
  refreshToken: string,
  storage?: AuthTokenStorage,
): StoredRefreshToken | null {
  const current = readStoredRefreshToken(undefined, storage);
  if (!current || current.token !== expectedRefreshToken) return null;

  return storeAuthTokens(accessToken, refreshToken, current.kind, storage)
    ? { token: refreshToken, kind: current.kind }
    : null;
}

export function storeAccessToken(
  accessToken: string,
  storage?: AuthTokenStorage,
): boolean {
  const target = resolveStorage(storage);
  if (!target || !accessToken) return false;

  try {
    target.session.setItem(ACCESS_TOKEN_KEY, accessToken);
    return true;
  } catch {
    return false;
  }
}

export function removeStoredRefreshToken(
  kind: RefreshTokenStorageKind,
  storage?: AuthTokenStorage,
): void {
  const target = resolveStorage(storage);
  if (!target) return;

  try {
    if (kind === "local") {
      target.local.removeItem(PERSISTENT_REFRESH_TOKEN_KEY);
    } else {
      target.session.removeItem(SESSION_REFRESH_TOKEN_KEY);
    }
  } catch {
    // 저장소 접근이 차단된 브라우저에서는 제거 실패를 호출부로 전파하지 않는다.
  }
}

/** 쿠키 승계가 끝난 뒤 과거 local/session RT를 모두 제거한다. */
export function clearStoredRefreshTokens(storage?: AuthTokenStorage): void {
  const target = resolveStorage(storage);
  if (!target) return;

  try {
    target.session.removeItem(SESSION_REFRESH_TOKEN_KEY);
    target.local.removeItem(PERSISTENT_REFRESH_TOKEN_KEY);
  } catch {
    // 저장소 접근이 차단된 브라우저에서는 가능한 범위에서만 정리한다.
  }
}

export function clearAuthTokens(storage?: AuthTokenStorage): void {
  const target = resolveStorage(storage);
  if (!target) return;

  try {
    target.session.removeItem(ACCESS_TOKEN_KEY);
    target.session.removeItem(SESSION_REFRESH_TOKEN_KEY);
    target.local.removeItem(PERSISTENT_REFRESH_TOKEN_KEY);
  } catch {
    // 로그아웃/만료 정리는 가능한 범위에서 수행한다.
  }
}
