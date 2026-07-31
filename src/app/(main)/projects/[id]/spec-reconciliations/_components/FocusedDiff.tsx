/**
 * 긴 설계 설명에서 변경 줄 주변만 보여주는 line Diff.
 */

import { diffLines } from "diff";

type DiffRow = {
  key: string;
  kind: "context" | "add" | "remove" | "gap";
  oldLine: number | null;
  newLine: number | null;
  content: string;
};

export function FocusedDiff({
  before,
  after,
  label = "설계 설명 변경점",
}: {
  before: string;
  after: string;
  label?: string;
}) {
  const rows = buildFocusedDiff(before, after);
  return (
    <div className="sp-reconcile-diff" role="region" aria-label={label}>
      {rows.map((row) => (
        <div key={row.key} className={`sp-reconcile-diff-line is-${row.kind}`}>
          <span className="sp-reconcile-diff-number">{row.oldLine ?? ""}</span>
          <span className="sp-reconcile-diff-number">{row.newLine ?? ""}</span>
          <span className="sp-reconcile-diff-mark">
            {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}
          </span>
          <span className="sp-reconcile-diff-copy">{row.content || " "}</span>
        </div>
      ))}
    </div>
  );
}

function buildFocusedDiff(before: string, after: string): DiffRow[] {
  const allRows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  let sequence = 0;

  for (const part of diffLines(before, after)) {
    const lines = part.value.split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const content of lines) {
      const kind = part.added ? "add" : part.removed ? "remove" : "context";
      allRows.push({
        key: `${sequence}-${kind}-${oldLine}-${newLine}`,
        kind,
        oldLine: part.added ? null : oldLine,
        newLine: part.removed ? null : newLine,
        content,
      });
      sequence += 1;
      if (!part.added) oldLine += 1;
      if (!part.removed) newLine += 1;
    }
  }

  const changed = allRows
    .map((row, index) => (row.kind === "context" ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length === 0) return allRows;

  const keep = new Set<number>();
  for (const index of changed) {
    for (let offset = -3; offset <= 3; offset += 1) {
      const target = index + offset;
      if (target >= 0 && target < allRows.length) keep.add(target);
    }
  }

  const focused: DiffRow[] = [];
  let previousIndex = -2;
  for (const index of [...keep].sort((left, right) => left - right)) {
    if (index > previousIndex + 1) {
      focused.push({
        key: `gap-${previousIndex}-${index}`,
        kind: "gap",
        oldLine: null,
        newLine: null,
        content: `… ${index - previousIndex - 1}개 동일 줄 생략 …`,
      });
    }
    focused.push(allRows[index]);
    previousIndex = index;
  }
  return focused;
}

