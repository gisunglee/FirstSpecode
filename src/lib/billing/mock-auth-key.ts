/**
 * billing/mock-auth-key — Mock PG 의 authKey 인코딩 (브라우저·서버 공용, Node 전용 API 없음)
 *
 * Mock "PG 창" 페이지(클라이언트)가 카드 정보를 authKey 에 담아 successUrl 로 돌려보내고,
 * 서버의 MockPaymentGateway.issueBillingKey 가 이를 풀어 빌링키를 만든다.
 * 두 쪽이 같은 함수를 쓰도록 여기 한 곳에 둔다. `Buffer`·`node:crypto` 를 쓰지 않는 이유는
 * 이 파일이 클라이언트 번들에도 들어가기 때문.
 */

export const MOCK_AUTH_KEY_PREFIX = "mock_auth.";

/** PG 창이 authKey 에 담아 보내는 카드 정보 */
export type MockAuthPayload = {
  cardCompany: string;
  last4:       string;
  /** true 면 이 카드의 청구는 항상 실패 (결제 실패·재시도·강등 흐름 테스트용) */
  alwaysFail:  boolean;
};

function toBase64Url(utf8: string): string {
  const bytes = new TextEncoder().encode(utf8);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function encodeMockAuthKey(payload: MockAuthPayload): string {
  return `${MOCK_AUTH_KEY_PREFIX}${toBase64Url(JSON.stringify(payload))}.${randomHex(6)}`;
}

/** 형식이 맞지 않으면 null. 카드사·끝자리가 비어 있으면 안전한 기본값으로 채운다 */
export function decodeMockAuthKey(authKey: string): MockAuthPayload | null {
  if (!authKey.startsWith(MOCK_AUTH_KEY_PREFIX)) return null;
  const body = authKey.slice(MOCK_AUTH_KEY_PREFIX.length).split(".")[0];
  if (!body) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(body)) as Partial<MockAuthPayload>;
    return {
      cardCompany: typeof parsed.cardCompany === "string" && parsed.cardCompany.trim() ? parsed.cardCompany.trim().slice(0, 30) : "모의카드",
      last4:       typeof parsed.last4 === "string" && /^\d{4}$/.test(parsed.last4) ? parsed.last4 : "0000",
      alwaysFail:  parsed.alwaysFail === true,
    };
  } catch {
    return null;
  }
}
