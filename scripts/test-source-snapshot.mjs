import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const commandPath = path.join(
  scriptRoot,
  ".claude",
  "commands",
  "source_snapshot.mjs",
);
const testRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "specode-source-snapshot-"),
);

try {
  fs.mkdirSync(path.join(testRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(testRoot, "src", "example.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(testRoot, ".env.local"), "SECRET=must-not-leak\n");
  const before = path.join(testRoot, "before.json.gz");
  const after = path.join(testRoot, "after.json.gz");
  const diff = path.join(testRoot, "diff.json");

  run(["capture", "--output", before]);
  const fakeSecret = "ghp_123456789012345678901234567890";
  fs.writeFileSync(
    path.join(testRoot, "src", "example.ts"),
    `export const value = 2;\nexport const accidental = "${fakeSecret}";\n`,
  );
  fs.writeFileSync(path.join(testRoot, "src", "added.ts"), "export const added = true;\n");
  run(["capture", "--output", after]);
  run(["compare", before, after, "--output", diff]);

  const result = JSON.parse(fs.readFileSync(diff, "utf8"));
  assert.equal(result.changedFileCount, 2);
  assert.deepEqual(
    result.changes.map((change) => change.path).sort(),
    ["src/added.ts", "src/example.ts"],
  );
  assert.equal(
    JSON.stringify(result).includes("must-not-leak"),
    false,
    "환경 파일 내용은 evidence에 포함되면 안 된다",
  );
  assert.equal(JSON.stringify(result).includes(fakeSecret), false);
  assert.equal(result.security.sensitiveValuesRedacted, true);
  assert.match(result.diffHash, /^[a-f0-9]{64}$/);
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}

function run(args) {
  const result = spawnSync(process.execPath, [commandPath, ...args], {
    cwd: testRoot,
    env: { ...process.env, SPECODE_SOURCE_ROOT: testRoot },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
