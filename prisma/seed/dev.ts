/**
 * A clinic that stays in the development database.
 *
 * The gap this closes, in the owner's words: *"a tick has to survive."*
 *
 * Everything demonstrated so far ran on a browser fetch interceptor, which
 * forgets on reload. The schema, the row-level security and the whole API were
 * already real — 155 integration tests pass against PostgreSQL — but the
 * development database had never been given a clinic, so there was nothing to
 * point the app at.
 *
 * The integration suite already knows how to build one. It seeds a fresh
 * organisation per run with a random suffix, because tests must not see each
 * other's data. Development wants the opposite: one clinic, the same one every
 * morning, with a stable address to sign in at. So this reuses that builder
 * with a fixed suffix, and refuses to run twice rather than quietly making a
 * second clinic nobody asked for.
 *
 * Synthetic throughout. Constitution rule 6 — every name, email and record
 * here is invented, and the password below is a development credential for a
 * database that holds nothing real.
 *
 *   pnpm db:seed:dev
 */
// First, and on its own line. rls-context builds the Prisma client from
// APP_DATABASE_URL at module load, so an import placed after it reads an
// undefined connection string and fails as "access denied" — which sends you
// looking at database grants that were fine all along.
import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { prisma, withSystemContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { systemClock } from '../../apps/api/src/shared/clock.js';
import { seedVs01Demo, DEMO_PASSWORD } from './vs01-demo.js';
import { generateOpeningTasks } from '../../apps/api/src/platform/workflow/scheduler.service.js';

/** Fixed, so the sign-in address does not change between runs. */
const SUFFIX = 'dev';

async function main() {
  // reason first, then the org scope. There is no ungoverned global read here
  // — a random uuid is used because this is the one query that runs before an
  // organisation is known to exist.
  const existing = await withSystemContext(
    prisma,
    'checking whether the development clinic has already been seeded',
    randomUUID(),
    (tx) => tx.organization.findFirst({ where: { code: `KBDEMO_${SUFFIX}` } }),
  );

  if (existing) {
    console.log(
      `The development clinic already exists (${existing.code}).\n`
      + 'Seeding again would create a second clinic nobody asked for. To start\n'
      + 'over, drop and re-migrate the database first.',
    );
    return;
  }

  console.log('Seeding the development clinic…');
  const env = await seedVs01Demo(SUFFIX);

  // A clinic with no work is not a clinic. The scheduler is the real one —
  // the same function the integration suite runs — so the tasks that appear
  // are the tasks the product would generate this morning.
  const opening = await generateOpeningTasks(
    prisma, systemClock, env.organizationId, env.clinicId,
  );

  console.log(`
Done.

  organisation   ${env.organizationId}
  clinic         ${env.clinicId}
  opening tasks  ${opening.created} generated

Sign in with any of these — password ${DEMO_PASSWORD}

  priya_${SUFFIX}@synthetic.test    dental assistant
  anita_${SUFFIX}@synthetic.test    senior assistant
  kavita_${SUFFIX}@synthetic.test   reception
  rahul_${SUFFIX}@synthetic.test    clinic manager
  owner_${SUFFIX}@synthetic.test    owner
`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
