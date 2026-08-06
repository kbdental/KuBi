/**
 * A decision the owner has made, and the line it must not cross.
 *
 * The owner said: *"yes escalate it, missed rounds should reach Rahul."* Rahul
 * is the Clinic Manager. The v3.0 register already carried that ladder —
 * Housekeeping → Clinic Manager → Clinic Head — so the decision confirmed it
 * rather than changed it, and the work was to make the app *say* so.
 *
 * Two things are tested here, and the second matters more than the first:
 *
 * 1. The generated file still matches the register the owner edits.
 * 2. Showing a proposal's ladder does not make the standard governed. This is
 *    the same mistake I made before, when I pointed `covers` at a v3.0 id and
 *    ten ungoverned rows quietly began to read as supervised. The distinction
 *    is easy to blur and expensive to blur, so it gets its own tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  PROPOSED_CONTROLS, proposalById, readyToAccept, liveProposals, withdrawn,
  DAILY_STANDARD, ACTIVITY_LIBRARY, ladderFor, proposedLadderFor, provenanceOf, runDay,
} from '@kubi/contracts';

const REGISTER = 'docs/requirements/matrix-v3-proposals.tsv';

describe('the generated file and the register the owner edits', () => {
  it('is current — the register is the source, this file is the copy', () => {
    // Fails loudly rather than drifting quietly. Fix: run
    //   node scripts/generate-proposed-controls.mjs
    expect(() => execFileSync('node', ['scripts/generate-proposed-controls.mjs', '--check'], {
      encoding: 'utf8',
    })).not.toThrow();
  });

  it('carries every row of the register, and no row the register does not have', () => {
    const ids = readFileSync(REGISTER, 'utf8').replace(/\r\n/g, '\n').trimEnd()
      .split('\n').slice(1).filter((l) => l.trim() !== '')
      .map((l) => l.split('\t')[0]!.trim());
    expect(PROPOSED_CONTROLS.map((p) => p.id)).toEqual(ids);
  });

  it('leaves a DECISION_REQUIRED cell empty and lists it as open', () => {
    // Rule 4 of the working agreement: never silently resolve an open decision.
    // A proposal with an open frequency has null there, not a plausible guess.
    const hk7 = proposalById('HK-007')!;
    expect(hk7.frequency).toBeNull();
    expect(hk7.dueRule).toBeNull();
    expect(hk7.openDecisions).toContain('Frequency');
    expect(hk7.openDecisions).toContain('Due Rule');
  });

  it('counts what is settled and what is not', () => {
    // 38 rows: 32 live proposals and 6 withdrawn. Of the live ones, 13 could
    // be accepted the day the matrix unfreezes; 19 are waiting on a frequency,
    // a due rule, a sub-process or a KPI.
    //
    // 13 rather than 12 since 2026-08-06: the owner answered PAT-006, the
    // dormant-patient control, with "30 days". One answer, one fewer blocked
    // proposal — which is the shape of every remaining decision on this list.
    expect(PROPOSED_CONTROLS).toHaveLength(38);
    expect(liveProposals()).toHaveLength(32);
    expect(withdrawn()).toHaveLength(6);
    expect(readyToAccept()).toHaveLength(13);
  });
});

describe('the check that has to happen before anything is proposed', () => {
  it('records, on every row, what it was compared against in the frozen matrix', () => {
    // The column exists because it was skipped once. Six proposals reached the
    // owner's register duplicating controls the clinic already runs — a staff
    // arrival time, a crown-delivery scheduling gate, a same-day sterilisation
    // deadline — because the frozen matrix was never read alongside them.
    // An empty cell here means that comparison was not made.
    for (const p of PROPOSED_CONTROLS) {
      expect(p.frozenCheck, `${p.id} has no frozen-matrix check`).toBeTruthy();
    }
  });

  it('names real frozen activities, or says NONE_FOUND', () => {
    const frozen = new Set(ACTIVITY_LIBRARY.map((a) => a.id));
    for (const p of PROPOSED_CONTROLS) {
      const named = p.frozenCheck.match(/\b[A-Z]{3,4}-\d{3}\b/g) ?? [];
      if (named.length === 0) {
        expect(p.frozenCheck, `${p.id} names nothing and does not say NONE_FOUND`)
          .toContain('NONE_FOUND');
        continue;
      }
      for (const id of named) {
        expect(frozen.has(id), `${p.id} cites ${id}, which is not in the frozen matrix`).toBe(true);
      }
    }
  });

  it('gives a withdrawn row a frozen control to point at', () => {
    // A withdrawal must name what supersedes it. "Withdrawn" with no successor
    // is how work quietly disappears.
    for (const p of withdrawn()) {
      expect(p.frozenCheck, `${p.id} was withdrawn without naming what replaces it`)
        .toMatch(/[A-Z]{3,4}-\d{3}/);
      expect(p.frozenCheck).not.toContain('NONE_FOUND');
    }
  });
});

describe("the owner's escalation decision, as the register states it", () => {
  it('sends every housekeeping proposal to the Clinic Manager', () => {
    // "Missed rounds should reach Rahul." Rahul is the Clinic Manager, so the
    // decision is recorded against the job, not the person — the ladder must
    // survive Rahul leaving.
    const housekeeping = PROPOSED_CONTROLS.filter((p) => p.id.startsWith('HK-'));
    expect(housekeeping).toHaveLength(14);
    for (const p of housekeeping) {
      expect(p.escalation, `${p.id} escalation`).toContain('Clinic Manager');
      expect(p.escalation[2], `${p.id} L3`).toBe('Clinic Head');
    }
  });

  it('names a job title, never a person', () => {
    const everyName = PROPOSED_CONTROLS.flatMap((p) => [...p.escalation, p.owner]);
    expect(everyName.some((n) => /rahul|priya|anita/i.test(n))).toBe(false);
  });
});

describe('a proposal is not a control, however it is displayed', () => {
  it('leaves the standard ungoverned and unsupervised', () => {
    const s = DAILY_STANDARD.find((x) => x.proposed === 'HK-001')!;
    expect(s.covers).toBeNull();
    expect(ladderFor(s)).toBeNull();          // still nothing governs it today
    expect(provenanceOf(s).escalatesTo).toBeNull();
    expect(provenanceOf(s).unsupervised).toBe(true);
  });

  it('says who would hear, and under what, without pretending they will', () => {
    const s = DAILY_STANDARD.find((x) => x.proposed === 'HK-001')!;
    const p = provenanceOf(s);
    expect(p.proposed).toBe('HK-001');
    expect(p.wouldEscalateTo).toBe('Housekeeping');   // L1: the doer's own level
    expect(proposedLadderFor(s)!.rungs[1]!.to).toBe('Clinic Manager');  // L2: Rahul
    expect(proposedLadderFor(s)!.blockedBy).toEqual([]);
  });

  it('carries the open decisions that stop it being accepted', () => {
    const s = DAILY_STANDARD.find((x) => x.proposed === 'HK-007')!;
    // The escalation is settled; the schedule is not. Both facts travel together,
    // because "reaches the Clinic Manager when late" is empty until something
    // says when it is late.
    expect(proposedLadderFor(s)!.rungs[1]!.to).toBe('Clinic Manager');
    expect(provenanceOf(s).blockedBy).toEqual(['Frequency', 'Due Rule']);
  });

  it('never returns a proposal for a standard a frozen control governs', () => {
    const governed = DAILY_STANDARD.find((s) => s.covers)!;
    expect(proposedLadderFor(governed)).toBeNull();
  });

  it('keeps every proposed id out of the frozen matrix', () => {
    // This test is what caught the duplication. Five ids collided outright —
    // ATT-001, ATT-002, LAB-001, INV-001, TRN-001 — and the collision was the
    // symptom: the frozen matrix already ran attendance, lab cases, consumable
    // checks and competency, and the proposals had been written without it.
    // The freeze, restated where it would be broken. If one of these ever
    // appears in ACTIVITY_LIBRARY it has been accepted, and this file — not
    // the screen — is where that has to be noticed.
    const frozen = new Set(ACTIVITY_LIBRARY.map((a) => a.id));
    for (const p of PROPOSED_CONTROLS) {
      expect(frozen.has(p.id), `${p.id} is now in the frozen matrix`).toBe(false);
    }
  });
});

describe('the running day, with the decision in it', () => {
  it('still escalates a proposed standard to nobody at all', () => {
    // 13:20 — a two-hourly round due at 13:00 is twenty minutes late.
    const day = runDay(13 * 60 + 20);
    const late = day.items.filter((i) => i.state === 'LATE' && i.standard.proposed);
    expect(late.length).toBeGreaterThan(0);
    for (const i of late) {
      expect(i.escalatedTo, `${i.key} was escalated for real`).toBeNull();
      expect(i.level).toBeNull();
      expect(i.unsupervised).toBe(true);
    }
  });

  it('tells the person reading it who it would have reached', () => {
    const day = runDay(13 * 60 + 20);
    const withDraft = day.items.filter((i) => i.wouldReach !== null);
    expect(withDraft.length).toBeGreaterThan(0);
    for (const i of withDraft) {
      expect(i.unsupervised, `${i.key} is supervised but carries a draft`).toBe(true);
      expect(i.wouldReachUnder).toBeTruthy();
    }
  });

  it('leaves the standards with no proposal at all saying nothing', () => {
    // Seven of the seventeen ungoverned rows have no drafted control either.
    // They must keep reading as a blank, because they are one.
    const day = runDay(13 * 60 + 20);
    const nothing = day.items.filter((i) => i.unsupervised && !i.standard.proposed);
    expect(nothing.length).toBeGreaterThan(0);
    for (const i of nothing) expect(i.wouldReach).toBeNull();
  });
});
