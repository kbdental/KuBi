/**
 * The automation engine and the activity generator.
 *
 * Most of these assert what does NOT happen. An automation engine that fires
 * too much is worse than one that fires too little: a clinic can chase a
 * missing task, but it cannot un-see a list of ninety invented ones, and it
 * stops reading the list after the second false morning.
 */
import { describe, it, expect } from 'vitest';
import {
  RULES, TriggerEvent, ActionKind, fire,
  ACTIVITY_LIBRARY, generateToday, generateForRole, checksForRole, fallsDueToday,
  type GenerationContext, type Rule,
} from '../../packages/contracts/src/index.js';

const openDay = (over: Partial<GenerationContext> = {}): GenerationContext => ({
  today: new Date('2026-08-04T00:00:00Z'), // a Tuesday
  weekday: 2, dayOfMonth: 4, clinicOpen: true, ...over,
});

describe('the automation engine fires the right branch', () => {
  it('runs THEN when the condition holds', () => {
    const out = fire(RULES, TriggerEvent.APPOINTMENT_BOOKED, { hoursUntil: 72 });
    expect(out).toHaveLength(1);
    expect(out[0]!.branch).toBe('THEN');
    expect(out[0]!.actions.map((a) => a.say)).toEqual([
      'Confirm the appointment', 'Prepare the chair', 'Verify consent',
      'Confirm a sterile kit is released', 'Schedule the follow-up',
    ]);
  });

  it('runs ELSE as a deliberate other branch, not a failure', () => {
    // A same-day booking still needs confirming — it just cannot wait for
    // tomorrow morning's round.
    const out = fire(RULES, TriggerEvent.APPOINTMENT_BOOKED, { hoursUntil: 3 });
    expect(out[0]!.branch).toBe('ELSE');
    expect(out[0]!.actions[0]!.say).toMatch(/confirm now/i);
  });

  it('fires rules with no condition every time', () => {
    const out = fire(RULES, TriggerEvent.PROCEDURE_COMPLETED);
    expect(out[0]!.branch).toBe('THEN');
    expect(out[0]!.actions).toHaveLength(4);
  });

  it('does nothing for an event no rule listens for', () => {
    expect(fire(RULES, TriggerEvent.PATIENT_ARRIVED)).toEqual([]);
  });

  it('ignores a disabled rule entirely', () => {
    const off: Rule[] = RULES.map((r) => ({ ...r, enabled: false }));
    expect(fire(off, TriggerEvent.PROCEDURE_COMPLETED)).toEqual([]);
  });

  it('is pure — firing twice gives the same answer', () => {
    const a = fire(RULES, TriggerEvent.LAB_QC_FAILED);
    const b = fire(RULES, TriggerEvent.LAB_QC_FAILED);
    expect(a).toEqual(b);
  });
});

describe('what automation is not allowed to do', () => {
  it('never completes work, only raises, blocks, notifies or escalates', () => {
    // Automation that can tick things off is automation that can hide a
    // failure. This is the assertion that keeps that impossible.
    const kinds = new Set(RULES.flatMap((r) => [...r.then, ...(r.otherwise ?? [])])
      .map((a) => a.kind));
    for (const k of kinds) {
      expect(Object.values(ActionKind)).toContain(k);
    }
    expect([...kinds]).not.toContain('COMPLETE');
  });

  it('sends every action to somebody', () => {
    for (const r of RULES) {
      for (const a of [...r.then, ...(r.otherwise ?? [])]) {
        expect(a.to, `${r.id} has an action with no recipient`).toBeTruthy();
        expect(a.say, `${r.id} has an action that says nothing`).toBeTruthy();
      }
    }
  });

  it('raises only activities that exist in the library', () => {
    // A rule pointing at a missing activity would create work that traces to
    // no standard, which breaks constitution rule 5.
    const ids = new Set(ACTIVITY_LIBRARY.map((a) => a.id));
    for (const r of RULES) {
      for (const a of [...r.then, ...(r.otherwise ?? [])]) {
        if (a.kind !== ActionKind.RAISE) continue;
        expect(ids, `${r.id} raises unknown activity ${a.activityId}`).toContain(a.activityId);
      }
    }
  });

  it('explains any condition in words as well as in code', () => {
    for (const r of RULES) {
      if (r.condition) expect(r.conditionText, `${r.id} has a silent condition`).toBeTruthy();
    }
  });

  it('blocks rather than warns when a lab case fails its check', () => {
    const out = fire(RULES, TriggerEvent.LAB_QC_FAILED);
    expect(out[0]!.actions.some((a) => a.kind === ActionKind.BLOCK)).toBe(true);
  });

  it('quarantines rather than releases when a cycle does not pass', () => {
    const bad = fire(RULES, TriggerEvent.AUTOCLAVE_CYCLE_FINISHED, { result: 'FAIL' });
    expect(bad[0]!.branch).toBe('ELSE');
    expect(bad[0]!.actions.some((a) => a.kind === ActionKind.BLOCK)).toBe(true);

    const good = fire(RULES, TriggerEvent.AUTOCLAVE_CYCLE_FINISHED, { result: 'PASS' });
    expect(good[0]!.actions[0]!.say).toMatch(/may not release their own/i);
  });
});

describe('the generator schedules a day, not the whole library', () => {
  it('generates far fewer than the whole library', () => {
    const today = generateToday(ACTIVITY_LIBRARY, openDay());
    expect(today.length).toBeGreaterThan(0);
    expect(today.length).toBeLessThan(ACTIVITY_LIBRARY.length / 2);
  });

  it('generates nothing at all on a closed day', () => {
    expect(generateToday(ACTIVITY_LIBRARY, openDay({ clinicOpen: false }))).toEqual([]);
  });

  it('only ever generates RECURRING work', () => {
    // Patient events, conditions and gates are raised by things happening. A
    // scheduler that produced them would be inventing patients.
    for (const t of generateToday(ACTIVITY_LIBRARY, openDay())) {
      expect(t.origin, `${t.activityId} was scheduled but is ${t.origin}`).toBe('RECURRING');
    }
  });

  it('never generates an activity whose due rule nobody decided', () => {
    for (const a of ACTIVITY_LIBRARY) {
      if (a.dueRule === null) expect(fallsDueToday(a, openDay())).toBeNull();
    }
  });

  it('holds weekly work to one fixed day', () => {
    const weekly = ACTIVITY_LIBRARY.find(
      (a) => (a.frequency ?? '').toUpperCase() === 'WEEKLY' && a.enabled && a.origin === 'RECURRING',
    );
    if (!weekly) return; // matrix may have none; the rule still stands
    expect(fallsDueToday(weekly, openDay({ weekday: 1 }))).toMatch(/weekly/i);
    // "Some time this week" is how weekly work quietly becomes fortnightly.
    for (const d of [2, 3, 4, 5, 6, 7] as const) {
      expect(fallsDueToday(weekly, openDay({ weekday: d }))).toBeNull();
    }
  });

  it('holds monthly work to the first', () => {
    const monthly = ACTIVITY_LIBRARY.find(
      (a) => (a.frequency ?? '').toUpperCase() === 'MONTHLY' && a.enabled && a.origin === 'RECURRING',
    );
    if (!monthly) return;
    expect(fallsDueToday(monthly, openDay({ dayOfMonth: 1 }))).toBeTruthy();
    expect(fallsDueToday(monthly, openDay({ dayOfMonth: 17 }))).toBeNull();
  });

  it('says why every generated item is on the list', () => {
    for (const t of generateToday(ACTIVITY_LIBRARY, openDay())) {
      expect(t.because, `${t.activityId} appeared without a reason`).toBeTruthy();
    }
  });

  it('puts patient safety first', () => {
    const order = generateToday(ACTIVITY_LIBRARY, openDay()).map((t) => t.priority);
    const rank: Record<string, number> = {
      PATIENT_SAFETY: 0, CRITICAL: 1, IMPORTANT: 2, ROUTINE: 3,
    };
    for (let i = 1; i < order.length; i += 1) {
      expect(rank[order[i]!]!).toBeGreaterThanOrEqual(rank[order[i - 1]!]!);
    }
  });

  it('traces every generated task back to an activity', () => {
    const ids = new Set(ACTIVITY_LIBRARY.map((a) => a.id));
    for (const t of generateToday(ACTIVITY_LIBRARY, openDay())) {
      expect(ids).toContain(t.activityId);
    }
  });
});

describe('the generator splits work by person', () => {
  it('gives a role only its own work', () => {
    const mine = generateForRole(ACTIVITY_LIBRARY, openDay(), 'Dental Assistant');
    for (const t of mine) expect(t.doer).toBe('Dental Assistant');
  });

  it('never asks anybody to check their own work', () => {
    // Separation of duties, enforced at the point work is created rather than
    // at the point somebody tries to sign it off.
    for (const role of ['Dental Assistant', 'Senior Assistant', 'Clinic Manager']) {
      for (const t of checksForRole(ACTIVITY_LIBRARY, openDay(), role)) {
        expect(t.doer, `${role} would check their own ${t.activityId}`).not.toBe(role);
      }
    }
  });
});
