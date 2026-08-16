import { describe, expect, it } from 'vitest';
import { collapseContext, diffLines, diffStats } from './diff';

describe('diffLines', () => {
  it('reports an unchanged file as all context', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc');
    expect(lines.every((l) => l.op === 'context')).toBe(true);
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0 });
  });

  it('detects a single changed line as one add and one remove', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc');
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1 });
    expect(lines.find((l) => l.op === 'add')?.text).toBe('B');
    expect(lines.find((l) => l.op === 'remove')?.text).toBe('b');
  });

  it('treats an empty original as an all-new file', () => {
    const lines = diffLines('', 'one\ntwo');
    expect(diffStats(lines)).toEqual({ added: 2, removed: 0 });
  });

  it('treats an empty replacement as a full deletion', () => {
    const lines = diffLines('one\ntwo', '');
    expect(diffStats(lines)).toEqual({ added: 0, removed: 2 });
  });

  it('keeps common lines rather than rewriting the whole file', () => {
    const before = ['package main', '', 'func main() {', '\tprintln("hi")', '}'].join('\n');
    const after = ['package main', '', 'func main() {', '\tprintln("hello")', '}'].join('\n');

    const stats = diffStats(diffLines(before, after));
    // A naive diff would report 5 added and 5 removed.
    expect(stats).toEqual({ added: 1, removed: 1 });
  });

  it('numbers lines against the correct side', () => {
    const lines = diffLines('a\nb', 'a\nx\nb');
    const added = lines.find((l) => l.op === 'add')!;
    expect(added.newLine).toBe(2);
    expect(added.oldLine).toBeUndefined();
  });
});

describe('collapseContext', () => {
  it('collapses long unchanged runs but keeps lines around changes', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 20', 'line twenty');

    const collapsed = collapseContext(diffLines(before, after), 2);
    const skips = collapsed.filter((l) => l.op === 'skip');

    expect(skips.length).toBeGreaterThan(0);
    expect(collapsed.length).toBeLessThan(41);
    // The changed line survives collapsing.
    expect(collapsed.some((l) => 'text' in l && l.text === 'line twenty')).toBe(true);
  });

  it('leaves a small diff untouched', () => {
    const collapsed = collapseContext(diffLines('a\nb', 'a\nc'), 3);
    expect(collapsed.some((l) => l.op === 'skip')).toBe(false);
  });
});
