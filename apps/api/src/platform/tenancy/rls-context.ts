/**
 * KuBi — TD-4 repayment: centralized Prisma/RLS transaction-context enforcement.
 *
 * Phase 1's RLS spike proved a fact: a Prisma query run OUTSIDE a transaction
 * returns zero rows, because the RLS context is transaction-scoped (set via
 * `set_config(..., is_local => true)`) and nothing has set it. That is the
 * correct fail-closed behaviour, but it must not depend on every developer
 * remembering to call `prisma.$transaction`. Owner control 14 (Phase 2):
 * "Do not rely on individual developers remembering to wrap queries
 * correctly."
 *
 * This module makes it structurally impossible to run a tenant-scoped query
 * without an explicit, resolved TenancyContext:
 *
 *   1. `withTenantContext(prisma, ctx, fn)` is the ONLY way to obtain a
 *      request-scoped Prisma client. It opens a transaction, sets the three
 *      RLS session variables via parameterised set_config, and hands the
 *      transactional client to `fn`.
 *   2. The base `prisma` client exported from this module is wrapped with an
 *      extension whose query hook THROWS on any tenant-scoped model accessed
 *      outside that transaction — so a bare `prisma.patient.findMany()`
 *      fails loudly at the call site with a fixable error, rather than
 *      silently returning zero rows and leaving a developer to wonder why.
 *   3. System-level, cross-tenant operations (organisation bootstrap, the
 *      break-glass path) must call `withSystemContext`, which is separately
 *      named, separately audited, and never the default.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../../../../../node_modules/.prisma/client/client.js';
import type { TenancyContext } from '@kubi/contracts';
import { RLS_SETTINGS } from '@kubi/contracts';

/**
 * Models whose tables are tenant-scoped and therefore require a resolved
 * TenancyContext before any operation. Kept as an explicit allowlist rather
 * than "everything except X" — a new model defaults to REQUIRING context,
 * which is the safe default (fail closed, not fail open).
 */
const TENANT_SCOPED_MODELS = new Set([
  'Organization',
  'Clinic',
  'Patient',
  'User',
  'Employee',
  'EmployeeRole',
  'FunctionalAssignment',
  // VS-02. An appointment links a patient to a time and a place, so it is the
  // last thing that should ever be readable without a resolved tenancy.
  'Appointment',
]);

/** Thrown when a tenant-scoped query is attempted without a resolved context. */
export class MissingTenancyContextError extends Error {
  constructor(model: string, operation: string) {
    super(
      `[kubi-rls] Refused ${model}.${operation}: no tenancy context is active. ` +
        `Tenant-scoped queries must run inside withTenantContext(prisma, ctx, fn) ` +
        `or, for system-level operations only, withSystemContext(prisma, reason, fn). ` +
        `This is TD-4 (Phase 1) — do not work around it by calling the base client directly.`,
    );
    this.name = 'MissingTenancyContextError';
  }
}

/**
 * Async-local tracking of "is a tenancy context currently established".
 *
 * A WeakSet keyed on the Prisma client instance was tried first and is WRONG:
 * `Prisma.defineExtension((client) => ...)` captures `client` at EXTENSION
 * DEFINITION time — the base client — not the distinct transactional client
 * instance `$transaction` hands to its callback. Marking the transactional
 * instance as "established" therefore never matched what the query hook
 * checked, and the hook always saw "not established" — which happened to be
 * safe (fail closed) but would have made `withTenantContext` permanently
 * unusable. Caught by the verification script before this shipped; kept as a
 * note here because the failure mode is easy to reintroduce.
 *
 * AsyncLocalStorage is the correct primitive: it propagates through the
 * promise chain that `fn` runs in, regardless of which client object issues
 * the query, and clears automatically when the async scope exits.
 */
const contextStorage = new AsyncLocalStorage<{ mode: 'tenant' | 'system' }>();

function buildExtension() {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'kubi-rls-enforcement',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (model && TENANT_SCOPED_MODELS.has(model) && !contextStorage.getStore()) {
              throw new MissingTenancyContextError(model, operation);
            }
            return query(args);
          },
        },
      },
    }),
  );
}

/**
 * The base client. NEVER export this without the extension applied — every
 * call site should import `prisma` from this module, not construct its own.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.APP_DATABASE_URL }),
}).$extends(buildExtension());

export type TenantPrisma = typeof prisma;

async function setSessionVars(
  tx: TenantPrisma,
  org: string,
  clinics: readonly string[],
  crossClinic: boolean,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config(${RLS_SETTINGS.ORG}, ${org}, true)`;
  await tx.$executeRaw`SELECT set_config(${RLS_SETTINGS.CLINICS}, ${clinics.join(',')}, true)`;
  await tx.$executeRaw`SELECT set_config(${RLS_SETTINGS.CROSS_CLINIC}, ${String(crossClinic)}, true)`;
}

/**
 * THE sanctioned way to run tenant-scoped queries.
 *
 * Opens a transaction, sets the three RLS session variables with
 * `set_config(name, value, true)` — the parameterised, transaction-local form
 * proven safe under pooling by the Phase 1 spike (T6, T7, T9) — marks the
 * transactional client as context-established, and invokes `fn`.
 *
 * Any query issued through `fn`'s client on a tenant-scoped model is now
 * permitted; anything issued through the module-level `prisma` export
 * directly, outside this function, still throws.
 */
export async function withTenantContext<T>(
  client: TenantPrisma,
  ctx: TenancyContext,
  fn: (tx: TenantPrisma) => Promise<T>,
): Promise<T> {
  if (!ctx.organizationId) {
    throw new Error('[kubi-rls] withTenantContext requires a non-empty organizationId.');
  }
  return contextStorage.run({ mode: 'tenant' }, () =>
    client.$transaction(async (tx) => {
      await setSessionVars(tx as unknown as TenantPrisma, ctx.organizationId, ctx.clinicIds, ctx.crossClinic);
      return fn(tx as unknown as TenantPrisma);
    }),
  );
}

/**
 * The ONLY other sanctioned path: system-level operations that act WITHIN one
 * organisation but are not driven by an ordinary user's tenancy context —
 * organisation/clinic bootstrap (provisioning the org row itself, before any
 * employee or role exists to derive a context from) and the break-glass path.
 *
 * Deliberately asymmetric to `withTenantContext`:
 *   - requires a `reason` (never optional, minimum length enforced) — every
 *     call is expected to be individually justifiable in an audit review;
 *   - requires an explicit `orgId` rather than deriving one from a session,
 *     because bootstrap is inserting the very row a normal context would
 *     read. The RLS policy `organizations.id = kubi_current_org()` is
 *     satisfied by setting `kubi.org_id` to the SAME id being inserted —
 *     self-consistent, requires no BYPASSRLS, and grants nothing outside
 *     that one organisation;
 *   - always sets `cross_clinic = true` for that org, since a system-level
 *     actor by definition is not scoped to one clinic.
 *
 * Invoked from three call sites: `ProvisioningService`, `BreakGlassService`
 * (each of which writes its own audit event around the call), and
 * `session-context.service.ts`'s `resolveSession` — which is the
 * chicken-and-egg case of reading a user's OWN EmployeeRole grants in order
 * to compute the TenancyContext that every subsequent request in that
 * session will use. That read is scoped to the org already asserted by the
 * (signed, unforgeable) access token, so it cannot cross organisations; it
 * carries no elevated write capability and is not itself a permission
 * bypass. It must never be reachable from a request handler that an
 * ordinary permission grant can trigger for anyone OTHER than themselves —
 * there is no permission in the D1 catalogue that maps to it.
 */
export async function withSystemContext<T>(
  client: TenantPrisma,
  reason: string,
  orgId: string,
  fn: (tx: TenantPrisma) => Promise<T>,
): Promise<T> {
  if (!reason || reason.trim().length < 8) {
    throw new Error('[kubi-rls] withSystemContext requires a specific, non-trivial reason.');
  }
  if (!orgId) {
    throw new Error('[kubi-rls] withSystemContext requires an explicit orgId — there is no ungoverned global scope.');
  }
  return contextStorage.run({ mode: 'system' }, () =>
    client.$transaction(async (tx) => {
      await setSessionVars(tx as unknown as TenantPrisma, orgId, [], true);
      return fn(tx as unknown as TenantPrisma);
    }),
  );
}
