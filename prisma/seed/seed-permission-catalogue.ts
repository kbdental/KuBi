/**
 * KuBi — one-time permission catalogue load, run with MIGRATOR credentials.
 *
 * Deliberately NOT called from application code. Migration 0004 grants
 * kubi_app SELECT-only on `permissions` — it is global reference data
 * managed like a migration, not tenant data the app writes. Run this via
 * `pnpm db:seed:catalogue` after every migration deploy, before the first
 * `bootstrapOrganization` call.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PERMISSION_CATALOGUE, permissionCode } from './permission-catalogue.js';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL (migrator) must be set.');
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    let count = 0;
    for (const p of PERMISSION_CATALOGUE) {
      const code = permissionCode(p.resource, p.action);
      await client.query(
        `INSERT INTO permissions (id, resource, action, code, class)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET class = EXCLUDED.class`,
        [p.resource, p.action, code, p.class],
      );
      count++;
    }
    console.log(`[seed-permission-catalogue] upserted ${count} permissions`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[seed-permission-catalogue] FAILED', e);
  process.exit(1);
});
