/**
 * The notification engine — module 9.
 *
 * The eight the specification names: overdue tasks, low stock, equipment
 * maintenance, follow-up due, consent missing, lab delayed, patient waiting,
 * emergency.
 *
 * The hard part of a notification engine is not sending things. It is not
 * sending things. Three rules, all of them about restraint:
 *
 * 1. **Notifications are derived, never stored.** They are a function of
 *    current state. A stored notification outlives the condition that caused
 *    it, and then somebody is chasing a stock item that arrived yesterday.
 * 2. **One notification per condition, not per check.** Polling every minute
 *    must not produce sixty messages.
 * 3. **Severity decides who, not how loud.** An EMERGENCY reaches the clinic
 *    head; a routine follow-up does not, however long it has been waiting.
 */

export const NotificationKind = {
  TASK_OVERDUE: 'TASK_OVERDUE',
  LOW_STOCK: 'LOW_STOCK',
  EQUIPMENT_MAINTENANCE: 'EQUIPMENT_MAINTENANCE',
  FOLLOWUP_DUE: 'FOLLOWUP_DUE',
  CONSENT_MISSING: 'CONSENT_MISSING',
  LAB_DELAYED: 'LAB_DELAYED',
  PATIENT_WAITING: 'PATIENT_WAITING',
  EMERGENCY: 'EMERGENCY',
} as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

export const Severity = {
  EMERGENCY: 'EMERGENCY',
  CRITICAL: 'CRITICAL',
  IMPORTANT: 'IMPORTANT',
  ROUTINE: 'ROUTINE',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

/** What each kind is worth. Fixed, so a notification cannot inflate itself. */
export const KIND_SEVERITY: Record<NotificationKind, Severity> = {
  EMERGENCY: Severity.EMERGENCY,
  CONSENT_MISSING: Severity.CRITICAL,
  EQUIPMENT_MAINTENANCE: Severity.CRITICAL,
  TASK_OVERDUE: Severity.IMPORTANT,
  LOW_STOCK: Severity.IMPORTANT,
  LAB_DELAYED: Severity.IMPORTANT,
  PATIENT_WAITING: Severity.IMPORTANT,
  FOLLOWUP_DUE: Severity.ROUTINE,
};

export interface Notification {
  /** Stable per condition, so the same condition never notifies twice. */
  id: string;
  kind: NotificationKind;
  severity: Severity;
  /** What to say, in the words a person would use. */
  headline: string;
  detail: string | null;
  /** Role name, as the matrix spells it. */
  to: string;
  /** The activity this traces to, where there is one. */
  activityId: string | null;
}

/** The state a notification set is derived from. */
export interface NotificationState {
  overdueTasks: Array<{ id: string; title: string; minutesLate: number; doer: string; activityId: string | null }>;
  lowStock: Array<{ name: string; quantity: number; minimum: number }>;
  serviceDue: Array<{ id: string; name: string; dueLabel: string }>;
  followupsDue: Array<{ id: string; patientLabel: string; overdue: boolean }>;
  consentMissing: Array<{ id: string; patientLabel: string; procedure: string }>;
  labDelayed: Array<{ id: string; reference: string; patientLabel: string; daysLate: number }>;
  waitingPatients: Array<{ id: string; patientLabel: string; waitingMinutes: number }>;
  emergencies: Array<{ id: string; headline: string }>;
  /** Minutes a patient may wait before the desk is told. Clinic-configured. */
  waitingThresholdMinutes: number;
}

/**
 * Derive the current notifications.
 *
 * Pure and idempotent: the same state always produces the same set, with the
 * same ids. That is what makes rule 2 hold — a caller can diff two sets and
 * send only what is new, rather than re-sending everything on every poll.
 */
export function notificationsFor(s: NotificationState): Notification[] {
  const out: Notification[] = [];
  const add = (
    kind: NotificationKind, id: string, headline: string,
    to: string, detail: string | null = null, activityId: string | null = null,
  ) => {
    out.push({ id, kind, severity: KIND_SEVERITY[kind], headline, detail, to, activityId });
  };

  for (const e of s.emergencies) {
    add(NotificationKind.EMERGENCY, `emg-${e.id}`, e.headline, 'Clinic Head');
  }

  for (const c of s.consentMissing) {
    add(
      NotificationKind.CONSENT_MISSING, `con-${c.id}`,
      `Consent missing — ${c.patientLabel}`, 'Treating Doctor',
      c.procedure, 'CLN-002',
    );
  }

  for (const a of s.serviceDue) {
    add(
      NotificationKind.EQUIPMENT_MAINTENANCE, `svc-${a.id}`,
      `${a.name} service due`, 'Clinic Manager', a.dueLabel, 'EQP-002',
    );
  }

  for (const t of s.overdueTasks) {
    add(
      NotificationKind.TASK_OVERDUE, `ovd-${t.id}`,
      `${t.title} is ${t.minutesLate} min late`, t.doer, null, t.activityId,
    );
  }

  for (const i of s.lowStock) {
    add(
      NotificationKind.LOW_STOCK, `stk-${i.name}`,
      i.quantity === 0 ? `${i.name} is out of stock` : `${i.name} is below minimum`,
      'Inventory Coordinator',
      `${i.quantity} left, minimum ${i.minimum}`, 'INV-004',
    );
  }

  for (const l of s.labDelayed) {
    add(
      NotificationKind.LAB_DELAYED, `lab-${l.id}`,
      `${l.patientLabel} — lab case ${l.daysLate} day${l.daysLate === 1 ? '' : 's'} late`,
      'Lab Coordinator', l.reference, 'LAB-003',
    );
  }

  // Only past the clinic's own threshold. Notifying at minute one would train
  // the desk to ignore the channel by lunchtime.
  for (const w of s.waitingPatients) {
    if (w.waitingMinutes < s.waitingThresholdMinutes) continue;
    add(
      NotificationKind.PATIENT_WAITING, `wait-${w.id}`,
      `${w.patientLabel} has waited ${w.waitingMinutes} min`, 'Reception',
    );
  }

  // Only the overdue ones. A follow-up due later today is not news.
  for (const f of s.followupsDue) {
    if (!f.overdue) continue;
    add(
      NotificationKind.FOLLOWUP_DUE, `fup-${f.id}`,
      `Follow-up overdue — ${f.patientLabel}`, 'Treating Doctor', null, 'FUP-004',
    );
  }

  const rank: Record<Severity, number> = {
    EMERGENCY: 0, CRITICAL: 1, IMPORTANT: 2, ROUTINE: 3,
  };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** What one person should be told, most serious first. */
export function notificationsForRole(all: readonly Notification[], role: string): Notification[] {
  return all.filter((n) => n.to === role);
}

/** New since the last set. Lets a caller send only what changed. */
export function newSince(
  previous: readonly Notification[], current: readonly Notification[],
): Notification[] {
  const seen = new Set(previous.map((n) => n.id));
  return current.filter((n) => !seen.has(n.id));
}
