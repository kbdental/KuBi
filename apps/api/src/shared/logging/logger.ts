/**
 * Structured logging with PHI redaction applied at the serializer level, so a
 * caller cannot bypass it by logging an object directly. Phase 1 Step 11.
 */
import pino from 'pino';
import { safeLogPayload } from './redaction.js';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'kubi-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Applied to every log object before serialization. This is the choke point.
  formatters: {
    log: (obj) => safeLogPayload(obj) as Record<string, unknown>,
  },
  redact: {
    // Belt and braces: pino's own redaction for the highest-risk paths.
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    censor: '[redacted]',
  },
});

export type Logger = typeof logger;
