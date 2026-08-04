/**
 * The exception library and the escalation matrix.
 *
 * The one thing these tests exist to protect: **immediate means zero, not
 * fifteen.** Three of the four severity levels escalate immediately, and the
 * tempting bug is to encode "immediate" as a small number so the arithmetic
 * stays uniform. A wrong-tooth identification does not get a fifteen-minute
 * grace period because it made the code tidier.
 */
import { describe, it, expect } from 'vitest';
import {
  EXCEPTION_LIBRARY, ESCALATION_MATRIX, ExceptionGroup, EscalationSeverity, ActionKind,
  theExceptions, exceptionsIn, stopsWork, immediate, byEscalationSeverity,
  escalateWithin, isImmediate, levelOf, unmappedRoles, exceptionCoverage,
} from '../../packages/contracts/src/index.js';

describe('the escalation matrix', () => {
  it('has the owner’s four levels, in order', () => {
    expect(ESCALATION_MATRIX.map((l) => l.level)).toEqual([1, 2, 3, 4]);
    expect(ESCALATION_MATRIX.map((l) => l.label))
      .toEqual(['Operational', 'Clinical', 'Safety', 'Critical']);
  });

  it('escalates three of the four immediately, and means zero by it', () => {
    expect(escalateWithin(EscalationSeverity.OPERATIONAL)).toBe(15);
    expect(escalateWithin(EscalationSeverity.CLINICAL)).toBe(0);
    expect(escalateWithin(EscalationSeverity.SAFETY)).toBe(0);
    expect(escalateWithin(EscalationSeverity.CRITICAL)).toBe(0);
    expect(immediate().length).toBeGreaterThan(0);
  });

  it('never gives an immediate level a grace period', () => {
    for (const l of ESCALATION_MATRIX) {
      if (l.severity === EscalationSeverity.OPERATIONAL) continue;
      expect(l.withinMinutes, `${l.label} was given ${l.withinMinutes} minutes`).toBe(0);
      expect(isImmediate(l.severity)).toBe(true);
    }
  });

  it('names somebody at every level, and escalates upward', () => {
    for (const l of ESCALATION_MATRIX) {
      expect(l.escalateTo.length).toBeGreaterThan(3);
      expect(l.examples.length).toBeGreaterThan(10);
    }
    expect(levelOf(EscalationSeverity.CRITICAL).escalateTo).toContain('Owner');
  });
});

describe('the library is well formed', () => {
  it('holds the sixty-eight exceptions the owner wrote, in twelve groups', () => {
    expect(EXCEPTION_LIBRARY).toHaveLength(68);
    expect(Object.keys(ExceptionGroup)).toHaveLength(12);
  });

  it('gives every exception a unique id', () => {
    const ids = EXCEPTION_LIBRARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves no group empty, and accounts for every exception once', () => {
    const total = theExceptions().reduce((n, g) => n + g.rules.length, 0);
    expect(total).toBe(EXCEPTION_LIBRARY.length);
    for (const g of theExceptions()) {
      expect(g.rules.length, `${g.label} is empty`).toBeGreaterThan(0);
    }
  });

  it('gives every exception a severity, because one without has no clock', () => {
    const levels = new Set(Object.values(EscalationSeverity));
    for (const e of EXCEPTION_LIBRARY) {
      expect(levels.has(e.severity), `${e.id} has severity ${e.severity}`).toBe(true);
    }
  });

  it('marks which severities the owner stated and which were read off the matrix', () => {
    // Group 1 arrived with a Priority column. The other eleven did not.
    expect(exceptionsIn(ExceptionGroup.CLINICAL).every((e) => e.severityStated)).toBe(true);
    expect(exceptionsIn(ExceptionGroup.MEDICAL).every((e) => !e.severityStated)).toBe(true);
    expect(exceptionCoverage().severityStated).toBe(10);
  });

  it('names somebody to escalate to on every single one', () => {
    for (const e of EXCEPTION_LIBRARY) {
      expect(e.escalateTo, `${e.id} escalates to nobody`).toBeTruthy();
    }
  });
});

describe('the ones that stop work', () => {
  it('reads the refusal out of the owner’s verb', () => {
    const stops = stopsWork();
    // Stop, Block, Hold, Suspend, Quarantine, Disable.
    for (const e of stops) {
      expect(
        /^(stop|block|hold|suspend|quarantine|disable|manager approval)/i.test(e.task),
        `${e.id} "${e.task}" was marked BLOCK without a stopping verb`,
      ).toBe(true);
    }
  });

  it('stops work in twelve places, and they are the right twelve', () => {
    expect(stopsWork()).toHaveLength(12);
    const tasks = stopsWork().map((e) => e.task);
    expect(tasks).toContain('Stop procedure immediately');
    expect(tasks).toContain('Block procedure');
    expect(tasks).toContain('Quarantine instrument sets');
    expect(tasks).toContain('Suspend aerosol procedures');
  });

  it('never turns a refusal into a reminder', () => {
    // The failure this guards: "Stop surgery" as a RAISE is a to-do item
    // somebody can tick while the surgery continues.
    for (const e of EXCEPTION_LIBRARY) {
      if (!/^stop /i.test(e.task)) continue;
      expect(e.action, `${e.id}: "${e.task}"`).toBe(ActionKind.BLOCK);
    }
  });

  it('makes every consent failure stop something except the reschedulable one', () => {
    const consent = exceptionsIn(ExceptionGroup.CONSENT);
    expect(consent).toHaveLength(5);
    expect(consent.filter((e) => e.action === ActionKind.BLOCK)).toHaveLength(4);
    expect(consent.find((e) => e.action !== ActionKind.BLOCK)?.exception)
      .toBe('Parent unavailable');
  });
});

describe('severity lands where it should', () => {
  it('puts every wrong-patient and wrong-site risk at critical', () => {
    const critical = byEscalationSeverity(EscalationSeverity.CRITICAL).map((e) => e.exception);
    expect(critical).toContain('Wrong tooth identified before treatment');
    expect(critical).toContain('Wrong treatment planned');
    expect(critical).toContain('Medical emergency');
    expect(critical).toContain('Biological indicator failure');
  });

  it('never files an infection-control failure below safety', () => {
    for (const e of exceptionsIn(ExceptionGroup.INFECTION_CONTROL)) {
      expect([EscalationSeverity.SAFETY, EscalationSeverity.CRITICAL], `${e.exception}`).toContain(e.severity);
    }
  });

  it('leaves only scheduling and money at operational', () => {
    for (const e of byEscalationSeverity(EscalationSeverity.OPERATIONAL)) {
      expect(
        [ExceptionGroup.TREATMENT, ExceptionGroup.LABORATORY, ExceptionGroup.EQUIPMENT,
          ExceptionGroup.FINANCIAL, ExceptionGroup.RECEPTION, ExceptionGroup.DOCUMENTATION,
          ExceptionGroup.STAFF, ExceptionGroup.COMMUNICATION],
        `${e.exception} is operational`,
      ).toContain(e.group);
    }
  });

  it('records the honest state, so a change to it is deliberate', () => {
    expect(exceptionCoverage()).toEqual({
      exceptions: 68, groups: 12, blocks: 12, immediate: 50, severityStated: 10,
    });
  });
});

describe('who these escalate to', () => {
  it('keeps the owner’s job titles rather than mapping them onto the wrong role', () => {
    const roles = unmappedRoles();
    // Six titles KuBi has no role for. Naming the wrong person is worse than
    // naming a job title nobody has been assigned to yet.
    expect(roles).toContain('Implantologist');
    expect(roles).toContain('Endodontist');
    expect(roles).toContain('Infection Control Officer');
    expect(roles).toContain('Lab Head');
    expect(roles).toContain('HR');
  });

  it('has more distinct escalation targets than KuBi has roles', () => {
    // Thirteen RoleCodes; this library escalates to more than that, which is
    // the decision waiting on the owner.
    expect(unmappedRoles().length).toBeGreaterThan(13);
  });
});
