import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import {
  AUTH_COOKIE_MODE_HEADER,
  AUTH_COOKIE_MODE_VALUE,
  DEVELOPMENT_REFRESH_COOKIE_NAME,
} from "../src/lib/authCookiePolicy";
import { hashPassword, hashRefreshToken, verifyPassword } from "../src/lib/auth";

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required");

const workspaceRoot = process.cwd();
const schemaName = `specode_auth_cookie_test_${Date.now()}`;
if (!/^specode_auth_cookie_test_[0-9]+$/.test(schemaName)) {
  throw new Error("Unsafe temporary schema name");
}

const testUrl = new URL(databaseUrl);
testUrl.searchParams.set("schema", schemaName);

const admin = new PrismaClient({ datasourceUrl: databaseUrl });
const testDb = new PrismaClient({ datasourceUrl: testUrl.toString() });
const prismaCli = path.join(workspaceRoot, "node_modules", "prisma", "build", "index.js");
const appOrigin = "http://localhost:3000";

function pushTemporarySchema(): void {
  const result = spawnSync(
    process.execPath,
    [prismaCli, "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        DATABASE_URL: testUrl.toString(),
        DIRECT_URL: testUrl.toString(),
      },
      encoding: "utf8",
      timeout: 120_000,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      [result.error?.message, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n")
        .trim(),
    );
  }
}

function cookiePair(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, new RegExp(`^${DEVELOPMENT_REFRESH_COOKIE_NAME}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=strict/i);
  return setCookie.split(";", 1)[0]!;
}

function authRequest(
  pathname: string,
  method: "POST" | "PUT",
  body: Record<string, unknown>,
  options?: {
    cookie?: string;
    accessToken?: string;
    origin?: string;
    fetchSite?: string;
    cookieMode?: boolean;
  },
): NextRequest {
  return new NextRequest(`${appOrigin}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: options?.origin ?? appOrigin,
      "Sec-Fetch-Site": options?.fetchSite ?? "same-origin",
      ...(options?.cookieMode === false
        ? {}
        : { [AUTH_COOKIE_MODE_HEADER]: AUTH_COOKIE_MODE_VALUE }),
      ...(options?.cookie ? { Cookie: options.cookie } : {}),
      ...(options?.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function main(): Promise<void> {
  let appPrisma: PrismaClient | null = null;

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    pushTemporarySchema();

    process.env.DATABASE_URL = testUrl.toString();
    process.env.DIRECT_URL = testUrl.toString();
    process.env.APP_URL = appOrigin;
    process.env.JWT_SECRET = "auth-cookie-smoke-test-secret-with-sufficient-length";

    const memberId = "auth-cookie-test-member";
    const password = "Original!Password1";
    await testDb.tbCmMember.create({
      data: {
        mber_id: memberId,
        email_addr: "auth-cookie-test@specode.invalid",
        pswd_hash: await hashPassword(password),
        mber_sttus_code: "ACTIVE",
      },
    });

    const [{ POST: login }, { POST: refresh }, { POST: logout }, { PUT: changePassword }, prismaModule] =
      await Promise.all([
        import("../src/app/api/auth/login/route"),
        import("../src/app/api/auth/token/refresh/route"),
        import("../src/app/api/auth/logout/route"),
        import("../src/app/api/member/profile/password/route"),
        import("../src/lib/prisma"),
      ]);
    appPrisma = prismaModule.prisma;

    const loginResponse = await login(authRequest(
      "/api/auth/login",
      "POST",
      { email: "auth-cookie-test@specode.invalid", password, rememberMe: true },
    ));
    assert.equal(loginResponse.status, 200);
    assert.equal(loginResponse.headers.get("cache-control"), "no-store");
    const loginBody = await loginResponse.json();
    assert.equal(typeof loginBody.data?.accessToken, "string");
    assert.equal("refreshToken" in loginBody.data, false);
    const initialCookie = cookiePair(loginResponse);

    const activeAfterLogin = await testDb.tbCmRefreshToken.findFirstOrThrow({
      where: { mber_id: memberId, revoked_dt: null },
    });

    const csrfResponse = await refresh(authRequest(
      "/api/auth/token/refresh",
      "POST",
      {},
      {
        cookie: initialCookie,
        origin: "https://evil.example",
        fetchSite: "cross-site",
      },
    ));
    assert.equal(csrfResponse.status, 403);
    const unchangedToken = await testDb.tbCmRefreshToken.findUniqueOrThrow({
      where: { token_id: activeAfterLogin.token_id },
    });
    assert.equal(unchangedToken.revoked_dt, null);

    const refreshResponse = await refresh(authRequest(
      "/api/auth/token/refresh",
      "POST",
      {},
      { cookie: initialCookie },
    ));
    assert.equal(refreshResponse.status, 200);
    const refreshBody = await refreshResponse.json();
    assert.equal(typeof refreshBody.data?.accessToken, "string");
    assert.equal("refreshToken" in refreshBody.data, false);
    const rotatedCookie = cookiePair(refreshResponse);
    assert.notEqual(rotatedCookie, initialCookie);

    const originalAfterRotation = await testDb.tbCmRefreshToken.findUniqueOrThrow({
      where: { token_id: activeAfterLogin.token_id },
    });
    assert.ok(originalAfterRotation.revoked_dt);
    assert.equal(await testDb.tbCmRefreshToken.count({
      where: { mber_id: memberId, revoked_dt: null },
    }), 1);

    const otherSession = await testDb.tbCmMemberSession.create({
      data: { mber_id: memberId },
    });
    const otherToken = await testDb.tbCmRefreshToken.create({
      data: {
        mber_id: memberId,
        sesn_id: otherSession.sesn_id,
        token_hash_val: hashRefreshToken("other-device-refresh-token"),
        expiry_dt: new Date(Date.now() + 60_000),
      },
    });

    const passwordResponse = await changePassword(authRequest(
      "/api/member/profile/password",
      "PUT",
      { currentPassword: password, newPassword: "Changed!Password2" },
      { accessToken: refreshBody.data.accessToken },
    ));
    assert.equal(passwordResponse.status, 200);
    assert.ok((await testDb.tbCmRefreshToken.findUniqueOrThrow({
      where: { token_id: otherToken.token_id },
    })).revoked_dt);
    assert.equal(await testDb.tbCmRefreshToken.count({
      where: { mber_id: memberId, revoked_dt: null },
    }), 1);

    const logoutResponse = await logout(authRequest(
      "/api/auth/logout",
      "POST",
      {},
      { cookie: rotatedCookie },
    ));
    assert.equal(logoutResponse.status, 200);
    assert.match(logoutResponse.headers.get("set-cookie") ?? "", /Max-Age=0/i);
    assert.equal(await testDb.tbCmRefreshToken.count({
      where: { mber_id: memberId, revoked_dt: null },
    }), 0);

    const invalidatedPasswordResponse = await changePassword(authRequest(
      "/api/member/profile/password",
      "PUT",
      { currentPassword: "Changed!Password2", newPassword: "ShouldNot!Change3" },
      { accessToken: refreshBody.data.accessToken },
    ));
    assert.equal(invalidatedPasswordResponse.status, 401);
    const memberAfterInvalidatedAttempt = await testDb.tbCmMember.findUniqueOrThrow({
      where: { mber_id: memberId },
      select: { pswd_hash: true },
    });
    assert.ok(memberAfterInvalidatedAttempt.pswd_hash);
    assert.equal(
      await verifyPassword("Changed!Password2", memberAfterInvalidatedAttempt.pswd_hash),
      true,
    );

    // 배포 전 Web Storage RT는 새 클라이언트가 body로 한 번 제출하면
    // 응답 본문에 새 RT를 노출하지 않고 HttpOnly 쿠키로 승계한다.
    const legacyRawToken = "legacy-web-storage-refresh-token";
    const legacySession = await testDb.tbCmMemberSession.create({
      data: { mber_id: memberId },
    });
    const legacyToken = await testDb.tbCmRefreshToken.create({
      data: {
        mber_id: memberId,
        sesn_id: legacySession.sesn_id,
        token_hash_val: hashRefreshToken(legacyRawToken),
        auto_login_yn: "Y",
        expiry_dt: new Date(Date.now() + 60_000),
      },
    });
    const migrationResponse = await refresh(authRequest(
      "/api/auth/token/refresh",
      "POST",
      { refreshToken: legacyRawToken },
    ));
    assert.equal(migrationResponse.status, 200);
    const migrationBody = await migrationResponse.json();
    assert.equal(typeof migrationBody.data?.accessToken, "string");
    assert.equal("refreshToken" in migrationBody.data, false);
    cookiePair(migrationResponse);
    assert.ok((await testDb.tbCmRefreshToken.findUniqueOrThrow({
      where: { token_id: legacyToken.token_id },
    })).revoked_dt);

    // 아직 배포 전 코드를 실행 중인 구형 클라이언트도 자신이 body로 제출한
    // RT에 한해서는 회전 결과를 받아 세션이 갑자기 끊기지 않는다.
    const oldClientRawToken = "old-client-refresh-token";
    const oldClientSession = await testDb.tbCmMemberSession.create({
      data: { mber_id: memberId },
    });
    await testDb.tbCmRefreshToken.create({
      data: {
        mber_id: memberId,
        sesn_id: oldClientSession.sesn_id,
        token_hash_val: hashRefreshToken(oldClientRawToken),
        auto_login_yn: "N",
        expiry_dt: new Date(Date.now() + 60_000),
      },
    });
    const oldClientResponse = await refresh(authRequest(
      "/api/auth/token/refresh",
      "POST",
      { refreshToken: oldClientRawToken },
      { cookieMode: false },
    ));
    assert.equal(oldClientResponse.status, 200);
    const oldClientBody = await oldClientResponse.json();
    assert.equal(typeof oldClientBody.data?.accessToken, "string");
    assert.equal(typeof oldClientBody.data?.refreshToken, "string");
    cookiePair(oldClientResponse);

    console.log("AUTH_HTTPONLY_COOKIE_DB_OK");
  } finally {
    await Promise.allSettled([
      appPrisma?.$disconnect(),
      testDb.$disconnect(),
    ]);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
