/**
 * Render the six libraries as one readable document.
 *
 * The owner asked to see what was stored, to check it against what they wrote.
 * That is an audit, not a browse — so the page is generated from the contracts
 * themselves rather than typed out, and the primary encoding on every row is
 * PROVENANCE: whose decision this was.
 *
 *   verbatim  the owner's own words, unedited
 *   derived   read out of the owner's words (a verb, a heading, a KPI)
 *   open      nobody has decided — recorded null, never guessed
 *   cannot    KuBi has no way to do this today, and says what it needs
 *
 * A page that showed all 666 rows identically would be exactly the lie these
 * libraries were built to avoid.
 *
 *   node scripts/render-libraries.mjs docs/kubi-libraries.html
 */
import { writeFileSync } from 'node:fs';
import {
  DAILY_STANDARD, RHYTHM_LABEL, theDay, proofMix, ungoverned, unproven,
  PATIENT_JOURNEY, theJourney, journeyCompleteness, needsOwner,
  CONDITION_LIBRARY, theConditions, conditionCoverage, missingCapabilities,
  COMPLIANCE_GATES, TREATMENT_GATES, gateCoverage, missingForGates,
  EXCEPTION_LIBRARY, theExceptions, ESCALATION_MATRIX, exceptionCoverage,
  unmappedRoles, isImmediate,
  PROCEDURE_PROTOCOLS, UNIVERSAL_PROTOCOL, procedures, protocolOf,
  protocolCoverage, PHASE_LABEL,
} from '../packages/contracts/src/index.js';

const out = process.argv[2] ?? 'docs/kubi-libraries.html';
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const role = (r) => r ? String(r).replace(/_/g, ' ').toLowerCase() : null;

/* A row's provenance decides its stripe. Nothing else does. */
const P = { VERBATIM: 'verbatim', DERIVED: 'derived', OPEN: 'open', CANNOT: 'cannot' };

function cell(value, provenance) {
  if (value === null || value === undefined || value === '') {
    return `<td class="is-open">not decided</td>`;
  }
  return `<td${provenance ? ` class="is-${provenance}"` : ''}>${esc(value)}</td>`;
}

function table(headers, rows) {
  return `<div class="scroll"><table>
<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.join('\n')}</tbody></table></div>`;
}

function row(provenance, cells) {
  return `<tr class="p-${provenance}">${cells.join('')}</tr>`;
}

function section(id, num, title, lede, stats, body) {
  return `<section id="${id}">
  <p class="eyebrow">Library ${num} of 6</p>
  <h2>${esc(title)}</h2>
  <p class="lede">${lede}</p>
  <dl class="stats">${stats.map(([n, l, tone]) =>
    `<div${tone ? ` class="s-${tone}"` : ''}><dt>${esc(n)}</dt><dd>${esc(l)}</dd></div>`).join('')}</dl>
  ${body}
</section>`;
}

/* ---- 1. the daily operating standard ---------------------------------- */

const mix = proofMix();
const PROOF_WORD = {
  SYSTEM: 'KuBi knows', READING: 'a reading recorded',
  CONFIRMATION: 'somebody says so', NOT_YET: 'cannot be proved',
};

const dailyBody = theDay().map((slot) => `<h3>${esc(slot.label)} <span class="n">${slot.items.length}</span></h3>`
  + table(['Task', 'Your standard', 'Role', 'Control', 'How KuBi would know'],
    slot.items.map((s) => row(
      s.covers && s.proof !== 'NOT_YET' ? P.VERBATIM : s.proof === 'NOT_YET' ? P.CANNOT : P.OPEN,
      [
        `<td>${esc(s.task)}</td>`,
        `<td class="is-verbatim">${esc(s.standard)}</td>`,
        `<td>${esc(role(s.role))}</td>`,
        s.covers ? `<td class="mono">${esc(s.covers)}</td>`
          : `<td class="is-open">none — ${esc(s.gap)}</td>`,
        `<td class="${s.proof === 'NOT_YET' ? 'is-cannot' : ''}">${esc(PROOF_WORD[s.proof])}</td>`,
      ],
    )))).join('\n');

const one = section('daily', 1, 'The daily operating standard', 'Everything the clock raises. Your forty-seven non-negotiables, in your wording, in the seven slots of a day.', [
  [DAILY_STANDARD.length, 'non-negotiables'],
  [mix.SYSTEM, 'KuBi knows on its own'],
  [mix.CONFIRMATION, 'rest on somebody’s word', 'warn'],
  [ungoverned().length, 'have no control behind them', 'warn'],
  [unproven().length, 'cannot be proved at all', 'stop'],
], dailyBody);

/* ---- 2. the patient journey -------------------------------------------- */

const jc = journeyCompleteness();
const journeyBody = theJourney().map((st) => `<h3>${esc(st.label)} <span class="n">${st.tasks.length}</span></h3>`
  + table(['Task', 'Role', 'Your KPI', 'Control'],
    st.tasks.map((p) => row(
      p.role ? P.VERBATIM : P.OPEN,
      [
        `<td>${esc(p.task)}</td>`,
        cell(role(p.role), P.VERBATIM),
        cell(p.kpi, P.VERBATIM),
        p.covers ? `<td class="mono">${esc(p.covers)}</td>` : `<td class="is-open">none yet</td>`,
      ],
    )))).join('\n');

const two = section('journey', 2, 'The patient journey', 'Everything a patient raises. Thirteen stages from booking to case completion.', [
  [jc.tasks, 'tasks'],
  [jc.owned, 'have an owner'],
  [needsOwner().length, 'have nobody assigned', 'warn'],
  [jc.governed, 'sit under a control'],
], journeyBody);

/* ---- 3. conditions ------------------------------------------------------ */

const cc = conditionCoverage();
const condBody = `<h3>What KuBi would have to hold <span class="n">${missingCapabilities().length}</span></h3>`
  + table(['Capability', 'Rules it would switch on'],
    missingCapabilities().map((m) => row(P.CANNOT, [
      `<td>${esc(m.needs)}</td>`,
      `<td><b>${m.rules.length}</b> — ${esc(m.rules.map((r) => r.condition).join(', '))}</td>`,
    ])))
  + theConditions().map((g) => `<h3>${esc(g.letter)}. ${esc(g.label)} <span class="n">${g.rules.length}</span></h3>`
    + table(['Condition', 'Auto task', 'Role', 'Due', 'What it does', 'Can KuBi see it?'],
      g.rules.map((r) => row(
        r.detects ? (r.role ? P.VERBATIM : P.OPEN) : P.CANNOT,
        [
          `<td class="is-verbatim">${esc(r.condition)}</td>`,
          `<td class="is-verbatim">${esc(r.task)}</td>`,
          cell(role(r.role), P.VERBATIM),
          cell(r.due, P.VERBATIM),
          `<td class="is-derived">${r.action === 'BLOCK' ? 'stops work' : r.action === 'NOTIFY' ? 'tells somebody' : r.action === 'ESCALATE' ? 'escalates' : 'raises a task'}</td>`,
          r.detects ? `<td>yes — <span class="mono">${esc(r.detects)}</span></td>`
            : `<td class="is-cannot">no — needs ${esc(r.needs)}</td>`,
        ],
      )))).join('\n');

const three = section('conditions', 3, 'Condition-based tasks', 'Everything a fact raises. The exceptions, risks and missed steps nobody planned for.', [
  [cc.rules, 'rules'],
  [cc.canDetect, 'KuBi can actually notice'],
  [cc.rules - cc.canDetect, 'it cannot see at all', 'stop'],
  [cc.rules - cc.assigned, 'would land on nobody', 'warn'],
  [cc.blocks, 'stop work rather than create it'],
], condBody);

/* ---- 4. compliance gates ------------------------------------------------ */

const gc = gateCoverage();
const gateBody = `<h3>What KuBi would have to hold <span class="n">${missingForGates().length}</span></h3>`
  + table(['Capability', 'Requirements it would unlock'],
    missingForGates().map((m) => row(P.CANNOT, [
      `<td>${esc(m.needs)}</td>`,
      `<td><b>${m.requirements.length}</b> — ${esc(m.requirements.map((r) => r.label).join(', '))}</td>`,
    ])))
  + COMPLIANCE_GATES.map((g) => `<h3>Gate ${g.number} — ${esc(g.name)} <span class="n">${g.requirements.length}</span></h3>`
    + `<p class="blockif"><b>Blocks if:</b> ${esc(g.blockIf.join(' · '))}</p>`
    + table(['Must be completed', 'Can KuBi check it?'],
      g.requirements.map((r) => row(r.evaluable ? P.VERBATIM : P.CANNOT, [
        `<td class="is-verbatim">${esc(r.label)}</td>`,
        r.evaluable ? '<td>yes</td>'
          : `<td class="is-cannot">no — needs ${esc(r.needs)}. Returns UNKNOWN, and UNKNOWN is never PASS, so the gate refuses.</td>`,
      ])))).join('\n')
  + `<h3>Treatment-specific gates <span class="n">${TREATMENT_GATES.length}</span></h3>`
  + TREATMENT_GATES.map((t) => `<h4>${esc(t.treatment)}</h4>`
    + table(['Additional gate', 'Can KuBi check it?'],
      t.requirements.map((r) => row(r.evaluable ? P.VERBATIM : P.CANNOT, [
        `<td class="is-verbatim">${esc(r.label)}</td>`,
        r.evaluable ? '<td>yes</td>' : `<td class="is-cannot">no — needs ${esc(r.needs)}</td>`,
      ])))).join('\n');

const four = section('gates', 4, 'Compliance gates', 'The library that refuses work. Seventeen universal gates and twelve treatment sets, every one of them BLOCK_HARD — no override path exists.', [
  [gc.gates + gc.treatmentGates, 'gates'],
  [gc.requirements, 'requirements'],
  [gc.evaluable, 'KuBi can evaluate'],
  [gc.requirements - gc.evaluable, 'return UNKNOWN, so they refuse', 'stop'],
  [gc.enforceable, 'could be switched on today', 'stop'],
], gateBody);

/* ---- 5. exceptions ------------------------------------------------------- */

const ec = exceptionCoverage();
const excBody = '<h3>The escalation matrix</h3>'
  + table(['Level', 'Examples', 'Escalate within', 'Escalate to'],
    ESCALATION_MATRIX.map((l) => row(P.VERBATIM, [
      `<td><b>${l.level} — ${esc(l.label)}</b></td>`,
      `<td>${esc(l.examples)}</td>`,
      `<td class="${l.withinMinutes === 0 ? 'is-cannot' : ''}">${l.withinMinutes === 0 ? 'immediate' : `${l.withinMinutes} minutes`}</td>`,
      `<td>${esc(l.escalateTo)}</td>`,
    ])))
  + `<h3>Escalation targets KuBi has no role for <span class="n">${unmappedRoles().length}</span></h3>`
  + `<p class="blockif">Kept as you wrote them. Mapping these onto one of KuBi’s thirteen roles would name the wrong person at a critical moment.</p>`
  + table(['Job title'], unmappedRoles().map((r) => row(P.OPEN, [`<td>${esc(r)}</td>`])))
  + theExceptions().map((g) => `<h3>${esc(g.label)} <span class="n">${g.rules.length}</span></h3>`
    + table(['Exception', 'Auto task', 'Escalate to', 'Severity', 'What it does'],
      g.rules.map((e) => row(
        e.action === 'BLOCK' ? P.CANNOT : e.severityStated ? P.VERBATIM : P.DERIVED,
        [
          `<td class="is-verbatim">${esc(e.exception)}</td>`,
          `<td class="is-verbatim">${esc(e.task)}</td>`,
          `<td>${esc(e.escalateTo)}</td>`,
          `<td class="${isImmediate(e.severity) ? 'is-cannot' : ''}">${esc(e.severity.toLowerCase())} · ${isImmediate(e.severity) ? 'immediate' : 'within 15 min'}${e.severityStated ? '' : ' <span class="tag">read off the matrix</span>'}</td>`,
          `<td class="is-derived">${e.action === 'BLOCK' ? 'stops work' : e.action === 'NOTIFY' ? 'tells somebody' : e.action === 'ESCALATE' ? 'escalates' : 'raises a task'}</td>`,
        ],
      )))).join('\n');

const five = section('exceptions', 5, 'Exceptions and the escalation matrix', 'Everything a failure raises, and who hears about it. Three of your four severity levels escalate immediately — immediate is stored as zero, not as a small number.', [
  [ec.exceptions, 'exceptions'],
  [ec.immediate, 'cannot wait a minute', 'stop'],
  [ec.blocks, 'stop work rather than create it'],
  [ec.severityStated, 'came with a severity you set'],
  [unmappedRoles().length, 'escalation targets, 6 with no role'],
], excBody);

/* ---- 6. procedure protocols ---------------------------------------------- */

const pc = protocolCoverage();
const protoBody = procedures().map((p) => `<h3>${esc(p)} <span class="n">${protocolOf(p).reduce((n, x) => n + x.steps.length, 0)}</span></h3>`
  + protocolOf(p).map((ph) => `<h4>${esc(ph.label)} the procedure</h4>`
    + table(['#', 'Raised by', 'Step', 'Role'],
      ph.steps.map((s) => row(s.role ? P.VERBATIM : P.OPEN, [
        `<td class="mono">${s.order}</td>`,
        `<td class="is-verbatim">${esc(s.when)}${s.phaseStated ? '' : ' <span class="tag">phase read from the verb</span>'}</td>`,
        `<td class="is-verbatim">${esc(s.task)}</td>`,
        cell(role(s.role), P.VERBATIM),
      ])))).join('')).join('\n')
  + `<h3>Applies to every treatment <span class="n">${UNIVERSAL_PROTOCOL.length}</span></h3>`
  + `<p class="blockif">Held once rather than copied into all seventeen protocols.</p>`
  + table(['Raised by', 'Step'],
    UNIVERSAL_PROTOCOL.map((u) => row(P.VERBATIM, [
      `<td class="is-verbatim">${esc(u.when)}</td>`,
      `<td class="is-verbatim">${esc(u.task)}</td>`,
    ])));

const six = section('protocols', 6, 'Procedure protocols', 'The only library that is a sequence rather than a set. A step has a position, and the system answers “what is next” rather than listing everything at once.', [
  [pc.procedures, 'protocols'],
  [pc.steps, 'steps'],
  [pc.universal, 'universal rules'],
  [pc.steps - pc.owned, 'steps with nobody assigned', 'warn'],
], protoBody);

/* ---- the page ------------------------------------------------------------ */

const total = DAILY_STANDARD.length + PATIENT_JOURNEY.length + CONDITION_LIBRARY.length
  + gc.requirements + EXCEPTION_LIBRARY.length + PROCEDURE_PROTOCOLS.length
  + UNIVERSAL_PROTOCOL.length;

const nav = [
  ['daily', 'The daily standard', DAILY_STANDARD.length],
  ['journey', 'The patient journey', PATIENT_JOURNEY.length],
  ['conditions', 'Condition-based tasks', CONDITION_LIBRARY.length],
  ['gates', 'Compliance gates', gc.requirements],
  ['exceptions', 'Exceptions', EXCEPTION_LIBRARY.length],
  ['protocols', 'Procedure protocols', PROCEDURE_PROTOCOLS.length],
];

const html = `<title>KuBi — the six libraries</title>
<style>
:root {
  /* Inherited from apps/web/src/styles.css. A second palette for the same
     product would be the exact mistake these libraries were built against. */
  --ink: #101a22; --ink-soft: #4f5f6c; --ink-faint: #7d8b97;
  --line: #dde4ea; --line-soft: #eaeff3;
  --page: #f2f5f7; --card: #ffffff;
  --accent: #0d6e5e; --accent-soft: #e8f3f0;
  --safety: #b0202a; --safety-soft: #fdf1f1;
  --warn: #8a5a00; --warn-soft: #fdf7e9;
  --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
  --sans: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e6edf2; --ink-soft: #9aa9b5; --ink-faint: #74838f;
    --line: #24313c; --line-soft: #1b262f;
    --page: #0c1319; --card: #121b22;
    --accent: #4fbfa8; --accent-soft: #12302b;
    --safety: #f08a90; --safety-soft: #2e1519;
    --warn: #e0b45f; --warn-soft: #2b2213;
  }
}
:root[data-theme="dark"] {
  --ink: #e6edf2; --ink-soft: #9aa9b5; --ink-faint: #74838f;
  --line: #24313c; --line-soft: #1b262f;
  --page: #0c1319; --card: #121b22;
  --accent: #4fbfa8; --accent-soft: #12302b;
  --safety: #f08a90; --safety-soft: #2e1519;
  --warn: #e0b45f; --warn-soft: #2b2213;
}
:root[data-theme="light"] {
  --ink: #101a22; --ink-soft: #4f5f6c; --ink-faint: #7d8b97;
  --line: #dde4ea; --line-soft: #eaeff3;
  --page: #f2f5f7; --card: #ffffff;
  --accent: #0d6e5e; --accent-soft: #e8f3f0;
  --safety: #b0202a; --safety-soft: #fdf1f1;
  --warn: #8a5a00; --warn-soft: #fdf7e9;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--page); color: var(--ink);
  font: 16px/1.55 var(--sans); font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}
.wrap { display: grid; grid-template-columns: 1fr; gap: 0; max-width: 1500px; margin: 0 auto; }
@media (min-width: 1000px) {
  .wrap { grid-template-columns: 250px minmax(0, 1fr); gap: 48px; padding-right: 40px; }
}
/* ---- the rail ---- */
nav { padding: 40px 24px; }
@media (min-width: 1000px) {
  nav { position: sticky; top: 0; height: 100vh; overflow-y: auto; border-right: 1px solid var(--line); }
}
.mark { font: 700 26px/1 var(--serif); letter-spacing: -0.02em; color: var(--accent); }
.mark-sub { font-size: 13px; color: var(--ink-faint); margin-top: 6px; line-height: 1.4; }
nav ol { list-style: none; margin: 28px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; counter-reset: lib; }
nav a {
  display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
  padding: 9px 10px; border-radius: 7px; text-decoration: none; color: var(--ink-soft);
  font-size: 14.5px; line-height: 1.3;
}
nav a:hover, nav a:focus-visible { background: var(--line-soft); color: var(--ink); outline: none; }
nav a:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
nav a b { font-size: 12px; color: var(--ink-faint); font-weight: 600; }
.key { margin-top: 30px; border-top: 1px solid var(--line); padding-top: 18px; }
.key p { font: 600 11.5px/1 var(--sans); letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint); margin: 0 0 12px; }
.key ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; font-size: 13.5px; color: var(--ink-soft); }
.key li { padding-left: 14px; border-left: 3px solid var(--line); line-height: 1.35; }
.key li.k-verbatim { border-left-color: var(--ink-faint); }
.key li.k-derived { border-left-color: var(--accent); }
.key li.k-open { border-left-color: var(--warn); }
.key li.k-cannot { border-left-color: var(--safety); }
/* ---- the page ---- */
main { padding: 40px 24px 120px; min-width: 0; }
@media (min-width: 1000px) { main { padding: 56px 0 140px; } }
h1 { font: 700 clamp(30px, 4.6vw, 46px)/1.08 var(--serif); letter-spacing: -0.022em; margin: 0 0 18px; text-wrap: balance; }
.intro { font-size: 18px; line-height: 1.6; color: var(--ink-soft); max-width: 62ch; margin: 0 0 14px; }
.intro strong { color: var(--ink); font-weight: 620; }
.count { font: 700 15px/1 var(--sans); color: var(--accent); letter-spacing: .02em; margin: 26px 0 0; }
section { margin-top: 76px; scroll-margin-top: 20px; }
.eyebrow { font: 700 11.5px/1 var(--sans); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-faint); margin: 0 0 10px; }
h2 { font: 700 clamp(24px, 3.2vw, 33px)/1.15 var(--serif); letter-spacing: -0.018em; margin: 0 0 12px; text-wrap: balance; }
.lede { font-size: 16.5px; color: var(--ink-soft); max-width: 66ch; margin: 0 0 26px; line-height: 1.6; }
h3 {
  font: 650 18px/1.3 var(--sans); letter-spacing: -0.012em;
  margin: 40px 0 12px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
}
h3 .n { font-size: 12.5px; font-weight: 700; color: var(--ink-soft); background: var(--line-soft); border-radius: 999px; padding: 3px 9px; }
h4 { font: 620 14.5px/1 var(--sans); letter-spacing: .05em; text-transform: uppercase; color: var(--ink-faint); margin: 26px 0 8px; }
.blockif { font-size: 14.5px; color: var(--ink-soft); margin: 0 0 12px; max-width: 76ch; line-height: 1.5; }
/* ---- the numbers that lead each library ---- */
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 8px; padding: 0; }
.stats > div {
  flex: 1 1 150px; background: var(--card); border: 1px solid var(--line);
  border-radius: 11px; padding: 14px 16px;
}
.stats dt { font: 700 25px/1.05 var(--sans); letter-spacing: -0.02em; }
.stats dd { margin: 5px 0 0; font-size: 13px; color: var(--ink-soft); line-height: 1.35; }
.stats .s-warn dt { color: var(--warn); }
.stats .s-warn { background: var(--warn-soft); border-color: var(--warn); }
.stats .s-stop dt { color: var(--safety); }
.stats .s-stop { background: var(--safety-soft); border-color: var(--safety); }
/* ---- tables ---- */
.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 11px; background: var(--card); }
table { border-collapse: collapse; width: 100%; font-size: 14.5px; }
th {
  text-align: left; font: 700 11.5px/1 var(--sans); letter-spacing: .085em;
  text-transform: uppercase; color: var(--ink-faint);
  padding: 12px 14px; border-bottom: 1px solid var(--line); white-space: nowrap;
}
td { padding: 11px 14px; border-bottom: 1px solid var(--line-soft); vertical-align: top; line-height: 1.45; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr { border-left: 3px solid transparent; }
tbody tr.p-verbatim { border-left-color: var(--ink-faint); }
tbody tr.p-derived { border-left-color: var(--accent); }
tbody tr.p-open { border-left-color: var(--warn); }
tbody tr.p-cannot { border-left-color: var(--safety); }
tbody tr:hover { background: var(--line-soft); }
td.is-open { color: var(--warn); }
td.is-cannot { color: var(--safety); }
td.is-derived { color: var(--accent); }
.mono { font-family: var(--mono); font-size: 12.5px; color: var(--ink-soft); white-space: nowrap; }
.tag {
  display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; background: var(--warn-soft); color: var(--warn);
  border-radius: 4px; padding: 2px 5px; margin-left: 5px; white-space: nowrap;
}
footer { margin-top: 90px; border-top: 1px solid var(--line); padding-top: 22px; font-size: 14px; color: var(--ink-faint); max-width: 66ch; line-height: 1.6; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>

<div class="wrap">
<nav>
  <div class="mark">KuBi</div>
  <div class="mark-sub">The six libraries, generated from the code that holds them.</div>
  <ol>
    ${nav.map(([id, label, n]) => `<li><a href="#${id}">${esc(label)} <b>${n}</b></a></li>`).join('\n    ')}
  </ol>
  <div class="key">
    <p>The stripe on each row</p>
    <ul>
      <li class="k-verbatim">Your words, stored unedited</li>
      <li class="k-derived">Read out of your words — a verb, a heading</li>
      <li class="k-open">Nobody has decided. Stored as blank, never guessed</li>
      <li class="k-cannot">KuBi cannot do this today, and says what it needs</li>
    </ul>
  </div>
</nav>

<main>
<h1>What KuBi is holding, and where it came from</h1>
<p class="intro">
  Six libraries, <strong>${total} rows</strong>, generated from the TypeScript that holds them
  rather than typed out here — so what you are reading is what the system is actually
  running on. Every row carries a stripe saying whose decision it was.
</p>
<p class="intro">
  The one rule throughout: <strong>nothing is invented.</strong> Where you gave a role, a KPI or
  a priority, it is stored verbatim. Where you did not, it is stored as blank and shown as blank.
  A plausible guess would look complete, survive review, and name the wrong person the first time
  something went wrong in a real clinic.
</p>
<p class="count">288 unit tests hold these numbers in place. Changing one is a visible event.</p>

${one}
${two}
${three}
${four}
${five}
${six}

<footer>
  Generated by <span class="mono">scripts/render-libraries.mjs</span> from
  <span class="mono">packages/contracts/src/</span>. Every count on this page is computed at
  build time, not written down — so it cannot drift from the code. Synthetic and
  specification data only; no patient record appears here.
</footer>
</main>
</div>`;

writeFileSync(out, html);
console.log(`${out} — ${Math.round(html.length / 1024)} kB, ${total} rows`);
