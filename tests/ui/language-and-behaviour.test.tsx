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
import { ClinicHeader } from '../../apps/web/src/screens/clinic-header.js';
import { CurrentTask } from '../../apps/web/src/screens/current-task.js';
import { Clinic } from '../../apps/web/src/screens/clinic.js';
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
  clinic: null,
  opening: { total: 5, done: 3, complete: false },
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
    // The most urgent unblocked task is lifted out into "Happening now", so
    // the list below holds what is still to come.
    render(<Today day={day} onOpenTask={() => {}} onRefresh={() => {}} />);
    expect(screen.getByText('Check the emergency kit')).toBeDefined();
    expect(visibleText()).not.toMatch(NEVER_ON_SCREEN);
  });

  it('the task sheet shows the blocking message in plain words', () => {
    render(<TaskSheetScreen sheet={sheet} onBack={() => {}} onFinished={() => {}} />);
    expect(screen.getByText("We can't confirm the emergency kit list yet")).toBeDefined();
    expect(visibleText()).not.toMatch(NEVER_ON_SCREEN);
  });

  it('Attention renders severity as words a person would say', () => {
    render(<Attention items={attention} onResolved={() => {}} />);
    expect(screen.getByText('Patient Safety')).toBeDefined();
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
    expect(screen.getByText('Patient Safety')).toBeDefined();                  // how serious
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
  /** The check screen loads what was recorded; stub it for these. */
  function stubDetail(items = [
    { id: 'i1', label: 'Every room clean', checked: true, value: null, unit: null },
    { id: 'i2', label: 'Instruments laid out', checked: false, value: null, unit: null },
  ]) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          id: 'c', title: 'Get treatment rooms ready', standard: null,
          completedAt: new Date().toISOString(), items,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ));
  }

  it('offers both answers, once the work is on screen', async () => {
    stubDetail();
    render(<Checks items={checks} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Get treatment rooms ready'));
    await waitFor(() => expect(screen.getByText('Every room clean')).toBeDefined());
    expect(screen.getByRole('button', { name: 'Looks right' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Not right' })).toBeDefined();
  });

  it('sending work back requires saying what was wrong', async () => {
    stubDetail();
    render(<Checks items={checks} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Get treatment rooms ready'));
    await waitFor(() => expect(screen.getByText('Every room clean')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Not right' }));
    expect(screen.getByRole('button', { name: 'Send it back' }).hasAttribute('disabled')).toBe(true);
  });

  it('Q5: shows every item as recorded, including the ones NOT ticked', async () => {
    stubDetail();
    render(<Checks items={checks} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Get treatment rooms ready'));

    await waitFor(() => expect(screen.getByText('What was recorded')).toBeDefined());
    expect(screen.getByText('Every room clean')).toBeDefined();
    // The unticked one is the whole point — it must not be quietly omitted.
    expect(screen.getByText('Instruments laid out')).toBeDefined();
    expect(visibleText()).not.toMatch(NEVER_ON_SCREEN);
  });

  it('Q5: cannot confirm before the work has actually loaded', () => {
    // A confirmation given before seeing anything is exactly what Q5 exists
    // to prevent, so the button waits.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    render(<Checks items={checks} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Get treatment rooms ready'));
    expect(screen.getByRole('button', { name: 'Looks right' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('where the clinic is', () => {
  const clinic = {
    name: 'KB Dental Andheri',
    timezone: 'Asia/Kolkata',
    phase: 'OPENING' as const,
    opening: { total: 5, done: 3, complete: false },
    readyBy: new Date(Date.now() + 13 * 60_000).toISOString(),
    firstPatientAt: null,
  };

  it('answers where I am, what phase, whether we are ready, and how long is left', () => {
    render(<ClinicHeader clinic={clinic} />);
    expect(screen.getByText('KB Dental Andheri')).toBeDefined();   // where
    expect(screen.getByText(/Good (morning|afternoon|evening)/)).toBeDefined();
    expect(screen.getByText('Clinic opening')).toBeDefined();      // what phase
    expect(screen.getByText('3 of 5 areas ready')).toBeDefined();  // are we ready
    expect(screen.getByText('13 minutes left')).toBeDefined();     // how long
    expect(visibleText()).not.toMatch(NEVER_ON_SCREEN);
  });

  it('says when the clinic is running late, rather than counting down past zero', () => {
    const late = { ...clinic, readyBy: new Date(Date.now() - 20 * 60_000).toISOString() };
    render(<ClinicHeader clinic={late} />);
    expect(screen.getByText('20 minutes late')).toBeDefined();
  });

  it('reads the clinic’s own clock, not the viewer’s', () => {
    // A manager looking from home, or a tablet on the wrong zone, must still
    // see the clinic's time. 03:30 UTC is 09:00 in Kolkata.
    const at = { ...clinic, readyBy: '2026-07-29T03:30:00.000Z' };
    render(<ClinicHeader clinic={at} />);
    expect(screen.getByText('09:00 AM')).toBeDefined();
  });

  it('never implies readiness when there is no opening set today', () => {
    const closed = { ...clinic, phase: null, opening: null, readyBy: null };
    render(<ClinicHeader clinic={closed} />);
    expect(screen.getByText('No opening scheduled today')).toBeDefined();
    expect(screen.queryByText('Clinic open')).toBeNull();
    expect(screen.queryByText(/areas ready/)).toBeNull();
  });

  it('shows no first-patient time while appointments are not integrated', () => {
    // The most trusted wrong number on the screen would be an invented one.
    render(<ClinicHeader clinic={clinic} />);
    expect(screen.queryByText('First patient')).toBeNull();
  });

  it('shows a first-patient countdown once that time is real', () => {
    const withPatient = {
      ...clinic,
      firstPatientAt: new Date(Date.now() + 13 * 60_000).toISOString(),
    };
    render(<ClinicHeader clinic={withPatient} />);
    expect(screen.getByText('First patient')).toBeDefined();
  });
});

describe('the thing happening now is already open', () => {
  const inline: TaskSheet = {
    ...sheet,
    id: 'cur',
    title: 'Open the clinic',
    cantConfirm: null,
    canOverrideBlock: false,
    items: [
      { id: 'a', label: 'Main entrance open', requiresValue: false, unit: null, checked: false, value: null },
      { id: 'b', label: 'Floors unlocked', requiresValue: false, unit: null, checked: false, value: null },
    ],
  };

  it('opens the current task on Today, so starting work costs no taps', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(inline), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));

    render(<CurrentTask taskId="cur" onOpenFull={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText('Open the clinic')).toBeDefined());
    // The checklist is on screen without anyone having pressed anything.
    expect(screen.getByText('Main entrance open')).toBeDefined();
    expect(screen.getByText('0 of 2 done')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Finish' }).hasAttribute('disabled')).toBe(true);
  });

  it('hands anything that needs explaining to the full screen, rather than cramping it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({ ...inline, cantConfirm: "We can't confirm the emergency kit list yet" }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ));

    render(<CurrentTask taskId="cur" onOpenFull={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open this' })).toBeDefined());
    // Still the one thing in front of you — it just does not pretend to be simple.
    expect(screen.getByText('Happening now')).toBeDefined();
    expect(screen.queryByText('Main entrance open')).toBeNull();
  });
});

describe('VS-02 — the day, as people', () => {
  const schedule = {
    periodKey: '2026-07-29',
    timezone: 'Asia/Kolkata',
    rows: [
      {
        id: 'a1', patientLabel: 'SYNTHETIC Meera J.', patientUhid: 'SYN-1001',
        visitType: 'Check-up', chairLabel: 'Chair 1',
        scheduledStart: '2026-07-29T04:00:00.000Z', scheduledEnd: '2026-07-29T04:30:00.000Z',
        status: 'ARRIVED' as const, statusLabel: 'Waiting',
        waitingMinutes: 22, arrivedAt: '2026-07-29T04:00:00.000Z',
      },
      {
        id: 'a2', patientLabel: 'SYNTHETIC Arjun P.', patientUhid: 'SYN-1002',
        visitType: 'Root canal', chairLabel: 'Chair 2',
        scheduledStart: '2026-07-29T04:30:00.000Z', scheduledEnd: '2026-07-29T05:15:00.000Z',
        status: 'BOOKED' as const, statusLabel: 'Expected',
        waitingMinutes: null, arrivedAt: null,
      },
    ],
  };

  it('answers the front desk’s actual question: who is here, who is next', () => {
    render(<Clinic schedule={schedule} canAct onChanged={() => {}} />);
    expect(screen.getByText(/2 still to see · 1 waiting · 0 in the chair/)).toBeDefined();
    expect(screen.getByText('SYNTHETIC Meera J.')).toBeDefined();
    expect(screen.getByText('Waiting')).toBeDefined();
    expect(visibleText()).not.toMatch(NEVER_ON_SCREEN);
    // Never a status token on screen.
    expect(visibleText()).not.toMatch(/\bBOOKED\b|\bIN_CHAIR\b|\bNO_SHOW\b/);
  });

  it('calls out somebody who has been waiting too long', () => {
    render(<Clinic schedule={schedule} canAct onChanged={() => {}} />);
    expect(screen.getByText('waiting 22 min')).toBeDefined();
  });

  it('shows clinic time, not the viewer’s', () => {
    // 04:00 UTC is 09:30 in Kolkata.
    render(<Clinic schedule={schedule} canAct onChanged={() => {}} />);
    expect(screen.getByText('09:30 AM')).toBeDefined();
  });

  it('offers one press to move a visit along, and the right one for its state', () => {
    render(<Clinic schedule={schedule} canAct onChanged={() => {}} />);
    expect(screen.getByRole('button', { name: 'Taken through' })).toBeDefined(); // waiting
    expect(screen.getByRole('button', { name: 'They’re here' })).toBeDefined();  // expected
  });

  it('offers no actions to someone whose job this is not', () => {
    render(<Clinic schedule={schedule} canAct={false} onChanged={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Taken through' })).toBeNull();
    // They can still see the day, which is the point of showing it to them.
    expect(screen.getByText('SYNTHETIC Meera J.')).toBeDefined();
  });
});

describe('the clinic header, once the day is real', () => {
  const base = {
    name: 'KB Dental Andheri',
    timezone: 'Asia/Kolkata',
    phase: 'OPENING' as const,
    opening: { total: 5, done: 2, complete: false },
    readyBy: new Date(Date.now() + 20 * 60_000).toISOString(),
    firstPatientAt: new Date(Date.now() + 35 * 60_000).toISOString(),
  };

  it('counts down to the first patient', () => {
    render(<ClinicHeader clinic={base} />);
    expect(screen.getByText('First patient')).toBeDefined();
    expect(screen.getByText('35 minutes left')).toBeDefined();
  });

  it('a patient already past their time never reads as neutral', () => {
    const late = { ...base, firstPatientAt: new Date(Date.now() - 40 * 60_000).toISOString() };
    render(<ClinicHeader clinic={late} />);
    const el = screen.getByText('40 minutes late');
    expect(el.className).toContain('is-late');
  });

  it('says nothing about a first patient when nobody is left today', () => {
    const none = { ...base, firstPatientAt: null };
    render(<ClinicHeader clinic={none} />);
    expect(screen.queryByText('First patient')).toBeNull();
  });
});

describe('the review decisions, on screen', () => {
  it('Q4: severity reads as what is being asked of you', () => {
    const rows: AttentionRow[] = [
      { ...attention[0]!, id: 'a', severity: 'PATIENT_SAFETY' },
      { ...attention[0]!, id: 'b', severity: 'CRITICAL', headline: 'Autoclave cycle failed' },
      { ...attention[0]!, id: 'c', severity: 'IMPORTANT', headline: 'Gloves running low' },
      { ...attention[0]!, id: 'd', severity: 'ROUTINE', headline: 'Waste collection due' },
    ];
    render(<Attention items={rows} onResolved={() => {}} />);
    expect(screen.getByText('Patient Safety')).toBeDefined();
    expect(screen.getByText('Needs Immediate Action')).toBeDefined();
    expect(screen.getByText('Needs Attention')).toBeDefined();
    expect(screen.getByText('Routine')).toBeDefined();
  });

  it('shows progress through the checklist, and counts up as items are ticked', () => {
    render(<TaskSheetScreen sheet={sheet} onBack={() => {}} onFinished={() => {}} />);
    expect(screen.getByText('0 of 2 done')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Oxygen cylinder/ }));
    expect(screen.getByText('1 of 2 done')).toBeDefined();
  });

  it('confirms the clinic is open, as the clinic\'s state rather than a notice', () => {
    // The confirmation belongs in the header: it is a fact about the clinic,
    // not one more line in somebody's list.
    const openClinic = {
      name: 'KB Dental Andheri', timezone: 'Asia/Kolkata', phase: 'OPEN' as const,
      opening: { total: 5, done: 5, complete: true },
      readyBy: new Date().toISOString(), firstPatientAt: null,
    };
    render(<ClinicHeader clinic={openClinic} />);
    expect(screen.getByText('Clinic open')).toBeDefined();
    expect(screen.getByText('5 of 5 areas ready')).toBeDefined();
    // Nothing left to count down to once it is open.
    expect(screen.queryByText('Ready by')).toBeNull();
  });

  it('says "seeing patients" once someone is actually in the chair', () => {
    const busy = {
      name: 'KB Dental Andheri', timezone: 'Asia/Kolkata', phase: 'SEEING_PATIENTS' as const,
      opening: { total: 5, done: 5, complete: true },
      readyBy: new Date().toISOString(),
      firstPatientAt: new Date(Date.now() + 25 * 60_000).toISOString(),
    };
    render(<ClinicHeader clinic={busy} />);
    expect(screen.getByText('Seeing patients')).toBeDefined();
    // "First" would be wrong once the day is underway.
    expect(screen.getByText('Next patient')).toBeDefined();
    expect(screen.queryByText('First patient')).toBeNull();
  });

  it('never says open while opening is only partly done', () => {
    const partly = {
      name: 'KB Dental Andheri', timezone: 'Asia/Kolkata', phase: 'OPENING' as const,
      opening: { total: 5, done: 3, complete: false },
      readyBy: new Date().toISOString(), firstPatientAt: null,
    };
    render(<ClinicHeader clinic={partly} />);
    expect(screen.getByText('Clinic opening')).toBeDefined();
    expect(screen.queryByText('Clinic open')).toBeNull();
  });
});
