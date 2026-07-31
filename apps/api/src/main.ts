/**
 * Process entrypoint. `buildServer()` has until now only ever been driven by
 * `app.inject()` in tests; this is what makes it answer a real socket so the
 * web app can talk to it.
 */
// Loads .env if one is present. dotenv never overwrites a variable that is
// already set, so a real deployment's environment always wins.
import 'dotenv/config';
import { buildServer } from './server.js';
import { startDailyRuns } from './platform/workflow/daily-run.service.js';
import { systemClock } from './shared/clock.js';
import { logger } from './shared/logging/logger.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const app = await buildServer();

/**
 * The clinic's mornings. On by default — a KuBi that does not generate the
 * day is not doing its job, so this is not something to remember to switch on.
 * KUBI_SCHEDULER=off exists for the one case that genuinely needs it: running
 * a second instance for debugging without it writing to the same database.
 */
const stopDailyRuns = process.env.KUBI_SCHEDULER === 'off'
  ? (logger.warn('daily runs disabled by KUBI_SCHEDULER=off'), () => {})
  : startDailyRuns(systemClock);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopDailyRuns();
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port, host });
logger.info({ port, host }, 'api listening');
