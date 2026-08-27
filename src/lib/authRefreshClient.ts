/**
 * HttpOnly Refresh Token 회전의 브라우저 다중 탭 조정자.
 *
 * RT 원문은 JavaScript에서 새로 저장하거나 탭 사이에 전달하지 않는다.
 * 배포 전 Web Storage에 남은 RT만 한 번 body로 제출해 쿠키로 승계한 뒤 제거한다.
 */

import {
  clearAuthTokens,
  clearStoredRefreshTokens,
  getStoredAccessToken,
  readStoredRefreshToken,
  storeAccessToken,
  type RefreshTokenStorageKind,
} from "@/lib/authTokenStorage";
import {
  AUTH_COOKIE_MODE_HEADER,
  AUTH_COOKIE_MODE_VALUE,
} from "@/lib/authCookiePolicy";
import { shouldRefreshAccessToken } from "@/lib/authSessionPolicy";

const REFRESH_LOCK_NAME = "specode-auth-refresh-v2";
const REFRESH_CHANNEL_NAME = "specode-auth-refresh-v2";
const AUTH_EVENT_KEY = "lc_auth_coordination_event_v2";
const PEER_RESULT_WAIT_MS = 1_500;
const LOCK_HANDOFF_WAIT_MS = 250;
const MESSAGE_MAX_AGE_MS = 15_000;

type RefreshSuccessMessage = {
  type: "REFRESH_SUCCESS";
  sourceId: string;
  createdAt: number;
  accessToken: string;
};

type AuthClearedMessage = {
  type: "AUTH_CLEARED";
  sourceId: string;
  createdAt: number;
};

type RefreshApiBody = {
  data?: { accessToken?: unknown };
  code?: unknown;
};

type LockAttempt =
  | { acquired: false }
  | { acquired: true; accessToken: string | null };

type PeerResult = {
  accessToken: string;
  createdAt: number;
  expiresAt: number;
};

const tabId = globalThis.crypto?.randomUUID?.()
  ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

let refreshPromise: Promise<string | null> | null = null;
let refreshChannel: BroadcastChannel | null = null;
let listenersInitialized = false;
let latestPeerResult: PeerResult | null = null;
const peerWaiters = new Set<(result: PeerResult) => void>();

function isRefreshSuccessMessage(value: unknown): value is RefreshSuccessMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<RefreshSuccessMessage>;
  return message.type === "REFRESH_SUCCESS"
    && typeof message.sourceId === "string"
    && typeof message.createdAt === "number"
    && typeof message.accessToken === "string"
    && message.accessToken.length > 0
    && message.accessToken.length <= 8_192;
}

function isAuthClearedMessage(value: unknown): value is AuthClearedMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<AuthClearedMessage>;
  return message.type === "AUTH_CLEARED"
    && typeof message.sourceId === "string"
    && typeof message.createdAt === "number";
}

function rememberPeerResult(message: RefreshSuccessMessage): void {
  const result: PeerResult = {
    accessToken: message.accessToken,
    createdAt: message.createdAt,
    expiresAt: Date.now() + MESSAGE_MAX_AGE_MS,
  };
  latestPeerResult = result;
  for (const resolve of peerWaiters) resolve(result);
  peerWaiters.clear();
}

function receiveRefreshMessage(value: unknown): void {
  if (isAuthClearedMessage(value)) {
    if (value.sourceId === tabId) return;
    const ageMs = Date.now() - value.createdAt;
    if (ageMs < -1_000 || ageMs > MESSAGE_MAX_AGE_MS) return;

    clearAuthTokens();
    if (!window.location.pathname.startsWith("/auth/")) {
      window.location.href = "/auth/login";
    }
    return;
  }

  if (!isRefreshSuccessMessage(value) || value.sourceId === tabId) return;
  const ageMs = Date.now() - value.createdAt;
  if (ageMs < -1_000 || ageMs > MESSAGE_MAX_AGE_MS) return;
  if (!storeAccessToken(value.accessToken)) return;

  clearStoredRefreshTokens();
  rememberPeerResult(value);
}

function ensureCoordinationListeners(): void {
  if (listenersInitialized || typeof window === "undefined") return;
  listenersInitialized = true;

  if (typeof BroadcastChannel !== "undefined") {
    try {
      refreshChannel = new BroadcastChannel(REFRESH_CHANNEL_NAME);
      refreshChannel.addEventListener("message", (event) => {
        receiveRefreshMessage(event.data);
      });
    } catch {
      refreshChannel = null;
    }
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== AUTH_EVENT_KEY || !event.newValue) return;
    try {
      receiveRefreshMessage(JSON.parse(event.newValue));
    } catch {
      // 다른 코드가 같은 키에 잘못된 값을 쓴 경우 무시한다.
    }
  });
}

function publishMessage(message: RefreshSuccessMessage | AuthClearedMessage): void {
  try {
    refreshChannel?.postMessage(message);
  } catch {
    // storage event fallback을 계속 시도한다.
  }

  try {
    localStorage.setItem(AUTH_EVENT_KEY, JSON.stringify(message));
    localStorage.removeItem(AUTH_EVENT_KEY);
  } catch {
    // localStorage가 차단되어도 현재 탭 처리는 이미 끝났다.
  }
}

function publishRefreshResult(accessToken: string): void {
  publishMessage({
    type: "REFRESH_SUCCESS",
    sourceId: tabId,
    createdAt: Date.now(),
    accessToken,
  });
}

function waitForPeerResult(
  startedAt: number,
  timeoutMs = PEER_RESULT_WAIT_MS,
): Promise<string | null> {
  if (
    latestPeerResult
    && latestPeerResult.expiresAt > Date.now()
    && latestPeerResult.createdAt >= startedAt
  ) {
    return Promise.resolve(latestPeerResult.accessToken);
  }

  return new Promise((resolve) => {
    const finish = (accessToken: string | null) => {
      clearTimeout(timer);
      peerWaiters.delete(onResult);
      resolve(accessToken);
    };
    const onResult = (result: PeerResult) => {
      if (result.createdAt >= startedAt) finish(result.accessToken);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    peerWaiters.add(onResult);
  });
}

async function requestTokenRotation(
  requiredKind: RefreshTokenStorageKind | undefined,
  startedAt: number,
  allowConflictRetry = true,
): Promise<string | null> {
  // 과거 저장값은 쿠키가 없는 기존 사용자 승계에만 사용한다.
  const legacyToken = readStoredRefreshToken(requiredKind)?.token;
  const response = await fetch("/api/auth/token/refresh", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      [AUTH_COOKIE_MODE_HEADER]: AUTH_COOKIE_MODE_VALUE,
    },
    body: JSON.stringify(legacyToken ? { refreshToken: legacyToken } : {}),
  });
  const body = await response.json().catch(() => ({})) as RefreshApiBody;

  if (!response.ok) {
    if (response.status === 409 && body.code === "REFRESH_CONFLICT") {
      const peerAccessToken = await waitForPeerResult(startedAt);
      if (peerAccessToken) return peerAccessToken;

      // Web Locks 미지원 브라우저에서 승자 응답의 Set-Cookie만 적용되고
      // 탭 메시지를 놓친 경우, 공유된 후속 쿠키로 한 번만 재시도한다.
      if (allowConflictRetry) {
        return requestTokenRotation(requiredKind, Date.now(), false);
      }
    }
    if (response.status === 401) clearStoredRefreshTokens();
    return null;
  }

  const accessToken = body.data?.accessToken;
  if (typeof accessToken !== "string" || !storeAccessToken(accessToken)) return null;

  clearStoredRefreshTokens();
  publishRefreshResult(accessToken);
  return accessToken;
}

async function coordinateAcrossTabs(
  requiredKind: RefreshTokenStorageKind | undefined,
): Promise<string | null> {
  const startedAt = Date.now();
  if (typeof navigator === "undefined" || !navigator.locks) {
    return requestTokenRotation(requiredKind, startedAt);
  }

  try {
    const immediate: LockAttempt = await navigator.locks.request(
      REFRESH_LOCK_NAME,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return { acquired: false };
        return {
          acquired: true,
          accessToken: await requestTokenRotation(requiredKind, startedAt),
        };
      },
    );

    if (immediate.acquired) return immediate.accessToken;

    return navigator.locks.request(REFRESH_LOCK_NAME, async () => {
      const peerAccessToken = await waitForPeerResult(startedAt, LOCK_HANDOFF_WAIT_MS);
      if (peerAccessToken) return peerAccessToken;

      // 승자 메시지를 놓쳤어도 HttpOnly 쿠키는 브라우저 전체에 공유되어 있다.
      return requestTokenRotation(requiredKind, Date.now());
    });
  } catch {
    // Web Locks 실패 시에도 서버 CAS가 같은 RT의 이중 소비를 차단한다.
    return requestTokenRotation(requiredKind, startedAt);
  }
}

export async function refreshAccessToken(
  requiredKind?: RefreshTokenStorageKind,
): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      if (typeof window === "undefined") return null;
      ensureCoordinationListeners();
      return coordinateAcrossTabs(requiredKind);
    } catch (err) {
      console.warn("[authRefresh] 로그인 세션 갱신에 실패했습니다.", err);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * 현재 AT가 충분히 남아 있으면 그대로 사용하고, 없거나 만료가 임박했을 때만 회전한다.
 * 모든 화면의 초기 인증 확인과 API 요청이 같은 기준을 사용하도록 제공하는 진입점이다.
 */
export async function ensureFreshAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const currentToken = getStoredAccessToken();
  if (!shouldRefreshAccessToken(currentToken)) return currentToken;
  return refreshAccessToken();
}

/** 배포 전 Web Storage RT가 남은 브라우저만 백그라운드에서 쿠키로 승계한다. */
export async function migrateLegacyRefreshToken(): Promise<void> {
  if (typeof window === "undefined" || !readStoredRefreshToken()) return;
  await refreshAccessToken();
}

/** 현재 탭 토큰을 지우고 같은 출처의 다른 탭에도 로그아웃을 알린다. */
export function clearAuthTokensAcrossTabs(): void {
  clearAuthTokens();
  ensureCoordinationListeners();

  publishMessage({
    type: "AUTH_CLEARED",
    sourceId: tabId,
    createdAt: Date.now(),
  });
}

// 일반 화면이 로드된 탭은 다른 탭의 갱신/로그아웃 결과를 즉시 받는다.
ensureCoordinationListeners();
