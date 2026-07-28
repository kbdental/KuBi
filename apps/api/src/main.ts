/**
 * Process entrypoint. `buildServer()` has until now only ever been driven by
 * `app.inject()` in tests; this is what makes it answer a real socket so the
 * web app can talk to it.
 */
// Loads .env if one is present. dotenv never overwrites a variable that is
// already set, so a real deployment's environment always wins.
import 'dotenv/config';
import { buildServer } from './server.js';
import { logger } from './shared/logging/logger.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const app = await buildServer();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port, host });
logger.info({ port, host }, 'api listening');
