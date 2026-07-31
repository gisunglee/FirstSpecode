/**
 * 자동 비교 배치의 순수 분할 로직.
 *
 * DB나 Next.js에 의존하지 않아 모든 파일/설계 대상이 품질 예산 안에서 빠짐없이
 * 배정되는지 단위 테스트할 수 있다.
 */

import {
  BATCH_LIMITS,
  type BatchScope,
  type BatchTargetRef,
  type EvidenceFile,
  type FileAssignment,
} from "./batchContracts";

export type BatchDefinition = {
  scope: BatchScope;
  files: EvidenceFile[];
  targets: BatchTargetRef[];
  chunkNo: number;
};

export function buildBatchDefinitions(
  files: EvidenceFile[],
  scopes: BatchScope[],
  assignments: FileAssignment[],
) {
  const expandedFiles = splitEvidenceFiles(files);
  const filesByPath = new Map<string, EvidenceFile[]>();
  for (const file of expandedFiles) {
    const current = filesByPath.get(file.path) ?? [];
    current.push(file);
    filesByPath.set(file.path, current);
  }
  const scopeByKey = new Map(scopes.map((scope) => [scope.key, scope]));
  const grouped = new Map<string, EvidenceFile[]>();
  const sharedAssignments: FileAssignment[] = [];
  const unmapped: EvidenceFile[] = [];
  for (const assignment of normalizeAssignments(files, scopes, assignments)) {
    const fileParts = filesByPath.get(assignment.path) ?? [];
    if (fileParts.length === 0) continue;
    if (assignment.scopeKeys.length === 0) {
      unmapped.push(...fileParts);
    } else if (assignment.shared || assignment.scopeKeys.length > 1) {
      sharedAssignments.push(assignment);
    } else {
      const key = assignment.scopeKeys[0];
      const current = grouped.get(key) ?? [];
      current.push(...fileParts);
      grouped.set(key, current);
    }
  }

  const definitions: BatchDefinition[] = [];
  for (const [scopeKey, scopedFiles] of grouped) {
    const scope = scopeByKey.get(scopeKey);
    if (!scope) continue;
    for (const [index, chunk] of chunkFiles(scopedFiles).entries()) {
      definitions.push({
        scope,
        files: chunk,
        targets: scope.targetRefs,
        chunkNo: index + 1,
      });
    }
  }
  for (const assignment of sharedAssignments) {
    const fileParts = filesByPath.get(assignment.path) ?? [];
    if (fileParts.length === 0) continue;
    const targets = dedupeTargets(
      assignment.scopeKeys.flatMap((key) => scopeByKey.get(key)?.targetRefs ?? []),
    );
    const targetChunks = chunkTargets(targets);
    for (const file of fileParts) {
      for (const [index, targetChunk] of targetChunks.entries()) {
        definitions.push({
          scope: makeScope(
            `SHARED:${safeKey(file.path)}:${file.partNo ?? 1}:${index + 1}`,
            "SHARED",
            null,
            `공통 변경 · ${file.path}${formatPartLabel(file)}`,
            targetChunk,
          ),
          files: [file],
          targets: targetChunk,
          chunkNo: 1,
        });
      }
    }
  }
  for (const [index, chunk] of chunkFiles(unmapped).entries()) {
    const scope = makeScope(
      `UNMAPPED:${index + 1}`,
      "UNMAPPED",
      null,
      `미분류 변경 ${index + 1}`,
      [],
    );
    definitions.push({ scope, files: chunk, targets: [], chunkNo: 1 });
  }
  if (definitions.length === 0) {
    const fallback = scopes[0] ?? makeScope(
      "UNMAPPED:1",
      "UNMAPPED",
      null,
      "미분류 변경",
      [],
    );
    for (const [index, chunk] of chunkFiles(expandedFiles).entries()) {
      definitions.push({
        scope: fallback,
        files: chunk,
        targets: fallback.targetRefs,
        chunkNo: index + 1,
      });
    }
  }
  return definitions;
}

export function makeScope(
  key: string,
  type: BatchScope["type"],
  refId: string | null,
  name: string,
  targetRefs: BatchTargetRef[],
): BatchScope {
  return {
    key,
    type,
    refId,
    name,
    targetRefs: dedupeTargets(targetRefs),
    contextChars: targetRefs.reduce(
      (sum, target) => sum + target.description.length,
      0,
    ),
  };
}

export function chunkTargets(targets: BatchTargetRef[]) {
  const chunks: BatchTargetRef[][] = [];
  let current: BatchTargetRef[] = [];
  let chars = 0;
  for (const target of dedupeTargets(targets)) {
    if (
      current.length > 0 &&
      (current.length >= BATCH_LIMITS.maxTargets ||
        chars + target.description.length > BATCH_LIMITS.maxContextChars)
    ) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(target);
    chars += target.description.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}

export function fitsTargetBudget(targets: BatchTargetRef[]) {
  return (
    targets.length <= BATCH_LIMITS.maxTargets &&
    targets.reduce((sum, target) => sum + target.description.length, 0) <=
      BATCH_LIMITS.maxContextChars
  );
}

export function dedupeTargets(targets: BatchTargetRef[]) {
  return Array.from(new Map(
    targets.map((target) => [
      `${target.targetRefType}:${target.targetRefId}:${target.targetField}`,
      target,
    ]),
  ).values());
}

export function splitEvidenceFiles(files: EvidenceFile[]) {
  return files.flatMap((file) => {
    if (file.patch.length <= BATCH_LIMITS.maxFilePatchChars) {
      return [{ ...file, partNo: 1, partCount: 1 }];
    }
    const partCount = Math.ceil(
      file.patch.length / BATCH_LIMITS.maxFilePatchChars,
    );
    return Array.from({ length: partCount }, (_, index) => ({
      ...file,
      patch: file.patch.slice(
        index * BATCH_LIMITS.maxFilePatchChars,
        (index + 1) * BATCH_LIMITS.maxFilePatchChars,
      ),
      partNo: index + 1,
      partCount,
    }));
  });
}

export function selectEvidenceParts(
  files: EvidenceFile[],
  rawParts: unknown,
  fallbackPaths: string[],
) {
  const expanded = splitEvidenceFiles(files);
  if (!Array.isArray(rawParts)) {
    return expanded.filter((file) => fallbackPaths.includes(file.path));
  }
  const keys = new Set(rawParts.flatMap((value) => {
    const record = asRecord(value);
    const path = stringValue(record?.path);
    const partNo = numberValue(record?.partNo);
    return path && partNo ? [`${path}:${partNo}`] : [];
  }));
  return expanded.filter((file) =>
    keys.has(`${file.path}:${file.partNo ?? 1}`),
  );
}

function chunkFiles(files: EvidenceFile[]) {
  const chunks: EvidenceFile[][] = [];
  let current: EvidenceFile[] = [];
  let chars = 0;
  for (const file of dedupeFiles(files)) {
    if (
      current.length > 0 &&
      (current.length >= BATCH_LIMITS.maxFiles ||
        chars + file.patch.length > BATCH_LIMITS.maxDiffChars)
    ) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(file);
    chars += file.patch.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function normalizeAssignments(
  files: EvidenceFile[],
  scopes: BatchScope[],
  assignments: FileAssignment[],
) {
  const validPaths = new Set(files.map((file) => file.path));
  const validScopes = new Set(scopes.map((scope) => scope.key));
  const byPath = new Map<string, FileAssignment>();
  for (const assignment of assignments) {
    if (!validPaths.has(assignment.path)) continue;
    const scopeKeys = Array.from(new Set(
      assignment.scopeKeys.filter((key) => validScopes.has(key)),
    )).slice(0, BATCH_LIMITS.maxScopesPerFile);
    const previous = byPath.get(assignment.path);
    byPath.set(assignment.path, {
      path: assignment.path,
      scopeKeys: Array.from(new Set([...(previous?.scopeKeys ?? []), ...scopeKeys])),
      shared: Boolean(previous?.shared) || assignment.shared || scopeKeys.length > 1,
      confidence:
        previous?.confidence === "HIGH" || assignment.confidence === "HIGH"
          ? "HIGH"
          : previous?.confidence === "MEDIUM" || assignment.confidence === "MEDIUM"
            ? "MEDIUM"
            : "LOW",
      reason: [previous?.reason, assignment.reason].filter(Boolean).join(" / "),
    });
  }
  return files.map((file) => byPath.get(file.path) ?? {
    path: file.path,
    scopeKeys: [],
    shared: false,
    confidence: "LOW" as const,
    reason: "AI router가 연결 범위를 확정하지 못함",
  });
}

function dedupeFiles(files: EvidenceFile[]) {
  return Array.from(new Map(files.map((file) => [
    `${file.path}:${file.partNo ?? 1}`,
    file,
  ])).values());
}

function formatPartLabel(file: EvidenceFile) {
  return (file.partCount ?? 1) > 1
    ? ` (${file.partNo}/${file.partCount})`
    : "";
}

function safeKey(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-100);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}
