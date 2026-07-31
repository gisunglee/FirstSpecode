/**
 * 설명 필드용 보수적 line 기반 3-way merge.
 *
 * base→current와 base→proposal의 변경 구간이 겹치지 않을 때만 preview를 만든다.
 * 겹치는 구간은 임의로 우선순위를 정하지 않고 conflict로 반환한다.
 */

import { diffArrays } from "diff";

type Edit = {
  start: number;
  end: number;
  replacement: string[];
  side: "CURRENT" | "PROPOSAL";
};

export type ThreeWayMergeResult =
  | { clean: true; merged: string; conflicts: [] }
  | {
      clean: false;
      merged: null;
      conflicts: Array<{
        baseStartLine: number;
        baseEndLine: number;
        currentLines: string[];
        proposalLines: string[];
      }>;
    };

function splitLines(value: string) {
  return value.replace(/\r\n/g, "\n").split("\n");
}

function editsFromDiff(
  base: string[],
  variant: string[],
  side: Edit["side"],
): Edit[] {
  const edits: Edit[] = [];
  let baseOffset = 0;
  let active: Edit | null = null;

  function flush() {
    if (active) edits.push(active);
    active = null;
  }

  for (const part of diffArrays(base, variant)) {
    const values = part.value as string[];
    if (!part.added && !part.removed) {
      flush();
      baseOffset += values.length;
      continue;
    }
    if (!active) {
      active = {
        start: baseOffset,
        end: baseOffset,
        replacement: [],
        side,
      };
    }
    if (part.removed) {
      active.end += values.length;
      baseOffset += values.length;
    } else {
      active.replacement.push(...values);
    }
  }
  flush();
  return edits;
}

function sameEdit(left: Edit, right: Edit) {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.replacement.join("\n") === right.replacement.join("\n")
  );
}

function overlaps(left: Edit, right: Edit) {
  const leftInsertion = left.start === left.end;
  const rightInsertion = right.start === right.end;
  if (leftInsertion && rightInsertion) return left.start === right.start;
  if (leftInsertion) return left.start > right.start && left.start < right.end;
  if (rightInsertion) return right.start > left.start && right.start < left.end;
  return Math.max(left.start, right.start) < Math.min(left.end, right.end);
}

export function mergeDescriptionText(
  baseValue: string,
  currentValue: string,
  proposedValue: string,
): ThreeWayMergeResult {
  if (currentValue === baseValue) {
    return { clean: true, merged: proposedValue, conflicts: [] };
  }
  if (proposedValue === baseValue || currentValue === proposedValue) {
    return { clean: true, merged: currentValue, conflicts: [] };
  }

  const base = splitLines(baseValue);
  const currentEdits = editsFromDiff(base, splitLines(currentValue), "CURRENT");
  const proposalEdits = editsFromDiff(base, splitLines(proposedValue), "PROPOSAL");
  const conflicts: Extract<ThreeWayMergeResult, { clean: false }>["conflicts"] = [];

  for (const current of currentEdits) {
    for (const proposal of proposalEdits) {
      if (!overlaps(current, proposal) || sameEdit(current, proposal)) continue;
      conflicts.push({
        baseStartLine: Math.min(current.start, proposal.start) + 1,
        baseEndLine: Math.max(current.end, proposal.end),
        currentLines: current.replacement,
        proposalLines: proposal.replacement,
      });
    }
  }
  if (conflicts.length > 0) {
    return { clean: false, merged: null, conflicts };
  }

  const unique = new Map<string, Edit>();
  for (const edit of [...currentEdits, ...proposalEdits]) {
    unique.set(
      `${edit.start}:${edit.end}:${edit.replacement.join("\n")}`,
      edit,
    );
  }
  const merged = [...base];
  const sorted = [...unique.values()].sort((left, right) => {
    if (left.start !== right.start) return right.start - left.start;
    // 같은 경계의 삽입은 교체보다 뒤에서 먼저 적용해야 최종 결과가 삽입→교체 순이다.
    return right.end - left.end;
  });
  for (const edit of sorted) {
    merged.splice(edit.start, edit.end - edit.start, ...edit.replacement);
  }
  return { clean: true, merged: merged.join("\n"), conflicts: [] };
}

