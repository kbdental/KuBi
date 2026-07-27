/**
 * KuBi seed entrypoint. Phase 1 Step 8.
 *
 * Phase 1 scope: the FRAMEWORK only. Registers are wired but deliberately
 * empty — loading the 101 activity definitions, permission matrix, gates, KPIs
 * and config keys is Phase 2+ work and is blocked on OD-02/OD-03 for 23 of the
 * activity rows (owner control 3: do not silently resolve an open decision).
 */
import 'dotenv/config';
import { summarize, assertNoInventedValues, type SeedRow, type LoadReport } from './provenance.js';

const REGISTERS = [
  'activity-definitions',
  'automation-rules',
  'requirements',
  'roles-permissions',
  'kpi-definitions',
  'exception-taxonomy',
  'config-keys',
] as const;

async function main() {
  console.log('KuBi seed — Phase 1 framework verification\n');
  const reports: LoadReport[] = [];

  for (const register of REGISTERS) {
    // Phase 1: each register resolves to an empty, provenance-checked set.
    const rows: SeedRow<unknown>[] = [];
    assertNoInventedValues(rows, register);
    reports.push(summarize(register, rows));
  }

  for (const r of reports) {
    console.log(
      `  ${r.register.padEnd(22)} total=${r.total} loaded=${r.loaded} ` +
        `blocked=${r.blockedOnDecision} unspecified=${r.notSpecified}`,
    );
    for (const w of r.warnings) console.log(`      ! ${w}`);
  }

  console.log('\nSeed framework OK. Registers are intentionally empty in Phase 1.');
}

main().catch((e) => {
  console.error('SEED FAILED:', e);
  process.exit(1);
});
