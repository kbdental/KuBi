/**
 * Phase 1 Step 11 verification: synthetic PHI in a log payload must be redacted.
 * Owner control 13 — PHI-safe from the beginning.
 */
import { describe, it, expect } from 'vitest';
import {
  safeLogPayload,
  LOG_ALLOWLIST,
  LOG_DENYLIST,
} from '../../apps/api/src/shared/logging/redaction.js';

describe('PHI redaction', () => {
  it('drops direct patient identifiers', () => {
    const out = safeLogPayload({
      patientId: 'c0ffee00-0000-4000-8000-000000000001',
      name: 'SYNTHETIC Rajesh Kumar',
      uhid: 'KB-2026-00042',
      phone: '+919876543210',
      dob: '1984-03-11',
    }) as Record<string, unknown>;

    expect(out.patientId).toBe('c0ffee00-0000-4000-8000-000000000001'); // id survives
    expect(out.name).toMatch(/^\[redacted:string\(\d+\)\]$/);
    expect(out.uhid).toMatch(/^\[redacted:string\(\d+\)\]$/);
    expect(out.phone).toMatch(/^\[redacted:string\(\d+\)\]$/);
    expect(out.dob).toMatch(/^\[redacted:string\(\d+\)\]$/);
    expect(JSON.stringify(out)).not.toContain('Rajesh');
    expect(JSON.stringify(out)).not.toContain('9876543210');
  });

  it('drops clinical content while keeping enumerated state', () => {
    const out = safeLogPayload({
      patientProcedureId: 'a1',
      status: 'IN_PROGRESS',
      evaluationResult: 'UNKNOWN',
      diagnosis: 'SYNTHETIC irreversible pulpitis 46',
      clinicalNote: 'SYNTHETIC note body',
      allergies: ['SYNTHETIC penicillin'],
    }) as Record<string, unknown>;

    expect(out.status).toBe('IN_PROGRESS');
    expect(out.evaluationResult).toBe('UNKNOWN');
    expect(out.diagnosis).toMatch(/^\[redacted:string\(\d+\)\]$/);
    expect(out.clinicalNote).toMatch(/^\[redacted:string\(\d+\)\]$/);
    expect(out.allergies).toBe('[redacted:array(1)]');
    expect(JSON.stringify(out)).not.toContain('pulpitis');
    expect(JSON.stringify(out)).not.toContain('penicillin');
  });

  it('drops credentials', () => {
    const out = safeLogPayload({
      userId: 'u1',
      password: 'hunter2',
      accessToken: 'eyJhbGciOi',
      authorization: 'Bearer abc',
    }) as Record<string, unknown>;
    expect(out.userId).toBe('u1');
    expect(JSON.stringify(out)).not.toContain('hunter2');
    expect(JSON.stringify(out)).not.toContain('eyJhbGciOi');
    expect(JSON.stringify(out)).not.toContain('Bearer abc');
  });

  it('is opt-in: an unknown field is dropped, not passed through', () => {
    const out = safeLogPayload({
      someFieldNobodyAnticipated: 'SYNTHETIC sensitive value',
    }) as Record<string, unknown>;
    expect(out.someFieldNobodyAnticipated).toMatch(/^\[redacted:string\(\d+\)\]$/);
  });

  it('recurses into nested structures', () => {
    const out = safeLogPayload({
      exceptionCode: 'CLN.GATE.CONSENT_ABSENT',
      context: { patientId: 'p1', name: 'SYNTHETIC Priya S', nested: { uhid: 'KB-1' } },
    });
    const s = JSON.stringify(out);
    expect(s).toContain('CLN.GATE.CONSENT_ABSENT');
    expect(s).toContain('p1');
    expect(s).not.toContain('Priya');
    expect(s).not.toContain('KB-1');
  });

  it('denylist wins over allowlist', () => {
    const overlap = [...LOG_DENYLIST].filter((k) => LOG_ALLOWLIST.has(k));
    expect(overlap).toEqual([]);
    const out = safeLogPayload({ reason: 'SYNTHETIC override reason' }) as Record<string, unknown>;
    expect(out.reason).toMatch(/^\[redacted:string\(\d+\)\]$/);
  });

  it('redacts Error objects to type only', () => {
    const out = safeLogPayload(new Error('SYNTHETIC patient Meera not found')) as Record<
      string,
      unknown
    >;
    expect(out.errorName).toBe('Error');
    expect(JSON.stringify(out)).not.toContain('Meera');
  });
});
