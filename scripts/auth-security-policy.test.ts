import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import {
  signAccessToken,
  signSocialToken,
  verifyAccessToken,
  verifySocialToken,
} from "../src/lib/auth";
import { isMcpClientRequestAllowed } from "../src/lib/authCredentialPolicy";
import {
  getStoredAccessToken,
  readStoredRefreshToken,
  replaceAuthTokensIfCurrent,
  storeAuthTokens,
  type AuthTokenStorage,
} from "../src/lib/authTokenStorage";
import {
  classifyRevokedRefreshTokenUse,
  RefreshSessionInvalidatedError,
  RefreshTokenRotationConflictError,
  rotateRefreshTokenAtomically,
} from "../src/lib/refreshTokenRotation";

const PROJECT_ID = "project-1";
const JWT_SECRET = "test-only-secret-with-sufficient-length";

process.env.JWT_SECRET = JWT_SECRET;

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function createMemoryAuthStorage(): AuthTokenStorage {
  return {
    local: new MemoryStorage(),
    session: new MemoryStorage(),
  };
}

test("MCP 프로토콜에 필요한 메서드만 허용한다", () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    assert.equal(isMcpClientRequestAllowed(method, "/api/mcp", PROJECT_ID), true);
  }
  assert.equal(isMcpClientRequestAllowed("PATCH", "/api/mcp", PROJECT_ID), false);
});

test("프로젝트 목록은 조회만 허용한다", () => {
  assert.equal(isMcpClientRequestAllowed("GET", "/api/projects", PROJECT_ID), true);
  assert.equal(isMcpClientRequestAllowed("POST", "/api/projects", PROJECT_ID), false);
  assert.equal(isMcpClientRequestAllowed("DELETE", "/api/projects", PROJECT_ID), false);
});

test("고정된 프로젝트 경로의 비삭제 작업만 허용한다", () => {
  for (const method of ["GET", "POST", "PUT", "PATCH"]) {
    assert.equal(
      isMcpClientRequestAllowed(method, `/api/projects/${PROJECT_ID}/requirements`, PROJECT_ID),
      true,
    );
  }
  assert.equal(
    isMcpClientRequestAllowed("DELETE", `/api/projects/${PROJECT_ID}/requirements/1`, PROJECT_ID),
    false,
  );
});

test("다른 프로젝트와 비프로젝트 API는 차단한다", () => {
  const deniedPaths = [
    "/api/projects/another-project/requirements",
    "/api/projects/my",
    "/api/member/me",
    "/api/auth/mcp-keys",
    "/api/admin/members",
    "/api/invitations/token",
    "/api/docs/export",
    "/api/worker/run",
  ];

  for (const path of deniedPaths) {
    assert.equal(isMcpClientRequestAllowed("GET", path, PROJECT_ID), false, path);
  }
});

test("새 Access Token은 종류와 세션을 포함하고 검증된다", () => {
  const token = signAccessToken({
    mberId: "member-1",
    email: "member@example.com",
    sesnId: "session-1",
  });

  assert.deepEqual(verifyAccessToken(token), {
    mberId: "member-1",
    email: "member@example.com",
    sesnId: "session-1",
    tokenType: "ACCESS",
  });
});

test("필수 클레임이 있는 기존 Access Token은 전환 기간에 허용한다", () => {
  const legacyToken = jwt.sign(
    { mberId: "member-1", email: "member@example.com", sesnId: "session-1" },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "5m" },
  );

  assert.deepEqual(verifyAccessToken(legacyToken), {
    mberId: "member-1",
    email: "member@example.com",
    sesnId: "session-1",
    tokenType: "ACCESS",
  });
});

test("기존 nullable 이메일 계정의 빈 문자열 클레임도 호환한다", () => {
  const token = signAccessToken({
    mberId: "member-1",
    email: "",
    sesnId: "session-1",
  });

  assert.equal(verifyAccessToken(token)?.email, "");
});

test("같은 비밀키로 서명된 소셜 토큰을 Access Token으로 받지 않는다", () => {
  const socialToken = signSocialToken({
    provdrCode: "GOOGLE",
    provdrUserId: "provider-user-1",
    email: "member@example.com",
  });

  assert.equal(verifyAccessToken(socialToken), null);
});

test("Access Token을 소셜 연동 토큰으로 받지 않는다", () => {
  const accessToken = signAccessToken({
    mberId: "member-1",
    email: "member@example.com",
    sesnId: "session-1",
  });

  assert.equal(verifySocialToken(accessToken), null);
});

test("필수 클레임이 있는 기존 소셜 토큰은 전환 기간에 허용한다", () => {
  const legacySocialToken = jwt.sign(
    {
      provdrCode: "GOOGLE",
      provdrUserId: "provider-user-1",
      email: "member@example.com",
    },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "5m" },
  );

  assert.deepEqual(verifySocialToken(legacySocialToken), {
    provdrCode: "GOOGLE",
    provdrUserId: "provider-user-1",
    email: "member@example.com",
    tokenType: "SOCIAL",
  });
});

test("세션이 없거나 종류가 다르거나 알고리즘이 다른 토큰은 거부한다", () => {
  const missingSession = jwt.sign(
    { mberId: "member-1", email: "member@example.com" },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "5m" },
  );
  const wrongType = jwt.sign(
    {
      mberId: "member-1",
      email: "member@example.com",
      sesnId: "session-1",
      tokenType: "SOCIAL",
    },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "5m" },
  );
  const wrongAlgorithm = jwt.sign(
    { mberId: "member-1", email: "member@example.com", sesnId: "session-1" },
    JWT_SECRET,
    { algorithm: "HS384", expiresIn: "5m" },
  );

  assert.equal(verifyAccessToken(missingSession), null);
  assert.equal(verifyAccessToken(wrongType), null);
  assert.equal(verifyAccessToken(wrongAlgorithm), null);
});

test("로그인 토큰은 선택한 RT 저장소 한 곳에만 저장한다", () => {
  const storage = createMemoryAuthStorage();

  assert.equal(storeAuthTokens("access-1", "refresh-local", "local", storage), true);
  assert.deepEqual(readStoredRefreshToken(undefined, storage), {
    token: "refresh-local",
    kind: "local",
  });

  assert.equal(storeAuthTokens("access-2", "refresh-session", "session", storage), true);
  assert.deepEqual(readStoredRefreshToken(undefined, storage), {
    token: "refresh-session",
    kind: "session",
  });
  assert.equal(readStoredRefreshToken("local", storage), null);
  assert.equal(getStoredAccessToken(storage), "access-2");
});

test("RT 회전 결과는 요청에 사용한 토큰이 그대로일 때만 저장한다", () => {
  const storage = createMemoryAuthStorage();
  storeAuthTokens("access-1", "refresh-1", "local", storage);

  assert.equal(
    replaceAuthTokensIfCurrent("different-token", "access-bad", "refresh-bad", storage),
    null,
  );
  assert.equal(getStoredAccessToken(storage), "access-1");

  assert.deepEqual(
    replaceAuthTokensIfCurrent("refresh-1", "access-2", "refresh-2", storage),
    { token: "refresh-2", kind: "local" },
  );
  assert.equal(getStoredAccessToken(storage), "access-2");
});

test("방금 폐기된 RT 재요청만 동시성 충돌로 분류한다", () => {
  const now = new Date("2026-08-20T00:00:10.000Z");

  assert.equal(
    classifyRevokedRefreshTokenUse(new Date("2026-08-20T00:00:05.000Z"), now),
    "CONCURRENT_RETRY",
  );
  assert.equal(
    classifyRevokedRefreshTokenUse(new Date("2026-08-20T00:00:04.999Z"), now),
    "REUSE_DETECTED",
  );
});

test("동시에 같은 RT를 회전해도 조건부 소비와 새 RT 생성은 한 번만 성공한다", async () => {
  let active = true;
  let createCount = 0;
  const tx = {
    tbCmRefreshToken: {
      updateMany: async () => {
        await Promise.resolve();
        if (!active) return { count: 0 };
        active = false;
        return { count: 1 };
      },
      create: async () => {
        createCount += 1;
        return {};
      },
    },
    tbCmMemberSession: {
      updateMany: async () => ({ count: 1 }),
    },
  };
  const input = {
    tokenId: "token-1",
    memberId: "member-1",
    sessionId: "session-1",
    newTokenHash: "new-token-hash",
    autoLoginYn: "Y",
    newExpiry: new Date("2026-08-30T00:00:00.000Z"),
    now: new Date("2026-08-20T00:00:00.000Z"),
  };

  const results = await Promise.allSettled([
    rotateRefreshTokenAtomically(tx as never, input),
    rotateRefreshTokenAtomically(tx as never, input),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof RefreshTokenRotationConflictError);
  assert.equal(createCount, 1);
});

test("회전 중 세션이 무효화되면 새 RT를 만들지 않는다", async () => {
  let createCount = 0;
  const tx = {
    tbCmRefreshToken: {
      updateMany: async () => ({ count: 1 }),
      create: async () => {
        createCount += 1;
        return {};
      },
    },
    tbCmMemberSession: {
      updateMany: async () => ({ count: 0 }),
    },
  };

  await assert.rejects(
    rotateRefreshTokenAtomically(tx as never, {
      tokenId: "token-1",
      memberId: "member-1",
      sessionId: "session-1",
      newTokenHash: "new-token-hash",
      autoLoginYn: "N",
      newExpiry: new Date("2026-08-30T00:00:00.000Z"),
      now: new Date("2026-08-20T00:00:00.000Z"),
    }),
    RefreshSessionInvalidatedError,
  );
  assert.equal(createCount, 0);
});
