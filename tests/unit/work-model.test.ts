/**
 * Five object types, six engines, four responsibilities.
 *
 * The owner's central correction: **not everything is a checklist.** These are
 * the assertions that stop the five collapsing back into one tickable box,
 * which is what happens the moment the system forgets why work exists.
 */
import { describe, it, expect } from 'vitest';
import {
  TaskOrigin, Engine, ENGINE_EMITS, ORIGIN_LABEL, ENGINE_LABEL,
  ladder, rungAt, STERILIZATION_SAME_DAY,
  type Responsibility,
} from '../../packages/contracts/src/index.js';

describe('the five object types', () => {
  it('are five, and are the five the owner named', () => {
    expect(Object.keys(TaskOrigin).sort()).toEqual(
      ['CONDITION', 'EXCEPTION', 'GATE', 'PATIENT_EVENT', 'RECURRING'],
    );
  });

  it('each says why it exists in words a person would use', () => {
    for (const o of Object.values(TaskOrigin)) {
      expect(ORIGIN_LABEL[o], `${o} has no label`).toBeTruthy();
    }
    // The one that matters most: a gate is not a checklist, and must not
    // read like one.
    expect(ORIGIN_LABEL.GATE).toMatch(/before starting/i);
  });
});

describe('the six engines', () => {
  it('are six, and are the six the owner named', () => {
    expect(Object.keys(Engine).sort()).toEqual(
      ['COMPLIANCE', 'EQUIPMENT', 'EXCEPTION', 'INVENTORY', 'PATIENT_EVENT', 'TIME'],
    );
    for (const e of Object.values(Engine)) expect(ENGINE_LABEL[e]).toBeTruthy();
  });

  it('every engine produces at least one kind of work', () => {
    for (const e of Object.values(Engine)) {
      expect(ENGINE_EMITS[e].length, `${e} produces nothing`).toBeGreaterThan(0);
    }
  });

  it('every kind of work has an engine that produces it', () => {
    // An origin nothing can emit is a type that will never appear — which is
    // how a specified behaviour silently goes missing.
    const emitted = new Set(Object.values(ENGINE_EMITS).flat());
    for (const o of Object.values(TaskOrigin)) {
      expect(emitted, `nothing produces ${o}`).toContain(o);
    }
  });

  it('keeps compliance as the only source of gates', () => {
    // A gate that any engine could raise is a gate anyone could route around.
    const gateEngines = Object.values(Engine)
      .filter((e) => ENGINE_EMITS[e].includes(TaskOrigin.GATE));
    expect(gateEngines).toEqual([Engine.COMPLIANCE]);
  });

  it('lets equipment and inventory both raise condition work', () => {
    // A service date arriving and stock crossing its reorder level are the
    // same shape of event, which is why origin and engine are two fields.
    expect(ENGINE_EMITS.EQUIPMENT).toContain(TaskOrigin.CONDITION);
    expect(ENGINE_EMITS.INVENTORY).toContain(TaskOrigin.CONDITION);
  });
});

describe('four levels of responsibility', () => {
  const r: Responsibility = {
    doer: 'DENTAL_ASSISTANT', checker: 'SENIOR_ASSISTANT',
    owner: 'CLINICAL_DIRECTOR', escalation: 'CLINIC_HEAD',
  } as Responsibility;

  it('builds a three-rung ladder that ends with the escalation role', () => {
    const rungs = ladder(r);
    expect(rungs.map((x) => x.level)).toEqual([1, 2, 3]);
    expect(rungs[2]!.to).toBe('CLINIC_HEAD');
  });

  it('rises in time, never sideways', () => {
    const rungs = ladder(r);
    expect(rungs[0]!.afterMinutes).toBeLessThan(rungs[1]!.afterMinutes);
    expect(rungs[1]!.afterMinutes).toBeLessThan(rungs[2]!.afterMinutes);
  });

  it('falls back to the owner when nobody checks, rather than skipping a rung', () => {
    // Self-verified work still has to escalate to somebody above the doer.
    const solo = ladder({ ...r, checker: null });
    expect(solo[1]!.to).toBe('CLINICAL_DIRECTOR');
    expect(solo).toHaveLength(3);
  });

  it('reports no rung before the first is reached', () => {
    expect(rungAt(ladder(r), 0)).toBeNull();
    expect(rungAt(ladder(r), 14)).toBeNull();
  });

  it('reports the highest rung reached, not the first', () => {
    // At 70 minutes the clinic head is involved. Reporting level 1 because it
    // matched first is how an escalation quietly stops escalating.
    expect(rungAt(ladder(r), 15)?.level).toBe(1);
    expect(rungAt(ladder(r), 45)?.level).toBe(2);
    expect(rungAt(ladder(r), 70)?.level).toBe(3);
  });
});

describe('the sterilisation example, as specified', () => {
  const s = STERILIZATION_SAME_DAY;

  it('is not stored as a tickable box', () => {
    // "Don't store this simply as ☐ Instruments autoclaved."
    expect(s.sop.length).toBeGreaterThan(5);
    expect(s.kpi.formula).toBeTruthy();
    expect(s.verification).toBeTruthy();
    expect(s.failure).toBeTruthy();
  });

  it('carries the SOP in order, used through to storage', () => {
    expect(s.sop[0]).toBe('Used');
    expect(s.sop).toContain('Ultrasonic');
    expect(s.sop).toContain('Autoclave');
    expect(s.sop[s.sop.length - 1]).toBe('Storage');
  });

  it('names all four responsibilities, none of them the same person', () => {
    const { doer, checker, owner, escalation } = s.responsibility;
    expect(new Set([doer, checker, owner, escalation]).size).toBe(4);
  });

  it('computes the KPI the owner specified, to the target they set', () => {
    expect(s.kpi.name).toMatch(/same-day sterilisation/i);
    expect(s.kpi.formula).toMatch(/÷|\//);
    expect(s.kpi.target).toBe('100%');
  });

  it('says what counts as failure, so the exception engine has a rule', () => {
    // The exception engine asks "what should have happened but didn't". It
    // cannot ask that without a definition of didn't.
    expect(s.failure).toMatch(/not autoclaved/i);
  });
});
