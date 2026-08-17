import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DIRECT_URL or DATABASE_URL is required");
}

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const schemaName = `specode_push_test_${Date.now()}`;
if (!/^specode_push_test_[0-9]+$/.test(schemaName)) {
  throw new Error("Unsafe temporary schema name");
}

const testUrl = new URL(databaseUrl);
testUrl.searchParams.set("schema", schemaName);
const prisma = new PrismaClient();
const prismaCli = path.join(
  workspaceRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js",
);

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      DATABASE_URL: testUrl.toString(),
      DIRECT_URL: testUrl.toString(),
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(
      [result.error?.message, result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n")
        .trim(),
    );
  }
}

try {
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  runPrisma([
    "db",
    "push",
    "--schema",
    "prisma/schema.prisma",
    "--skip-generate",
  ]);
  runPrisma([
    "migrate",
    "diff",
    "--from-url",
    testUrl.toString(),
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--exit-code",
  ]);
  console.log("PRISMA_DB_PUSH_ISOLATED_OK");
} finally {
  await prisma.$executeRawUnsafe(
    `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
  );
  await prisma.$disconnect();
}
