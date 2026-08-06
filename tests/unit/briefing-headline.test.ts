/**
 * The bug the owner found by using the app, held down by tests.
 *
 * *"a lot of glitches for an assistant — if there is something missing in
 * sterilization and it says take me to it, it goes there but cannot do
 * anything."*
 *
 * The first test below is that exact sequence. It failed before the fix.
 */
import { describe, it, expect } from 'vitest';
import { headlineFor, isActionable, type HeadlineSection } from '@kubi/contracts';

const task = (text: string, over: Partial<HeadlineSection['items'][0]> = {}) =>
  ({ kind: 'task' as const, text, taskId: `t-${text}`, ...over });
const fact = (text: string, owner: string | null = null) =>
  ({ kind: 'fact' as const, text, owner });

describe("the assistant's sterilisation section, which is what was reported", () => {
  const sections: HeadlineSection[] = [
    { key: 'opening', label: 'Before the first patient', tone: 'GREEN', items: [] },
    {
      key: 'ster',
      label: 'Sterilisation in the loop',
      tone: 'RED',
      items: [fact('STER-0911', 'sterilisation technician')],
    },
    { key: 'closing', label: 'Closing', tone: 'AMBER', items: [task('Wipe the chairs')] },
  ];

  it('offers no button into a section holding nothing they can press', () => {
    // The whole bug in one assertion. Before the fix this was 'ster', and the
    // button scrolled to a red wall.
    expect(headlineFor(sections).action).toBeNull();
  });

  it('says who it is with instead', () => {
    const h = headlineFor(sections);
    expect(h.waitingOn).toBe('sterilisation technician');
    expect(h.why).toContain('with the sterilisation technician');
  });

  it('still names the most serious thing, rather than finding one with a button', () => {
    // The tempting shortcut: headline "Closing" instead, because Closing has
    // something pressable. That trades a dead button for a false statement
    // about the clinic, which is worse and harder to spot.
    const h = headlineFor(sections);
    expect(h.verdict).toBe('Sterilisation in the loop');
    expect(h.tone).toBe('RED');
  });

  it('says plainly when nobody owns it either', () => {
    const orphan = sections.map((s) =>
      (s.key === 'ster' ? { ...s, items: [fact('STER-0911')] } : s));
    const h = headlineFor(orphan);
    expect(h.action).toBeNull();
    expect(h.waitingOn).toBeNull();
    expect(h.why).toContain('Nothing here is yours to do');
  });
});

describe('when there is something to do, it still offers it', () => {
  it('points at the worst section that has a real task in it', () => {
    const h = headlineFor([
      { key: 'opening', label: 'Before the first patient', tone: 'RED', items: [task('Autoclave test')] },
      { key: 'closing', label: 'Closing', tone: 'AMBER', items: [task('Wipe the chairs')] },
    ]);
    expect(h.action).toBe('opening');
    expect(h.waitingOn).toBeNull();
  });

  it('offers it when a section mixes facts with one real task', () => {
    const h = headlineFor([{
      key: 'mixed',
      label: 'Mixed',
      tone: 'RED',
      items: [fact('A batch somebody else owns', 'technician'), task('Something of yours')],
    }]);
    expect(h.action).toBe('mixed');
  });

  it('prefers RED over AMBER, and the earlier section within a tone', () => {
    const h = headlineFor([
      { key: 'a', label: 'A', tone: 'AMBER', items: [task('a')] },
      { key: 'b', label: 'B', tone: 'RED', items: [task('b')] },
      { key: 'c', label: 'C', tone: 'RED', items: [task('c')] },
    ]);
    expect(h.action).toBe('b');
  });

  it('ignores an empty section however loud its tone', () => {
    const h = headlineFor([
      { key: 'loud', label: 'Loud but empty', tone: 'RED', items: [] },
      { key: 'real', label: 'Real', tone: 'AMBER', items: [task('a')] },
    ]);
    expect(h.verdict).toBe('Real');
  });

  it('says all clear when every section is empty', () => {
    const h = headlineFor([{ key: 'a', label: 'A', tone: 'RED', items: [] }]);
    expect(h).toEqual({
      verdict: 'All clear', why: 'Nothing needs you right now.',
      tone: 'GREEN', action: null, waitingOn: null,
    });
  });
});

describe('what counts as something a person can press', () => {
  it('a task with an id', () => {
    expect(isActionable(task('x'))).toBe(true);
  });

  it('never a fact', () => {
    expect(isActionable(fact('x'))).toBe(false);
  });

  it('never a blocked row, however much it looks like a task', () => {
    // Blocked work renders as a lock. Offering it as a button is the same
    // class of lie as the sterilisation one — a promise the screen cannot keep.
    expect(isActionable(task('x', { blockedBy: 'the autoclave cycle' }))).toBe(false);
  });

  it('never a task with no id to open', () => {
    expect(isActionable(task('x', { taskId: null }))).toBe(false);
  });
});
