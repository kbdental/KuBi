/**
 * The event log, and the restart it has to survive.
 *
 * The claim under test is the whole of §16: *"The event log is the only truth.
 * Everything else is a projection."* If that is true then a fresh process,
 * holding nothing, can read PostgreSQL and rebuild a clinic that behaves
 * identically — same flows, same owners, same timers, same refusals.
 *
 * Every test below uses a brand-new `EventStore` for the "after restart" half.
 * That is as close as a test gets to pulling the plug.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import { EventStore, EventStoreError, clinicMinute } from '../../apps/api/src/platform/events/event-store.js';
import { FixedClock } from '../../apps/api/src/shared/clock.js';
import {
  ClinicEvent, RoleCode, decisions, decisionsFor, sweep, ownerOf, readiness,
} from '../../packages/contracts/src/index.js';

const T = (h: number, m: number) => h * 60 + m;
const NOW = new Date('2026-08-06T04:00:00.000Z');   // 09:30 Asia/Kolkata

let env: DemoEnvironment;
const suffix = randomUUID().slice(0, 6);
/** A fresh store, as if the process had just started. */
const freshStore = () => new EventStore(new FixedClock(NOW));

beforeAll(async () => { env = await seedVs01Demo(suffix); }, 90_000);
afterAll(async () => { await prisma.$disconnect(); });

function inClinic<T2>(fn: (tx: never) => Promise<T2>): Promise<T2> {
  return withTenantContext(
    prisma,
    { organizationId: env.organizationId, clinicIds: [env.clinicId], crossClinic: false },
    fn as never,
  );
}
const db = (tx: never) => tx as never as typeof prisma;

/** Record an event and fail loudly if the clinic refused it. */
async function say(
  tx: never, store: EventStore, type: ClinicEvent, subjectId: string,
  by: RoleCode, now: number, label?: string, key?: string,
) {
  const r = await store.append(tx as never, {
    organizationId: env.organizationId,
    clinicId: env.clinicId,
    type, subjectId, byRole: by,
    ...(label ? { subjectLabel: label } : {}),
    idempotencyKey: key ?? `${type}:${subjectId}:${randomUUID().slice(0, 8)}`,
  }, now);
  if (!r.outcome.ok) throw new Error(`refused: ${r.outcome.refusal.because}`);
  return r;
}

/**
 * Do the morning, against the operatories this clinic actually has.
 *
 * The room ids come from the seeded master rather than from a list here, so
 * this fixture is doing the same thing an assistant does: preparing the rooms
 * that exist. Add a fifth operatory to the seed and this prepares five.
 */
async function openTheClinic(tx: never, store: EventStore, tag: string) {
  const day = `day-${tag}`;
  await say(tx, store, ClinicEvent.CLINIC_UNLOCKED, day, RoleCode.RECEPTION, T(8, 30), 'the clinic');

  const b = `batch-${tag}`;
  await say(tx, store, ClinicEvent.BATCH_COLLECTED, b, RoleCode.STERILIZATION_TECHNICIAN, T(8, 0), 'STER-1');
  await say(tx, store, ClinicEvent.BATCH_ULTRASONIC_DONE, b, RoleCode.STERILIZATION_TECHNICIAN, T(8, 10));
  await say(tx, store, ClinicEvent.BATCH_PACKED, b, RoleCode.STERILIZATION_TECHNICIAN, T(8, 20));
  await say(tx, store, ClinicEvent.BATCH_AUTOCLAVED, b, RoleCode.STERILIZATION_TECHNICIAN, T(8, 25));
  await say(tx, store, ClinicEvent.BATCH_RELEASED, b, RoleCode.SENIOR_ASSISTANT, T(8, 30));

  const rooms = await db(tx).operatory.findMany({
    where: { clinicId: env.clinicId, archivedAt: null }, orderBy: { position: 'asc' },
  });
  for (const room of rooms) {
    await say(tx, store, ClinicEvent.OPERATORY_READY, room.id,
      RoleCode.DENTAL_ASSISTANT, T(8, 35), room.label);
  }
  await say(tx, store, ClinicEvent.EQUIPMENT_VERIFIED, day, RoleCode.DENTAL_ASSISTANT, T(8, 36));
  await say(tx, store, ClinicEvent.STOCK_VERIFIED, day, RoleCode.DENTAL_ASSISTANT, T(8, 37));
  await say(tx, store, ClinicEvent.RECEPTION_READY, day, RoleCode.RECEPTION, T(8, 38));
  await say(tx, store, ClinicEvent.COMMON_AREAS_READY, day, RoleCode.HOUSEKEEPING, T(8, 39));

  await say(tx, store, ClinicEvent.ROOMS_READY, day, RoleCode.DENTAL_ASSISTANT, T(8, 40));
  await say(tx, store, ClinicEvent.HUDDLE_HELD, day, RoleCode.CLINIC_MANAGER, T(8, 50));
}

/* ═══════════════════════════════════════════════════════════════════════ */

describe('the log persists what happened', () => {
  it('writes one row per event, with both times', async () => {
    await inClinic(async (tx) => {
      const store = freshStore();
      const tag = randomUUID().slice(0, 6);
      await say(tx, store, ClinicEvent.CLINIC_UNLOCKED, `d-${tag}`, RoleCode.RECEPTION, T(8, 30), 'the clinic');

      const row = await db(tx).clinicEventRow.findFirstOrThrow({
        where: { subjectId: `d-${tag}` },
      });
      expect(row.type).toBe(ClinicEvent.CLINIC_UNLOCKED);
      expect(row.byRole).toBe(RoleCode.RECEPTION);
      // Two times, deliberately: when it happened, and when it was typed.
      expect(row.occurredMinute).toBe(T(8, 30));
      expect(row.occurredAt).toBeInstanceOf(Date);
      expect(row.recordedAt).toBeInstanceOf(Date);
    });
  });

  it('keeps events in the order they were recorded', async () => {
    await inClinic(async (tx) => {
      const store = freshStore();
      const tag = randomUUID().slice(0, 6);
      await openTheClinic(tx, store, tag);
      const rows = await db(tx).clinicEventRow.findMany({
        where: { subjectId: `batch-${tag}` }, orderBy: { seq: 'asc' },
      });
      expect(rows.map((r) => r.type)).toEqual([
        ClinicEvent.BATCH_COLLECTED, ClinicEvent.BATCH_ULTRASONIC_DONE,
        ClinicEvent.BATCH_PACKED, ClinicEvent.BATCH_AUTOCLAVED, ClinicEvent.BATCH_RELEASED,
      ]);
      // Sequence is monotonic. Replay reads in this order and nothing else.
      const seqs = rows.map((r) => Number(r.seq));
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    });
  });

  it('writes nothing at all when the clinic refuses', async () => {
    await inClinic(async (tx) => {
      const store = freshStore();
      const tag = randomUUID().slice(0, 6);
      const before = await db(tx).clinicEventRow.count();

      // A subject-scoped refusal on purpose. The log is one cumulative story
      // per clinic, so a day-level fact — "a sterile pack has been released"
      // — is true the moment any earlier test releases one, and asserting on
      // it would make this test pass or fail on its position in the file.
      // This patient's medical history has never been touched by anybody, and
      // no amount of unrelated history in the log can make it so.
      const r = await store.append(tx as never, {
        organizationId: env.organizationId, clinicId: env.clinicId,
        type: ClinicEvent.TREATMENT_FINISHED, subjectId: `p-${tag}`,
        byRole: RoleCode.TREATING_DOCTOR, idempotencyKey: `x-${tag}`,
      }, T(9, 30));

      expect(r.outcome.ok).toBe(false);
      expect(r.outcome.ok === false && r.outcome.refusal.because)
        .toBe('The medical history has not been updated');
      // A refused event is not an event.
      expect(await db(tx).clinicEventRow.count()).toBe(before);
    });
  });
});

describe('the same click twice', () => {
  it('records one event and says so', async () => {
    await inClinic(async (tx) => {
      const store = freshStore();
      const tag = randomUUID().slice(0, 6);
      const key = `once-${tag}`;

      const first = await say(tx, store, ClinicEvent.CLINIC_UNLOCKED, `d-${tag}`,
        RoleCode.RECEPTION, T(8, 30), 'the clinic', key);
      expect(first.duplicate).toBe(false);

      // The same key again — a retry on a slow connection, or a double tap.
      const again = await store.append(tx as never, {
        organizationId: env.organizationId, clinicId: env.clinicId,
        type: ClinicEvent.CLINIC_UNLOCKED, subjectId: `d-${tag}`,
        byRole: RoleCode.RECEPTION, idempotencyKey: key,
      }, T(8, 31));

      expect(again.duplicate).toBe(true);
      expect(await db(tx).clinicEventRow.count({ where: { idempotencyKey: key } })).toBe(1);
    });
  });
});

describe('an event that makes no sense is refused before it reaches the log', () => {
  it('refuses an unknown event type', async () => {
    await inClinic(async (tx) => {
      const store = freshStore();
      await expect(store.append(tx as never, {
        organizationId: env.organizationId, clinicId: env.clinicId,
        type: 'PATIENT_TELEPORTED' as ClinicEvent, subjectId: 'p1',
        byRole: RoleCode.RECEPTION, idempotencyKey: `bad-${randomUUID()}`,
      }, T(9, 0))).rejects.toThrow(EventStoreError);
    });
  });

  it('refuses an unknown role, a blank subject and a missing key', async () => {
    await inClinic(async (tx) => {
      const store = freshStore();
      const base = {
        organizationId: env.organizationId, clinicId: env.clinicId,
        type: ClinicEvent.CLINIC_UNLOCKED, subjectId: 'today',
        byRole: RoleCode.RECEPTION, idempotencyKey: `k-${randomUUID()}`,
      };
      await expect(store.append(tx as never, { ...base, byRole: 'WIZARD' as RoleCode }, 0))
        .rejects.toThrow(/not a role/);
      await expect(store.append(tx as never, { ...base, subjectId: '  ' }, 0))
        .rejects.toThrow(/about something/);
      await expect(store.append(tx as never, { ...base, idempotencyKey: '' }, 0))
        .rejects.toThrow(/idempotency/);
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   RESTART SURVIVAL — the point of all of it
   ═══════════════════════════════════════════════════════════════════════ */

describe('restart survival', () => {
  it('rebuilds the same flows, at the same nodes, from the log alone', async () => {
    const tag = randomUUID().slice(0, 6);
    let before: ReturnType<typeof decisions>;

    await inClinic(async (tx) => {
      const store = freshStore();
      await openTheClinic(tx, store, tag);
      await say(tx, store, ClinicEvent.PATIENT_ARRIVED, `p-${tag}`, RoleCode.RECEPTION, T(9, 0), 'Meera R.');
      await say(tx, store, ClinicEvent.PATIENT_REGISTERED, `p-${tag}`, RoleCode.RECEPTION, T(9, 5));
      const w = await store.replay(tx as never, env.clinicId, T(9, 30));
      before = decisions(w, T(9, 30));
    });

    // The plug comes out. A different EventStore, holding nothing.
    await inClinic(async (tx) => {
      const after = decisions(await freshStore().replay(tx as never, env.clinicId, T(9, 30)), T(9, 30));
      expect(after.map((d) => d.id)).toEqual(before.map((d) => d.id));
      expect(after.map((d) => d.node)).toEqual(before.map((d) => d.node));
    });
  });

  it('preserves ownership — the assistant still holds what the assistant held', async () => {
    const tag = randomUUID().slice(0, 6);
    await inClinic(async (tx) => {
      const store = freshStore();
      await openTheClinic(tx, store, tag);
      await say(tx, store, ClinicEvent.PATIENT_ARRIVED, `p-${tag}`, RoleCode.RECEPTION, T(9, 0), 'Kabir S.');
      await say(tx, store, ClinicEvent.PATIENT_REGISTERED, `p-${tag}`, RoleCode.RECEPTION, T(9, 5));
    });

    await inClinic(async (tx) => {
      const w = await freshStore().replay(tx as never, env.clinicId, T(9, 30));
      const visit = w.flows.find((f) => f.subjectId === `p-${tag}`)!;
      expect(ownerOf(visit)).toBe(RoleCode.DENTAL_ASSISTANT);
      expect(decisionsFor(w, RoleCode.DENTAL_ASSISTANT, T(9, 30))
        .some((d) => d.subjectLabel === 'Kabir S.')).toBe(true);
      expect(decisionsFor(w, RoleCode.RECEPTION, T(9, 30))
        .some((d) => d.subjectLabel === 'Kabir S.')).toBe(false);
    });
  });

  it('preserves the clock — a patient who waited twenty minutes still has', async () => {
    const tag = randomUUID().slice(0, 6);
    await inClinic(async (tx) => {
      const store = freshStore();
      await openTheClinic(tx, store, tag);
      await say(tx, store, ClinicEvent.PATIENT_ARRIVED, `p-${tag}`, RoleCode.RECEPTION, T(9, 0), 'Devika N.');
      await say(tx, store, ClinicEvent.PATIENT_REGISTERED, `p-${tag}`, RoleCode.RECEPTION, T(9, 5));
    });

    await inClinic(async (tx) => {
      // The seat node expects 15 minutes and was handed over at 09:05, so at
      // 09:30 it is ten minutes over — and that has to come out of the log,
      // not out of when the process happened to start.
      const w = await freshStore().replay(tx as never, env.clinicId, T(9, 30));
      const late = sweep(w, T(9, 30)).alerts.find((a) => a.subjectLabel === 'Devika N.');
      expect(late).toBeDefined();
      expect(late!.minutesLate).toBe(10);
      expect(late!.escalatedTo).toBe(RoleCode.CLINIC_MANAGER);
    });
  });

  it('preserves governance — a refusal before the restart is a refusal after it', async () => {
    const tag = randomUUID().slice(0, 6);
    await inClinic(async (tx) => {
      const store = freshStore();
      await openTheClinic(tx, store, tag);
      await say(tx, store, ClinicEvent.PATIENT_ARRIVED, `p-${tag}`, RoleCode.RECEPTION, T(9, 0), 'Arjun P.');
      await say(tx, store, ClinicEvent.PATIENT_REGISTERED, `p-${tag}`, RoleCode.RECEPTION, T(9, 5));
      await say(tx, store, ClinicEvent.PATIENT_SEATED, `p-${tag}`, RoleCode.DENTAL_ASSISTANT, T(9, 10));
      await say(tx, store, ClinicEvent.DIAGNOSIS_RECORDED, `p-${tag}`, RoleCode.TREATING_DOCTOR, T(9, 20));
      await say(tx, store, ClinicEvent.PLAN_ACCEPTED, `p-${tag}`, RoleCode.TREATING_DOCTOR, T(9, 25));
    });

    await inClinic(async (tx) => {
      const store = freshStore();
      // Consent was never signed. The restart must not lose that.
      const r = await store.append(tx as never, {
        organizationId: env.organizationId, clinicId: env.clinicId,
        type: ClinicEvent.TREATMENT_FINISHED, subjectId: `p-${tag}`,
        byRole: RoleCode.TREATING_DOCTOR, idempotencyKey: `t-${tag}`,
      }, T(10, 0));
      expect(r.outcome.ok).toBe(false);
      if (r.outcome.ok) return;
      expect(r.outcome.refusal.because).toBe('There is no signed consent for this procedure');
    });
  });

  it('has no second source of truth — no flow, owner or timer is stored', async () => {
    // §16: everything except the log is a projection. If a `flows` table ever
    // appears, this fails and somebody has to justify it.
    const tables: Array<{ table_name: string }> = await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('flows','flow_nodes','ownership','decisions','timers')`,
    );
    expect(tables).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════ */

describe('the log cannot be rewritten', () => {
  /**
   * The migration claims append-only *by GRANT, not by good manners*. That is
   * a claim about PostgreSQL, so it is tested against PostgreSQL rather than
   * against the code that politely declines to write the statement.
   *
   * `prisma` here connects as `kubi_app` — the role the running application
   * uses. If a future migration hands it UPDATE back, these fail, and no
   * amount of careful application code will be asked to compensate.
   */
  it('refuses an UPDATE, a DELETE and a TRUNCATE from the application role', async () => {
    const tag = randomUUID().slice(0, 6);
    await inClinic(async (tx) => {
      await say(tx, freshStore(), ClinicEvent.CLINIC_UNLOCKED, `imm-${tag}`,
        RoleCode.RECEPTION, T(8, 30), 'the clinic');
    });

    await expect(prisma.$executeRawUnsafe(
      `UPDATE clinic_events SET type = 'TAMPERED' WHERE subject_id = '${`imm-${tag}`}'`,
    )).rejects.toThrow(/permission denied/i);

    await expect(prisma.$executeRawUnsafe(
      `DELETE FROM clinic_events WHERE subject_id = '${`imm-${tag}`}'`,
    )).rejects.toThrow(/permission denied/i);

    await expect(prisma.$executeRawUnsafe('TRUNCATE clinic_events'))
      .rejects.toThrow(/permission denied|must be owner/i);

    // Still there, unaltered, after all three attempts. Read inside a tenant
    // transaction: RLS context is transaction-scoped, so the same SELECT run
    // outside one returns zero rows by design and would "pass" for the wrong
    // reason.
    await inClinic(async (tx) => {
      const rows = await db(tx).clinicEventRow.findMany({
        where: { subjectId: `imm-${tag}` },
      });
      expect(rows.map((r) => r.type)).toEqual([ClinicEvent.CLINIC_UNLOCKED]);
    });
  });

  it('does not let the application role bypass row-level security', async () => {
    // A BYPASSRLS grant would make every policy above decorative. The
    // migration refuses to apply if this is ever true; this checks it stayed
    // false afterwards.
    const rows: Array<{ rolbypassrls: boolean }> = await prisma.$queryRawUnsafe(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'kubi_app'`,
    );
    expect(rows[0]?.rolbypassrls).toBe(false);
  });
});

describe('the operatory master drives the morning', () => {
  it('builds the readiness plan from the rows, not from a constant', async () => {
    await inClinic(async (tx) => {
      const rooms = await db(tx).operatory.findMany({
        where: { clinicId: env.clinicId, archivedAt: null },
      });
      // The owner has four. If the seed ever says otherwise this fails, which
      // is the point — the number is data.
      expect(rooms).toHaveLength(4);

      const w = await freshStore().replay(tx as never, env.clinicId, T(9, 0));
      const r = readiness(w.events, w.operatories, w.firstPatientAt, T(9, 0));
      const perRoom = r.blocks.filter((b) => b.id.startsWith('OPERATORY:'));
      expect(perRoom).toHaveLength(4);
      expect(perRoom.map((b) => b.label).sort())
        .toEqual(['Prepare Operatory 1', 'Prepare Operatory 2',
          'Prepare Operatory 3', 'Prepare Operatory 4']);
    });
  });

  it('picks up a fifth operatory on the next request, not the next restart', async () => {
    const label = `Operatory 5 ${randomUUID().slice(0, 4)}`;
    await inClinic(async (tx) => {
      await db(tx).operatory.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          label, position: 5,
        },
      });
      // Same store, no restart. Master data is read every replay.
      const w = await freshStore().replay(tx as never, env.clinicId, T(9, 0));
      expect(w.operatories.map((o) => o.label)).toContain(label);
      expect(readiness(w.events, w.operatories, w.firstPatientAt, T(9, 0))
        .blocks.filter((b) => b.id.startsWith('OPERATORY:'))).toHaveLength(5);
    });
  });

  it('leaves an archived operatory out of the morning', async () => {
    await inClinic(async (tx) => {
      const extra = await db(tx).operatory.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          label: `Decommissioned ${randomUUID().slice(0, 4)}`, position: 9,
        },
      });
      // Archived, never deleted — the working agreement for master data.
      await db(tx).operatory.update({
        where: { id: extra.id }, data: { archivedAt: new Date('2026-08-08T00:00:00Z') },
      });
      const w = await freshStore().replay(tx as never, env.clinicId, T(9, 0));
      expect(w.operatories.map((o) => o.id)).not.toContain(extra.id);
    });
  });
});

describe('the clinic-local minute', () => {
  it('reads the clinic zone rather than the server one', () => {
    // 04:00 UTC is 09:30 in Kolkata. A server in another timezone must not
    // move the clinic's morning.
    expect(clinicMinute(NOW, 'Asia/Kolkata')).toBe(T(9, 30));
    expect(clinicMinute(NOW, 'UTC')).toBe(T(4, 0));
  });
});
