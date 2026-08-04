/**
 * The patient-triggered library, held to its own rules.
 *
 * The rule that matters most here is negative: this library must never fill
 * in an owner or a standard that the clinic has not decided. Eighty-two of
 * ninety-six tasks arrived with those columns blank, and a plausible guess
 * would look complete, survive review, and name the wrong person the first
 * time something went wrong in a real clinic.
 */
import { describe, it, expect } from 'vitest';
import {
  PATIENT_JOURNEY, STAGE_ORDER, STAGE_LABEL, Stage, RoleCode,
  theJourney, tasksAt, needsOwner, needsStandard, ungovernedTasks,
  journeyActivities, journeyRefersToRealActivities, journeyCompleteness,
} from '../../packages/contracts/src/index.js';

describe('the journey is well formed', () => {
  it('holds the ninety-six tasks the owner wrote', () => {
    expect(PATIENT_JOURNEY).toHaveLength(96);
  });

  it('gives every task a unique id', () => {
    const ids = PATIENT_JOURNEY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places every task in one of the thirteen stages', () => {
    for (const p of PATIENT_JOURNEY) {
      expect(STAGE_ORDER, `${p.id} is in stage ${p.stage}`).toContain(p.stage);
    }
  });

  it('leaves no stage empty', () => {
    for (const s of theJourney()) {
      expect(s.tasks.length, `${s.label} is empty`).toBeGreaterThan(0);
    }
  });

  it('names every stage in words a person would say', () => {
    for (const s of STAGE_ORDER) {
      expect(STAGE_LABEL[s]).toBeTruthy();
      expect(STAGE_LABEL[s]).not.toBe(s);
    }
  });

  it('keeps the thirteen stages in the order care actually happens', () => {
    const at = (s: Stage) => STAGE_ORDER.indexOf(s);
    // Identity before consent, consent before the procedure, procedure before
    // billing, follow-up before the case can be closed.
    expect(at(Stage.SEATED)).toBeLessThan(at(Stage.BEFORE_PROCEDURE));
    expect(at(Stage.BEFORE_PROCEDURE)).toBeLessThan(at(Stage.DURING_PROCEDURE));
    expect(at(Stage.DURING_PROCEDURE)).toBeLessThan(at(Stage.BILLING));
    expect(at(Stage.FOLLOW_UP)).toBeLessThan(at(Stage.COMPLETION));
  });

  it('accounts for every task exactly once across the stages', () => {
    const total = theJourney().reduce((n, s) => n + s.tasks.length, 0);
    expect(total).toBe(PATIENT_JOURNEY.length);
  });
});

describe('nothing is invented', () => {
  it('records what the owner specified, and only that', () => {
    // Stages 1 and 2 came with a Responsible and a KPI against every task.
    // Every other stage came with those columns blank.
    for (const p of tasksAt(Stage.BOOKED)) {
      expect(p.role, `${p.id} lost its role`).not.toBeNull();
      expect(p.kpi, `${p.id} lost its KPI`).not.toBeNull();
    }
    for (const p of tasksAt(Stage.ARRIVES)) {
      expect(p.role, `${p.id} lost its role`).not.toBeNull();
      expect(p.kpi, `${p.id} lost its KPI`).not.toBeNull();
    }
    for (const p of tasksAt(Stage.DIAGNOSIS)) {
      expect(p.role, `${p.id} was given an owner nobody decided`).toBeNull();
      expect(p.kpi, `${p.id} was given a standard nobody set`).toBeNull();
    }
  });

  it('assigns only roles that actually exist, where one is assigned at all', () => {
    const roles = new Set(Object.values(RoleCode));
    for (const p of PATIENT_JOURNEY) {
      if (p.role === null) continue;
      expect(roles.has(p.role), `${p.id} is assigned to ${p.role}`).toBe(true);
    }
  });

  it('points every control reference at a real activity in the frozen matrix', () => {
    expect(journeyRefersToRealActivities()).toBe(true);
    expect(journeyActivities().length).toBeGreaterThan(0);
  });

  it('never assigns a standard to a task with no owner', () => {
    // A KPI against nobody is a number that cannot fail, because there is
    // nobody it can fail for.
    const orphans = PATIENT_JOURNEY.filter((p) => p.kpi !== null && p.role === null);
    expect(orphans.map((p) => p.id)).toEqual([]);
  });
});

describe('what the clinic still has to decide', () => {
  it('records the honest state, so a change to it is deliberate', () => {
    expect(journeyCompleteness()).toEqual({
      tasks: 96, owned: 14, measured: 14, governed: 49,
    });
  });

  it('has eighty-two tasks with nobody assigned', () => {
    expect(needsOwner()).toHaveLength(82);
    expect(needsStandard()).toHaveLength(82);
  });

  it('cannot escalate an unowned task, which is why the number matters', () => {
    // Stated as the consequence rather than as a count: an escalation ladder
    // needs a doer to start from. Until a task has an owner, nothing happens
    // when it does not happen.
    for (const p of needsOwner()) {
      expect(p.role).toBeNull();
    }
    expect(needsOwner().length).toBeGreaterThan(PATIENT_JOURNEY.length / 2);
  });

  it('leaves every billing task ungoverned, because the domain does not exist', () => {
    const billing = tasksAt(Stage.BILLING);
    expect(billing).toHaveLength(6);
    expect(billing.every((p) => p.covers === null)).toBe(true);
  });

  it('names forty-seven tasks with no control behind them', () => {
    expect(ungovernedTasks()).toHaveLength(47);
  });
});
