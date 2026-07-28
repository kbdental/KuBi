/**
 * KuBi — idempotent loaders for the permission catalogue (global) and the
 * 13 canonical roles + Phase 2 grants (per organisation). Owner control 11:
 * loaders must be idempotent and preserve provenance.
 */
import type { TenantPrisma } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { CANONICAL_ROLES } from './canonical-roles.js';

/**
 * NOTE: permission catalogue loading moved to
 * prisma/seed/seed-permission-catalogue.ts, run with MIGRATOR credentials.
 * kubi_app holds SELECT-only on `permissions` (migration 0004) — the
 * catalogue is global reference data managed like a migration, not written
 * by application code. Keeping a loader here that used tx.permission.upsert
 * would fail at runtime under the app role, which is exactly what caught
 * this during Phase 2 foundation testing.
 */

/**
 * Seeds the 13 canonical roles and their Phase 2 grants for ONE organisation.
 * MUST run inside a context already scoped to that organisation
 * (withSystemContext during provisioning, or withTenantContext for an
 * existing org). Upserts by (organizationId, code) — safe to re-run, and
 * re-running re-applies the current grant list rather than only adding.
 */
export async function loadCanonicalRolesForOrg(
  tx: TenantPrisma,
  organizationId: string,
): Promise<{ roles: number; grants: number }> {
  let grantCount = 0;
  for (const roleSeed of CANONICAL_ROLES) {
    const role = await tx.role.upsert({
      where: { organizationId_code: { organizationId, code: roleSeed.code } },
      create: { organizationId, code: roleSeed.code, name: roleSeed.name, isSystemRole: true },
      update: { name: roleSeed.name },
    });

    // Reconcile grants: remove any not in the current seed, add any missing.
    const existing = await tx.rolePermission.findMany({
      where: { roleId: role.id },
      include: { permission: true },
    });
    const existingCodes = new Set(existing.map((e) => e.permission.code));
    const desiredCodes = new Set(roleSeed.grants);

    for (const stale of existing.filter((e) => !desiredCodes.has(e.permission.code))) {
      await tx.rolePermission.delete({ where: { id: stale.id } });
    }
    for (const code of roleSeed.grants) {
      if (existingCodes.has(code)) continue;
      const permission = await tx.permission.findUnique({ where: { code } });
      if (!permission) {
        throw new Error(`[load-foundation] Role ${roleSeed.code} references unknown permission ${code}`);
      }
      await tx.rolePermission.create({
        data: { organizationId, roleId: role.id, permissionId: permission.id },
      });
      grantCount++;
    }
  }
  return { roles: CANONICAL_ROLES.length, grants: grantCount };
}
