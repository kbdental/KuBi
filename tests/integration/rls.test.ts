/**
 * Two-level RLS, as a standing regression suite.
 *
 * scripts/rls-spike.ts was the Phase 1 Step 6 architecture GATE (a one-off
 * go/no-go). This suite is its permanent successor: these properties must hold
 * on every commit, because a policy regression is silent — nothing errors, the
 * system simply starts returning other tenants' rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

const APP_URL = process.env.TEST_APP_DATABASE_URL ?? process.env.APP_DATABASE_URL!;
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;

const ORG_A = randomUUID(), ORG_B = randomUUID();
const CLINIC_A1 = randomUUID(), CLINIC_A2 = randomUUID(), CLINIC_B1 = randomUUID();

async function ctx(c: PoolClient, o?: string, cl: string[] = [], cross = false) {
  await c.query(`SELECT set_config('kubi.org_id',$1,true)`, [o ?? '']);
  await c.query(`SELECT set_config('kubi.clinic_ids',$1,true)`, [cl.join(',')]);
  await c.query(`SELECT set_config('kubi.cross_clinic',$1,true)`, [String(cross)]);
}

let admin: Pool;

beforeAll(async () => {
  admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const c = await admin.connect();
  for (const [org, clinics, pats] of [
    [ORG_A, [CLINIC_A1, CLINIC_A2], [['A-1', CLINIC_A1], ['A-2', CLINIC_A1], ['A-3', CLINIC_A2]]],
    [ORG_B, [CLINIC_B1], [['B-1', CLINIC_B1]]],
  ] as const) {
    await c.query('BEGIN');
    await ctx(c, org as string, clinics as string[], true);
    await c.query(`INSERT INTO organizations (id,code,name,updated_at) VALUES ($1,$2,$3,now())`,
      [org, `T_${(org as string).slice(0, 8)}`, 'SYNTHETIC org']);
    for (const cl of clinics as string[]) {
      await c.query(`INSERT INTO clinics (id,organization_id,code,name,updated_at) VALUES ($1,$2,$3,'SYNTHETIC clinic',now())`,
        [cl, org, cl.slice(0, 8)]);
    }
    for (const [uh, cl] of pats as readonly (readonly [string, string])[]) {
      await c.query(`INSERT INTO patients (organization_id,clinic_id,uhid,display_label) VALUES ($1,$2,$3,'SYNTHETIC patient')`,
        [org, cl, `${uh}-${(org as string).slice(0, 4)}`]);
    }
    await c.query('COMMIT');
  }
  c.release();
});

afterAll(async () => { await admin?.end(); });

describe('two-level RLS', () => {
  it('fails closed with no tenancy context', async () => {
    const p = new Pool({ connectionString: APP_URL, max: 1 });
    const c = await p.connect();
    await c.query('BEGIN');
    const r = await c.query('SELECT * FROM patients');
    await c.query('COMMIT'); c.release(); await p.end();
    expect(r.rowCount).toBe(0);
  });

  it('isolates organisations', async () => {
    const p = new Pool({ connectionString: APP_URL, max: 1 });
    const c = await p.connect();
    await c.query('BEGIN'); await ctx(c, ORG_A, [], true);
    const r = await c.query('SELECT uhid FROM patients');
    await c.query('COMMIT'); c.release(); await p.end();
    expect(r.rowCount).toBe(3);
    expect(r.rows.every((x) => x.uhid.startsWith('A-'))).toBe(true);
  });

  it('isolates clinics within an organisation', async () => {
    const p = new Pool({ connectionString: APP_URL, max: 1 });
    const c = await p.connect();
    await c.query('BEGIN'); await ctx(c, ORG_A, [CLINIC_A1], false);
    const r = await c.query('SELECT uhid FROM patients');
    await c.query('COMMIT'); c.release(); await p.end();
    expect(r.rowCount).toBe(2);
  });

  it('does not leak context across pool checkouts', async () => {
    const p = new Pool({ connectionString: APP_URL, max: 1 });
    const c1 = await p.connect();
    const pid1 = (await c1.query('SELECT pg_backend_pid() p')).rows[0].p;
    await c1.query('BEGIN'); await ctx(c1, ORG_A, [], true);
    await c1.query('SELECT * FROM patients');
    await c1.query('COMMIT'); c1.release();
    const c2 = await p.connect();
    const pid2 = (await c2.query('SELECT pg_backend_pid() p')).rows[0].p;
    const leaked = await c2.query('SELECT * FROM patients');
    c2.release(); await p.end();
    expect(pid1).toBe(pid2);      // same physical connection — the risky case
    expect(leaked.rowCount).toBe(0);
  });

  it('blocks cross-tenant writes', async () => {
    const p = new Pool({ connectionString: APP_URL, max: 1 });
    const c = await p.connect();
    await c.query('BEGIN'); await ctx(c, ORG_A, [CLINIC_A1], false);
    await expect(
      c.query(`INSERT INTO patients (organization_id,clinic_id,uhid,display_label) VALUES ($1,$2,'X','SYNTHETIC')`,
        [ORG_B, CLINIC_B1]),
    ).rejects.toThrow(/row-level security/i);
    await c.query('ROLLBACK'); c.release(); await p.end();
  });

  it('denies DELETE to the application role', async () => {
    const p = new Pool({ connectionString: APP_URL, max: 1 });
    const c = await p.connect();
    await c.query('BEGIN'); await ctx(c, ORG_A, [CLINIC_A1], true);
    await expect(c.query(`DELETE FROM patients`)).rejects.toThrow(/permission denied/i);
    await c.query('ROLLBACK'); c.release(); await p.end();
  });
});
