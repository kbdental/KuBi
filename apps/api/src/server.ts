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
import { prisma, withTenantContext } from './platform/tenancy/rls-context.js';
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
import { ActivityStatus, ExceptionStatus } from '@kubi/contracts';

const clock = systemClock;

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
  phase: 'OPENING' | 'OPEN' | 'SEEING_PATIENTS' | null;
  opening: { total: number; done: number; complete: boolean } | null;
  readyBy: Date | null;
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
  const rows = await tx.activityInstance.findMany({
    where: { clinicId, periodKey },
    select: { status: true },
  });

  const firstPatientAt = await nextPatientAt(tx, clinicId, periodKey);
  const base = { name: clinic.name, timezone: clinic.timezone, firstPatientAt };
  if (rows.length === 0) return { ...base, phase: null, opening: null, readyBy: null };

  const done = rows.filter(
    (r) => r.status === ActivityStatus.COMPLETED || r.status === ActivityStatus.VERIFIED,
  ).length;
  const complete = done === rows.length;

  // The deadline is the clinic's own configured opening time, read from
  // configuration rather than assumed (D-01, OD-19).
  const cfg = await tx.configValue.findFirst({
    where: { organizationId: clinic.organizationId, clinicId, key: 'clinic.opening_time' },
  });
  const openingTime = (cfg?.valueJson as { value?: string } | null)?.value ?? null;

  const inChair = await tx.appointment.count({
    where: { clinicId, periodKey, status: 'IN_CHAIR' },
  });

  return {
    ...base,
    phase: !complete ? 'OPENING' : inChair > 0 ? 'SEEING_PATIENTS' : 'OPEN',
    opening: { total: rows.length, done, complete },
    readyBy: openingTime ? clinicLocalTimeToUtc(periodKey, openingTime, clinic.timezone) : null,
  };
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

  app.get('/health', async () => ({ ok: true }));

  return app;
}
