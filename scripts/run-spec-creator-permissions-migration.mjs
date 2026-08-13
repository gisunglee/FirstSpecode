import { spawnSync } from "node:child_process";

const rawUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!rawUrl) {
  console.error("DATABASE_URL 또는 DIRECT_URL이 필요합니다.");
  process.exit(1);
}

const migrationUrl = new URL(rawUrl);

// Supabase transaction pooler(6543)는 DDL 실행이 장시간 대기할 수 있다.
// 동일 자격증명의 session pooler(5432)로 전환해 마이그레이션을 실행한다.
if (migrationUrl.hostname.endsWith(".pooler.supabase.com") && migrationUrl.port === "6543") {
  migrationUrl.port = "5432";
  migrationUrl.searchParams.delete("pgbouncer");
}
migrationUrl.searchParams.set("connect_timeout", "10");

const result = spawnSync(
  "./node_modules/.bin/prisma",
  [
    "db",
    "execute",
    "--url",
    migrationUrl.toString(),
    "--file",
    "prisma/sql/2026-08-09_add_spec_creator_modifier.sql",
  ],
  { stdio: "inherit", env: process.env },
);

if (result.error) {
  console.error(`마이그레이션 실행 실패: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
