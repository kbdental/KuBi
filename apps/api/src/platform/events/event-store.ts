/**
 * The event log, and the replay that rebuilds the world from it.
 *
 * Specification §16. *"The event log is the only truth. Everything else is a
 * projection."*
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why there is no `flows` table
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Because a flow is `record()` applied to the events in order, and a stored
 * copy is a second thing that can be wrong. Every restart replays; every
 * replay produces the same world; and there is no migration to write the day
 * somebody changes a workflow, because the workflow was never written down
 * anywhere but the code.
 *
 * The cost is a fold over the day's events on start-up. At clinic scale that
 * is a few thousand rows, and this comment exists so that whoever finds it
 * slow knows the trade before adding the column back.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What replay does NOT re-run
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Governance. An event in the log was admitted when it happened; re-admitting
 * it now would let a rule written next month retroactively delete a treatment
 * that really occurred. History is not re-litigated — it is replayed.
 */
import {
  ClinicEvent, RoleCode, emptyWorld, record,
  type World, type EventOutcome,
} from '@kubi/contracts';
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';

export class EventStoreError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'EventStoreError';
  }
}

/** Clinic-local minutes since midnight, from an instant and a zone offset. */
export function clinicMinute(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

export interface AppendInput {
  organizationId: string;
  clinicId: string;
  type: ClinicEvent;
  subjectId: string;
  subjectLabel?: string;
  byRole: RoleCode;
  byEmployeeId?: string;
  /** The caller's own id. A retry carries the same one and inserts nothing. */
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

const KNOWN_EVENTS = new Set<string>(Object.values(ClinicEvent));
const KNOWN_ROLES = new Set<string>(Object.values(RoleCode));

export class EventStore {
  constructor(private readonly clock: Clock, private readonly timezone = 'Asia/Kolkata') {}

  /**
   * Rebuild the world from the log.
   *
   * `now` is passed in rather than read, so a caller can ask what the world
   * looked like at 10:14 as easily as what it looks like now.
   */
  async replay(tx: TenantPrisma, clinicId: string, now: number): Promise<World> {
    const rows = await tx.clinicEventRow.findMany({
      where: { clinicId },
      orderBy: { seq: 'asc' },
    });

    let w: World = emptyWorld(rows[0]?.occurredMinute ?? now);
    for (const r of rows) {
      // Each event is applied at the minute it happened, so waiting times and
      // lateness come out of the log rather than out of the replay's own
      // start-up moment.
      w = { ...w, now: r.occurredMinute };
      const out = record(w, {
        type: r.type as ClinicEvent,
        subjectId: r.subjectId,
        by: r.byRole as RoleCode,
        ...(r.subjectLabel ? { subjectLabel: r.subjectLabel } : {}),
      });
      // A refusal during replay means a rule changed since the event was
      // admitted. The event still happened, so the world takes it: the log is
      // the truth and the rule is the opinion.
      if (out.ok) w = out.world;
      else w = { ...w, events: [...w.events, {
        seq: w.events.length + 1,
        type: r.type as ClinicEvent,
        subjectId: r.subjectId,
        at: r.occurredMinute,
        by: r.byRole as RoleCode,
      }] };
    }
    return { ...w, now };
  }

  /**
   * Record something that happened.
   *
   * Governance runs against the world as it stands, and a refusal writes
   * nothing at all — a refused event is not an event. The append and the
   * decision to append are one transaction, so two people recording the same
   * thing at once cannot both be told yes.
   */
  async append(
    tx: TenantPrisma, input: AppendInput, now: number,
  ): Promise<{ outcome: EventOutcome; duplicate: boolean }> {
    if (!KNOWN_EVENTS.has(input.type)) {
      throw new EventStoreError(`"${input.type}" is not a clinic event`, 'UNKNOWN_EVENT');
    }
    if (!KNOWN_ROLES.has(input.byRole)) {
      throw new EventStoreError(`"${input.byRole}" is not a role`, 'UNKNOWN_ROLE');
    }
    if (!input.subjectId.trim()) {
      throw new EventStoreError('An event must be about something', 'NO_SUBJECT');
    }
    if (!input.idempotencyKey.trim()) {
      throw new EventStoreError('An event must carry an idempotency key', 'NO_KEY');
    }

    const already = await tx.clinicEventRow.findFirst({
      where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
      select: { seq: true },
    });
    if (already) {
      // The same click twice. Report the world as it is and write nothing.
      const world = await this.replay(tx, input.clinicId, now);
      return { outcome: { ok: true, world, consequences: [] }, duplicate: true };
    }

    const world = await this.replay(tx, input.clinicId, now);
    const outcome = record(world, {
      type: input.type,
      subjectId: input.subjectId,
      by: input.byRole,
      ...(input.subjectLabel ? { subjectLabel: input.subjectLabel } : {}),
    });
    if (!outcome.ok) return { outcome, duplicate: false };

    const at = this.clock.now();
    await tx.clinicEventRow.create({
      data: {
        organizationId: input.organizationId,
        clinicId: input.clinicId,
        type: input.type,
        subjectId: input.subjectId,
        subjectLabel: input.subjectLabel ?? null,
        occurredAt: at,
        occurredMinute: now,
        byRole: input.byRole,
        byEmployeeId: input.byEmployeeId ?? null,
        payload: (input.payload ?? {}) as never,
        idempotencyKey: input.idempotencyKey,
      },
    });

    return { outcome, duplicate: false };
  }

  /** The clinic-local minute right now. */
  minuteNow(): number {
    return clinicMinute(this.clock.now(), this.timezone);
  }
}
