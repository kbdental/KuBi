/**
 * TD-4 repayment verification. Standing regression test — the WeakSet-based
 * first attempt at this passed a naive smoke test but was structurally wrong
 * (see the comment in rls-context.ts). This suite is what would have caught
 * it, and must keep catching any regression of the same shape.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  prisma,
  withTenantContext,
  withSystemContext,
  MissingTenancyContextError,
} from '../../apps/api/src/platform/tenancy/rls-context.js';

const orgIds: string[] = [];

afterAll(async () => {
  await prisma.$disconnect();
});

describe('TD-4 — centralized RLS context enforcement', () => {
  it('throws MissingTenancyContextError for a tenant-scoped query with no context', async () => {
    await expect(prisma.organization.findMany()).rejects.toBeInstanceOf(
      MissingTenancyContextError,
    );
  });

  it('withSystemContext requires a substantive reason', async () => {
    const orgId = randomUUID();
    await expect(
      withSystemContext(prisma, 'short', orgId, async (tx) => tx.organization.findMany()),
    ).rejects.toThrow(/non-trivial reason/);
  });

  it('withSystemContext bootstraps an org; withTenantContext reads it back', async () => {
    const orgId = randomUUID();
    orgIds.push(orgId);
    await withSystemContext(prisma, 'test bootstrap for TD-4 verification', orgId, async (tx) => {
      await tx.organization.create({
        data: { id: orgId, code: `TD4_${orgId.slice(0, 8)}`, name: 'SYNTHETIC TD-4 org' },
      });
    });

    const rows = await withTenantContext(
      prisma,
      { organizationId: orgId, clinicIds: [], crossClinic: true },
      (tx) => tx.organization.findMany(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(orgId);
  });

  it('does not leak established context onto a later unscoped call', async () => {
    const orgId = randomUUID();
    orgIds.push(orgId);
    await withSystemContext(prisma, 'test bootstrap for leak check', orgId, async (tx) => {
      await tx.organization.create({
        data: { id: orgId, code: `LEAK_${orgId.slice(0, 8)}`, name: 'SYNTHETIC leak-check org' },
      });
    });
    // Immediately after a successful, fully-awaited context call: must throw again.
    await expect(prisma.organization.findMany()).rejects.toBeInstanceOf(
      MissingTenancyContextError,
    );
  });

  it('isolates concurrent tenant contexts from one another', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    orgIds.push(orgA, orgB);
    await withSystemContext(prisma, 'test bootstrap org A', orgA, (tx) =>
      tx.organization.create({ data: { id: orgA, code: `CC_A_${orgA.slice(0, 6)}`, name: 'SYNTHETIC A' } }),
    );
    await withSystemContext(prisma, 'test bootstrap org B', orgB, (tx) =>
      tx.organization.create({ data: { id: orgB, code: `CC_B_${orgB.slice(0, 6)}`, name: 'SYNTHETIC B' } }),
    );

    const [rowsA, rowsB] = await Promise.all([
      withTenantContext(prisma, { organizationId: orgA, clinicIds: [], crossClinic: true }, (tx) =>
        tx.organization.findMany(),
      ),
      withTenantContext(prisma, { organizationId: orgB, clinicIds: [], crossClinic: true }, (tx) =>
        tx.organization.findMany(),
      ),
    ]);
    expect(rowsA.map((r) => r.id)).toEqual([orgA]);
    expect(rowsB.map((r) => r.id)).toEqual([orgB]);
  });

  it('rejects withTenantContext with an empty organizationId', async () => {
    await expect(
      withTenantContext(prisma, { organizationId: '', clinicIds: [], crossClinic: false }, (tx) =>
        tx.organization.findMany(),
      ),
    ).rejects.toThrow(/non-empty organizationId/);
  });

  it('rejects withSystemContext with an empty orgId', async () => {
    await expect(
      withSystemContext(prisma, 'a fine reason here', '', (tx) => tx.organization.findMany()),
    ).rejects.toThrow(/explicit orgId/);
  });
});
