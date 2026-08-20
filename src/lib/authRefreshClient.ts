/**
 * Refresh Token 회전의 브라우저 다중 탭 조정자.
 *
 * Web Locks가 있으면 같은 출처의 탭 중 하나만 서버에 갱신을 요청한다.
 * 회전 결과는 BroadcastChannel과 일시적인 storage event로 전달한다.
 */

import {
  clearAuthTokens,
  getStoredAccessToken,
  readStoredRefreshToken,
  replaceAuthTokensIfCurrent,
  storeAccessToken,
  storeAuthTokens,
  type RefreshTokenStorageKind,
  type StoredRefreshToken,
} from "@/lib/authTokenStorage";

const REFRESH_LOCK_NAME = "specode-auth-refresh-v1";
const REFRESH_CHANNEL_NAME = "specode-auth-refresh-v1";
const AUTH_EVENT_KEY = "lc_auth_coordination_event";
const PEER_RESULT_WAIT_MS = 1_500;
const MESSAGE_MAX_AGE_MS = 15_000;

type RefreshSuccessMessage = {
  type: "REFRESH_SUCCESS";
  sourceId: string;
  createdAt: number;
  previousFingerprint: string;
  nextFingerprint: string;
  storageKind: RefreshTokenStorageKind;
  accessToken: string;
  /** sessionStorage는 탭별이므로 이 경우에만 새 RT를 전달한다. */
  refreshToken?: string;
};

type AuthClearedMessage = {
  type: "AUTH_CLEARED";
  sourceId: string;
  createdAt: number;
};

type RefreshApiBody = {
  data?: { accessToken?: unknown; refreshToken?: unknown };
  code?: unknown;
};

type LockAttempt =
  | { acquired: false }
  | { acquired: true; accessToken: string | null };

const tabId = globalThis.crypto?.randomUUID?.()
  ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

let refreshPromise: Promise<string | null> | null = null;
let refreshChannel: BroadcastChannel | null = null;
let listenersInitialized = false;

const recentPeerResults = new Map<string, { accessToken: string; expiresAt: number }>();
const peerWaiters = new Map<string, Set<(accessToken: string) => void>>();

function fallbackFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function tokenFingerprint(token: string): Promise<string> {
  try {
    if (!globalThis.crypto?.subtle) return fallbackFingerprint(token);
    const bytes = new TextEncoder().encode(token);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  } catch {
    return fallbackFingerprint(token);
  }
}

function isRefreshSuccessMessage(value: unknown): value is RefreshSuccessMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<RefreshSuccessMessage>;
  return message.type === "REFRESH_SUCCESS"
    && typeof message.sourceId === "string"
    && typeof message.createdAt === "number"
    && typeof message.previousFingerprint === "string"
    && typeof message.nextFingerprint === "string"
    && (message.storageKind === "local" || message.storageKind === "session")
    && typeof message.accessToken === "string"
    && message.accessToken.length > 0
    && message.accessToken.length <= 8_192
    && (message.refreshToken === undefined || typeof message.refreshToken === "string");
}

function isAuthClearedMessage(value: unknown): value is AuthClearedMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<AuthClearedMessage>;
  return message.type === "AUTH_CLEARED"
    && typeof message.sourceId === "string"
    && typeof message.createdAt === "number";
}

function rememberPeerResult(fingerprint: string, accessToken: string): void {
  const now = Date.now();
  for (const [key, result] of recentPeerResults) {
    if (result.expiresAt <= now) recentPeerResults.delete(key);
  }

  recentPeerResults.set(fingerprint, {
    accessToken,
    expiresAt: now + MESSAGE_MAX_AGE_MS,
  });

  const waiters = peerWaiters.get(fingerprint);
  if (!waiters) return;
  peerWaiters.delete(fingerprint);
  for (const resolve of waiters) resolve(accessToken);
}

async function applyPeerRefresh(message: RefreshSuccessMessage): Promise<void> {
  if (message.sourceId === tabId) return;
  const ageMs = Date.now() - message.createdAt;
  if (ageMs < -1_000 || ageMs > MESSAGE_MAX_AGE_MS) return;

  const current = readStoredRefreshToken();
  if (!current || current.kind !== message.storageKind) return;

  const currentFingerprint = await tokenFingerprint(current.token);
  if (
    currentFingerprint !== message.previousFingerprint
    && currentFingerprint !== message.nextFingerprint
  ) {
    return;
  }

  if (message.storageKind === "session" && currentFingerprint === message.previousFingerprint) {
    if (!message.refreshToken) return;
    const receivedFingerprint = await tokenFingerprint(message.refreshToken);
    if (receivedFingerprint !== message.nextFingerprint) return;
    if (!storeAuthTokens(message.accessToken, message.refreshToken, "session")) return;
  } else if (!storeAccessToken(message.accessToken)) {
    return;
  }

  rememberPeerResult(message.previousFingerprint, message.accessToken);
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

  if (isRefreshSuccessMessage(value)) void applyPeerRefresh(value);
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

async function publishRefreshResult(
  previousFingerprint: string,
  nextToken: StoredRefreshToken,
  accessToken: string,
): Promise<void> {
  const message: RefreshSuccessMessage = {
    type: "REFRESH_SUCCESS",
    sourceId: tabId,
    createdAt: Date.now(),
    previousFingerprint,
    nextFingerprint: await tokenFingerprint(nextToken.token),
    storageKind: nextToken.kind,
    accessToken,
    ...(nextToken.kind === "session" ? { refreshToken: nextToken.token } : {}),
  };

  try {
    refreshChannel?.postMessage(message);
  } catch {
    // storage event fallback을 계속 시도한다.
  }

  try {
    localStorage.setItem(AUTH_EVENT_KEY, JSON.stringify(message));
    localStorage.removeItem(AUTH_EVENT_KEY);
  } catch {
    // localStorage가 차단되어도 BroadcastChannel 또는 현재 탭 갱신은 유지한다.
  }
}

function waitForPeerResult(fingerprint: string): Promise<string | null> {
  const recent = recentPeerResults.get(fingerprint);
  if (recent && recent.expiresAt > Date.now()) {
    return Promise.resolve(recent.accessToken);
  }

  return new Promise((resolve) => {
    const finish = (accessToken: string | null) => {
      clearTimeout(timer);
      const waiters = peerWaiters.get(fingerprint);
      waiters?.delete(onResult);
      if (waiters?.size === 0) peerWaiters.delete(fingerprint);
      resolve(accessToken);
    };
    const onResult = (accessToken: string) => finish(accessToken);
    const timer = setTimeout(() => finish(null), PEER_RESULT_WAIT_MS);
    const waiters = peerWaiters.get(fingerprint) ?? new Set();
    waiters.add(onResult);
    peerWaiters.set(fingerprint, waiters);
  });
}

async function requestTokenRotation(
  stored: StoredRefreshToken,
  previousFingerprint: string,
  allowSuccessorRetry = true,
): Promise<string | null> {
  const response = await fetch("/api/auth/token/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: stored.token }),
  });
  const body = await response.json().catch(() => ({})) as RefreshApiBody;

  if (!response.ok) {
    if (response.status === 409 && body.code === "REFRESH_CONFLICT") {
      const peerAccessToken = await waitForPeerResult(previousFingerprint);
      if (peerAccessToken) return peerAccessToken;

      const current = readStoredRefreshToken(stored.kind);
      if (current) {
        const currentFingerprint = await tokenFingerprint(current.token);
        if (allowSuccessorRetry && currentFingerprint !== previousFingerprint) {
          // 결과 메시지를 놓쳤지만 공용 RT가 바뀌었다면 최신 RT로 한 번만 재시도한다.
          return requestTokenRotation(current, currentFingerprint, false);
        }
      }
    }
    return null;
  }

  const accessToken = body.data?.accessToken;
  const refreshToken = body.data?.refreshToken;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") return null;

  const nextToken = replaceAuthTokensIfCurrent(
    stored.token,
    accessToken,
    refreshToken,
  );
  if (!nextToken) return null;

  await publishRefreshResult(previousFingerprint, nextToken, accessToken);
  return accessToken;
}

async function coordinateAcrossTabs(
  initial: StoredRefreshToken,
  initialFingerprint: string,
): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return requestTokenRotation(initial, initialFingerprint);
  }

  const initialAccessToken = getStoredAccessToken();

  try {
    const immediate: LockAttempt = await navigator.locks.request(
      REFRESH_LOCK_NAME,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return { acquired: false };
        return {
          acquired: true,
          accessToken: await requestTokenRotation(initial, initialFingerprint),
        };
      },
    );

    if (immediate.acquired) return immediate.accessToken;

    return navigator.locks.request(REFRESH_LOCK_NAME, async () => {
      const peerAccessToken = await waitForPeerResult(initialFingerprint);
      if (peerAccessToken) return peerAccessToken;

      const current = readStoredRefreshToken(initial.kind);
      if (!current) return null;

      const currentFingerprint = await tokenFingerprint(current.token);
      const currentAccessToken = getStoredAccessToken();
      if (currentFingerprint !== initialFingerprint) {
        if (currentAccessToken && currentAccessToken !== initialAccessToken) {
          return currentAccessToken;
        }
        return requestTokenRotation(current, currentFingerprint);
      }

      // localStorage RT가 그대로라면 선행 탭은 서버에서 소비하기 전에 실패한 것이다.
      // sessionStorage RT는 탭별이라 결과 전달을 놓쳤는지 구분할 수 없어 재사용하지 않는다.
      return current.kind === "local"
        ? requestTokenRotation(current, currentFingerprint)
        : null;
    });
  } catch {
    // Web Locks 사용이 정책/브라우저 문제로 실패해도 서버 CAS가 최종 경쟁을 차단한다.
    return requestTokenRotation(initial, initialFingerprint);
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

      const initial = readStoredRefreshToken(requiredKind);
      if (!initial) return null;

      const initialFingerprint = await tokenFingerprint(initial.token);
      return coordinateAcrossTabs(initial, initialFingerprint);
    } catch (err) {
      console.warn("[authRefresh] 자동 로그인 연장에 실패했습니다.", err);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/** 현재 탭의 토큰을 지우고 같은 출처의 다른 탭에도 로그아웃을 알린다. */
export function clearAuthTokensAcrossTabs(): void {
  clearAuthTokens();
  ensureCoordinationListeners();

  const message: AuthClearedMessage = {
    type: "AUTH_CLEARED",
    sourceId: tabId,
    createdAt: Date.now(),
  };

  try {
    refreshChannel?.postMessage(message);
  } catch {
    // storage event fallback을 계속 시도한다.
  }

  try {
    localStorage.setItem(AUTH_EVENT_KEY, JSON.stringify(message));
    localStorage.removeItem(AUTH_EVENT_KEY);
  } catch {
    // 현재 탭 정리는 이미 완료됐으므로 전파 실패만 무시한다.
  }
}

// 일반 화면이 로드된 탭은 다른 탭의 회전 결과를 즉시 받을 수 있게 미리 구독한다.
ensureCoordinationListeners();
