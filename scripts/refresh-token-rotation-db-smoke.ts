import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { refreshTokenRotationExpiryDate } from "../src/lib/auth";
import {
  RefreshTokenRotationConflictError,
  rotateRefreshTokenAtomically,
} from "../src/lib/refreshTokenRotation";

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_URL or DATABASE_URL is required");

const workspaceRoot = process.cwd();
const schemaName = `specode_refresh_test_${Date.now()}`;
if (!/^specode_refresh_test_[0-9]+$/.test(schemaName)) {
  throw new Error("Unsafe temporary schema name");
}

const testUrl = new URL(databaseUrl);
testUrl.searchParams.set("schema", schemaName);

const admin = new PrismaClient({ datasourceUrl: databaseUrl });
const clientA = new PrismaClient({ datasourceUrl: testUrl.toString() });
const clientB = new PrismaClient({ datasourceUrl: testUrl.toString() });
const prismaCli = path.join(workspaceRoot, "node_modules", "prisma", "build", "index.js");

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

async function main(): Promise<void> {
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    pushTemporarySchema();

    const memberId = "refresh-test-member";
    const sessionId = "refresh-test-session";
    const tokenId = "refresh-test-token";
    const now = new Date();
    const sessionCreatedAt = new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000);
    const cappedExpiry = refreshTokenRotationExpiryDate(sessionCreatedAt, now);
    assert.ok(cappedExpiry);

    await clientA.tbCmMember.create({
      data: {
        mber_id: memberId,
        email_addr: "refresh-test@specode.invalid",
        mber_sttus_code: "ACTIVE",
      },
    });
    await clientA.tbCmMemberSession.create({
      data: {
        sesn_id: sessionId,
        mber_id: memberId,
        creat_dt: sessionCreatedAt,
      },
    });
    await clientA.tbCmRefreshToken.create({
      data: {
        token_id: tokenId,
        mber_id: memberId,
        token_hash_val: "original-refresh-token-hash",
        auto_login_yn: "Y",
        expiry_dt: new Date(now.getTime() + 60_000),
        sesn_id: sessionId,
      },
    });

    const rotate = (client: PrismaClient, suffix: string) =>
      client.$transaction((tx) =>
        rotateRefreshTokenAtomically(tx, {
          tokenId,
          memberId,
          sessionId,
          newTokenHash: `rotated-refresh-token-hash-${suffix}`,
          autoLoginYn: "Y",
          newExpiry: cappedExpiry,
          now,
        })
      );

    const results = await Promise.allSettled([
      rotate(clientA, "a"),
      rotate(clientB, "b"),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected");
    assert.ok(rejected.reason instanceof RefreshTokenRotationConflictError);

    const original = await clientA.tbCmRefreshToken.findUniqueOrThrow({
      where: { token_id: tokenId },
    });
    const activeTokens = await clientA.tbCmRefreshToken.count({
      where: { sesn_id: sessionId, revoked_dt: null },
    });
    const activeToken = await clientA.tbCmRefreshToken.findFirstOrThrow({
      where: { sesn_id: sessionId, revoked_dt: null },
    });
    const session = await clientA.tbCmMemberSession.findUniqueOrThrow({
      where: { sesn_id: sessionId },
    });

    assert.ok(original.revoked_dt);
    assert.equal(activeTokens, 1);
    assert.equal(activeToken.expiry_dt.toISOString(), cappedExpiry.toISOString());
    assert.equal(session.invald_dt, null);
    console.log("REFRESH_TOKEN_ATOMIC_ROTATION_DB_OK");
  } finally {
    await Promise.allSettled([
      clientA.$disconnect(),
      clientB.$disconnect(),
    ]);
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
