/**
 * The library is enforced, not recommended.
 *
 * KuBi got into trouble because every screen was free to invent its own way of
 * saying a thing that already had a way. Twenty-seven screens produced forty
 * families of class name: the answer block was written twice at two sizes with
 * two incompatible sets of tone names, and the row four times. Nothing was
 * wrong on its own screen. Together it looked like four products, and the
 * owner said so: "it looks haphazard".
 *
 * A shared component file does not fix that on its own — the next screen just
 * writes its own markup again, in a hurry, and nobody notices for a month. So
 * the rule is a test:
 *
 *   **A converted screen may only use class names the library defines.**
 *
 * If a screen needs a shape the library does not have, the shape is added to
 * ui.tsx once and every screen gets it. That is the whole discipline, and it
 * is three lines of policy rather than a style guide nobody reads.
 *
 * The register below is the honest state of the conversion. It may shrink. It
 * may never grow — a new screen is born converted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SCREENS = join(process.cwd(), 'apps/web/src/screens');

/**
 * The vocabulary. Every class name ui.tsx renders, including the ones it
 * builds by template (`answer-${tone}`), expanded.
 *
 * Kept as an explicit list rather than scraped out of ui.tsx: a scraper would
 * pass the moment somebody added a class to the library for one screen's
 * benefit, which is the failure this test exists to catch.
 */
const TONES = ['good', 'warn', 'stop', 'calm'];

const LIBRARY = new Set([
  // the page
  'screen', 'screen-wide', 'screen-title', 'screen-sub', 'back',
  'today-columns', 'today-main', 'today-side',
  // level 1 — the answer
  'answer', 'answer-verdict', 'answer-why', 'answer-do',
  ...TONES.map((t) => `answer-${t}`),
  // level 2 — the group
  'group', 'group-title', 'group-count', 'group-note',
  ...TONES.map((t) => `group-${t}`),
  // level 3 — the row
  'row', 'row-main', 'row-title', 'row-note', 'row-go', 'row-tags', 'row-static',
  'is-blocked', 'is-overdue',
  ...TONES.map((t) => `row-${t}`),
  // furniture
  'tag', 'tag-mono', ...TONES.map((t) => `tag-${t}`),
  'facts', 'fact', 'fact-value', 'fact-label', ...TONES.map((t) => `fact-${t}`),
  'empty', 'empty-big', 'empty-line',
  'notice', 'notice-title', ...TONES.map((t) => `notice-${t}`),
  'switch', 'switch-opt', 'is-on',
  'btn', 'btn-quiet', 'btn-danger',
  'more',
  // the journey
  'jr', 'jr-step', 'jr-mark', 'jr-main', 'jr-label', 'jr-needs', 'jr-act',
  'jr-done', 'jr-now', 'jr-blocked', 'jr-waiting', 'jr-absent',
  // forms
  'field', 'field-label',

  /* ── the shell, and the two screens on it ──────────────────────────────
     New shapes rather than second ways of saying old ones: a rail, a state
     card, a block list, a meter. Registered here so the discipline still
     bites — any screen inventing a *seventh* way to draw a row still fails.  */
  // dashboard
  'dash-kicker', 'dash-headline', 'dash-sub', 'dash-cards', 'dash-section',
  'dash-list', 'dash-row', 'dash-row-body', 'dash-row-title', 'dash-row-meta',
  'more-row',
  'state-card', 'state-card-title', 'state-card-state', 'state-card-detail',
  'state-card-bar',
  // clinic readiness
  'ready-panel', 'ready-head', 'ready-kicker', 'ready-verdict', 'ready-sub',
  'ready-note', 'ready-advisory', 'ready-advisory-head',
  'block-list', 'block', 'block-mark', 'block-body', 'block-label',
  'block-meta', 'block-do',
  'meter', 'meter-value',
  /* ── patient events ──────────────────────────────────────────────────
     One genuinely new shape, and the reason it is new: a care item has four
     states, not two. Met, outstanding, unknown and not-applicable cannot be
     drawn with `block-mark`, which is a tick or a blank — and the whole
     argument of that screen is that an unanswered question is not the same
     as an undone task. So `care-pip` exists, and nothing else on the screen
     does: the rows underneath it are `block`, the panels are `ready-panel`. */
  'care', 'care-head', 'care-title', 'care-state', 'care-counts', 'care-count',
  'care-more', 'care-detail', 'care-group', 'care-group-title', 'care-pip',
  'care-why',
  'is-met', 'is-open', 'is-late', 'is-unknown', 'is-aside',
  'is-ready', 'is-held', 'is-dim', 'is-quiet',
  /* ── equipment ────────────────────────────────────────────────────────
     An asset card is a record, not a task: identity, state, facts, then the
     cycles. It reuses `fact`, `tag`, `switch` and `block` from the library
     and adds only the frame around them. */
  'asset-list', 'asset', 'asset-head', 'asset-id', 'asset-name', 'asset-where',
  'asset-headline', 'asset-state', 'asset-facts', 'asset-detail', 'asset-block',
  'asset-line',
  'asset-operational', 'asset-overdue', 'asset-down', 'asset-unserviced',
  'asset-state-operational', 'asset-state-overdue', 'asset-state-down',
  'asset-state-unserviced',
  'fact-stop',
  /* ── compliance ───────────────────────────────────────────────────────
     A gate list is only worth reading if it says why each gate exists and
     what would prove it. The basis badge carries the first; the breach block
     is the one thing on that screen that cannot be fixed by doing the work,
     so it is drawn as a block rather than as another row. */
  'gate-basis', 'gate-statutory', 'gate-consent', 'gate-safety',
  'gate-clinical', 'gate-record',
  'gate-tally', 'gate-tally-row', 'gate-tally-label', 'gate-tally-count',
  'breach', 'breach-title', 'breach-line',
  /* the protocol spine, and the horizon that raises a failure before the
     patient arrives rather than when the doctor asks for the component */
  'spine', 'spine-stage', 'spine-mark', 'spine-verdict',
  'horizon', 'horizon-row', 'horizon-sev', 'horizon-body', 'horizon-head',
  'horizon-why', 'horizon-lost',
  'is-critical', 'is-high', 'is-normal', 'is-clear',
  /* ── the readiness lanes and the cleaning rounds ──────────────────────
     A lane is one role's whole morning with its own fraction, which the flat
     block list could not express: "nine of eleven" cannot tell you whether
     the assistants are nearly finished or housekeeping has not started. The
     HK row is a five-column line rather than a `block`, because a scheduled
     round is a record of something that happened and not a task to press. */
  'lane', 'lane-head', 'lane-who', 'lane-mark', 'lane-name', 'lane-question',
  'lane-count',
  'hk-list', 'hk', 'hk-id', 'hk-what', 'hk-who', 'hk-when', 'hk-state',
  'is-waiting',
  /* ── reception, the appointment book ──────────────────────────────────
     A slot is built around what will go wrong with it: the problems are the
     body of the row rather than an icon, because a row that hides its own
     findings is a row somebody has to open every one of. The script is two
     columns because the clinic has two scripts, and the form is a numbered
     list with a reason per field. None of them is a `block` — nothing here
     is a task waiting for a button. */
  'slot-list', 'slot', 'slot-head', 'slot-time', 'slot-who', 'slot-name',
  'slot-tag', 'slot-state', 'slot-meta', 'slot-special', 'slot-why',
  'slot-control',
  'slot-ok', 'slot-open', 'slot-off', 'slot-here', 'slot-late', 'slot-bad',
  'script', 'script-head', 'script-col', 'script-row', 'script-line',
  'form-list', 'ff', 'ff-num', 'ff-label', 'ff-opt', 'ff-why',
  /* attendance, which lives inside readiness rather than in a tab of its own */
  'staffing', 'staff-roles', 'staff-role', 'staff-mark', 'staff-name',
  'staff-count', 'staff-owns',
  'clash', 'clash-title', 'clash-row', 'clash-note',
  /* ── the dashboard's failing parameters ───────────────────────────────
     The one shape the library did not have: a failure carrying its people.
     Every other list in KuBi is work somebody must do; this is a fault
     somebody must own, and the owner's name is the point of the row rather
     than a detail on it. `who-nobody` is deliberately its own class — an
     unowned failure has to read differently from an owned one, not merely
     have an empty field where a name would be. */
  'fail-list', 'fail', 'fail-head', 'fail-what', 'fail-sev', 'fail-why',
  'fail-foot', 'fail-where',
  'fail-stops', 'fail-holds', 'fail-watch',
  'who', 'who-nobody', 'who-person', 'who-name', 'who-note',
  // shared state modifiers
  'is-good', 'is-warn', 'is-bad', 'is-done', 'is-here', 'is-urgent',
]);

/**
 * Screens rebuilt on the library. Adding a file here is the conversion; the
 * test then holds it there.
 */
const CONVERTED = [
  'attention.tsx',
  'audit.tsx',
  'briefing.tsx',
  'checks.tsx',
  'day.tsx',
  'exceptions.tsx',
  'gate.tsx',
  'notifications.tsx',
  'closing.tsx',
  'dashboard.tsx',
  'day-blocks.tsx',
  'patient-360.tsx',
  // Built on the vocabulary from the first line rather than converted onto it
  // afterwards, which is the point of having one.
  'now.tsx',
  'equipment.tsx',
  'patient-events.tsx',
  'readiness.tsx',
  'reception.tsx',
  'retention.tsx',
  'rules.tsx',
  'today.tsx',
];

/**
 * Screens still carrying their own vocabulary, with the count of distinct
 * class names each one owns. This is the debt, named. The numbers may fall
 * and files may leave; nothing may be added.
 */
const NOT_YET_CONVERTED = [
  'activity-library.tsx', 'clinic.tsx', 'clinic-header.tsx',
  'command-centre.tsx', 'command-palette.tsx', 'confirmations.tsx',
  'current-task.tsx', 'engines.tsx', 'entry.tsx',
  'handover.tsx', 'operations.tsx', 'owner-business.tsx',
  'patients.tsx', 'quality.tsx', 'reception-board.tsx', 'sign-in.tsx',
  'standards.tsx', 'task-sheet.tsx',
];

/** Every class name a file mentions, from both literals and templates. */
function classesIn(file: string): string[] {
  const src = readFileSync(join(SCREENS, file), 'utf8');
  const out: string[] = [];
  // className="a b c" and className={`a ${x} b`} and className={`a-${t}`}
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const raw = m[1] ?? m[2] ?? '';
    // Drop interpolations: `${cond ? 'x' : ''}` contributes its own literals,
    // which the next expression picks up.
    for (const word of raw.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
      if (word) out.push(word);
    }
  }
  // Class names living in a lookup table or a ternary rather than in the
  // attribute — `const TONE = { GREEN: 'row-good' }` and `? 'is-on' : ''`.
  for (const m of src.matchAll(/className=\{([^}]*)\}/g)) {
    for (const s of (m[1] ?? '').matchAll(/'([a-z][a-z0-9-]*)'/g)) out.push(s[1]!);
  }
  return out;
}

describe('the UI library', () => {
  it.each(CONVERTED)('%s uses only library class names', (file) => {
    const strays = [...new Set(classesIn(file))].filter((c) => !LIBRARY.has(c));
    expect(
      strays,
      `${file} invents ${strays.join(', ')}. Add the shape to ui.tsx instead — `
      + 'a second way to say something that already has a way is how this got haphazard.',
    ).toEqual([]);
  });

  it('every screen is either converted or on the register', () => {
    const onDisk = readdirSync(SCREENS).filter((f) => f.endsWith('.tsx')).sort();
    const accounted = [...CONVERTED, ...NOT_YET_CONVERTED].sort();
    // A new screen is born converted: it may not quietly join the debt list.
    expect(onDisk).toEqual(accounted);
  });

  it('the debt register only shrinks', () => {
    // Recorded when the library landed. Raising this number is the one change
    // this test exists to prevent.
    expect(NOT_YET_CONVERTED.length).toBeLessThanOrEqual(18);
  });
});
