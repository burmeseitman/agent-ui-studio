import { describe, expect, it } from 'vitest';
import { createSession, deriveTitle, saveSessions, updateSessionMessages } from './sessions';
import { ChatMessage } from '../types';

const msg = (role: ChatMessage['role'], content: string, id = `${role}-${content}`): ChatMessage => ({
  id,
  role,
  content,
  timestamp: 0,
});

describe('deriveTitle', () => {
  it('uses the first user message', () => {
    expect(deriveTitle([msg('assistant', 'hi there'), msg('user', 'explain generics')])).toBe(
      'explain generics'
    );
  });

  it('collapses whitespace and truncates long prompts', () => {
    const title = deriveTitle([msg('user', `a  very\n\nlong ${'x'.repeat(80)}`)])!;
    expect(title.length).toBeLessThanOrEqual(49);
    expect(title).toContain('a very long');
    expect(title.endsWith('…')).toBe(true);
  });

  it('returns null when the user has not said anything yet', () => {
    expect(deriveTitle([])).toBeNull();
    expect(deriveTitle([msg('user', '   ')])).toBeNull();
  });
});

describe('updateSessionMessages', () => {
  it('replaces messages and names an untitled session after the first prompt', () => {
    const session = createSession();
    const updated = updateSessionMessages([session], session.id, [msg('user', 'why is it slow?')]);

    expect(updated[0].messages).toHaveLength(1);
    expect(updated[0].title).toBe('why is it slow?');
  });

  it('keeps a title the user has already set', () => {
    const session = { ...createSession(), title: 'Perf investigation' };
    const updated = updateSessionMessages([session], session.id, [msg('user', 'something else')]);
    expect(updated[0].title).toBe('Perf investigation');
  });

  it('leaves other sessions untouched', () => {
    const a = createSession();
    const b = createSession();
    const updated = updateSessionMessages([a, b], a.id, [msg('user', 'hi')]);
    expect(updated[1]).toBe(b);
  });
});

describe('saveSessions', () => {
  it('caps how many conversations are retained, keeping the most recent', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...createSession(),
      title: `chat ${i}`,
      updatedAt: i,
    }));

    const saved = saveSessions(many);
    expect(saved.length).toBeLessThanOrEqual(30);
    expect(saved[0].title).toBe('chat 39');
    expect(saved.some((s) => s.title === 'chat 0')).toBe(false);
  });

  it('caps messages within a single conversation', () => {
    const huge = {
      ...createSession(),
      messages: Array.from({ length: 250 }, (_, i) => msg('user', `m${i}`, `id-${i}`)),
    };

    const saved = saveSessions([huge]);
    expect(saved[0].messages.length).toBeLessThanOrEqual(100);
    // The newest messages are the ones kept.
    expect(saved[0].messages.at(-1)?.content).toBe('m249');
  });
});

describe('updateSessionMessages targeting', () => {
  it('is a no-op when the id matches nothing', () => {
    // The regression: an active id of '' silently discarded every save while the
    // UI kept showing the first session, so the chat looked fine until reload.
    const session = createSession();
    const updated = updateSessionMessages([session], '', [msg('user', 'hello')]);

    expect(updated[0].messages).toHaveLength(0);
    expect(updated[0]).toEqual(session);
  });

  it('persists messages when the id matches', () => {
    const session = createSession();
    const updated = updateSessionMessages([session], session.id, [msg('user', 'hello')]);
    expect(updated[0].messages).toHaveLength(1);
  });
});
