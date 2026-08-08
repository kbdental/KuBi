/**
 * KuBi VS-01 HTTP API.
 *
 * Fastify rather than NestJS — a deviation from ADR-005, recorded in the
 * completion report. Reason: VS-01 needs ~12 endpoints, and NestJS's module/
 * DI machinery is ceremony at that size. The property that justified NestJS
 * (a single uniform place to enforce authorization so it cannot be forgotten
 * per-endpoint) is preserved: `authed()` is the only way to build a handler,
 * and it resolves session, tenancy and permission before the handler runs.
 * Reversible — the services below are framework-agnostic.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { z } from 'zod';
import { prisma, withTenantContext, type TenantPrisma } from './platform/tenancy/rls-context.js';
import { systemClock } from './shared/clock.js';
import { logger } from './shared/logging/logger.js';
import { verifyPassword } from './platform/auth/password.service.js';
import { signAccessToken, verifyAccessToken } from './platform/auth/token.service.js';
import { resolveSession, type ResolvedSession } from './platform/rbac/session-context.service.js';
import { checkPermission } from './platform/rbac/permission-evaluation.service.js';
import { withSystemContext } from './platform/tenancy/rls-context.js';
import {
  startTask, respondToChecklist, completeTask, verifyTask, reportProblem,
  evaluateGate, authoriseGate, askForAuthorisation,
  TaskAuthorizationError, GateBlockedError, PROBLEM_KINDS,
} from './platform/workflow/task.service.js';
import {
  getSchedule, nextPatientAt, setAppointmentStatus, AppointmentTransitionError,
  type AppointmentStatus,
} from './platform/schedule/appointment.service.js';
import { writeAudit, AuditAction } from './platform/audit/audit.service.js';
import { clinicLocalDate, clinicLocalTimeToUtc } from './platform/workflow/scheduler.service.js';
import { buildHandover } from './platform/workflow/handover.service.js';
import { buildOverview } from './platform/insight/overview.service.js';
import {
  raiseIncident, containIncident, investigateIncident, addAction,
  implementAction, checkEffectiveness, closeIncident, listIncidents, CapaRuleError,
} from './platform/quality/capa.service.js';
import { RetentionService, RetentionError } from './domains/clinical/retention.service.js';
import { EventStore, EventStoreError } from './platform/events/event-store.js';
import {
  ActivityStatus, ExceptionStatus, DAILY_STANDARD,
  DORMANT_AFTER_DAYS, type OutreachOutcome, headlineFor,
  ClinicEvent, FLOWS,
  decisions, decisionsFor, escalatedTo, mostImportant, sweep, board, readiness, closing,
  type RoleCode as Role,
} from '@kubi/contracts';


/**
 * What each role's briefing is called, and the one question it answers.
 *
 * Kept here rather than in the client so the two cannot disagree about what a
 * screen is for. Anything not listed gets the neutral pair — a role with no
 * entry is honest about being unlabelled rather than borrowing another's.
 */
const ROLE_LABEL: Record<string, string> = {
  DENTAL_ASSISTANT: 'Assistant',
  SENIOR_ASSISTANT: 'Senior assistant',
  RECEPTION: 'Reception',
  HOUSEKEEPING: 'Housekeeping',
  CLINIC_MANAGER: 'Clinic manager',
  TREATING_DOCTOR: 'Doctor',
  STERILIZATION_TECHNICIAN: 'Sterilisation',
  LAB_COORDINATOR: 'Laboratory',
};
const ROLE_QUESTION: Record<string, string> = {
  DENTAL_ASSISTANT: 'What do I do now?',
  SENIOR_ASSISTANT: 'What do I do now?',
  RECEPTION: 'Who is waiting, and who needs calling?',
  HOUSEKEEPING: 'What needs cleaning, and when?',
  CLINIC_MANAGER: 'Is the clinic running to standard?',
  TREATING_DOCTOR: 'Which patient needs me?',
  STERILIZATION_TECHNICIAN: 'What is in the loop, and what is stuck?',
  LAB_COORDINATOR: 'What is due back, and what is stuck?',
};

const clock = systemClock;

/**
 * The retention loop. Stateless apart from the clock, so one instance is
 * enough; the tenant transaction is passed in on every call.
 */
const retention = new RetentionService(clock);

/**
 * The event log and the engine on top of it.
 *
 * Every route below is one of exactly two things: it reads decisions(), or it
 * records an event. There is no third kind, and no route computes what should
 * happen next — that is the engine's job and the whole point of §12.
 */
const events = new EventStore(clock);

/** Buckets for TODAY. Plain words, ordered by urgency. */
type Bucket = 'OVERDUE' | 'NOW' | 'NEXT' | 'LATER';

function bucketFor(dueAt: Date, status: string, now: Date): Bucket {
  if (status === ActivityStatus.OVERDUE || dueAt < now) return 'OVERDUE';
  const mins = (dueAt.getTime() - now.getTime()) / 60_000;
  if (mins <= 60) return 'NOW';
  if (mins <= 240) return 'NEXT';
  return 'LATER';
}

/**
 * Where the CLINIC is, right now — not where this person's task list is.
 *
 * The whole point: someone arriving should know where they are, what phase the
 * clinic is in, whether it is ready, and how long is left, before they think
 * about anything they personally have to do.
 *
 * Everything here is a clinic-level fact for today's clinic-local date. One
 * person finishing their own three tasks does not mean the clinic opened.
 * Counts and times only — no titles, no assignees, no names (Q6).
 *
 * `phase` is null when there is no opening set today (a non-working day, or
 * before generation has run). Absent is not the same as ready, and must never
 * render as "the clinic is open".
 */
async function clinicContext(
  tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
  clinicIds: readonly string[],
  now: Date,
): Promise<{
  name: string;
  /**
   * The CLINIC's timezone. Every time on screen is formatted with this, not
   * with the viewer's browser zone -- "ready by 09:00" must mean nine o'clock
   * at the clinic, whoever is looking and from wherever.
   */
  timezone: string;
  phase: 'OPENING' | 'OPEN' | 'SEEING_PATIENTS' | 'CLOSING' | 'CLOSED' | null;
  opening: { total: number; done: number; complete: boolean } | null;
  /** The end-of-day set. Null when the clinic has no closing time configured. */
  closing: { total: number; done: number; complete: boolean } | null;
  readyBy: Date | null;
  /** The clinic's own configured closing time today. Never guessed. */
  closingAt: Date | null;
  /**
   * When the next patient the clinic must be ready for is due. Real since
   * VS-02, and still null when there is genuinely nobody left today — which
   * is an answer, not a gap, and must not be dressed up as a time.
   */
  firstPatientAt: Date | null;
} | null> {
  const clinicId = clinicIds[0];
  // Someone who can see every clinic has no single "here" to report.
  if (clinicIds.length !== 1 || !clinicId) return null;

  const clinic = await tx.clinic.findUnique({ where: { id: clinicId } });
  if (!clinic) return null;

  const periodKey = clinicLocalDate(now, clinic.timezone);
  // The process each instance belongs to, because opening and closing are two
  // separate questions. Counting them together would report "2 of 11 areas
  // ready" all morning and never let the clinic reach OPEN at all.
  const rows = await tx.activityInstance.findMany({
    where: { clinicId, periodKey },
    select: { status: true, definition: { select: { process: true } } },
  });

  const firstPatientAt = await nextPatientAt(tx, clinicId, periodKey);
  const base = { name: clinic.name, timezone: clinic.timezone, firstPatientAt };

  const tally = (process: string) => {
    const forProcess = rows.filter((r) => r.definition.process === process);
    if (forProcess.length === 0) return null;
    const done = forProcess.filter(
      (r) => r.status === ActivityStatus.COMPLETED || r.status === ActivityStatus.VERIFIED,
    ).length;
    return { total: forProcess.length, done, complete: done === forProcess.length };
  };

  const opening = tally('Opening Readiness');
  const closing = tally('Closing Readiness');

  // Both deadlines are the clinic's own configured times, read from
  // configuration rather than assumed (D-01, OD-19).
  const cfg = await tx.configValue.findMany({
    where: {
      organizationId: clinic.organizationId, clinicId,
      key: { in: ['clinic.opening_time', 'clinic.closing_time'] },
    },
  });
  const timeOf = (key: string) => {
    const value = (cfg.find((c) => c.key === key)?.valueJson as { value?: string } | null)?.value;
    return value ? clinicLocalTimeToUtc(periodKey, value, clinic.timezone) : null;
  };
  const readyBy = timeOf('clinic.opening_time');
  const closingAt = timeOf('clinic.closing_time');

  // No opening set today is not "closed for the day" and not "ready" — it is an
  // absence, and the only honest phase for it is none at all.
  if (!opening) {
    return { ...base, phase: null, opening: null, closing, readyBy, closingAt };
  }

  const inChair = await tx.appointment.count({
    where: { clinicId, periodKey, status: 'IN_CHAIR' },
  });

  const phase = (() => {
    if (!opening.complete) return 'OPENING' as const;
    if (inChair > 0) return 'SEEING_PATIENTS' as const;
    // Closing is a real moment the clinic configured, not "it feels late".
    // Somebody still in the chair outranks it: the day is not closing down
    // while a patient is being treated, whatever the clock says.
    if (closing?.complete) return 'CLOSED' as const;
    if (closing && closingAt && now >= closingAt) return 'CLOSING' as const;
    if (closing && closing.done > 0) return 'CLOSING' as const;
    return 'OPEN' as const;
  })();

  return { ...base, phase, opening, closing, readyBy, closingAt };
}

/**
 * Refuse, audibly, unless this person holds the permission.
 *
 * The denial is written to the audit log before the 403 is thrown, because a
 * refused clinical action is exactly the thing somebody will later ask about.
 * Extracted here after the third copy of this block; the two older routes keep
 * their inline versions until they are next touched, since rewriting working
 * authorisation code to save six lines is not a trade worth making.
 */
async function requireClinical(
  tx: TenantPrisma, s: ResolvedSession, clinicId: string,
  code: string, entityType: string, entityId: string,
): Promise<void> {
  const decision = await checkPermission(tx, clock, {
    employeeId: s.employeeId!, organizationId: s.organizationId, clinicId, code,
  });
  if (decision.allowed) return;

  await writeAudit(tx, {
    organizationId: s.organizationId, clinicId,
    actorEmployeeId: s.employeeId, action: AuditAction.UNAUTHORIZED_ATTEMPT,
    entityType, entityId,
  });
  throw Object.assign(
    new Error('Following a patient up about unfinished treatment is a clinical call, '
      + 'and your role does not hold that permission.'),
    { statusCode: 403 },
  );
}

async function requireSession(req: FastifyRequest): Promise<ResolvedSession> {
  const token = (req.cookies as Record<string, string | undefined>)['kubi_at']
    ?? req.headers.authorization?.replace(/^Bearer /, '');
  if (!token) throw Object.assign(new Error('Not signed in'), { statusCode: 401 });
  const payload = await verifyAccessToken(token).catch(() => {
    throw Object.assign(new Error('Not signed in'), { statusCode: 401 });
  });
  const session = await resolveSession(prisma, clock, payload.userId, payload.organizationId);
  if (!session) throw Object.assign(new Error('Not signed in'), { statusCode: 401 });
  return session;
}

/** Record a UX event. Never blocks the request. */
async function track(
  session: ResolvedSession, eventName: string,
  extra?: { instanceId?: string; durationMs?: number; metadata?: Record<string, unknown> },
) {
  try {
    await withSystemContext(prisma, 'record ux instrumentation event', session.organizationId, (tx) =>
      tx.uxEvent.create({
        data: {
          organizationId: session.organizationId,
          employeeId: session.employeeId,
          eventName,
          instanceId: extra?.instanceId ?? null,
          durationMs: extra?.durationMs ?? null,
          metadata: (extra?.metadata ?? undefined) as never,
        },
      }),
    );
  } catch (e) {
    logger.warn({ errorName: (e as Error).name }, 'ux event not recorded');
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);

  app.setErrorHandler((err: Error, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode
      ?? (err instanceof TaskAuthorizationError ? 403 : 500);
    // A blocked gate is not a failure of the request — the clinic simply
    // isn't ready. 409 so the screen can offer the two honest ways forward.
    if (err instanceof GateBlockedError) {
      reply.status(409).send({ error: err.message, canOverride: err.overridable });
      return;
    }
    if (err instanceof AppointmentTransitionError) {
      reply.status(409).send({ error: err.message });
      return;
    }
    // "Somebody is already following this patient up" and "they have booked
    // since you opened this list" are both states of the clinic, not faults in
    // the request. 409 so the screen can say so and reload, rather than
    // reporting a server error for a race the user handled correctly.
    if (err instanceof EventStoreError) {
      reply.status(400).send({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof RetentionError) {
      reply.status(409).send({ error: err.message, code: err.code });
      return;
    }
    if (status >= 500) logger.error({ errorName: err.name }, 'request failed');
    // Errors say what went wrong and what to do — no stack, no jargon.
    reply.status(status).send({ error: err.message });
  });

  // ---- auth ----
  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    // Authentication precedes tenancy: we cannot scope to an organisation we
    // have not identified yet. A narrow SECURITY DEFINER function exposes only
    // the four columns needed to verify a password (migration 0007) -- no
    // profile, no roles, no employee link.
    const found = await prisma.$queryRawUnsafe<Array<{ id: string; organization_id: string; password_hash: string; status: string }>>(
      `SELECT * FROM kubi_lookup_user_for_login($1)`,
      body.email,
    ).catch(() => []);

    const row = found[0];
    if (!row || row.status !== 'ACTIVE' || !(await verifyPassword(row.password_hash, body.password))) {
      return reply.status(401).send({ error: 'Email or password is incorrect.' });
    }

    const session = await resolveSession(prisma, clock, row.id, row.organization_id);
    if (!session) return reply.status(401).send({ error: 'Email or password is incorrect.' });

    const accessToken = await signAccessToken(
      { userId: row.id, organizationId: row.organization_id }, clock,
    );
    await withSystemContext(prisma, 'record successful login for audit', row.organization_id, (tx) =>
      writeAudit(tx, {
        organizationId: row.organization_id, actorUserId: row.id,
        actorEmployeeId: session.employeeId, action: AuditAction.LOGIN_SUCCESS,
        entityType: 'user', entityId: row.id,
      }),
    );
    await track(session, 'login');

    reply.setCookie('kubi_at', accessToken, {
      httpOnly: true, sameSite: 'strict', path: '/', maxAge: 15 * 60,
    });
    return { displayLabel: session.displayLabel, roleCodes: session.roleCodes };
  });

  app.post('/api/v1/auth/logout', async (_req, reply) => {
    reply.clearCookie('kubi_at', { path: '/' });
    return { ok: true };
  });

  app.get('/api/v1/auth/me', async (req) => {
    const s = await requireSession(req);
    return {
      displayLabel: s.displayLabel, roleCodes: s.roleCodes,
      clinicIds: s.tenancy.clinicIds, crossClinic: s.tenancy.crossClinic,
    };
  });

  // ---- TODAY ----
  app.get('/api/v1/my-day', async (req) => {
    const s = await requireSession(req);
    if (!s.employeeId) {
      return {
        buckets: { OVERDUE: [], NOW: [], NEXT: [], LATER: [] },
        attentionCount: 0,
        clinic: null,
        opening: null,
      };
    }

    const now = clock.now();
    const result = await withTenantContext(prisma, s.tenancy, async (tx) => {
      const instances = await tx.activityInstance.findMany({
        where: {
          assigneeEmployeeId: s.employeeId,
          status: { in: [ActivityStatus.DUE, ActivityStatus.IN_PROGRESS, ActivityStatus.OVERDUE] },
        },
        include: { definition: true },
        orderBy: { dueAt: 'asc' },
      });

      const blockers = await tx.attentionItem.findMany({
        where: { id: { in: instances.map((i) => i.blockedByItemId).filter((x): x is string => !!x) } },
      });

      const attentionCount = await tx.attentionItem.count({
        where: {
          ownerEmployeeId: s.employeeId,
          status: { in: [ExceptionStatus.OPEN, ExceptionStatus.ACKNOWLEDGED, ExceptionStatus.ACTION_IN_PROGRESS] },
        },
      });

      // Usability review: a lightweight confirmation once the clinic is
      // actually open. Opening is a CLINIC fact, not a personal one — Priya
      // finishing her three tasks does not mean the clinic opened — so this
      // counts today's opening set at her clinic, not her own work.
      //
      // Counts only. No titles, no assignees, nothing about who did what:
      // seeing that opening is complete is not the same as being allowed to
      // read other people's tasks, and Q6 keeps names off the screen anyway.
      const clinic = await clinicContext(tx, s.tenancy.clinicIds, now);

      const buckets: Record<Bucket, unknown[]> = { OVERDUE: [], NOW: [], NEXT: [], LATER: [] };
      for (const i of instances) {
        const blocker = blockers.find((b) => b.id === i.blockedByItemId);
        buckets[bucketFor(i.dueAt, i.status, now)].push({
          id: i.id,
          title: i.definition.title,
          standard: i.definition.standardText,
          dueAt: i.dueAt,
          status: i.status,
          started: i.status === ActivityStatus.IN_PROGRESS,
          blockedBy: blocker ? blocker.headline : null,
        });
      }
      return { buckets, attentionCount, clinic, opening: clinic?.opening ?? null };
    });

    await track(s, 'view_today');
    return result;
  });

  /**
   * The briefing — the screen five of the roles actually land on.
   *
   * my-day answers "what do I owe"; this answers "how is my part of the day
   * going". They read the same instances and differ only in shape: buckets by
   * urgency there, sections by the owner's rhythm here.
   *
   * The sections come from DAILY_STANDARD rather than being written into this
   * file. Before that, a briefing hard-coded its own idea of a role's day —
   * "Treatment rooms and chairs cleaned" appeared for housekeeping whether or
   * not the standard said anything of the kind, which is a demonstration of a
   * clinic rather than this clinic.
   *
   * Deliberately thinner than the demo backend's version: no cascade, no lab
   * or sterilisation facts. Those need domain reads this route has no business
   * doing, and a section that quietly showed nothing would read as "all clear"
   * rather than "not built". Sections appear only where they are real.
   */
  app.get('/api/v1/briefing', async (req) => {
    const s = await requireSession(req);
    const now = clock.now();

    const roleLabel = ROLE_LABEL[s.roleCodes[0] ?? ''] ?? 'My work';
    const question = ROLE_QUESTION[s.roleCodes[0] ?? ''] ?? 'What do I do now?';

    if (!s.employeeId) {
      return {
        roleLabel, question, work: null,
        headline: { verdict: 'Nothing assigned', why: 'This account has no employee record.', tone: 'GREEN', action: null },
        sections: [],
      };
    }

    return withTenantContext(prisma, s.tenancy, async (tx) => {
      const instances = await tx.activityInstance.findMany({
        where: {
          assigneeEmployeeId: s.employeeId!,
          status: { in: [ActivityStatus.DUE, ActivityStatus.IN_PROGRESS, ActivityStatus.OVERDUE] },
        },
        include: { definition: true },
        orderBy: { dueAt: 'asc' },
      });
      const done = await tx.activityInstance.count({
        where: {
          assigneeEmployeeId: s.employeeId!,
          status: { in: [ActivityStatus.COMPLETED, ActivityStatus.VERIFIED] },
        },
      });

      // Which part of the day an instance belongs to, via the control it was
      // raised from. Null where the standard names no control for it — those
      // fall into "Everything else" rather than being guessed into a slot.
      const rhythmOf = (code: string): string | null =>
        DAILY_STANDARD.find((d) => d.covers === code)?.rhythm ?? null;

      const item = (i: (typeof instances)[number]) => ({
        id: i.id,
        kind: 'task' as const,
        text: i.definition.title,
        detail: i.status === ActivityStatus.IN_PROGRESS ? 'started' : null,
        origin: 'RECURRING',
        taskId: i.id,
        priority: null,
        tone: i.status === ActivityStatus.OVERDUE ? 'RED' : null,
        blockedBy: null,
        activityCode: i.definition.code,
      });

      const slot = (rhythms: string[]) =>
        instances.filter((i) => rhythms.includes(rhythmOf(i.definition.code) ?? ''));

      const before = slot(['BEFORE_OPENING']);
      const during = slot(['HOURLY', 'TWO_HOURLY', 'LUNCH']);
      const closing = slot(['CLOSING', 'LAST_PATIENT']);
      const rest = instances.filter(
        (i) => !before.includes(i) && !during.includes(i) && !closing.includes(i),
      );

      const section = (
        key: string, label: string, hint: string | null, emptyText: string,
        rows: typeof instances,
      ) => ({
        key, label,
        tone: rows.some((r) => r.status === ActivityStatus.OVERDUE) ? 'RED'
          : rows.length > 0 ? 'AMBER' : 'GREEN',
        hint, emptyText, items: rows.map(item),
      });

      const sections = [
        section('opening', 'Before the first patient',
          'The clinic does not open with any of these outstanding.',
          'Opening is done.', before),
        section('during', 'Through the day',
          'On a cadence, whatever else is happening.', 'Nothing due this hour.', during),
        section('other', 'Everything else', null, 'Nothing outstanding.', rest),
        section('closing', 'Closing',
          'Nobody locks up with these open.', 'Closing is clear.', closing),
      ];

      // The answer is derived from the sections, never authored, so a headline
      // cannot claim something its own content does not support — including
      // the claim that something can be done about it. Shared with the demo
      // backend, because both copies of this had the same bug: "Take me to it"
      // was offered for whichever section was worst, whether or not it held
      // anything a person could press.
      const headline = headlineFor(sections);

      void now;
      return {
        roleLabel, question,
        work: { total: instances.length + done, done },
        headline, sections,
      };
    });
  });

  // ---- DO THIS ----
  app.get('/api/v1/tasks/:id', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    return withTenantContext(prisma, s.tenancy, async (tx) => {
      const inst = await tx.activityInstance.findUniqueOrThrow({
        where: { id },
        include: { definition: { include: { checklistItems: { orderBy: { ordinal: 'asc' } } } }, responses: true },
      });
      const gate = await evaluateGate(
        tx, s.organizationId, inst.clinicId,
        inst.definition.gateRequirement, inst.definition.gateEnforcement,
      );
      const blocker = inst.blockedByItemId
        ? await tx.attentionItem.findUnique({ where: { id: inst.blockedByItemId } })
        : null;

      return {
        id: inst.id,
        title: inst.definition.title,
        standard: inst.definition.standardText,
        status: inst.status,
        dueAt: inst.dueAt,
        isMine: inst.assigneeEmployeeId === s.employeeId,
        needsSomeoneElseToCheck: !inst.definition.selfVerifyAllowed,
        items: inst.definition.checklistItems.map((it) => {
          const r = inst.responses.find((x) => x.itemId === it.id);
          return {
            id: it.id, label: it.label,
            requiresValue: it.requiresValue, unit: it.valueUnit,
            checked: r?.checked ?? false, value: r?.numericValue ?? null,
          };
        }),
        cantConfirm: gate?.blocks ? gate.message : null,
        canOverrideBlock: gate?.blocks ? gate.overridable : false,
        blockedBy: blocker?.headline ?? null,
        problemKinds: PROBLEM_KINDS,
      };
    });
  });

  app.post('/api/v1/tasks/:id/start', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const r = await withTenantContext(prisma, s.tenancy, (tx) =>
      startTask(tx, clock, id, s.employeeId!));
    await track(s, 'task_start', { instanceId: id });
    return { status: r.status };
  });

  app.post('/api/v1/tasks/:id/complete', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      responses: z.array(z.object({
        itemId: z.string().uuid(), checked: z.boolean(), numericValue: z.number().optional(),
      })),
      taps: z.number().int().optional(),
      durationMs: z.number().int().optional(),
      // Present only when a gate blocked and the person recorded why it is
      // safe to proceed. The service decides whether that is permitted.
      overrideReason: z.string().min(1).max(500).optional(),
    }).parse(req.body);

    let result;
    try {
      result = await withTenantContext(prisma, s.tenancy, async (tx) => {
        await respondToChecklist(tx, clock, id, s.employeeId!, body.responses);
        return completeTask(tx, clock, id, s.employeeId!,
          body.overrideReason ? { reason: body.overrideReason } : undefined);
      });
    } catch (err) {
      // The refusal rolled its transaction back, so the manager still has to
      // be told — in a transaction of its own, which survives.
      if (err instanceof GateBlockedError && err.needsAuthorisation && err.instanceId) {
        await withTenantContext(prisma, s.tenancy, (tx) =>
          askForAuthorisation(tx, clock, err.instanceId!)).catch(() => undefined);
      }
      throw err;
    }

    await track(s, 'task_complete', {
      instanceId: id,
      ...(body.durationMs !== undefined ? { durationMs: body.durationMs } : {}),
      metadata: {
        taps: body.taps ?? null,
        selfVerified: result.selfVerified,
        outOfRange: result.outOfRangeValues.length,
      },
    });

    return {
      status: result.status,
      selfVerified: result.selfVerified,
      waitingForCheck: result.needsCheckBy !== null,
      outOfRange: result.outOfRangeValues,
    };
  });

  app.post('/api/v1/tasks/:id/report-problem', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      itemId: z.string().uuid().optional(),
      kind: z.string(),
      note: z.string().max(500).optional(),
    }).parse(req.body);

    const item = await withTenantContext(prisma, s.tenancy, (tx) =>
      reportProblem(tx, clock, {
        instanceId: id, employeeId: s.employeeId!,
        itemId: body.itemId ?? null, kind: body.kind, note: body.note ?? null,
      }));
    await track(s, 'report_problem', { instanceId: id });
    return { headline: item.headline, id: item.id };
  });

  // ---- ATTENTION ----
  app.get('/api/v1/attention', async (req) => {
    const s = await requireSession(req);
    const items = await withTenantContext(prisma, s.tenancy, (tx) =>
      tx.attentionItem.findMany({
        where: { status: { in: [ExceptionStatus.OPEN, ExceptionStatus.ACKNOWLEDGED, ExceptionStatus.ACTION_IN_PROGRESS] } },
        orderBy: [{ severity: 'asc' }, { dueAt: 'asc' }],
      }));
    await track(s, 'view_attention');

    const order = { PATIENT_SAFETY: 0, CRITICAL: 1, IMPORTANT: 2, ROUTINE: 3 } as Record<string, number>;
    return items
      .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
      .map((i) => ({
        id: i.id,
        headline: i.headline,          // what happened
        severity: i.severity,          // how serious
        detail: i.detail,
        mine: i.ownerEmployeeId === s.employeeId, // who acts
        dueAt: i.dueAt,                // by when
        escalated: i.escalationLevel !== 'INITIAL',
        // Some attention items are not "close this", they are "go and do
        // something". Carried as a plain flag rather than the code, which is
        // engine vocabulary and never reaches a screen.
        instanceId: i.sourceInstanceId,
        needsAuthorisation: i.code === 'OPN.GATE.NEEDS_AUTHORISATION',
      }));
  });

  app.post('/api/v1/attention/:id/resolve', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ note: z.string().min(1).max(500) }).parse(req.body);

    await withTenantContext(prisma, s.tenancy, async (tx) => {
      const item = await tx.attentionItem.findUniqueOrThrow({ where: { id } });
      const decision = await checkPermission(tx, clock, {
        employeeId: s.employeeId!, organizationId: s.organizationId,
        clinicId: item.clinicId, code: 'attention_item:resolve',
      });
      if (!decision.allowed) {
        await writeAudit(tx, {
          organizationId: s.organizationId, clinicId: item.clinicId,
          actorEmployeeId: s.employeeId, action: AuditAction.UNAUTHORIZED_ATTEMPT,
          entityType: 'attention_item', entityId: id,
        });
        throw Object.assign(new Error('You do not have permission to resolve this.'), { statusCode: 403 });
      }
      await tx.attentionItem.update({
        where: { id },
        data: {
          status: ExceptionStatus.RESOLVED, resolvedAt: clock.now(),
          resolvedByEmployeeId: s.employeeId, resolutionNote: body.note,
        },
      });
      // Unblock any task this was holding.
      await tx.activityInstance.updateMany({
        where: { blockedByItemId: id }, data: { blockedByItemId: null },
      });
      await writeAudit(tx, {
        organizationId: s.organizationId, clinicId: item.clinicId,
        actorEmployeeId: s.employeeId, action: 'ATTENTION_RESOLVED',
        entityType: 'attention_item', entityId: id, reason: body.note,
      });
    });
    await track(s, 'resolve_attention');
    return { ok: true };
  });

  // ---- CHECK & RELEASE ----
  app.get('/api/v1/checks', async (req) => {
    const s = await requireSession(req);
    const rows = await withTenantContext(prisma, s.tenancy, (tx) =>
      tx.activityInstance.findMany({
        where: { status: ActivityStatus.COMPLETED },
        include: { definition: true },
      }));
    await track(s, 'view_checks');
    return rows
      .filter((r) => r.completedByEmployeeId !== s.employeeId)
      .map((r) => ({
        id: r.id, title: r.definition.title,
        completedAt: r.completedAt,
        standard: r.definition.standardText,
      }));
  });

  /**
   * Usability review Q5: the checker must see what was actually recorded.
   *
   * Approved expansion of the VS-01 freeze. It adds no business capability —
   * it makes the check the system already claimed to perform actually
   * possible. Confirming work without seeing what was claimed is not
   * independent verification; it is a signature.
   *
   * Deliberately its own endpoint rather than reusing GET /tasks/:id, which is
   * written from the doer's point of view (isMine, problemKinds, tick state to
   * edit). A checker is answering a different question and gets a read-only
   * view shaped for it.
   */
  app.get('/api/v1/checks/:id', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    return withTenantContext(prisma, s.tenancy, async (tx) => {
      const inst = await tx.activityInstance.findUniqueOrThrow({
        where: { id },
        include: {
          definition: { include: { checklistItems: { orderBy: { ordinal: 'asc' } } } },
          responses: true,
        },
      });

      // Segregation of duties is enforced on the POST as well; refusing the
      // read too means a person is never shown a review screen for their own
      // work only to be turned away when they act on it.
      if (inst.completedByEmployeeId === s.employeeId) {
        throw Object.assign(
          new Error('You cannot confirm your own work on this task.'),
          { statusCode: 403 },
        );
      }

      return {
        id: inst.id,
        title: inst.definition.title,
        standard: inst.definition.standardText,
        completedAt: inst.completedAt,
        // Q6: no names. Who did it stays in the audit trail, off the screen.
        items: inst.definition.checklistItems.map((it) => {
          const r = inst.responses.find((x) => x.itemId === it.id);
          return {
            id: it.id,
            label: it.label,
            checked: r?.checked ?? false,
            value: r?.numericValue ?? null,
            unit: it.valueUnit,
          };
        }),
      };
    });
  });

  app.post('/api/v1/checks/:id', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      result: z.enum(['PASS', 'FAIL']), comment: z.string().max(500).optional(),
    }).parse(req.body);
    const status = await withTenantContext(prisma, s.tenancy, (tx) =>
      verifyTask(tx, clock, id, s.employeeId!, body.result, body.comment));
    await track(s, 'verify_task', { instanceId: id });
    return { status };
  });

  // ---- CLINIC: today's schedule (VS-02) ----
  app.get('/api/v1/schedule', async (req) => {
    const s = await requireSession(req);
    const now = clock.now();

    const result = await withTenantContext(prisma, s.tenancy, async (tx) => {
      const clinicId = s.tenancy.clinicIds[0];
      if (s.tenancy.clinicIds.length !== 1 || !clinicId) return { rows: [], periodKey: null };
      const clinic = await tx.clinic.findUnique({ where: { id: clinicId } });
      if (!clinic) return { rows: [], periodKey: null };

      const periodKey = clinicLocalDate(now, clinic.timezone);
      const rows = await getSchedule(tx, clock, clinicId, periodKey);
      return { rows, periodKey, timezone: clinic.timezone };
    });

    await track(s, 'view_schedule');
    return result;
  });

  app.post('/api/v1/appointments/:id/status', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      to: z.enum(['ARRIVED', 'IN_CHAIR', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
      reason: z.string().max(500).optional(),
    }).parse(req.body);

    const updated = await withTenantContext(prisma, s.tenancy, async (tx) => {
      const appt = await tx.appointment.findUniqueOrThrow({ where: { id } });
      const decision = await checkPermission(tx, clock, {
        employeeId: s.employeeId!, organizationId: s.organizationId,
        clinicId: appt.clinicId, code: 'appointment:update_status',
      });
      if (!decision.allowed) {
        await writeAudit(tx, {
          organizationId: s.organizationId, clinicId: appt.clinicId,
          actorEmployeeId: s.employeeId, action: AuditAction.UNAUTHORIZED_ATTEMPT,
          entityType: 'appointment', entityId: id,
        });
        throw Object.assign(new Error('You do not have permission to change this visit.'), { statusCode: 403 });
      }
      return setAppointmentStatus(tx, clock, {
        appointmentId: id,
        to: body.to as AppointmentStatus,
        employeeId: s.employeeId!,
        organizationId: s.organizationId,
        reason: body.reason ?? null,
      });
    });

    await track(s, 'appointment_status', { metadata: { to: body.to } });
    return { status: updated.status };
  });

  // ---- a manager lets one blocked task go ahead (usability review Q2) ----
  app.post('/api/v1/tasks/:id/authorise', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(500) }).parse(req.body);

    await withTenantContext(prisma, s.tenancy, (tx) =>
      authoriseGate(tx, clock, { instanceId: id, employeeId: s.employeeId!, reason: body.reason }));
    await track(s, 'authorise_gate', { instanceId: id });
    return { ok: true };
  });

  /* ═══════════════════════════════════════════════════════════════════
     THE ENGINE

     Three routes. A screen reads the first two and posts to the third, and
     computes nothing of its own — principle P-1 and the reason the UI can
     stay thin enough to be trusted.
     ═══════════════════════════════════════════════════════════════════ */

  /** What this person must decide now, and what has escalated to them. */
  app.get('/api/v1/now', async (req) => {
    const s = await requireSession(req);
    const result = await withTenantContext(prisma, s.tenancy, async (tx) => {
      const clinicId = s.tenancy.clinicIds[0];
      if (!clinicId) return null;
      const now = events.minuteNow();
      const world = await events.replay(tx, clinicId, now);
      const role = (s.roleCodes[0] ?? 'RECEPTION') as Role;
      return {
        now,
        role,
        mine: decisionsFor(world, role, now),
        escalated: escalatedTo(world, role, now),
      };
    });
    await track(s, 'view_now');
    if (!result) throw Object.assign(new Error('No clinic in context.'), { statusCode: 400 });
    return result;
  });

  /**
   * The whole clinic: every open decision, the live board, and what is late.
   *
   * One route rather than seven, because the owner asked for one clinic and
   * not seven software modules. A screen slices this; it does not query per
   * flow.
   */
  app.get('/api/v1/clinic', async (req) => {
    const s = await requireSession(req);
    const result = await withTenantContext(prisma, s.tenancy, async (tx) => {
      const clinicId = s.tenancy.clinicIds[0];
      if (!clinicId) return null;
      const now = events.minuteNow();
      // The readiness target is the day's first appointment, resolved inside
      // replay. Everything in the opening procedure is due before it.
      const world = await events.replay(tx, clinicId, now);
      const all = decisions(world, now);
      return {
        now,
        first: mostImportant(world, now),
        decisions: all,
        // The morning: which blocks are outstanding, whether the clinic is
        // ready, and readiness against the first appointment. Calculated
        // here and rendered there — the screen computes nothing.
        readiness: readiness(world.events, world.operatories, world.firstPatientAt, now),
        // The evening, on the same terms: which sections of the drill are
        // outstanding, and which of those are patient-safety critical.
        closing: closing(world.events, world.operatories),
        board: board(world, now),
        late: sweep(world, now).alerts,
        flows: world.flows.filter((f) => !f.done).map((f) => ({
          id: f.id, kind: f.kind, subjectLabel: f.subjectLabel,
          node: FLOWS[f.kind].nodes[f.at]?.id ?? null,
        })),
        eventCount: world.events.length,
      };
    });
    await track(s, 'view_clinic');
    if (!result) throw Object.assign(new Error('No clinic in context.'), { statusCode: 400 });
    return result;
  });

  /**
   * Record something that happened.
   *
   * The only write path in the application. The body names an event and a
   * subject; it cannot name a workflow position, a phase or an assignee,
   * because none of those is a thing a person does.
   */
  app.post('/api/v1/events', async (req) => {
    const s = await requireSession(req);
    const body = z.object({
      type: z.enum(Object.values(ClinicEvent) as [string, ...string[]]),
      subjectId: z.string().min(1).max(120),
      subjectLabel: z.string().max(200).optional(),
      idempotencyKey: z.string().min(8).max(120),
    }).parse(req.body);

    const out = await withTenantContext(prisma, s.tenancy, async (tx) => {
      const clinicId = s.tenancy.clinicIds[0];
      if (!clinicId) throw Object.assign(new Error('No clinic in context.'), { statusCode: 400 });
      const now = events.minuteNow();
      return events.append(tx, {
        organizationId: s.organizationId,
        clinicId,
        type: body.type as ClinicEvent,
        subjectId: body.subjectId,
        ...(body.subjectLabel ? { subjectLabel: body.subjectLabel } : {}),
        byRole: (s.roleCodes[0] ?? 'RECEPTION') as Role,
        ...(s.employeeId ? { byEmployeeId: s.employeeId } : {}),
        idempotencyKey: body.idempotencyKey,
      }, now);
    });

    // A refusal is a state of the clinic, not a failure of the request. The
    // screen shows one sentence and one button; 409 is how it knows to.
    if (!out.outcome.ok) {
      return { ok: false, refusal: out.outcome.refusal };
    }
    await track(s, 'record_event', { metadata: { type: body.type } });
    return {
      ok: true,
      duplicate: out.duplicate,
      consequences: out.outcome.consequences,
    };
  });

  // ---- RETENTION: the patients who stopped coming (SG-T.4, 30 days) ----
  //
  // Read is open to anyone who can see the schedule; acting on it is not.
  // Ringing a patient about unfinished treatment is a clinical conversation,
  // so opening and recording require 'patient:followup', the same permission
  // the post-surgical follow-up uses.

  app.get('/api/v1/retention', async (req) => {
    const s = await requireSession(req);
    const result = await withTenantContext(prisma, s.tenancy, async (tx) => {
      const clinicId = s.tenancy.clinicIds[0];
      if (s.tenancy.clinicIds.length !== 1 || !clinicId) {
        return { items: [], summary: null, dormantAfterDays: DORMANT_AFTER_DAYS };
      }
      const [items, summary] = await Promise.all([
        retention.list(tx, clinicId),
        retention.summary(tx, clinicId),
      ]);
      return { items, summary, dormantAfterDays: DORMANT_AFTER_DAYS };
    });

    await track(s, 'view_retention');
    return result;
  });

  app.post('/api/v1/retention/:patientId/open', async (req) => {
    const s = await requireSession(req);
    const { patientId } = z.object({ patientId: z.string().uuid() }).parse(req.params);

    const result = await withTenantContext(prisma, s.tenancy, async (tx) => {
      const clinicId = s.tenancy.clinicIds[0];
      if (!clinicId) throw Object.assign(new Error('No clinic in context.'), { statusCode: 400 });
      await requireClinical(tx, s, clinicId, 'patient:followup', 'patient', patientId);
      return retention.open(tx, clinicId, s.organizationId, patientId);
    });

    await track(s, 'retention_open', { metadata: { patientId } });
    return result;
  });

  app.post('/api/v1/retention/:id/record', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      outcome: z.enum([
        'RETURNING', 'DECLINED', 'WILL_DECIDE', 'NO_ANSWER', 'UNREACHABLE', 'NOT_APPLICABLE',
      ]),
      note: z.string().max(1000).optional(),
    }).parse(req.body);

    await withTenantContext(prisma, s.tenancy, async (tx) => {
      const clinicId = s.tenancy.clinicIds[0];
      if (!clinicId) throw Object.assign(new Error('No clinic in context.'), { statusCode: 400 });
      await requireClinical(tx, s, clinicId, 'patient:followup', 'retention_outreach', id);
      await retention.record(
        tx, clinicId, id, body.outcome as OutreachOutcome, s.employeeId!, body.note,
      );
    });

    await track(s, 'retention_record', { metadata: { outcome: body.outcome } });
    return { ok: true };
  });

  // ---- CLOSING: what tomorrow inherits (VS-03) ----
  app.get('/api/v1/handover', async (req) => {
    const s = await requireSession(req);
    const now = clock.now();

    const result = await withTenantContext(prisma, s.tenancy, async (tx) => {
      const clinicId = s.tenancy.clinicIds[0];
      if (s.tenancy.clinicIds.length !== 1 || !clinicId) return null;
      const clinic = await tx.clinic.findUnique({ where: { id: clinicId } });
      if (!clinic) return null;
      return buildHandover(tx, clock, clinicId, clinicLocalDate(now, clinic.timezone));
    });

    await track(s, 'view_handover');
    return result ?? { periodKey: null, clear: true, unfinished: [], waitingOnSomeone: [], stillOpen: [], patientsNotSeen: [] };
  });

  // ---- the clinic at a glance ----
  app.get('/api/v1/overview', async (req) => {
    const s = await requireSession(req);

    const result = await withTenantContext(prisma, s.tenancy, async (tx) => {
      const clinicId = s.tenancy.clinicIds[0];
      if (s.tenancy.clinicIds.length !== 1 || !clinicId) return null;

      // Clinic-wide performance is not everyone's business: an assistant sees
      // their own work, not how the clinic is scoring.
      const decision = await checkPermission(tx, clock, {
        employeeId: s.employeeId!, organizationId: s.organizationId,
        clinicId, code: 'activity_instance:view_clinic',
      });
      if (!decision.allowed) {
        throw Object.assign(
          new Error('You do not have permission to see the clinic overview.'),
          { statusCode: 403 },
        );
      }

      const clinic = await tx.clinic.findUnique({ where: { id: clinicId } });
      if (!clinic) return null;
      return buildOverview(tx, clock, clinicId, clinic.timezone);
    });

    await track(s, 'view_overview');
    return result;
  });

  // ---- CAPA: the IMPROVE stage of the §8 loop ----
  //
  // Every route here is a step of the requirement's chain: what happened →
  // immediate correction → root cause → corrective and preventive actions →
  // responsible person and due date → verification → closed. The service
  // refuses out-of-order steps; these routes only carry the refusal through
  // with a status the UI can show.

  app.get('/api/v1/incidents', async (req) => {
    const s = await requireSession(req);
    const q = z.object({ includeClosed: z.enum(['true', 'false']).optional() }).parse(req.query);

    const result = await withTenantContext(prisma, s.tenancy, async (tx) => {
      const clinicId = s.tenancy.clinicIds[0];
      if (s.tenancy.clinicIds.length !== 1 || !clinicId) return [];
      return listIncidents(tx, clock, s.organizationId, clinicId, {
        includeClosed: q.includeClosed === 'true',
      });
    });
    await track(s, 'view_incidents');
    return result;
  });

  app.get('/api/v1/incidents/:id', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return withTenantContext(prisma, s.tenancy, async (tx) => {
      const inc = await tx.incident.findUniqueOrThrow({
        where: { id },
        include: { actions: { orderBy: { createdAt: 'asc' } } },
      });
      return inc;
    });
  });

  app.post('/api/v1/incidents', async (req) => {
    const s = await requireSession(req);
    const body = z.object({
      summary: z.string().min(1).max(300),
      description: z.string().max(2000).optional(),
      parameter: z.string(),
      priority: z.string(),
    }).parse(req.body);

    return withTenantContext(prisma, s.tenancy, async (tx) => {
      const clinicId = s.tenancy.clinicIds[0];
      if (!clinicId) throw Object.assign(new Error('No clinic in context.'), { statusCode: 400 });
      const inc = await raiseIncident(tx, clock, {
        organizationId: s.organizationId,
        clinicId,
        parameter: body.parameter as never,
        priority: body.priority,
        summary: body.summary,
        ...(body.description ? { description: body.description } : {}),
        ...(s.employeeId ? { reportedByEmployeeId: s.employeeId } : {}),
      });
      await writeAudit(tx, {
        organizationId: s.organizationId, clinicId,
        actorEmployeeId: s.employeeId, action: 'INCIDENT_RAISED',
        entityType: 'incident', entityId: inc.id,
      });
      return inc;
    });
  });

  /** Wraps a CAPA step so a rule refusal reads as 409, not 500. */
  const capaStep = <T>(fn: () => Promise<T>) =>
    fn().catch((e) => {
      if (e instanceof CapaRuleError) {
        throw Object.assign(new Error(e.message), { statusCode: 409, code: e.code });
      }
      throw e;
    });

  app.post('/api/v1/incidents/:id/contain', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ immediateCorrection: z.string().min(1).max(1000) }).parse(req.body);
    const out = await capaStep(() => withTenantContext(prisma, s.tenancy, (tx) =>
      containIncident(tx, clock, id, body.immediateCorrection)));
    await track(s, 'capa_contain');
    return out;
  });

  app.post('/api/v1/incidents/:id/investigate', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ rootCause: z.string().min(1).max(1000) }).parse(req.body);
    const out = await capaStep(() => withTenantContext(prisma, s.tenancy, (tx) =>
      investigateIncident(tx, clock, id, body.rootCause)));
    await track(s, 'capa_investigate');
    return out;
  });

  app.post('/api/v1/incidents/:id/actions', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      type: z.enum(['CORRECTIVE', 'PREVENTIVE']),
      description: z.string().min(1).max(1000),
      responsibleEmployeeId: z.string().uuid(),
      dueAt: z.string().datetime(),
    }).parse(req.body);
    const out = await capaStep(() => withTenantContext(prisma, s.tenancy, (tx) =>
      addAction(tx, id, {
        type: body.type,
        description: body.description,
        responsibleEmployeeId: body.responsibleEmployeeId,
        dueAt: new Date(body.dueAt),
      })));
    await track(s, 'capa_add_action');
    return out;
  });

  app.post('/api/v1/capa-actions/:id/implement', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const out = await capaStep(() => withTenantContext(prisma, s.tenancy, (tx) =>
      implementAction(tx, clock, id)));
    await track(s, 'capa_implement_action');
    return out;
  });

  // FRS §6: the effectiveness check can send an action BACK, and that return
  // path is the point. `effective: false` is not an error condition.
  app.post('/api/v1/capa-actions/:id/effectiveness', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      effective: z.boolean(),
      note: z.string().max(500).optional(),
    }).parse(req.body);
    const out = await capaStep(() => withTenantContext(prisma, s.tenancy, (tx) =>
      checkEffectiveness(tx, clock, id, s.employeeId!, body.effective, body.note)));
    await track(s, 'capa_effectiveness_check');
    return out;
  });

  app.post('/api/v1/incidents/:id/close', async (req) => {
    const s = await requireSession(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const out = await capaStep(() => withTenantContext(prisma, s.tenancy, (tx) =>
      closeIncident(tx, clock, id)));
    await track(s, 'capa_close');
    return out;
  });

  app.get('/health', async () => ({ ok: true }));

  return app;
}
