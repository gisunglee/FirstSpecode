/**
 * 확정된 검토 항목의 소스 증거에서 파일·심볼 연결을 누적한다.
 *
 * 첫 제출은 사용자 선택과 AI 후보로 동작하고, 확정된 결과만 연결지도로 승격한다.
 * 자유 형식 JSON 전체를 믿지 않고 files 배열의 제한된 형태만 읽는다.
 */

import { Prisma } from "@prisma/client";
import type { ReconcileTargetType } from "./contracts";

type SourceLinkCandidate = {
  sourceKind: string;
  path: string;
  symbol: string;
  relationType: string;
  confidence: string;
};

function safeCode(value: unknown, fallback: string) {
  return typeof value === "string" && /^[A-Z_]{2,30}$/.test(value)
    ? value
    : fallback;
}

export function extractSourceLinks(evidence: unknown): SourceLinkCandidate[] {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const record = evidence as Record<string, unknown>;
  const files = Array.isArray(record.files) ? record.files : [];
  const candidates: SourceLinkCandidate[] = [];

  for (const file of files) {
    if (typeof file === "string") {
      const path = file.trim().slice(0, 1_000);
      if (path) {
        candidates.push({
          sourceKind: "FILE",
          path,
          symbol: "",
          relationType: "DIRECT",
          confidence: "MEDIUM",
        });
      }
      continue;
    }
    if (!file || typeof file !== "object" || Array.isArray(file)) continue;
    const item = file as Record<string, unknown>;
    const path = typeof item.path === "string" ? item.path.trim().slice(0, 1_000) : "";
    if (!path) continue;
    const symbols = Array.isArray(item.symbols)
      ? item.symbols.filter((value): value is string => typeof value === "string")
      : typeof item.symbol === "string"
        ? [item.symbol]
        : [];
    const normalizedSymbols = symbols.length > 0 ? symbols : [""];
    for (const symbol of normalizedSymbols.slice(0, 100)) {
      candidates.push({
        sourceKind: safeCode(item.kind, symbol ? "SYMBOL" : "FILE"),
        path,
        symbol: symbol.trim().slice(0, 500),
        relationType: safeCode(item.relationType, "DIRECT"),
        confidence: safeCode(item.confidence, "MEDIUM"),
      });
    }
  }

  const unique = new Map<string, SourceLinkCandidate>();
  for (const candidate of candidates) {
    unique.set(
      `${candidate.sourceKind}\0${candidate.path}\0${candidate.symbol}`,
      candidate,
    );
  }
  return [...unique.values()];
}

export async function upsertConfirmedSourceLinks(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    receiptId: string;
    targetType: ReconcileTargetType;
    targetId: string;
    evidence: unknown;
  },
) {
  const candidates = extractSourceLinks(input.evidence);
  for (const candidate of candidates) {
    await tx.tbSpSpecSourceLink.upsert({
      where: {
        prjct_id_target_ref_ty_code_target_ref_id_source_kind_code_source_path_source_symbol: {
          prjct_id: input.projectId,
          target_ref_ty_code: input.targetType,
          target_ref_id: input.targetId,
          source_kind_code: candidate.sourceKind,
          source_path: candidate.path,
          source_symbol: candidate.symbol,
        },
      },
      create: {
        prjct_id: input.projectId,
        target_ref_ty_code: input.targetType,
        target_ref_id: input.targetId,
        source_kind_code: candidate.sourceKind,
        source_path: candidate.path,
        source_symbol: candidate.symbol,
        relation_ty_code: candidate.relationType,
        confidence_code: candidate.confidence,
        first_receipt_id: input.receiptId,
        last_receipt_id: input.receiptId,
      },
      update: {
        relation_ty_code: candidate.relationType,
        confidence_code: candidate.confidence,
        last_receipt_id: input.receiptId,
        use_yn: "Y",
        mdfcn_dt: new Date(),
      },
    });
  }
}
