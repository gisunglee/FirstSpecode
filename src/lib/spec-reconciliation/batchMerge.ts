/** 자동 비교 배치가 같은 설계 대상을 제안했을 때의 순수 병합 규칙. */

import { createHash } from "node:crypto";

export type MergeProposal = {
  beforeHash: string;
  proposedValue: string;
  classification: string;
  sourceFact: string;
  inferredImpact?: string | null;
  risk: string;
  confidence: string;
};

export function mergeBatchProposalOrigins<P extends MergeProposal>(
  origins: Array<{ proposal: P }>,
) {
  if (origins.length === 0) {
    throw new Error("병합할 배치 제안이 없습니다.");
  }
  const first: P = origins[0].proposal;
  const proposedHashes = new Set(
    origins.map((origin) => sha256(origin.proposal.proposedValue)),
  );
  const classifications = new Set(
    origins.map((origin) => origin.proposal.classification),
  );
  return {
    first,
    conflict:
      proposedHashes.size > 1 ||
      classifications.size > 1 ||
      origins.some((origin) =>
        origin.proposal.beforeHash.toLowerCase() !== first.beforeHash.toLowerCase(),
      ),
    risk: maxRisk(origins.map((origin) => origin.proposal.risk)),
    confidence: minConfidence(
      origins.map((origin) => origin.proposal.confidence),
    ),
    sourceFact: joinUnique(origins.map((origin) => origin.proposal.sourceFact)),
    inferredImpact:
      joinUnique(origins.map((origin) => origin.proposal.inferredImpact ?? "")) ||
      null,
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function maxRisk(values: string[]) {
  const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return values.reduce(
    (max, value) => order.indexOf(value) > order.indexOf(max) ? value : max,
    "LOW",
  );
}

function minConfidence(values: string[]) {
  const order = ["LOW", "MEDIUM", "HIGH"];
  return values.reduce(
    (min, value) => order.indexOf(value) < order.indexOf(min) ? value : min,
    "HIGH",
  );
}

function joinUnique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    .map((value) => `- ${value}`)
    .join("\n");
}
