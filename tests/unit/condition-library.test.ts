/**
 * The condition library, held to its own rules.
 *
 * The question this library exists to answer is not "what are the rules" —
 * the owner wrote those. It is **which of them can KuBi actually notice**.
 * A condition-based system is worth exactly as much as the conditions it can
 * detect; the rest is a document with ambitions.
 */
import { describe, it, expect } from 'vitest';
import {
  CONDITION_LIBRARY, GROUP_ORDER, ConditionGroup, ActionKind, TriggerEvent, RoleCode,
  theConditions, conditionsIn, detectable, undetectable, blocking, unassigned,
  missingCapabilities, conditionCoverage,
} from '../../packages/contracts/src/index.js';

describe('the library is well formed', () => {
  it('holds the hundred rules the owner wrote', () => {
    expect(CONDITION_LIBRARY).toHaveLength(100);
  });

  it('gives every rule a unique id', () => {
    const ids = CONDITION_LIBRARY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps all eighteen groups, in the owner’s lettering', () => {
    expect(GROUP_ORDER).toHaveLength(18);
    expect(GROUP_ORDER.map((g) => g.letter).join('')).toBe('ABCDEFGHIJKLMNOPQR');
    expect(new Set(GROUP_ORDER.map((g) => g.group)).size).toBe(18);
  });

  it('leaves no group empty, and accounts for every rule once', () => {
    const total = theConditions().reduce((n, g) => n + g.rules.length, 0);
    expect(total).toBe(CONDITION_LIBRARY.length);
    for (const g of theConditions()) {
      expect(g.rules.length, `${g.label} is empty`).toBeGreaterThan(0);
    }
  });

  it('speaks the automation engine’s vocabulary rather than inventing a second one', () => {
    const kinds = new Set(Object.values(ActionKind));
    const events = new Set(Object.values(TriggerEvent));
    for (const r of CONDITION_LIBRARY) {
      expect(kinds.has(r.action), `${r.id} uses action ${r.action}`).toBe(true);
      if (r.detects) expect(events.has(r.detects), `${r.id} fires on ${r.detects}`).toBe(true);
    }
  });
});

describe('nothing is invented', () => {
  it('keeps the owner’s assignments where they gave them, and only there', () => {
    // Groups A and B came with an Assigned To against every row. C to R
    // came with the column absent.
    for (const r of conditionsIn(ConditionGroup.APPOINTMENT)) {
      expect(r.role, `${r.id} lost its role`).toBe(RoleCode.RECEPTION);
      expect(r.due, `${r.id} lost its due time`).toBeTruthy();
    }
    for (const r of conditionsIn(ConditionGroup.PATIENT)) {
      expect(r.role, `${r.id} lost its role`).not.toBeNull();
      expect(r.due, `${r.id} was given a due time nobody set`).toBeNull();
    }
    for (const r of conditionsIn(ConditionGroup.DIAGNOSIS)) {
      expect(r.role, `${r.id} was given an owner nobody decided`).toBeNull();
    }
  });

  it('assigns only roles that exist, where one is assigned at all', () => {
    const roles = new Set(Object.values(RoleCode));
    for (const r of CONDITION_LIBRARY) {
      if (r.role === null) continue;
      expect(roles.has(r.role), `${r.id} is assigned to ${r.role}`).toBe(true);
    }
  });

  it('says what is missing for every rule it cannot detect', () => {
    for (const r of undetectable()) {
      expect(r.needs, `${r.id} cannot be detected and does not say why`).toBeTruthy();
      expect((r.needs ?? '').length, `${r.id}'s explanation is a stub`).toBeGreaterThan(15);
    }
  });

  it('never carries a reason on a rule that works', () => {
    for (const r of detectable()) {
      expect(r.needs, `${r.id} fires but claims something is missing`).toBeNull();
    }
  });
});

describe('the action comes from the owner’s verb', () => {
  it('stops work where the owner said stop', () => {
    const bio = CONDITION_LIBRARY.find((r) => r.condition === 'Biological test failed')!;
    expect(bio.task).toBe('Stop instrument usage');
    // A task can be ticked while the instruments are still in somebody's hand.
    expect(bio.action).toBe(ActionKind.BLOCK);
  });

  it('makes every consent a block, because "mandatory" is not a reminder', () => {
    const consents = conditionsIn(ConditionGroup.CONSENT);
    expect(consents).toHaveLength(6);
    expect(consents.every((r) => r.action === ActionKind.BLOCK)).toBe(true);
  });

  it('notifies rather than creating work where the owner wrote "inform"', () => {
    for (const r of CONDITION_LIBRARY) {
      if (!/^inform/i.test(r.task)) continue;
      expect(r.action, `${r.id}: "${r.task}"`).toBe(ActionKind.NOTIFY);
    }
  });

  it('escalates the one thing the owner escalated', () => {
    const escalations = CONDITION_LIBRARY.filter((r) => r.action === ActionKind.ESCALATE);
    expect(escalations.map((r) => r.task)).toEqual(['Owner escalation']);
  });

  it('never lets a rule complete work', () => {
    // The automation engine has no COMPLETE action, and this library must not
    // smuggle one in through a task named like one.
    expect(Object.keys(ActionKind)).not.toContain('COMPLETE');
  });
});

describe('what KuBi can actually notice', () => {
  it('records the honest state, so a change to it is deliberate', () => {
    expect(conditionCoverage()).toEqual({
      rules: 100, canDetect: 40, assigned: 16, blocks: 8,
    });
  });

  it('cannot notice most of them', () => {
    expect(undetectable().length).toBeGreaterThan(detectable().length);
  });

  it('groups the missing capabilities so the work is countable', () => {
    const missing = missingCapabilities();
    expect(missing.length).toBeGreaterThan(0);
    // Sorted worst-first, so the biggest single unlock is at the top.
    const counts = missing.map((m) => m.rules.length);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(counts[0]).toBeGreaterThan(1);
  });

  it('cannot detect a single financial condition', () => {
    const money = conditionsIn(ConditionGroup.FINANCIAL);
    expect(money).toHaveLength(6);
    expect(money.every((r) => r.detects === null)).toBe(true);
  });

  it('cannot detect a single patient-risk condition', () => {
    // Allergies, cardiac history, pregnancy, infectious disease. The group
    // that most needs to fire, and the one KuBi is blindest to.
    const risk = conditionsIn(ConditionGroup.PATIENT);
    expect(risk).toHaveLength(8);
    expect(risk.every((r) => r.detects === null)).toBe(true);
  });

  it('can detect every inventory condition but one', () => {
    const stock = conditionsIn(ConditionGroup.INVENTORY);
    expect(stock.filter((r) => r.detects !== null)).toHaveLength(5);
    expect(stock.filter((r) => r.detects === null).map((r) => r.condition))
      .toEqual(['Material expired']);
  });
});

describe('an auto-created task has to land on somebody', () => {
  it('counts the ones that would land on nobody', () => {
    expect(unassigned()).toHaveLength(84);
  });

  it('would create work with no owner even among the rules it can fire', () => {
    // The sharpest version of the problem: KuBi can already detect these, so
    // the only thing stopping them from working is that nobody owns them.
    const ready = detectable().filter((r) => r.role === null && r.action === ActionKind.RAISE);
    expect(ready.length).toBeGreaterThan(0);
  });

  it('has every blocking rule stop something, owner or not', () => {
    // A block does not need an assignee — it refuses, and the refusal is the
    // whole action. This is why consent is safe to ship before assignment.
    expect(blocking().length).toBe(8);
  });
});
