import { describe, expect, it } from 'vitest';
import { hljs, resolveLanguage } from './highlight';

describe('resolveLanguage', () => {
  it('resolves registered grammars', () => {
    expect(resolveLanguage('go')).toBe('go');
    expect(resolveLanguage('python')).toBe('python');
    expect(resolveLanguage('TypeScript')).toBe('typescript');
  });

  it('maps common markdown fence aliases', () => {
    expect(resolveLanguage('ts')).toBe('typescript');
    expect(resolveLanguage('tsx')).toBe('typescript');
    expect(resolveLanguage('sh')).toBe('bash');
    expect(resolveLanguage('yml')).toBe('yaml');
    expect(resolveLanguage('html')).toBe('xml');
    expect(resolveLanguage('c++')).toBe('cpp');
  });

  it('returns null for unregistered languages instead of throwing', () => {
    // The subset build cannot highlight everything; callers fall back cleanly.
    expect(resolveLanguage('brainfuck')).toBeNull();
    expect(resolveLanguage('')).toBeNull();
    expect(resolveLanguage(undefined)).toBeNull();
  });

  it('escapes HTML in highlighted output', () => {
    const highlighted = hljs.highlight('<script>alert(1)</script>', { language: 'javascript' }).value;
    expect(highlighted).not.toContain('<script>');
    expect(highlighted).toContain('&lt;');
  });
});
