/**
 * CAPA — the IMPROVE stage of the Operations App §8 loop.
 *
 *   PLAN → TRIGGER → ASSIGN → EXECUTE → PROVE → VERIFY → ESCALATE → MEASURE → IMPROVE
 *
 * Every other stage was already built. Without this one the clinic detects the
 * same failure every day and files it identically every day: a line, not a
 * loop. The requirement is explicit about the purpose — "this is how your
 * clinic starts learning from failures rather than repeatedly correcting them."
 *
 * ---
 *
 * The whole value is in what this module REFUSES. An incident record you can
 * close by typing something in a box is a filing system; what makes it a
 * learning mechanism is that each step has a precondition:
 *
 *   - You cannot investigate before containing. The patient in the chair
 *     cannot wait for a root cause analysis, so the immediate correction is
 *     recorded first and is never confused with the fix.
 *   - You cannot plan actions before recording a root cause. Jumping to a fix
 *     is the exact habit CAPA exists to break.
 *   - You cannot leave the planning stage without at least one PREVENTIVE
 *     action. This is the requirement's central point: "simply correcting
 *     today's appointment doesn't solve the operational problem." An incident
 *     with only corrective actions has learned nothing.
 *   - You cannot verify your own action, for the same reason a doer cannot
 *     confirm their own activity.
 *   - You cannot close while any action is unverified.
 *
 * Every one of those is a test.
 */
import { Prisma } from '@prisma/client';
import {
  IncidentStatus, CapaActionType, CapaActionStatus, IncidentSource,
  CapaRequirement, Priority, type Parameter,
} from '@kubi/contracts';
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';

export class CapaRuleError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CapaRuleError';
  }
}

/** Priorities at which a REQUIRED_ON_CRITICAL policy bites. */
const CRITICAL_PRIORITIES: readonly string[] = [Priority.CRITICAL, Priority.PATIENT_SAFETY];

/**
 * Human-facing reference, INC-YYYY-NNNN, unique per organisation and stable
 * once issued — the same reasoning as the permanent activity IDs.
 */
async function nextReference(client: TenantPrisma, orgId: string, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const prefix = `INC-${year}-`;
  const last = await client.incident.findFirst({
    where: { organizationId: orgId, reference: { startsWith: prefix } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  const n = last ? Number(last.reference.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

export interface RaiseIncidentInput {
  organizationId: string;
  clinicId: string;
  parameter: Parameter;
  priority: string;
  summary: string;
  description?: string;
  source?: string;
  sourceAttentionItemId?: string;
  sourceInstanceId?: string;
  reportedByEmployeeId?: string;
  ownerEmployeeId?: string;
}

export async function raiseIncident(
  client: TenantPrisma,
  clock: Clock,
  input: RaiseIncidentInput,
) {
  const now = clock.now();
  // Serialisable retry is not warranted: a collision on the reference is
  // caught by the unique index and the caller retries, which is rare enough
  // that a second attempt costs nothing.
  return client.incident.create({
    data: {
      organizationId: input.organizationId,
      clinicId: input.clinicId,
      reference: await nextReference(client, input.organizationId, now),
      source: input.source ?? IncidentSource.MANUAL,
      parameter: input.parameter,
      priority: input.priority,
      status: IncidentStatus.OPEN,
      summary: input.summary,
      description: input.description ?? null,
      sourceAttentionItemId: input.sourceAttentionItemId ?? null,
      sourceInstanceId: input.sourceInstanceId ?? null,
      reportedByEmployeeId: input.reportedByEmployeeId ?? null,
      ownerEmployeeId: input.ownerEmployeeId ?? null,
    },
  });
}

/**
 * Whether a failed activity must raise an incident.
 *
 * This is the wire that was missing: `ActivityDefinition.capaPolicy` existed
 * as a column with no consumer, so the loop's last stage was declared and
 * never reached. ESCALATE now feeds IMPROVE.
 */
export function capaRequired(
  policy: string,
  priority: string,
  priorFailures: number,
): boolean {
  switch (policy) {
    case CapaRequirement.ALWAYS:
      return true;
    case CapaRequirement.REQUIRED_ON_CRITICAL:
      return CRITICAL_PRIORITIES.includes(priority);
    case CapaRequirement.REQUIRED_ON_REPEAT:
      // The second occurrence is the one that proves the first fix did not
      // work — which is precisely when the clinic needs to look deeper.
      return priorFailures >= 1;
    case CapaRequirement.NONE:
    default:
      return false;
  }
}

/** Step 1 — what was done about today. */
export async function containIncident(
  client: TenantPrisma,
  clock: Clock,
  incidentId: string,
  immediateCorrection: string,
) {
  const inc = await mustFind(client, incidentId);
  if (inc.status !== IncidentStatus.OPEN) {
    throw new CapaRuleError(
      `Incident ${inc.reference} is already past containment.`,
      'ALREADY_CONTAINED',
    );
  }
  if (!immediateCorrection.trim()) {
    throw new CapaRuleError('An immediate correction must say what was done.', 'EMPTY_CORRECTION');
  }
  return client.incident.update({
    where: { id: incidentId },
    data: {
      immediateCorrection,
      containedAt: clock.now(),
      status: IncidentStatus.CONTAINED,
    },
  });
}

/** Step 2 — why it happened. Refused before containment, by design. */
export async function investigateIncident(
  client: TenantPrisma,
  clock: Clock,
  incidentId: string,
  rootCause: string,
) {
  const inc = await mustFind(client, incidentId);
  if (inc.status !== IncidentStatus.CONTAINED) {
    throw new CapaRuleError(
      `Record what was done about today before asking why it happened (${inc.reference} is ${inc.status}).`,
      'NOT_CONTAINED',
    );
  }
  if (!rootCause.trim()) {
    throw new CapaRuleError('A root cause must say why it happened.', 'EMPTY_ROOT_CAUSE');
  }
  return client.incident.update({
    where: { id: incidentId },
    data: { rootCause, investigatedAt: clock.now(), status: IncidentStatus.INVESTIGATED },
  });
}

export interface AddActionInput {
  type: string;
  description: string;
  responsibleEmployeeId: string;
  dueAt: Date;
}

/** Step 3 — actions. Refused before a root cause exists. */
export async function addAction(
  client: TenantPrisma,
  incidentId: string,
  input: AddActionInput,
) {
  const inc = await mustFind(client, incidentId);
  if (inc.status !== IncidentStatus.INVESTIGATED && inc.status !== IncidentStatus.ACTIONS_PLANNED) {
    throw new CapaRuleError(
      `Record a root cause before planning actions (${inc.reference} is ${inc.status}).`,
      'NOT_INVESTIGATED',
    );
  }
  if (!input.description.trim()) {
    throw new CapaRuleError('An action must say what will be done.', 'EMPTY_ACTION');
  }
  const action = await client.capaAction.create({
    data: {
      organizationId: inc.organizationId,
      incidentId,
      type: input.type,
      description: input.description,
      status: CapaActionStatus.OPEN,
      responsibleEmployeeId: input.responsibleEmployeeId,
      dueAt: input.dueAt,
    },
  });

  // The incident advances only once both kinds exist. Corrective alone is the
  // failure mode this parameter was added to prevent.
  const actions = await client.capaAction.findMany({
    where: { incidentId },
    select: { type: true },
  });
  const hasCorrective = actions.some((a) => a.type === CapaActionType.CORRECTIVE);
  const hasPreventive = actions.some((a) => a.type === CapaActionType.PREVENTIVE);
  if (hasCorrective && hasPreventive && inc.status === IncidentStatus.INVESTIGATED) {
    await client.incident.update({
      where: { id: incidentId },
      data: { status: IncidentStatus.ACTIONS_PLANNED },
    });
  }
  return action;
}

/**
 * Step 4 — the action was carried out.
 *
 * IMPLEMENTED, not "done": whether it worked is a separate question asked on a
 * separate date. Matrix v2.0 INC-006 makes the effectiveness check its own
 * activity for exactly this reason.
 */
export async function implementAction(
  client: TenantPrisma,
  clock: Clock,
  actionId: string,
  effectivenessAfterDays = 30,
) {
  const action = await client.capaAction.findUnique({ where: { id: actionId } });
  if (!action) throw new CapaRuleError('No such action.', 'NO_ACTION');
  if (action.status === CapaActionStatus.EFFECTIVE || action.status === CapaActionStatus.CLOSED) {
    throw new CapaRuleError('That action has already been through its effectiveness check.', 'ALREADY_EFFECTIVE');
  }
  const now = clock.now();
  const updated = await client.capaAction.update({
    where: { id: actionId },
    data: {
      status: CapaActionStatus.EFFECTIVENESS_PENDING,
      implementedAt: now,
      // The check falls due later on purpose. Asking "did it work?" the same
      // afternoon answers nothing -- the failure has had no chance to recur.
      effectivenessDueAt: new Date(now.getTime() + effectivenessAfterDays * 86_400_000),
    },
  });
  await maybeAdvanceToVerifying(client, action.incidentId);
  return updated;
}

/**
 * Step 5 — the effectiveness check. Did it actually work?
 *
 * FRS §6: "ineffective loops back". A failed check does not fail the incident;
 * it returns the action to ACTION_IN_PROGRESS so somebody tries something else.
 * That return path is the whole reason CAPA is a loop rather than a form —
 * without it, "we fixed it" and "it stopped happening" become the same record
 * and a clinic can close the same failure for ever.
 *
 * Self-checking is refused for the same reason a doer cannot confirm their own
 * activity: a fix nobody independent looked at is a claim, not a fix.
 */
export async function checkEffectiveness(
  client: TenantPrisma,
  clock: Clock,
  actionId: string,
  checkerEmployeeId: string,
  effective: boolean,
  note?: string,
) {
  const action = await client.capaAction.findUnique({ where: { id: actionId } });
  if (!action) throw new CapaRuleError('No such action.', 'NO_ACTION');
  if (action.status !== CapaActionStatus.EFFECTIVENESS_PENDING) {
    throw new CapaRuleError(
      'An action must be implemented before its effectiveness can be checked.',
      'NOT_IMPLEMENTED',
    );
  }
  if (action.responsibleEmployeeId === checkerEmployeeId) {
    throw new CapaRuleError(
      'A CAPA action must be checked by someone other than the person responsible for it.',
      'SELF_VERIFICATION',
    );
  }

  if (!effective) {
    // Back round the loop. The count survives, because a CAPA on its third
    // attempt is a different conversation from one on its first.
    const reopened = await client.capaAction.update({
      where: { id: actionId },
      data: {
        status: CapaActionStatus.ACTION_IN_PROGRESS,
        implementedAt: null,
        effectivenessDueAt: null,
        verificationNote: note ?? null,
        ineffectiveCount: { increment: 1 },
      },
    });
    // The incident cannot stay in VERIFYING when one of its actions has gone
    // back to being work in progress.
    await client.incident.updateMany({
      where: { id: action.incidentId, status: IncidentStatus.VERIFYING },
      data: { status: IncidentStatus.ACTIONS_PLANNED },
    });
    return reopened;
  }

  const updated = await client.capaAction.update({
    where: { id: actionId },
    data: {
      status: CapaActionStatus.EFFECTIVE,
      verifiedByEmployeeId: checkerEmployeeId,
      verifiedAt: clock.now(),
      verificationNote: note ?? null,
    },
  });
  await maybeAdvanceToVerifying(client, action.incidentId);
  return updated;
}

/** Step 6 — close. Refused while any action is unverified. */
export async function closeIncident(client: TenantPrisma, clock: Clock, incidentId: string) {
  const inc = await mustFind(client, incidentId);
  const actions = await client.capaAction.findMany({
    where: { incidentId },
    select: { status: true, type: true },
  });

  if (actions.length === 0) {
    throw new CapaRuleError(
      `${inc.reference} has no actions. An incident closed without one has taught the clinic nothing.`,
      'NO_ACTIONS',
    );
  }
  if (!actions.some((a) => a.type === CapaActionType.PREVENTIVE)) {
    throw new CapaRuleError(
      `${inc.reference} has no preventive action. Correcting this one instance does not stop the next.`,
      'NO_PREVENTIVE',
    );
  }
  // FRS §7: "CAPA effectiveness is verified before closure." Implemented is
  // not enough -- the question is whether the failure stopped, not whether
  // somebody did the thing.
  const unproven = actions.filter(
    (a) => a.status !== CapaActionStatus.EFFECTIVE && a.status !== CapaActionStatus.CLOSED,
  ).length;
  if (unproven > 0) {
    throw new CapaRuleError(
      `${inc.reference} has ${unproven} action${unproven === 1 ? '' : 's'} not yet proven effective.`,
      'UNPROVEN_ACTIONS',
    );
  }

  return client.incident.update({
    where: { id: incidentId },
    data: { status: IncidentStatus.CLOSED, closedAt: clock.now() },
  });
}

async function maybeAdvanceToVerifying(client: TenantPrisma, incidentId: string) {
  const actions = await client.capaAction.findMany({
    where: { incidentId },
    select: { status: true },
  });
  const allDone = actions.length > 0
    && actions.every((a) => a.status === CapaActionStatus.EFFECTIVENESS_PENDING
      || a.status === CapaActionStatus.EFFECTIVE
      || a.status === CapaActionStatus.CLOSED);
  if (!allDone) return;
  await client.incident.updateMany({
    where: { id: incidentId, status: IncidentStatus.ACTIONS_PLANNED },
    data: { status: IncidentStatus.VERIFYING },
  });
}

async function mustFind(client: TenantPrisma, incidentId: string) {
  const inc = await client.incident.findUnique({ where: { id: incidentId } });
  if (!inc) throw new CapaRuleError('No such incident.', 'NO_INCIDENT');
  return inc;
}

export interface IncidentSummary {
  id: string;
  reference: string;
  parameter: string;
  priority: string;
  status: string;
  summary: string;
  /** How far round the loop it has travelled, for the progress rail. */
  stage: number;
  openActions: number;
  totalActions: number;
  ageDays: number;
  blockedBy: string | null;
}

const STAGE_ORDER: readonly string[] = [
  IncidentStatus.OPEN, IncidentStatus.CONTAINED, IncidentStatus.INVESTIGATED,
  IncidentStatus.ACTIONS_PLANNED, IncidentStatus.VERIFYING, IncidentStatus.CLOSED,
];

/**
 * The list a manager reads. Open first, oldest first — an incident that has sat
 * at one stage for a week is the one worth looking at, and sorting by age puts
 * it where it will be seen.
 */
export async function listIncidents(
  client: TenantPrisma,
  clock: Clock,
  organizationId: string,
  clinicId: string,
  opts: { includeClosed?: boolean } = {},
): Promise<IncidentSummary[]> {
  const rows = await client.incident.findMany({
    where: {
      organizationId,
      clinicId,
      ...(opts.includeClosed ? {} : { status: { not: IncidentStatus.CLOSED } }),
    },
    include: { actions: { select: { status: true, type: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const now = clock.now().getTime();
  return rows.map((r) => {
    const total = r.actions.length;
    const open = r.actions.filter((a) => a.status !== CapaActionStatus.EFFECTIVE
      && a.status !== CapaActionStatus.CLOSED).length;
    return {
      id: r.id,
      reference: r.reference,
      parameter: r.parameter,
      priority: r.priority,
      status: r.status,
      summary: r.summary,
      stage: Math.max(0, STAGE_ORDER.indexOf(r.status)),
      openActions: open,
      totalActions: total,
      ageDays: Math.floor((now - r.createdAt.getTime()) / 86_400_000),
      blockedBy: nextStepFor(r.status, r.actions),
    };
  });
}

/**
 * What this incident is waiting for, in one clause.
 *
 * A status word tells somebody where a thing is; it does not tell them what to
 * do. The requirement asks management to see deviations rather than lists, and
 * a deviation nobody knows how to clear is just a different kind of list.
 */
function nextStepFor(
  status: string,
  actions: Array<{ status: string; type: string }>,
): string | null {
  switch (status) {
    case IncidentStatus.OPEN:
      return 'Record what was done about it today';
    case IncidentStatus.CONTAINED:
      return 'Record why it happened';
    case IncidentStatus.INVESTIGATED:
      return actions.some((a) => a.type === CapaActionType.PREVENTIVE)
        ? 'Add a corrective action'
        : 'Add a preventive action — what stops the next one';
    case IncidentStatus.ACTIONS_PLANNED: {
      const n = actions.filter((a) => a.status === CapaActionStatus.OPEN
        || a.status === CapaActionStatus.ACTION_IN_PROGRESS).length;
      return n > 0 ? `${n} action${n === 1 ? '' : 's'} still to do` : null;
    }
    case IncidentStatus.VERIFYING: {
      const n = actions.filter((a) => a.status === CapaActionStatus.EFFECTIVENESS_PENDING).length;
      return n > 0
        ? `${n} action${n === 1 ? '' : 's'} waiting on an effectiveness check — did it actually work?`
        : null;
    }
    default:
      return null;
  }
}

export { STAGE_ORDER, Prisma };
