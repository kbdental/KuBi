/**
 * The staff guidelines of 2026-08-06, and whether KuBi already does them.
 *
 * The owner sent twelve sections in one go. The job was to say, line by line,
 * what already runs and what is genuinely new — and the first attempt got that
 * badly wrong. It compared each line against the daily standard, the patient
 * journey and the condition library, and never against the frozen 101-activity
 * matrix, which is where most of the answers were. Twelve lines were called new
 * that the clinic already runs, including the crown-delivery scheduling gate I
 * described as the most valuable line in the document.
 *
 * These tests exist so that the coverage file cannot rot back into that state:
 * every line accounted for, every verdict from a fixed vocabulary, and every
 * claim of "already covered" pointing at something that exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ACTIVITY_LIBRARY, DAILY_STANDARD, PATIENT_JOURNEY, CONDITION_LIBRARY,
  EXCEPTION_LIBRARY, PROPOSED_CONTROLS,
} from '@kubi/contracts';

const SOURCE = 'docs/requirements/staff-guidelines-2026-08.md';
const COVERAGE = 'docs/requirements/staff-guidelines-coverage.tsv';

const VERDICTS = new Set([
  'ALREADY_RUNS',        // a frozen control or library row already does this
  'ALREADY_PROPOSED',    // a live v3.0 proposal covers it
  'PARTIAL',             // something related exists but does not do what the line asks
  'NEW',                 // nothing in KuBi does this
  'NEEDS_NEW_CONCEPT',   // KuBi has no data model for it at all
  'NOT_A_CONTROL',       // a value or instruction with nothing to measure
]);

const rows = readFileSync(COVERAGE, 'utf8').replace(/\r\n/g, '\n').trimEnd()
  .split('\n').slice(1).filter((l) => l.trim() !== '')
  .map((l) => {
    const [id, verdict, where, note] = l.split('\t');
    return { id: id!, verdict: verdict!, where: where ?? '', note: note ?? '' };
  });

describe('every line the owner wrote is accounted for', () => {
  it('covers each numbered line exactly once, in order', () => {
    const inSource = [...readFileSync(SOURCE, 'utf8').matchAll(/\*\*(SG-[\dT]+\.\d+)\*\*/g)]
      .map((m) => m[1]!);
    expect(inSource).toHaveLength(71);
    expect(rows.map((r) => r.id)).toEqual(inSource);
  });

  it('gives every line a verdict from the fixed set', () => {
    for (const r of rows) {
      expect(VERDICTS.has(r.verdict), `${r.id} has verdict "${r.verdict}"`).toBe(true);
    }
  });

  it('says why, on every line', () => {
    // A verdict with no reasoning is an assertion. The point of the file is that
    // somebody else can check the reasoning without re-reading six libraries.
    for (const r of rows) {
      expect(r.note.length, `${r.id} has no note`).toBeGreaterThan(20);
    }
  });
});

describe('a claim that something is covered has to point at something', () => {
  const KNOWN = new Set<string>([
    ...ACTIVITY_LIBRARY.map((a) => a.id),
    ...DAILY_STANDARD.map((s) => s.id),
    ...PATIENT_JOURNEY.map((t) => t.id),
    ...CONDITION_LIBRARY.map((c) => c.id),
    ...EXCEPTION_LIBRARY.map((e) => e.id),
    ...PROPOSED_CONTROLS.map((p) => p.id),
  ]);

  it('names a real id wherever it names an id at all', () => {
    // Catches the failure mode directly: a plausible-looking reference to a
    // control that does not exist reads exactly like a real one.
    for (const r of rows) {
      for (const id of r.where.match(/\b[A-Z]{2,4}-[A-Z_]*-?\d{1,3}\b/g) ?? []) {
        expect(KNOWN.has(id), `${r.id} cites ${id}, which is in no library`).toBe(true);
      }
    }
  });

  it('never claims something already runs without saying what runs it', () => {
    for (const r of rows.filter((x) => x.verdict === 'ALREADY_RUNS')) {
      expect(r.where, `${r.id} claims to be covered by nothing in particular`)
        .toMatch(/[A-Z]{2,4}-/);
    }
  });

  it('points every ALREADY_PROPOSED line at a live proposal, never a withdrawn one', () => {
    const live = new Set(PROPOSED_CONTROLS.filter((p) => p.status === 'PROPOSED').map((p) => p.id));
    for (const r of rows.filter((x) => x.verdict === 'ALREADY_PROPOSED')) {
      const cited = r.where.match(/\b[A-Z]{2,5}-\d{3}\b/g) ?? [];
      expect(cited.length, `${r.id} is proposed-covered by nothing`).toBeGreaterThan(0);
      for (const id of cited) {
        expect(live.has(id), `${r.id} points at ${id}, which is not a live proposal`).toBe(true);
      }
    }
  });
});

describe('what the twelve sections actually amount to', () => {
  const count = (v: string) => rows.filter((r) => r.verdict === v).length;

  it('is mostly already built', () => {
    // The finding worth carrying: of 71 lines, 42 already run and 5 are already
    // proposed. The clinic's guidelines and KuBi's matrix were written from the
    // same operation, so the overlap is high — which is good news, and is not
    // what the first pass reported.
    expect(count('ALREADY_RUNS')).toBe(42);
    expect(count('ALREADY_PROPOSED')).toBe(5);
  });

  it('leaves fifteen lines that need something', () => {
    expect(count('NEW') + count('PARTIAL') + count('NEEDS_NEW_CONCEPT')).toBe(15);
  });

  it('keeps nine lines deliberately outside the system', () => {
    // Values and observations: be respectful, do not sit in reception, no shoes
    // on chairs. Real rules, worth telling staff, and nothing software can see.
    // Turning them into tickable tasks would be the dishonest move.
    expect(count('NOT_A_CONTROL')).toBe(9);
  });
});
