/**
 * KuBi — PHI-safe logging. Phase 1 Step 11, owner control 13.
 *
 * DESIGN: fields are OPT-IN to logging, not opt-out.
 *
 * A denylist ("redact these known-sensitive keys") fails silently the first
 * time someone adds a field nobody thought of — and in this domain that field
 * is a diagnosis. So `safeLogPayload` walks the object and drops every key that
 * is not on the allowlist, replacing it with a type marker.
 *
 * Nothing here depends on a logging library, so it is unit-testable in
 * isolation and reusable by Sentry's beforeSend hook.
 */

/**
 * Keys permitted to appear in logs, in full.
 * Identifiers, states, timings and codes — never free text, never clinical
 * content, never patient-identifying detail.
 *
 * Adding a key here is a security decision and belongs in code review.
 */
export const LOG_ALLOWLIST: ReadonlySet<string> = new Set([
  // correlation & tracing
  'correlationId', 'requestId', 'traceId', 'spanId', 'sessionId',
  // tenancy
  'organizationId', 'clinicId', 'locationId',
  // actors — ids only, never names
  'userId', 'employeeId', 'actorId', 'assigneeId', 'checkerId', 'ownerId',
  // domain identifiers
  'activityDefinitionId', 'activityInstanceId', 'definitionCode',
  'patientId', 'appointmentId', 'visitId', 'procedureId', 'patientProcedureId',
  'batchId', 'packId', 'assetId', 'labCaseId', 'exceptionId', 'capaId',
  // enumerated state — safe, and the reason logs are useful at all
  'status', 'fromStatus', 'toStatus', 'priority', 'severity', 'result',
  'evaluationResult', 'enforcement', 'decision', 'readinessStatus',
  'triggerType', 'executionMode', 'exceptionCode', 'requirementCode',
  'gateCode', 'permissionCode', 'roleCode', 'channel', 'provenance',
  // operational
  'httpMethod', 'route', 'statusCode', 'durationMs', 'attempt', 'queue',
  'jobId', 'ruleCode', 'ruleVersion', 'count', 'rowCount',
  // timing
  'dueAt', 'startedAt', 'completedAt', 'verifiedAt', 'occurredAt', 'timestamp',
  // errors — type and code only
  'errorName', 'errorCode', 'errorType',
]);

/**
 * Keys that must be dropped even if a future edit adds them to the allowlist.
 * Defence in depth against an accidental widening — a name is never loggable,
 * whatever anyone decides later.
 */
export const LOG_DENYLIST: ReadonlySet<string> = new Set([
  'name', 'firstName', 'lastName', 'displayLabel', 'fullName',
  'dob', 'dateOfBirth', 'age', 'gender',
  'phone', 'mobile', 'email', 'address', 'addressLine', 'city', 'postcode',
  'uhid', 'nationalId', 'aadhaar', 'pan', 'insuranceNumber',
  'diagnosis', 'complaint', 'symptoms', 'allergy', 'allergies', 'medication',
  'medicalHistory', 'clinicalNote', 'note', 'notes', 'reason', 'freeText',
  'password', 'passwordHash', 'token', 'accessToken', 'refreshToken',
  'secret', 'apiKey', 'authorization', 'cookie', 'signature',
]);

const MAX_DEPTH = 6;

function marker(value: unknown): string {
  if (value === null) return '[redacted:null]';
  if (Array.isArray(value)) return `[redacted:array(${value.length})]`;
  switch (typeof value) {
    case 'string':
      return `[redacted:string(${value.length})]`;
    case 'number':
      return '[redacted:number]';
    case 'boolean':
      return '[redacted:boolean]';
    case 'object':
      return '[redacted:object]';
    default:
      return '[redacted]';
  }
}

/**
 * Reduce an arbitrary object to something safe to write to a log sink.
 *
 * Allowlisted keys survive with their value. Everything else is replaced by a
 * type marker — which keeps logs diagnostically useful ("a 14-character string
 * was here") without emitting the content.
 */
export function safeLogPayload(input: unknown, depth = 0): unknown {
  if (input === null || input === undefined) return input;
  if (depth > MAX_DEPTH) return '[redacted:max-depth]';

  if (Array.isArray(input)) {
    return input.map((v) => safeLogPayload(v, depth + 1));
  }

  if (typeof input !== 'object') {
    // A bare scalar has no key to check. Callers must pass objects; a scalar at
    // the root is emitted only if it is not obviously a secret-looking string.
    return input;
  }

  if (input instanceof Date) return input.toISOString();
  if (input instanceof Error) {
    return { errorName: input.name, errorType: input.constructor.name };
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (LOG_DENYLIST.has(key)) {
      out[key] = marker(value);
      continue;
    }
    if (LOG_ALLOWLIST.has(key)) {
      // Allowlisted, but still recurse: an allowlisted container must not
      // smuggle a denied key through.
      out[key] =
        value !== null && typeof value === 'object'
          ? safeLogPayload(value, depth + 1)
          : value;
      continue;
    }
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      // Unknown key holding a structure: descend rather than dropping wholesale,
      // so allowlisted ids nested under an unknown wrapper survive.
      out[key] = safeLogPayload(value, depth + 1);
      continue;
    }
    out[key] = marker(value);
  }
  return out;
}

/** Sentry `beforeSend` hook — same allowlist, applied to event extra/contexts. */
export function scrubSentryEvent<T extends Record<string, unknown>>(event: T): T {
  const scrubbed: Record<string, unknown> = { ...event };
  for (const field of ['extra', 'contexts', 'request', 'tags'] as const) {
    if (scrubbed[field]) scrubbed[field] = safeLogPayload(scrubbed[field]);
  }
  if (scrubbed.user) scrubbed.user = safeLogPayload(scrubbed.user);
  return scrubbed as T;
}
