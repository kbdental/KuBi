/**
 * The specification, kept honest.
 *
 * A frozen architecture document that nothing checks is a document that
 * disagrees with the code by Thursday and nobody notices until somebody builds
 * from it. So:
 *
 *   · every open decision is numbered, listed once, and referenced by the
 *     section it blocks;
 *   · every claim that something is BUILT points at something that exists;
 *   · nothing marked DECISION_REQUIRED has quietly acquired a value.
 *
 * That last one is working-agreement rule 4, applied to the specification
 * rather than to a seed register. It is the rule I have broken most often in
 * this project, which is why it gets a test here before any of these engines
 * is written.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ClinicEvent, FLOWS, IMPERATIVE_PREFIXES,
  emptyWorld, record, sweep, deskOf, board, admit, ownerOf,
} from '@kubi/contracts';

const SPEC = 'docs/architecture/kubi-architecture-spec-v1.md';
const text = readFileSync(SPEC, 'utf8');

describe('the specification covers what was asked for', () => {
  it('answers all ten numbered requirements', () => {
    // The owner listed ten. The map at the top of the document is how they can
    // check I covered them without reading the whole thing.
    for (const asked of [
      'Core domain entities', 'Events', 'Workflows', 'Ownership rules',
      'Decision rules', 'Resource rules', 'Escalation rules',
      'State transition rules', 'APIs between engines', 'event-log schema',
    ]) {
      expect(text, `the "${asked}" requirement is not mapped to a section`)
        .toContain(asked);
    }
  });

  it('carries all seven objectives, in the owner’s order', () => {
    // The order is the specification, not decoration: it is the tie-breaker
    // when two decisions compete. Reordering it changes what the clinic does.
    const order = [
      'Patient safe', 'Patient happy', 'Treatment successful',
      'Clinic efficient', 'Money collected', 'Records complete',
      'Patient recalled',
    ];
    const positions = order.map((o) => text.indexOf(o));
    expect(positions.every((p) => p > 0), 'an objective is missing').toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('gives every one of the eight laws a check that can actually run', () => {
    for (let i = 1; i <= 8; i += 1) {
      expect(text, `law L-${i} is missing`).toContain(`| L-${i} |`);
    }
    // A law with no check is a slogan. The table's third column is what makes
    // the difference, so no row may leave it empty.
    const laws = [...text.matchAll(/\| (L-\d) \| ([^|]+)\| ([^|]+)\|/g)];
    expect(laws).toHaveLength(8);
    for (const [, id, , check] of laws) {
      expect(check.trim().length, `${id} has no continuous check`).toBeGreaterThan(20);
    }
  });

  it('names all twelve engines', () => {
    for (const engine of [
      'DECISION', 'CAPACITY', 'PREDICTION', 'RESOURCE', 'GOVERNANCE',
      'WORKFLOW', 'OWNERSHIP', 'TIME', 'EVENT LOG', 'OBJECTIVES',
    ]) {
      expect(text, `${engine} is missing from the layering`).toContain(engine);
    }
  });
});

describe('nothing has been quietly decided', () => {
  const ids = [...text.matchAll(/\bD-(\d\d)\b/g)].map((m) => m[1]!);

  it('numbers every open decision without gaps or duplicates', () => {
    const unique = [...new Set(ids)].sort();
    expect(unique.length).toBeGreaterThanOrEqual(15);
    // A gap means a decision was deleted rather than answered.
    expect(unique).toEqual(unique.map((_, i) => String(i + 1).padStart(2, '0')));
  });

  it('lists each one in the register as well as at the point it blocks', () => {
    // Found by title rather than by number: the register moved from §15 to
    // §17 when the domains section was inserted, and a test that hard-codes a
    // section number fails for the wrong reason the first time anything moves.
    const register = text.slice(text.indexOf('Open decisions'));
    for (const id of new Set(ids)) {
      expect(register, `D-${id} is raised but not in the register`).toContain(`D-${id}`);
    }
  });

  it('states a real question for each, not a placeholder', () => {
    const rows = [...text.matchAll(/\| D-\d\d \| ([^|]+)\| ([^|]+)\|/g)];
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const [, section, question] of rows) {
      expect(section.trim(), 'a decision blocks no section').toMatch(/§/);
      expect(question.trim().length, 'a decision has no question').toBeGreaterThan(15);
    }
  });

  it('refuses to guess the times, which is the decision I most wanted to fill in', () => {
    // Every expected time in the code today is an estimate of mine. The
    // specification says so rather than presenting them as agreed.
    expect(text).toContain('All current values are estimates and none is the');
  });
});

describe('every BUILT claim points at something that exists', () => {
  it('has the workflow, ownership, time, role and board engines it claims', () => {
    // The status table says these are built and tested. If any were removed,
    // the specification would be advertising something absent.
    for (const fn of [record, sweep, deskOf, board, admit, ownerOf, emptyWorld]) {
      expect(typeof fn).toBe('function');
    }
  });

  it('has the seven concurrent flows it names', () => {
    for (const kind of [
      'CLINIC', 'PATIENT', 'CLINICAL', 'STERILIZATION', 'LAB', 'INVENTORY', 'BILLING',
    ]) {
      expect(text, `${kind} is not named in the specification`).toContain(kind);
      expect(FLOWS[kind as keyof typeof FLOWS], `${kind} is specified but not built`)
        .toBeDefined();
    }
  });

  it('still holds the past-tense rule the specification states as law', () => {
    // §4.1 rule 1. Restated here because the specification asserts it as a
    // property of the system, and an assertion nothing enforces is a wish.
    for (const name of Object.values(ClinicEvent)) {
      for (const bad of IMPERATIVE_PREFIXES) {
        expect(name.startsWith(bad), `${name} reads as an instruction`).toBe(false);
      }
    }
  });
});

describe('the document points at itself correctly', () => {
  it('resolves every section reference to a heading that exists', () => {
    // Two references broke silently when the domains section was inserted and
    // everything below it shifted by two. A long specification with dead
    // cross-references is one nobody trusts, and this is cheaper than care.
    const headings = new Set([
      ...[...text.matchAll(/^## (\d+)\./gm)].map((m) => m[1]!),
      ...[...text.matchAll(/^### (\d+\.\d+)/gm)].map((m) => m[1]!),
    ]);
    const refs = [...new Set([...text.matchAll(/§(\d+(?:\.\d+)?)/g)].map((m) => m[1]!))];
    expect(refs.length).toBeGreaterThan(15);
    for (const r of refs) {
      expect(headings.has(r), `§${r} is referenced but no such section exists`).toBe(true);
    }
  });
});

describe('the design philosophy, which exists to stop the drift', () => {
  it('states all eight principles the owner asked for by name', () => {
    for (let i = 1; i <= 8; i += 1) {
      expect(text, `principle P-${i} is missing`).toContain(`| P-${i} |`);
    }
  });

  it('gives each one a way to detect the violation', () => {
    // "A principle nobody can check is a principle that gets argued away at
    // the fourth sprint." Each row's third column is the drift test.
    const rows = [...text.matchAll(/\| (P-\d) \| ([^|]+)\| ([^|]+)\|/g)];
    expect(rows).toHaveLength(8);
    for (const [, id, , violation] of rows) {
      expect(violation.trim().length, `${id} has no drift test`).toBeGreaterThan(25);
    }
  });

  it('requires an ADR to break one, rather than a code review comment', () => {
    expect(text).toContain('Violating any principle in §2.3 requires an ADR');
  });
});

describe('the seven business domains', () => {
  it('names all seven', () => {
    for (let i = 1; i <= 7; i += 1) {
      expect(text, `domain B-${i} is missing`).toContain(`B-${i}`);
    }
    for (const d of [
      'Patient relationship', 'Clinical care', 'Practice operations',
      'Business', 'Growth', 'Quality', 'Learning',
    ]) {
      expect(text, `${d} is not named`).toContain(d);
    }
  });

  it('states honestly how much of each is actually covered', () => {
    // The uncomfortable finding, kept in the document rather than in a
    // roadmap: three of seven domains are essentially absent and one is built
    // but unconnected. Deleting this line would make the spec flattering.
    expect(text).toContain('Three of seven domains are essentially absent');
  });

  it('defers the full dental domain model rather than half-writing it', () => {
    expect(text).toContain('Dental Practice Domain Model');
    expect(text).toContain('Phase 2 of the owner’s own roadmap'.replace('’', "'"));
  });
});

describe('what a decision carries with it', () => {
  it('attaches knowledge to work instead of offering a library', () => {
    expect(text).toContain('Knowledge is attached to work, never searched for');
  });

  it('returns communication as a consequence rather than sending it', () => {
    expect(text).toContain('never sent by an');
  });

  it('keeps one deliberate silence in the communication table', () => {
    // Messaging somebody standing at the desk is how a clinic teaches its
    // patients to ignore its messages.
    expect(text).toContain('nothing; the person is standing there');
  });

  it('makes every decision explain itself four ways', () => {
    for (const field of ['`why`', '`evidence`', '`protocol`', '`ifIgnored`']) {
      expect(text, `${field} is missing from decision quality`).toContain(field);
    }
    expect(text).toContain('A decision that cannot state all four is not shown');
  });

  it('refuses a partial readiness score, which is the dangerous display', () => {
    expect(text).toContain('reads as nearly ready and it');
  });
});

describe('the things it deliberately does not do', () => {
  it('specifies no UI', () => {
    expect(text).toContain('**NOT SPECIFIED.** Deliberately.');
  });

  it('refuses to invent a prediction without history', () => {
    // The worst thing this system could do to the owner is put a confident
    // number on their screen that came from nothing.
    expect(text).toContain('never returns a plausible-looking number');
  });

  it('keeps the append-only guarantee in the database rather than in manners', () => {
    expect(text).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON clinic_events');
    expect(text).toContain('Append-only by database grant, not by good manners');
  });

  it('closes itself to further expansion, at the owner’s instruction', () => {
    // "I would not let Claude continue expanding this architecture
    // indefinitely." A specification that keeps growing is one nothing is ever
    // built from, so this is a rule in the document and a test here.
    expect(text).toContain('This specification stops expanding here');
    expect(text).toContain('COMPLETE — awaiting owner acceptance');
  });

  it('adopts the owner’s four phases, with the UI last', () => {
    const road = text.slice(text.indexOf('### The roadmap'));
    expect(road.indexOf('1 — Freeze')).toBeLessThan(road.indexOf('2 — Dental domain'));
    expect(road.indexOf('2 — Dental domain')).toBeLessThan(road.indexOf('3 — Engines'));
    expect(road.indexOf('3 — Engines')).toBeLessThan(road.indexOf('4 — Role UI'));
  });

  it('states a build order that puts prediction last, because it needs history', () => {
    const order = text.slice(text.indexOf('### Build order'));
    expect(order.indexOf('Objectives and laws')).toBeLessThan(order.indexOf('Decision engine'));
    expect(order.indexOf('Decision engine')).toBeLessThan(order.indexOf('Prediction'));
    expect(order.indexOf('Prediction')).toBeLessThan(order.indexOf('UI'));
  });
});
