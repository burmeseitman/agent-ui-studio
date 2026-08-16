export type DiffOp = 'context' | 'add' | 'remove';

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** 1-based line number in the original file, when the line exists there. */
  oldLine?: number;
  /** 1-based line number in the new file, when the line exists there. */
  newLine?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
}

/**
 * Longest common subsequence over lines, the standard basis for a text diff.
 *
 * Cost is O(n·m), which is fine for approval previews: inputs are capped by the
 * caller, and anything larger is not something a human should be eyeballing in
 * a dialog anyway.
 */
function lcsTable(a: string[], b: string[]): Uint32Array {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + (j + 1)] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }
  return table;
}

/** Produces a line-by-line diff between two texts. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.length === 0 ? [] : oldText.split('\n');
  const b = newText.length === 0 ? [] : newText.split('\n');

  const width = b.length + 1;
  const table = lcsTable(a, b);
  const out: DiffLine[] = [];

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'context', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      out.push({ op: 'remove', text: a[i], oldLine: i + 1 });
      i++;
    } else {
      out.push({ op: 'add', text: b[j], newLine: j + 1 });
      j++;
    }
  }
  while (i < a.length) {
    out.push({ op: 'remove', text: a[i], oldLine: i + 1 });
    i++;
  }
  while (j < b.length) {
    out.push({ op: 'add', text: b[j], newLine: j + 1 });
    j++;
  }

  return out;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  return lines.reduce<DiffStats>(
    (acc, line) => {
      if (line.op === 'add') acc.added++;
      if (line.op === 'remove') acc.removed++;
      return acc;
    },
    { added: 0, removed: 0 }
  );
}

/**
 * Collapses long runs of unchanged lines, keeping `context` lines either side of
 * each change, the way a unified diff does.
 */
export function collapseContext(lines: DiffLine[], context = 3): Array<DiffLine | { op: 'skip'; count: number }> {
  const keep = new Array<boolean>(lines.length).fill(false);

  lines.forEach((line, index) => {
    if (line.op === 'context') return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) {
      keep[k] = true;
    }
  });

  const out: Array<DiffLine | { op: 'skip'; count: number }> = [];
  let skipped = 0;

  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) {
        out.push({ op: 'skip', count: skipped });
        skipped = 0;
      }
      out.push(line);
    } else {
      skipped++;
    }
  });

  if (skipped > 0) {
    out.push({ op: 'skip', count: skipped });
  }

  return out;
}
