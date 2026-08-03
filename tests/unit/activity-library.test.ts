/**
 * The generated activity library.
 *
 * These assertions exist because the library is generated: a broken generator
 * produces a plausible-looking file, and nothing else in the system would
 * notice. They also enforce constitution rule 4 — if anybody hand-edits this
 * file, the counts stop matching the matrix and these fail.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_LIBRARY, LIBRARY_FUNCTIONS, LIBRARY_KPIS,
  activitiesInFunction, activitiesByEngine, activitiesByOrigin,
  activitiesForRoleName,
} from '../../packages/contracts/src/index.js';

const MATRIX = 'docs/requirements/master-activity-matrix-v2.tsv';
const matrixRows = readFileSync(MATRIX, 'utf8').split(/\r?\n/).filter((l) => l.trim());

describe('generated from the frozen matrix, not hand-written', () => {
  it('has exactly one activity per matrix row', () => {
    // Constitution rule 4. If this drifts, somebody edited the generated file
    // and the two sources have already forked.
    expect(ACTIVITY_LIBRARY).toHaveLength(matrixRows.length - 1);
  });

  it('carries every activity id from the matrix, with none invented', () => {
    const fromMatrix = new Set(matrixRows.slice(1).map((r) => r.split('\t')[0]!.trim()));
    const fromLibrary = new Set(ACTIVITY_LIBRARY.map((a) => a.id));
    expect(fromLibrary).toEqual(fromMatrix);
  });

  it('gives every activity an id and something to do', () => {
    for (const a of ACTIVITY_LIBRARY) {
      expect(a.id, 'an activity has no id').toBeTruthy();
      expect(a.activity, `${a.id} has no activity`).toBeTruthy();
    }
  });

  it('strips the CRLF the matrix is stored with', () => {
    // Left in, the trailing \r rides on the last column of every row, so every
    // CAPA value silently carries an invisible character.
    for (const a of ACTIVITY_LIBRARY) {
      expect(JSON.stringify(a)).not.toMatch(/\\r/);
    }
  });
});

describe('the PSS hierarchy is complete', () => {
  it('places every activity in a function', () => {
    for (const a of ACTIVITY_LIBRARY) {
      expect(a.fn, `${a.id} has no function`).toBeTruthy();
    }
  });

  it('names a doer and an accountable owner for every activity', () => {
    // Two of the four responsibilities are mandatory. Checker may be null —
    // that permits self-verification, it does not mean nobody checks.
    for (const a of ACTIVITY_LIBRARY) {
      expect(a.doer, `${a.id} has no doer`).toBeTruthy();
      expect(a.owner, `${a.id} has no accountable owner`).toBeTruthy();
    }
  });

  it('gives every activity an escalation ladder', () => {
    for (const a of ACTIVITY_LIBRARY) {
      expect(a.escalation.length, `${a.id} escalates to nobody`).toBeGreaterThan(0);
    }
  });

  it('states an evidence type for every activity', () => {
    for (const a of ACTIVITY_LIBRARY) {
      expect(a.evidenceType, `${a.id} has no evidence type`).toBeTruthy();
    }
  });

  it('says what counts as failure, so the exception engine has a rule', () => {
    const silent = ACTIVITY_LIBRARY.filter((a) => !a.failure);
    expect(silent.map((a) => a.id)).toEqual([]);
  });
});

describe('the five object types and six engines are populated', () => {
  it('classifies every activity as one of the five origins', () => {
    const valid = ['RECURRING', 'PATIENT_EVENT', 'CONDITION', 'GATE', 'EXCEPTION'];
    for (const a of ACTIVITY_LIBRARY) expect(valid).toContain(a.origin);
  });

  it('is not all RECURRING', () => {
    // The state this repository was actually in until now.
    const recurring = activitiesByOrigin('RECURRING').length;
    expect(recurring).toBeGreaterThan(0);
    expect(recurring).toBeLessThan(ACTIVITY_LIBRARY.length);
  });

  it('has real work behind every one of the five types that the matrix uses', () => {
    for (const o of ['RECURRING', 'PATIENT_EVENT', 'CONDITION', 'GATE']) {
      expect(activitiesByOrigin(o).length, `nothing is ${o}`).toBeGreaterThan(0);
    }
  });

  it('routes gates to the compliance engine and nowhere else', () => {
    for (const a of activitiesByOrigin('GATE')) {
      expect(a.engine, `${a.id} is a gate on the ${a.engine} engine`).toBe('COMPLIANCE');
    }
  });

  it('spreads across at least five of the six engines', () => {
    const used = new Set(ACTIVITY_LIBRARY.map((a) => a.engine));
    expect(used.size).toBeGreaterThanOrEqual(5);
  });
});

describe('the views over the library', () => {
  it('filters by function without losing anything', () => {
    const total = LIBRARY_FUNCTIONS
      .reduce((n, f) => n + activitiesInFunction(f).length, 0);
    expect(total).toBe(ACTIVITY_LIBRARY.length);
  });

  it('finds the work a named role touches in any of its four capacities', () => {
    const forDoctor = activitiesForRoleName('Treating Doctor');
    expect(forDoctor.length).toBeGreaterThan(0);
    for (const a of forDoctor) {
      const touches = a.doer === 'Treating Doctor' || a.checker === 'Treating Doctor'
        || a.owner === 'Treating Doctor' || a.escalation.includes('Treating Doctor');
      expect(touches).toBe(true);
    }
  });

  it('collects the KPIs the library feeds', () => {
    expect(LIBRARY_KPIS.length).toBeGreaterThan(50);
    expect(LIBRARY_KPIS).toEqual([...LIBRARY_KPIS].sort());
  });

  it('returns nothing for an engine nothing uses, rather than throwing', () => {
    expect(activitiesByEngine('NOT_AN_ENGINE')).toEqual([]);
  });
});

describe('unmade decisions stay unmade', () => {
  it('disables any activity whose due rule nobody has decided', () => {
    // Non-negotiable 4. A guessed schedule looks like a decision somebody made.
    for (const a of ACTIVITY_LIBRARY) {
      if (a.dueRule === null) expect(a.enabled, `${a.id} is enabled without a due rule`).toBe(false);
    }
  });
});
