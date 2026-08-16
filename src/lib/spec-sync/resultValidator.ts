/**
 * AI 동기화 결과의 결정적 검증.
 *
 * AI가 만든 target과 proposal을 실행 당시 설계 snapshot에 다시 연결하고,
 * AS-IS 값과 hash는 서버가 직접 파생한다.
 */

import {
  syncAnalysisPayloadSchema,
  type DesignSnapshot,
  type SyncAnalysisPayload,
} from "./contracts";
import { hashExactText } from "./hash";

export type DerivedProposal = {
  targetType: string;
  targetId: string;
  targetField: string;
  beforeValue: string;
  beforeHash: string;
  proposedValue: string;
};

export type ValidatedSyncResult = {
  analysis: SyncAnalysisPayload;
  proposals: Map<string, DerivedProposal>;
};

export function validateSyncResult(
  rawResult: unknown,
  snapshot: DesignSnapshot,
): ValidatedSyncResult {
  const analysis = syncAnalysisPayloadSchema.parse(rawResult);
  validateSourceEvidence(analysis);
  const targets = new Map(
    snapshot.targets.map((target) => [targetKey(target), target]),
  );
  const findingKeys = new Set<string>();
  const implementationTargetKeys = new Set<string>();
  const proposals = new Map<string, DerivedProposal>();

  for (const finding of analysis.implementation.items) {
    const key = targetKey(finding);
    const target = targets.get(key);
    if (!target) {
      throw new Error(`실행 UW snapshot에 없는 구현 정합성 대상입니다: ${key}`);
    }
    implementationTargetKeys.add(key);
    assertUnique(findingKeys, `IMPLEMENTATION:${key}`);
    if (finding.proposal) {
      if (targetKey(finding.proposal) !== key) {
        throw new Error("구현 판정의 proposal은 같은 설계 대상만 수정할 수 있습니다.");
      }
      proposals.set(
        `IMPLEMENTATION:${key}`,
        deriveProposal(finding.proposal, targets),
      );
    }
  }

  const missingTargets = [...targets.keys()].filter(
    (key) => !implementationTargetKeys.has(key),
  );
  if (missingTargets.length > 0) {
    throw new Error(
      `구현 판정이 누락된 설계 대상이 있습니다: ${missingTargets.slice(0, 20).join(", ")}`,
    );
  }

  for (const finding of analysis.designCoverage.items) {
    const semanticKey = [
      finding.resultCode,
      finding.targetType ?? "NONE",
      finding.targetId ?? "NONE",
      finding.sourceFact.trim(),
    ].join(":");
    assertUnique(findingKeys, `COVERAGE:${semanticKey}`);
    if (finding.targetType && finding.targetId && finding.targetField) {
      const key = targetKey({
        targetType: finding.targetType,
        targetId: finding.targetId,
        targetField: finding.targetField,
      });
      if (!targets.has(key)) {
        throw new Error(`실행 UW snapshot에 없는 설계 커버리지 대상입니다: ${key}`);
      }
    }
    if (finding.proposal) {
      if (
        !finding.targetType ||
        !finding.targetId ||
        !finding.targetField ||
        targetKey(finding.proposal) !==
          targetKey({
            targetType: finding.targetType,
            targetId: finding.targetId,
            targetField: finding.targetField,
          })
      ) {
        throw new Error("설계 누락 proposal은 같은 설계 대상을 명시해야 합니다.");
      }
      proposals.set(
        `COVERAGE:${semanticKey}`,
        deriveProposal(finding.proposal, targets),
      );
    }
  }

  return { analysis, proposals };
}

export function assertDecisionEligible(input: {
  itemStatus: string;
  proposedValue: string | null;
  decision: "APPLY" | "REJECT" | "DEFER";
}) {
  if (
    input.itemStatus !== "PENDING" ||
    (input.decision === "APPLY" && input.proposedValue === null)
  ) {
    throw new Error("INVALID_ITEM_STATE");
  }
}

function deriveProposal(
  proposal: {
    targetType: string;
    targetId: string;
    targetField: string;
    proposedValue: string;
  },
  targets: Map<string, DesignSnapshot["targets"][number]>,
): DerivedProposal {
  const key = targetKey(proposal);
  const target = targets.get(key);
  if (!target) {
    throw new Error(`실행 UW snapshot에 없는 proposal 대상입니다: ${key}`);
  }
  if (proposal.proposedValue === target.value) {
    throw new Error(`변경 내용이 없는 proposal입니다: ${key}`);
  }
  return {
    targetType: target.targetType,
    targetId: target.targetId,
    targetField: target.targetField,
    beforeValue: target.value,
    beforeHash: hashExactText(target.value),
    proposedValue: proposal.proposedValue,
  };
}

function targetKey(input: {
  targetType: string;
  targetId: string;
  targetField: string;
}) {
  return `${input.targetType}:${input.targetId}:${input.targetField}`;
}

function assertUnique(keys: Set<string>, key: string) {
  if (keys.has(key)) {
    throw new Error(`중복 동기화 결과입니다: ${key}`);
  }
  keys.add(key);
}

function validateSourceEvidence(analysis: SyncAnalysisPayload) {
  const sourcePaths = new Map<string, string>();
  for (const file of analysis.sourceScope.files) {
    const path = normalizeRepositoryPath(file.path);
    if (sourcePaths.has(path)) {
      throw new Error(`중복 소스 범위입니다: ${file.path}`);
    }
    sourcePaths.set(path, file.kind);
  }

  const findings = [
    ...analysis.implementation.items,
    ...analysis.designCoverage.items,
  ];
  for (const finding of findings) {
    for (const evidence of finding.evidence) {
      const path = normalizeRepositoryPath(evidence.path);
      if (!sourcePaths.has(path)) {
        throw new Error(`확정 소스 범위 밖의 evidence입니다: ${evidence.path}`);
      }
      if (hashExactText(evidence.snippet) !== evidence.snippetHash.toLowerCase()) {
        throw new Error(`evidence snippet hash가 일치하지 않습니다: ${evidence.path}`);
      }
      if (containsCredential(evidence.snippet)) {
        throw new Error(`credential이 제거되지 않은 evidence입니다: ${evidence.path}`);
      }
      if (
        evidence.redacted &&
        !/\[REDACTED_(?:PRIVATE_KEY|TOKEN|AWS_KEY|SECRET)\]/.test(
          evidence.snippet,
        )
      ) {
        throw new Error(`redacted evidence에 마스킹 표식이 없습니다: ${evidence.path}`);
      }
    }
    const needsRuntimeEvidence =
      "importance" in finding
        ? finding.resultCode !== "UNKNOWN"
        : ["MATCH", "MISMATCH"].includes(finding.resultCode);
    if (
      needsRuntimeEvidence &&
      finding.evidence.length > 0 &&
      finding.evidence.every(
        (evidence) =>
          sourcePaths.get(normalizeRepositoryPath(evidence.path)) === "TEST",
      )
    ) {
      throw new Error("테스트 코드만으로 현재 구현 사실을 확정할 수 없습니다.");
    }
  }
}

function containsCredential(value: string) {
  return (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value) ||
    /\b(?:sk|spk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/.test(value) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(value) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i.test(value) ||
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'`][^"'`\r\n]{12,}["'`]/i.test(
      value,
    )
  );
}

export function normalizeRepositoryPath(path: string) {
  const normalized = path.trim().replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`저장소 상대 경로만 허용합니다: ${path}`);
  }

  const lower = `/${normalized.toLowerCase()}/`;
  const forbiddenSegments = [
    "/.git/",
    "/node_modules/",
    "/.next/",
    "/dist/",
    "/build/",
    "/vendor/",
    "/generated/",
  ];
  if (
    forbiddenSegments.some((segment) => lower.includes(segment)) ||
    /(^|\/)\.env(?:\.|$)/i.test(normalized) ||
    /\.(?:pem|key|p12|pfx|crt|cer)$/i.test(normalized)
  ) {
    throw new Error(`분석 제외 경로입니다: ${path}`);
  }
  return normalized;
}
