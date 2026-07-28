/**
 * What a person actually sees.
 *
 * The journey test proves the SERVER never sends internal vocabulary. That is
 * only half the promise: the screens have plenty of words of their own. This
 * renders each surface and reads the visible text back, so jargon written into
 * a component is caught the same way jargon written into an API response is.
 *
 * It asserts behaviour too, but only behaviour that is genuinely the screen's
 * job — never a rule. Every rule in KuBi belongs to the server, and a test
 * that checked a rule here would be testing the wrong thing in the wrong place.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Today } from '../../apps/web/src/screens/today.js';
import { TaskSheetScreen } from '../../apps/web/src/screens/task-sheet.js';
import { Attention } from '../../apps/web/src/screens/attention.js';
import { Checks } from '../../apps/web/src/screens/checks.js';
import { SignIn } from '../../apps/web/src/screens/sign-in.js';
import type { MyDay, TaskSheet, AttentionRow, CheckRow } from '../../apps/web/src/api.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/**
 * The internal five (WORK / CHECK / PROBLEM / FIX / IMPROVE) and the engine's
 * own nouns are for the design team. Staff see clinic language or nothing.
 */
const NEVER_ON_SCREEN =
  /\b(activity|instance|exception|escalation|taxonomy|enum|gate|trigger|tenant|RLS|permission|evaluation|NOT_CONFIGURED|UNKNOWN|BLOCK_HARD|BLOCK_OVERRIDABLE|PATIENT_SAFETY|IN_PROGRESS)\b/i;

function visibleText(): string {
  return document.body.textContent ?? '';
}

const day: MyDay = {
  buckets: {
    OVERDUE: [{
      id: 'a', title: 'Open the clinic', standard: 'Before the first patient arrives',
      dueAt: new Date().toISOString(), status: 'OVERDUE', started: false, blockedBy: null,
    }],
    NOW: [{
      id: 'b', title: 'Check the emergency kit', standard: null,
      dueAt: new Date().toISOString(), status: 'DUE', started: false,
      blockedBy: 'Oxygen cylinder is not working',
    }],
    NEXT: [], LATER: [],
  },
  attentionCount: 1,
};

const sheet: TaskSheet = {
  id: 'b',
  title: 'Check the emergency kit',
  standard: 'Everything in the kit, present and working',
  status: 'DUE',
  dueAt: new Date().toISOString(),
  isMine: true,
  needsSomeoneElseToCheck: true,
  items: [
    { id: 'i1', label: 'Oxygen cylinder', requiresValue: false, unit: null, checked: false, value: null },
    { id: 'i2', label: 'Room temperature', requiresValue: true, unit: '°C', checked: false, value: null },
  ],
  cantConfirm: "We can't confirm the emergency kit list yet",
  canOverrideBlock: true,
  blockedBy: null,
  problemKinds: [
    { key: 'NOT_WORKING', label: 'Not working' },
    { key: 'MISSING', label: 'Missing' },
  ],
};

const attention: AttentionRow[] = [{
  id: 'x', headline: 'Oxygen cylinder is not working', severity: 'PATIENT_SAFETY',
  detail: 'Pressure reads low', mine: true,
  dueAt: new Date(Date.now() + 30 * 60_000).toISOString(), escalated: false,
}];

const checks: CheckRow[] = [{
  id: 'c', title: 'Get treatment rooms ready',
  completedAt: new Date().toISOString(), standard: 'Every room set up for the first patient',
}];

describe('the screens speak clinic language, never the engine’s', () => {
  it('Today shows the work without jargon', () => {
    render(<Today day={day} onOpenTask={() => {}} />);
    expect(screen.getByText('Open the clinic')).toBeDefined();
    expect(visibleText()).not.toMatch(NEVER_ON_SCREEN);
  });

  it('the task sheet shows the blocking message in plain words', () => {
    render(<TaskSheetScreen sheet={sheet} onBack={() => {}} onFinished={() => {}} />);
    expect(screen.getByText("We can't confirm the emergency kit list yet")).toBeDefined();
    expect(visibleText()).not.toMatch(NEVER_ON_SCREEN);
  });

  it('Attention renders severity as words a person would say', () => {
    render(<Attention items={attention} onResolved={() => {}} />);
    expect(screen.getByText('Patient safety')).toBeDefined();
    expect(visibleText()).not.toMatch(NEVER_ON_SCREEN);
  });

  it('Checks reads as a second pair of eyes, not a verification step', () => {
    render(<Checks items={checks} onDone={() => {}} />);
    expect(screen.getByText('Get treatment rooms ready')).toBeDefined();
    expect(visibleText()).not.toMatch(NEVER_ON_SCREEN);
  });

  it('sign in offers two fields and one button', () => {
    render(<SignIn onSignedIn={() => {}} />);
    expect(screen.getByLabelText('Email')).toBeDefined();
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDefined();
    expect(visibleText()).not.toMatch(NEVER_ON_SCREEN);
  });
});

describe('the task sheet behaves the way the person was promised', () => {
  it('says someone else will check BEFORE the work starts', () => {
    render(<TaskSheetScreen sheet={sheet} onBack={() => {}} onFinished={() => {}} />);
    // Present on first paint, not after finishing.
    expect(screen.getByText(/someone else will confirm this/i)).toBeDefined();
    expect(screen.getByText(/don’t\s+need to find anyone/i)).toBeDefined();
  });

  it('keeps Report a problem one press away at all times', () => {
    render(<TaskSheetScreen sheet={sheet} onBack={() => {}} onFinished={() => {}} />);
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeDefined();
  });

  it('a blocked task shows what it is waiting on and that nobody needs chasing', () => {
    const blocked = { ...sheet, blockedBy: 'Oxygen cylinder is not working', cantConfirm: null };
    render(<TaskSheetScreen sheet={blocked} onBack={() => {}} onFinished={() => {}} />);
    expect(screen.getByText(/This is on hold/i)).toBeDefined();
    expect(screen.getByText(/you.{0,3}don.{0,3}t need to chase it/i)).toBeDefined();
  });

  it("when the server refuses, it offers both ways forward — never a dead end", async () => {
    // The server is the one that refuses; the screen's job is to carry the
    // refusal honestly and give the person somewhere to go.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/start')) return new Response('{}', { status: 200 });
      return new Response(
        JSON.stringify({ error: "We can't confirm the emergency kit list yet. Report a problem, or record why it is safe to go ahead.", canOverride: true }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    });

    render(<TaskSheetScreen sheet={sheet} onBack={() => {}} onFinished={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Oxygen cylinder/ }));
    fireEvent.click(screen.getByRole('button', { name: /Room temperature/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() => expect(screen.getByText('Before you finish')).toBeDefined());
    // Both doors are open, and reporting is offered first.
    expect(screen.getByRole('button', { name: 'Report a problem instead' })).toBeDefined();
    expect(screen.getByRole('button', { name: /Go ahead and finish/ })).toBeDefined();
    // Going ahead is impossible without saying how it was checked.
    expect(screen.getByRole('button', { name: /Go ahead and finish/ }).hasAttribute('disabled')).toBe(true);
    expect(visibleText()).not.toMatch(NEVER_ON_SCREEN);
  });

  it('does not let someone go ahead with an empty reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/start')) return new Response('{}', { status: 200 });
      return new Response(
        JSON.stringify({ error: "We can't confirm the emergency kit list yet.", canOverride: true }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    });

    render(<TaskSheetScreen sheet={sheet} onBack={() => {}} onFinished={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Oxygen cylinder/ }));
    fireEvent.click(screen.getByRole('button', { name: /Room temperature/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(screen.getByText('Before you finish')).toBeDefined());

    const go = screen.getByRole('button', { name: /Go ahead and finish/ });
    fireEvent.change(screen.getByPlaceholderText('How did you check?'), { target: { value: '   ' } });
    expect(go.hasAttribute('disabled')).toBe(true);
  });
});

describe('Attention answers the five questions a person actually has', () => {
  it('shows what happened, how serious, whose it is, and by when', () => {
    render(<Attention items={attention} onResolved={() => {}} />);
    expect(screen.getByText('Oxygen cylinder is not working')).toBeDefined(); // what
    expect(screen.getByText('Patient safety')).toBeDefined();                  // how serious
    expect(screen.getByText('Yours')).toBeDefined();                           // whose
    expect(screen.getByText(/Needed within \d+ min/)).toBeDefined();           // by when
  });

  it('will not close an item without saying what was done', () => {
    render(<Attention items={attention} onResolved={() => {}} />);
    fireEvent.click(screen.getByText('Oxygen cylinder is not working'));
    const sorted = screen.getByRole('button', { name: 'Mark as sorted' });
    expect(sorted.hasAttribute('disabled')).toBe(true);
  });
});

describe('Checks makes disagreeing as easy as agreeing', () => {
  it('offers both answers on the first screen', () => {
    render(<Checks items={checks} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Get treatment rooms ready'));
    expect(screen.getByRole('button', { name: 'Looks right' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Not right' })).toBeDefined();
  });

  it('sending work back requires saying what was wrong', () => {
    render(<Checks items={checks} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Get treatment rooms ready'));
    fireEvent.click(screen.getByRole('button', { name: 'Not right' }));
    expect(screen.getByRole('button', { name: 'Send it back' }).hasAttribute('disabled')).toBe(true);
  });
});
