/**
 * The audit engine and the notification engine.
 *
 * The audit tests are mostly about what cannot be done to the trail. The
 * notification tests are mostly about what is deliberately not sent — a
 * channel people ignore is worse than no channel, and they start ignoring it
 * on the second false morning.
 */
import { describe, it, expect } from 'vitest';
import {
  AuditAction, append, supersede, trailFor, refusals, deviations,
  deviationsWithoutCapa, independentlyVerified, type AuditEntry,
  notificationsFor, notificationsForRole, newSince, NotificationKind, Severity,
  KIND_SEVERITY, type NotificationState,
} from '../../packages/contracts/src/index.js';

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'a1', at: '2026-08-04T09:47:00.000Z', action: AuditAction.COMPLETED,
  activityId: 'STER-004', subject: 'Autoclave cycle', by: 'Priya S.', ...over,
});

describe('the audit trail can only be added to', () => {
  it('appends without touching what is already there', () => {
    const t0: AuditEntry[] = [entry()];
    const t1 = append(t0, entry({ id: 'a2', action: AuditAction.VERIFIED }));
    expect(t1).toHaveLength(2);
    expect(t0).toHaveLength(1); // the original is untouched
    expect(t1[0]).toEqual(t0[0]);
  });

  it('keeps both the mistake and its correction', () => {
    // A trail showing only the corrected value cannot be trusted about
    // anything, which is the whole reason there is no update operation.
    const t0 = [entry({ evidenceValue: '118°C' })];
    const t1 = supersede(t0, 'a1', entry({ id: 'a2', evidenceValue: '134°C' }));
    expect(t1).toHaveLength(2);
    expect(t1[0]!.evidenceValue).toBe('118°C');
    expect(t1[1]!.supersedes).toBe('a1');
  });

  it('refuses to supersede something that is not in the trail', () => {
    expect(() => supersede([entry()], 'nope', entry({ id: 'a2' })))
      .toThrow(/not in the trail/i);
  });
});

describe('the audit questions worth asking', () => {
  const trail: AuditEntry[] = [
    entry({ id: 'r1', action: AuditAction.RAISED, by: 'Time engine' }),
    entry({ id: 'c1', action: AuditAction.COMPLETED, by: 'Priya S.', evidence: 'VALUE', evidenceValue: '134°C / 18 min' }),
    entry({ id: 'v1', action: AuditAction.VERIFIED, by: 'Anita K.', verifiedBy: 'Anita K.' }),
    entry({ id: 'b1', action: AuditAction.BLOCKED, activityId: 'CLN-002', subject: 'Implant surgery', by: 'Compliance engine' }),
    entry({ id: 'd1', action: AuditAction.DEVIATION_RAISED, activityId: 'LAB-003', subject: 'Crown overdue', by: 'Exception engine', deviation: 'Case 3 days past due' }),
    entry({ id: 'd2', action: AuditAction.DEVIATION_RAISED, activityId: 'INV-004', subject: 'Composite A2', by: 'Inventory engine', deviation: 'Stock at zero', capaRef: 'CAPA-11' }),
  ];

  it('shows everything that happened to one activity', () => {
    expect(trailFor(trail, 'STER-004').map((e) => e.action)).toEqual([
      AuditAction.RAISED, AuditAction.COMPLETED, AuditAction.VERIFIED,
    ]);
  });

  it('surfaces every time the system refused', () => {
    // Most systems log what happened. The interesting entries are the ones
    // where the answer was no.
    expect(refusals(trail).map((e) => e.id)).toEqual(['b1']);
  });

  it('finds deviations that nobody turned into a CAPA', () => {
    // The single most useful audit query, and the one no clinic can answer
    // today: a departure nobody acted on is how March repeats February.
    expect(deviations(trail)).toHaveLength(2);
    expect(deviationsWithoutCapa(trail).map((e) => e.activityId)).toEqual(['LAB-003']);
  });

  it('confirms a second pair of eyes actually looked', () => {
    expect(independentlyVerified(trail, 'STER-004')).toBe(true);
  });

  it('does not call it verified when the same person signed their own work', () => {
    const solo: AuditEntry[] = [
      entry({ id: 'c', action: AuditAction.COMPLETED, by: 'Priya S.' }),
      entry({ id: 'v', action: AuditAction.VERIFIED, by: 'Priya S.', verifiedBy: 'Priya S.' }),
    ];
    expect(independentlyVerified(solo, 'STER-004')).toBe(false);
  });

  it('does not call it verified when nobody verified it', () => {
    expect(independentlyVerified([entry()], 'STER-004')).toBe(false);
  });

  it('names an actor on every entry, including the system', () => {
    for (const e of trail) expect(e.by, `${e.id} has no actor`).toBeTruthy();
  });
});

const quiet: NotificationState = {
  overdueTasks: [], lowStock: [], serviceDue: [], followupsDue: [],
  consentMissing: [], labDelayed: [], waitingPatients: [], emergencies: [],
  waitingThresholdMinutes: 15,
};

describe('the notification engine holds its tongue', () => {
  it('sends nothing when nothing is wrong', () => {
    expect(notificationsFor(quiet)).toEqual([]);
  });

  it('does not notify a patient waiting inside the clinic’s own threshold', () => {
    // Notifying at minute one trains the desk to ignore the channel by lunch.
    const s = { ...quiet, waitingPatients: [{ id: 'v1', patientLabel: 'Meera J.', waitingMinutes: 9 }] };
    expect(notificationsFor(s)).toEqual([]);
  });

  it('notifies once past the threshold', () => {
    const s = { ...quiet, waitingPatients: [{ id: 'v1', patientLabel: 'Meera J.', waitingMinutes: 31 }] };
    expect(notificationsFor(s)).toHaveLength(1);
    expect(notificationsFor(s)[0]!.headline).toMatch(/31 min/);
  });

  it('does not chase a follow-up that is merely due later today', () => {
    const s = {
      ...quiet,
      followupsDue: [
        { id: 'f1', patientLabel: 'Arjun P.', overdue: false },
        { id: 'f2', patientLabel: 'Rakesh T.', overdue: true },
      ],
    };
    expect(notificationsFor(s)).toHaveLength(1);
    expect(notificationsFor(s)[0]!.headline).toMatch(/Rakesh/);
  });

  it('gives the same condition the same id every time', () => {
    // Rule 2: one notification per condition, not per check. Polling every
    // minute must not produce sixty messages.
    const s = { ...quiet, lowStock: [{ name: 'Composite A2', quantity: 0, minimum: 5 }] };
    expect(notificationsFor(s)[0]!.id).toBe(notificationsFor(s)[0]!.id);
    expect(newSince(notificationsFor(s), notificationsFor(s))).toEqual([]);
  });

  it('reports only what is genuinely new', () => {
    const before = notificationsFor({ ...quiet, lowStock: [{ name: 'A', quantity: 1, minimum: 5 }] });
    const after = notificationsFor({
      ...quiet,
      lowStock: [{ name: 'A', quantity: 1, minimum: 5 }, { name: 'B', quantity: 0, minimum: 3 }],
    });
    expect(newSince(before, after).map((n) => n.headline)).toEqual(['B is out of stock']);
  });
});

describe('the notification engine says the right thing to the right person', () => {
  const busy: NotificationState = {
    ...quiet,
    emergencies: [{ id: 'e1', headline: 'Medical emergency in Chair 2' }],
    consentMissing: [{ id: 'p1', patientLabel: 'Priyanka N.', procedure: 'Implant surgery' }],
    lowStock: [{ name: 'Composite A2', quantity: 0, minimum: 5 }],
    labDelayed: [{ id: 'l1', reference: 'LAB-2026-0029', patientLabel: 'Imran Q.', daysLate: 3 }],
    overdueTasks: [{ id: 't1', title: 'Autoclave cycle', minutesLate: 22, doer: 'Dental Assistant', activityId: 'STER-004' }],
  };

  it('covers all eight kinds the specification names', () => {
    expect(Object.keys(NotificationKind).sort()).toEqual([
      'CONSENT_MISSING', 'EMERGENCY', 'EQUIPMENT_MAINTENANCE', 'FOLLOWUP_DUE',
      'LAB_DELAYED', 'LOW_STOCK', 'PATIENT_WAITING', 'TASK_OVERDUE',
    ]);
  });

  it('puts the emergency first, whatever else is happening', () => {
    expect(notificationsFor(busy)[0]!.kind).toBe(NotificationKind.EMERGENCY);
    expect(notificationsFor(busy)[0]!.severity).toBe(Severity.EMERGENCY);
  });

  it('does not let a routine matter inflate its own severity', () => {
    // Severity is fixed per kind, so nothing can shout its way up the list.
    expect(KIND_SEVERITY.FOLLOWUP_DUE).toBe(Severity.ROUTINE);
    expect(KIND_SEVERITY.CONSENT_MISSING).toBe(Severity.CRITICAL);
  });

  it('sends the emergency to the clinic head and stock to the coordinator', () => {
    const all = notificationsFor(busy);
    expect(notificationsForRole(all, 'Clinic Head').map((n) => n.kind))
      .toEqual([NotificationKind.EMERGENCY]);
    expect(notificationsForRole(all, 'Inventory Coordinator').map((n) => n.kind))
      .toEqual([NotificationKind.LOW_STOCK]);
  });

  it('traces a notification to its activity wherever there is one', () => {
    const withActivity = notificationsFor(busy).filter((n) => n.activityId !== null);
    expect(withActivity.length).toBeGreaterThan(0);
    for (const n of withActivity) expect(n.activityId).toMatch(/^[A-Z]+-\d+$/);
  });

  it('says out of stock rather than below minimum when there is none left', () => {
    expect(notificationsFor(busy).find((n) => n.kind === NotificationKind.LOW_STOCK)!.headline)
      .toMatch(/out of stock/);
  });
});
