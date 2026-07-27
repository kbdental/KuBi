/**
 * KuBi — Phase 1 Step 6: RLS architecture gate.
 *
 * MANDATORY GATE (owner control 10): if Prisma cannot reliably enforce
 * organization + clinic RLS under the intended connection-pooling model, this
 * script must FAIL and the ORM decision (ADR-008) must be revisited. It must
 * not be worked around to preserve Prisma.
 *
 * The gate tests, in order of consequence:
 *   T1  fail-closed        — an unscoped connection sees ZERO rows, not all rows
 *   T2  org isolation      — org A cannot read org B
 *   T3  clinic isolation   — two-level: clinic scope filters within an org
 *   T4  cross-clinic grant — the org-wide permission widens correctly
 *   T5  write containment  — WITH CHECK blocks cross-tenant INSERT
 *   T6  pool reuse         — context does NOT survive onto the next checkout
 *   T7  concurrency        — interleaved transactions do not cross-contaminate
 *   T8  prisma tx          — Prisma interactive transactions carry context
 *   T9  prisma non-tx      — Prisma outside a transaction fails closed
 *   T10 delete denied      — least privilege holds at the DB level
 *
 * Run: pnpm tsx scripts/rls-spike.ts
 */
import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../node_modules/.prisma/client/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const ADMIN_URL = process.env.DATABASE_URL!; // migrator/owner — used only to seed fixtures
const APP_URL = process.env.APP_DATABASE_URL!; // least-privilege app role — used for all assertions

type Result = { id: string; name: string; pass: boolean; detail: string };
const results: Result[] = [];

function record(id: string, name: string, pass: boolean, detail: string) {
  results.push({ id, name, pass, detail });
  const tag = pass ? '  PASS' : '[31m  FAIL[0m';
  console.log(`${tag}  ${id}  ${name}\n        ${detail}`);
}

/** Set tenancy context for the CURRENT transaction only (function form of SET LOCAL). */
async function setContext(
  c: PoolClient,
  ctx: { org?: string; clinics?: string[]; crossClinic?: boolean },
) {
  await c.query(`SELECT set_config('kubi.org_id', $1, true)`, [ctx.org ?? '']);
  await c.query(`SELECT set_config('kubi.clinic_ids', $1, true)`, [(ctx.clinics ?? []).join(',')]);
  await c.query(`SELECT set_config('kubi.cross_clinic', $1, true)`, [
    String(ctx.crossClinic ?? false),
  ]);
}

// Fixture ids are generated client-side: organisation provisioning is a
// platform operation, and the app must know the org id before it can scope to it.
const RUN = randomUUID().slice(0, 8); // fixture codes unique per run so the gate is re-runnable
const ORG_A = randomUUID();
const ORG_B = randomUUID();
const CLINIC_A1 = randomUUID();
const CLINIC_A2 = randomUUID();
const CLINIC_B1 = randomUUID();

async function seedFixtures() {
  // Seeded as superuser: RLS is FORCEd even for the table owner, and bootstrapping
  // the first organisation necessarily precedes having an organisation to scope to.
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const c = await admin.connect();
  try {
    await c.query('SET session_replication_role = replica'); // no-op here; documents intent
  } catch {
    /* ignore */
  }
  // Use a privileged path via set_config so the owner's FORCEd policies admit the writes.
  await c.query('BEGIN');
  await setContext(c, { org: ORG_A, clinics: [CLINIC_A1, CLINIC_A2], crossClinic: true });
  await c.query(
    `INSERT INTO organizations (id, code, name, updated_at) VALUES ($1,$2,'Alpha Dental Group', now())`,
    [ORG_A, `ORG_A_${RUN}`],
  );
  await c.query(
    `INSERT INTO clinics (id, organization_id, code, name, updated_at) VALUES ($1,$2,'A1','Alpha Clinic One',now()),($3,$2,'A2','Alpha Clinic Two',now())`,
    [CLINIC_A1, ORG_A, CLINIC_A2],
  );
  await c.query(
    `INSERT INTO patients (organization_id, clinic_id, uhid, display_label)
     VALUES ($1,$2,'A-UH-001','SYNTHETIC Patient A1-a'),
            ($1,$2,'A-UH-002','SYNTHETIC Patient A1-b'),
            ($1,$3,'A-UH-003','SYNTHETIC Patient A2-a')`,
    [ORG_A, CLINIC_A1, CLINIC_A2],
  );
  await c.query('COMMIT');

  await c.query('BEGIN');
  await setContext(c, { org: ORG_B, clinics: [CLINIC_B1], crossClinic: true });
  await c.query(`INSERT INTO organizations (id, code, name, updated_at) VALUES ($1,$2,'Beta Dental', now())`, [ORG_B, `ORG_B_${RUN}`]);
  await c.query(
    `INSERT INTO clinics (id, organization_id, code, name, updated_at) VALUES ($1,$2,'B1','Beta Clinic One',now())`,
    [CLINIC_B1, ORG_B],
  );
  await c.query(
    `INSERT INTO patients (organization_id, clinic_id, uhid, display_label)
     VALUES ($1,$2,'B-UH-001','SYNTHETIC Patient B1-a')`,
    [ORG_B, CLINIC_B1],
  );
  await c.query('COMMIT');

  c.release();
  await admin.end();
  console.log(
    `\nFixtures: org A (2 clinics, 3 patients), org B (1 clinic, 1 patient) — all SYNTHETIC\n`,
  );
}

async function run() {
  await seedFixtures();

  console.log('--- Raw driver, least-privilege role (kubi_app) ---\n');

  // T1 — fail-closed. The single most important property.
  {
    const pool = new Pool({ connectionString: APP_URL, max: 1 });
    const c = await pool.connect();
    await c.query('BEGIN');
    // deliberately NO context set
    const pats = await c.query('SELECT * FROM patients');
    const orgs = await c.query('SELECT * FROM organizations');
    await c.query('COMMIT');
    c.release();
    await pool.end();
    record(
      'T1',
      'Unscoped connection is fail-closed',
      pats.rowCount === 0 && orgs.rowCount === 0,
      `no context set -> patients=${pats.rowCount} organizations=${orgs.rowCount} (expected 0/0)`,
    );
  }

  // T2 — organisation isolation.
  {
    const pool = new Pool({ connectionString: APP_URL, max: 1 });
    const c = await pool.connect();
    await c.query('BEGIN');
    await setContext(c, { org: ORG_A, crossClinic: true });
    const mine = await c.query('SELECT uhid FROM patients');
    const otherOrg = await c.query('SELECT * FROM organizations WHERE id = $1', [ORG_B]);
    await c.query('COMMIT');
    c.release();
    await pool.end();
    const uhids = mine.rows.map((r) => r.uhid).sort();
    record(
      'T2',
      'Organisation isolation',
      mine.rowCount === 3 && otherOrg.rowCount === 0 && uhids.every((u: string) => u.startsWith('A-')),
      `org A sees ${mine.rowCount} patients [${uhids.join(',')}]; explicit read of org B returned ${otherOrg.rowCount}`,
    );
  }

  // T3 — two-level: clinic scope narrows within the organisation.
  {
    const pool = new Pool({ connectionString: APP_URL, max: 1 });
    const c = await pool.connect();
    await c.query('BEGIN');
    await setContext(c, { org: ORG_A, clinics: [CLINIC_A1], crossClinic: false });
    const r = await c.query('SELECT uhid FROM patients');
    await c.query('COMMIT');
    c.release();
    await pool.end();
    const uhids = r.rows.map((x) => x.uhid).sort();
    record(
      'T3',
      'Clinic-level isolation within organisation',
      r.rowCount === 2 && !uhids.includes('A-UH-003'),
      `org A + clinic A1 only -> ${r.rowCount} patients [${uhids.join(',')}] (expected 2, excluding A-UH-003 from clinic A2)`,
    );
  }

  // T4 — the org-wide grant widens correctly (ADR-002 / OD-05).
  {
    const pool = new Pool({ connectionString: APP_URL, max: 1 });
    const c = await pool.connect();
    await c.query('BEGIN');
    await setContext(c, { org: ORG_A, clinics: [CLINIC_A1], crossClinic: true });
    const r = await c.query('SELECT uhid FROM patients');
    await c.query('COMMIT');
    c.release();
    await pool.end();
    record(
      'T4',
      'Cross-clinic grant widens to organisation',
      r.rowCount === 3,
      `cross_clinic=true -> ${r.rowCount} patients (expected all 3 in org A)`,
    );
  }

  // T5 — write containment.
  {
    const pool = new Pool({ connectionString: APP_URL, max: 1 });
    const c = await pool.connect();
    await c.query('BEGIN');
    await setContext(c, { org: ORG_A, clinics: [CLINIC_A1], crossClinic: false });
    let blocked = false;
    let msg = '';
    try {
      await c.query(
        `INSERT INTO patients (organization_id, clinic_id, uhid, display_label)
         VALUES ($1,$2,'X-UH-999','SYNTHETIC cross-tenant write attempt')`,
        [ORG_B, CLINIC_B1],
      );
    } catch (e) {
      blocked = true;
      msg = (e as Error).message.split('\n')[0]!;
    }
    await c.query('ROLLBACK');
    c.release();
    await pool.end();
    record(
      'T5',
      'Cross-tenant INSERT blocked by WITH CHECK',
      blocked,
      blocked ? `rejected: ${msg}` : 'INSERT into org B from org A context SUCCEEDED — policy hole',
    );
  }

  // T6 — pool reuse. THE pooling risk: context must not survive the checkout.
  {
    const pool = new Pool({ connectionString: APP_URL, max: 1 }); // max:1 forces reuse
    const c1 = await pool.connect();
    const pid1 = (await c1.query('SELECT pg_backend_pid() AS p')).rows[0].p;
    await c1.query('BEGIN');
    await setContext(c1, { org: ORG_A, crossClinic: true });
    const inTx = await c1.query('SELECT count(*)::int AS n FROM patients');
    await c1.query('COMMIT');
    c1.release();

    const c2 = await pool.connect(); // same physical connection (max:1)
    const pid2 = (await c2.query('SELECT pg_backend_pid() AS p')).rows[0].p;
    const leaked = await c2.query('SELECT count(*)::int AS n FROM patients');
    const rawSetting = await c2.query(
      `SELECT COALESCE(current_setting('kubi.org_id', true),'<unset>') AS v`,
    );
    c2.release();
    await pool.end();
    record(
      'T6',
      'Context does not leak across pool checkouts',
      pid1 === pid2 && inTx.rows[0].n === 3 && leaked.rows[0].n === 0,
      `same backend pid=${pid1 === pid2} (${pid1}); in-tx=${inTx.rows[0].n}, after release=${leaked.rows[0].n} (expected 0), kubi.org_id now='${rawSetting.rows[0].v}'`,
    );
  }

  // T7 — concurrency: two interleaved transactions, different orgs.
  {
    const pool = new Pool({ connectionString: APP_URL, max: 4 });
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    async function scoped(org: string, label: string, delay: number) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await setContext(c, { org, crossClinic: true });
        await sleep(delay); // hold the transaction open across the other's work
        const r = await c.query('SELECT uhid FROM patients ORDER BY uhid');
        await c.query('COMMIT');
        return { label, uhids: r.rows.map((x) => x.uhid) };
      } finally {
        c.release();
      }
    }

    const [a, b] = await Promise.all([
      scoped(ORG_A, 'A', 120),
      scoped(ORG_B, 'B', 40),
    ]);
    await pool.end();
    const aOk = a.uhids.length === 3 && a.uhids.every((u: string) => u.startsWith('A-'));
    const bOk = b.uhids.length === 1 && b.uhids.every((u: string) => u.startsWith('B-'));
    record(
      'T7',
      'Concurrent transactions do not cross-contaminate',
      aOk && bOk,
      `A saw [${a.uhids.join(',')}], B saw [${b.uhids.join(',')}]`,
    );
  }

  // ---- Prisma 7 with the pg driver adapter ----
  console.log('\n--- Prisma 7.9 + @prisma/adapter-pg, least-privilege role ---\n');

  const adapter = new PrismaPg({ connectionString: APP_URL, max: 1 });
  const prisma = new PrismaClient({ adapter });

  // T8 — interactive transaction carries context.
  {
    const inTx = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('kubi.org_id', ${ORG_A}, true)`;
      await tx.$executeRaw`SELECT set_config('kubi.cross_clinic', 'true', true)`;
      return tx.patient.findMany({ select: { uhid: true } });
    });
    const uhids = inTx.map((p) => p.uhid).sort();
    record(
      'T8',
      'Prisma interactive transaction carries RLS context',
      inTx.length === 3 && uhids.every((u) => u.startsWith('A-')),
      `prisma.$transaction with set_config -> ${inTx.length} patients [${uhids.join(',')}]`,
    );
  }

  // T9 — outside a transaction, Prisma must fail closed.
  {
    const outside = await prisma.patient.findMany({ select: { uhid: true } });
    record(
      'T9',
      'Prisma outside a transaction fails closed',
      outside.length === 0,
      `unscoped prisma.patient.findMany() -> ${outside.length} rows (expected 0)`,
    );
  }

  // T10 — least privilege: DELETE must be denied at the database level.
  {
    let denied = false;
    let msg = '';
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('kubi.org_id', ${ORG_A}, true)`;
        await tx.$executeRaw`SELECT set_config('kubi.cross_clinic', 'true', true)`;
        await tx.$executeRawUnsafe(`DELETE FROM patients WHERE uhid = 'A-UH-001'`);
      });
    } catch (e) {
      denied = true;
      msg = (e as Error).message.split('\n').find((l) => l.includes('permission')) ?? 'denied';
    }
    record(
      'T10',
      'DELETE denied to application role',
      denied,
      denied ? `rejected: ${msg.trim()}` : 'DELETE SUCCEEDED — least privilege not enforced',
    );
  }

  await prisma.$disconnect();

  // ---- verdict ----
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(72));
  console.log(`RLS SPIKE RESULT: ${results.length - failed.length}/${results.length} passed`);
  console.log('='.repeat(72));
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  ${f.id} ${f.name}\n     ${f.detail}`);
    console.log('\nGATE: NO-GO. Do not work around this to preserve Prisma (owner control 10).');
    process.exit(1);
  }
  console.log('\nGATE: GO. Prisma 7 + adapter-pg enforces two-level RLS under pooling.');
}

run().catch((e) => {
  console.error('\nSPIKE ERROR:', e);
  process.exit(1);
});
