/**
 * The thing that makes KuBi run a clinic rather than describe one.
 *
 * Until this existed the generators were complete, idempotent and tested — and
 * nothing called them. A morning checklist that only appears when a test asks
 * for it is not an operating system; it is a library.
 *
 * What it does is deliberately small: for every active clinic, generate today's
 * opening and closing sets and sweep anything past its deadline. All three are
 * idempotent, so running it every few minutes is not merely safe, it is the
 * design — a clinic whose configuration is fixed at 09:20 gets its morning at
 * 09:20 rather than tomorrow.
 *
 * ---
 *
 * The interesting problem is tenancy. To generate every clinic's morning the
 * scheduler must first know which clinics exist, and it cannot scope itself to
 * an organisation it has not yet identified — the same shape of problem
 * authentication has. This system has no ungoverned global scope and is not
 * getting one for a cron job, so the answer is the same as for login: one
 * narrow SECURITY DEFINER function, owned by a role whose entire capability is
 * that function, returning three non-sensitive columns. See migration 0013.
 *
 * Everything after the enumeration runs inside a normal tenant context. The
 * scheduler is not privileged; it is a caller that happens to know the list.
 */
import { prisma, type TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { logger } from '../../shared/logging/logger.js';
import {
  generateOpeningTasks, generateClosingTasks, generateStandingTasks, sweepOverdue,
} from './scheduler.service.js';

export interface ClinicRef {
  organizationId: string;
  clinicId: string;
  timezone: string;
}

export interface DailyRunResult {
  clinics: number;
  created: number;
  swept: number;
  /**
   * Definitions that are enabled but whose due rule KuBi could not resolve, so
   * nothing was generated for them. Reported rather than swallowed: a clinic
   * with unscheduled requirements should know the number, and a zero here is
   * the only honest way to claim full coverage.
   */
  unscheduled: number;
  /** Clinics whose run threw. The run continues past them, by design. */
  failed: Array<{ clinicId: string; error: string }>;
}

/**
 * Every active clinic, across every organisation.
 *
 * Reads through `kubi_list_active_clinics()` rather than the ORM: a plain
 * `clinic.findMany()` from kubi_app returns zero rows by design, and the fix
 * for that is emphatically not to widen a policy.
 */
export async function listActiveClinics(client: TenantPrisma = prisma): Promise<ClinicRef[]> {
  const rows = await client.$queryRaw<
    Array<{ organization_id: string; clinic_id: string; timezone: string }>
  >`SELECT * FROM kubi_list_active_clinics()`;

  return rows.map((r) => ({
    organizationId: r.organization_id,
    clinicId: r.clinic_id,
    timezone: r.timezone,
  }));
}

/**
 * One pass over every clinic. Safe to call repeatedly and safe to call
 * concurrently: generation is guarded by a unique constraint on
 * (definition, scope, period), so a duplicate run creates nothing twice.
 */
export async function runDailyGeneration(
  clock: Clock,
  client: TenantPrisma = prisma,
): Promise<DailyRunResult> {
  const clinics = await listActiveClinics(client);
  const result: DailyRunResult = {
    clinics: clinics.length, created: 0, swept: 0, unscheduled: 0, failed: [],
  };

  for (const c of clinics) {
    // One clinic's bad configuration must not stop every other clinic getting
    // its morning. The failure is recorded and the run continues.
    try {
      const opening = await generateOpeningTasks(client, clock, c.organizationId, c.clinicId);
      const closing = await generateClosingTasks(client, clock, c.organizationId, c.clinicId);
      // Everything that is neither opening nor closing — attendance,
      // sterilisation, equipment checks, audits. Without this the two named
      // sets were the only work a clinic ever saw, however much was enabled.
      const standing = await generateStandingTasks(client, clock, c.organizationId, c.clinicId);
      const swept = await sweepOverdue(client, clock, c.organizationId, c.clinicId);

      result.created += opening.created + closing.created + standing.created;
      result.unscheduled += standing.unscheduled;
      result.swept += swept;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // clinicId only — never the clinic's name, and never the error object,
      // which can carry row data into the log.
      logger.error({ clinicId: c.clinicId, errorName: (e as Error).name }, 'daily run failed for clinic');
      result.failed.push({ clinicId: c.clinicId, error });
    }
  }

  return result;
}

/**
 * Start the recurring pass, returning a function that stops it.
 *
 * An interval rather than a cron expression, because the work is idempotent
 * and "have we generated today yet?" is a question the generators already
 * answer correctly. A cron firing once at 06:00 would leave a clinic that was
 * configured at 09:20 with no morning at all until tomorrow; a short interval
 * simply picks it up.
 *
 * Deliberately NOT distributed-lock aware. Two instances running this produce
 * the same rows and the same no-ops, which is a property worth having rather
 * than a hazard to engineer around. If that stops being true — because some
 * future run has side effects outside the database, like sending a message —
 * this is the place that needs a lock, and that is a decision to take then.
 */
export function startDailyRuns(
  clock: Clock,
  everyMs = 5 * 60_000,
): () => void {
  let running = false;

  const tick = async () => {
    // A slow pass must not overlap itself and double the database load.
    if (running) return;
    running = true;
    try {
      const r = await runDailyGeneration(clock);
      if (r.created > 0 || r.swept > 0 || r.failed.length > 0 || r.unscheduled > 0) {
        logger.info(
          {
            clinics: r.clinics, created: r.created, swept: r.swept,
            unscheduled: r.unscheduled, failed: r.failed.length,
          },
          'daily run',
        );
      }
    } catch (e) {
      // The loop survives anything. A scheduler that dies on one bad night is
      // worse than no scheduler, because everybody has stopped watching.
      logger.error({ errorName: (e as Error).name }, 'daily run pass failed');
    } finally {
      running = false;
    }
  };

  void tick();
  const handle = setInterval(() => void tick(), everyMs);
  // Never hold the process open on this alone.
  handle.unref?.();

  return () => clearInterval(handle);
}
