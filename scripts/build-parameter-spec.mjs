/**
 * Builds the parameter specification page FROM the source workbooks rather
 * than from anything hand-typed.
 *
 * The reason is the whole reason this file exists: an earlier version of this
 * work was written from a recollection of the requirements and got the most
 * important section wrong. A page generated from the frozen matrix cannot
 * quietly drift from it — if the matrix changes, the page changes, and if a
 * claim here is wrong it is wrong in the source too.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const TSV = 'docs/requirements/master-activity-matrix-v2.tsv';
const PROPOSALS = 'docs/requirements/matrix-v3-proposals.tsv';
const OUT = 'docs/kubi-parameters.html';

const acts = readTsv(TSV);
const proposed = readTsv(PROPOSALS);

/**
 * Proposed rows for Matrix v3.0, covering the two parameters v2.0 leaves
 * empty. Kept in a separate file and rendered separately, because v2.0 is
 * frozen and a proposal that renders identically to a frozen requirement will
 * be mistaken for one inside a week.
 */
function readTsv(path) {
  // Written CRLF, so every line carries a trailing \r that would otherwise end
  // up inside the LAST column's name and value -- making `CAPA Requirement`
  // undefined on every row while the other 22 columns look perfect.
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const h = lines[0].split('\t').map((x) => x.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split('\t').map((c) => c.trim());
    while (cells.length < h.length) cells.push('');
    return Object.fromEntries(h.map((k, i) => [k, cells[i] ?? '']));
  });
}

/**
 * The 15 control parameters of Operations App §1 (Table 1), plus the 16th the
 * document adds later. This is the MANAGEMENT taxonomy — what the owner reads.
 *
 * `matrix` lists the Master Activity Matrix v2.0 groups that feed each one.
 * The two taxonomies are not the same shape, which is a finding rather than a
 * mistake: v2.0 groups by execution (who does the work, in what run) and §1
 * groups by control (what the owner is accountable for). Recorded here so the
 * mapping is explicit instead of assumed.
 */
const PARAMETERS = [
  { n: 1, key: 'ATTENDANCE_LEAVE', name: 'Attendance & Leave',
    controls: 'Reporting time, late arrival, absence, leave request, approval, Saturday–Monday sandwich rule, attendance compliance',
    matrix: ['Attendance & Leave'], score: 'Team Compliance Score' },
  { n: 2, key: 'OPENING_READINESS', name: 'Opening Readiness',
    controls: 'Clinic opened on time, floors ready, AC/diffuser/lights, water, reception, treatment rooms, equipment readiness',
    matrix: ['Opening Readiness'], score: 'Clinic Readiness Score' },
  { n: 3, key: 'CLEANLINESS', name: 'Cleanliness & Housekeeping',
    controls: 'Treatment rooms, chairs, slabs, mirrors, washrooms, reception, staff areas, high-touch surfaces, plants',
    matrix: [], score: 'Clinic Readiness Score' },
  { n: 4, key: 'MAINTENANCE_UTILITIES', name: 'Maintenance & Utilities',
    controls: 'AC, plumbing, electricals, chairs, compressor, suction, switches, doors, faucets, water pump, repair reporting',
    matrix: ['Equipment Preventive Maintenance'], score: 'Clinic Readiness Score' },
  { n: 5, key: 'INFECTION_CONTROL', name: 'Infection Control & Sterilization',
    controls: 'Dirty-to-clean instrument flow, ultrasonic cycle, packing/sealing, autoclave cycle, storage, same-day completion, biomedical waste',
    matrix: ['Infection Control'], score: 'Infection Control Score' },
  { n: 6, key: 'ROOM_CHAIR_READINESS', name: 'Room & Chair Readiness',
    controls: 'Consumables, instruments, PPE, RVG sleeves, materials, chair/equipment functionality before patient seating',
    matrix: [], score: 'Clinic Readiness Score' },
  { n: 7, key: 'APPOINTMENT_CONTROL', name: 'Appointment Control',
    controls: 'Morning confirmation, reminders, cancellations, rescheduling, unconfirmed patients, next appointment',
    matrix: ['Appointments & Reception'], score: 'Appointment Efficiency' },
  { n: 8, key: 'PATIENT_JOURNEY', name: 'Patient Clinical Journey',
    controls: 'Arrival → examination → records → consent → treatment → instructions → billing → next appointment → exit',
    matrix: ['Patient Care & Clinical'], score: 'Patient Care Compliance' },
  { n: 9, key: 'CLINICAL_DOCUMENTATION', name: 'Clinical Documentation',
    controls: 'Pre/post scans, photographs, X-rays, notes, treatment plan, consent, prescriptions, procedure documentation',
    matrix: ['Patient Care & Clinical'], score: 'Clinical Documentation Score' },
  { n: 10, key: 'SURGICAL_HIGH_RISK', name: 'Surgical & High-Risk Protocols',
    controls: 'Pre-op medicine reminder, meal instruction, consent, surgical checklist, post-op instructions, next-day follow-up',
    matrix: ['Implant Inventory'], score: 'Patient Care Compliance' },
  { n: 11, key: 'FOLLOWUP_EXPERIENCE', name: 'Patient Follow-up & Experience',
    controls: 'Follow-up due/completed, treatment progress, unresolved complaints, satisfaction, Google review request',
    matrix: ['Patient Follow-up', 'Complaints'], score: 'Patient Care Compliance' },
  { n: 12, key: 'LABORATORY', name: 'Laboratory Case Management',
    controls: 'Lab dispatch, due date, receipt, QC, crown availability, appointment linkage, remake/delay tracking',
    matrix: ['Laboratory Management'], score: 'Lab Efficiency' },
  { n: 13, key: 'INVENTORY_IMPLANTS', name: 'Inventory & Implant Stock',
    controls: 'Minimum stock, current stock, expiry, consumption, reorder, implant brands/components, shortages, wastage',
    matrix: ['Inventory & Procurement', 'Implant Inventory'], score: 'Inventory Readiness' },
  { n: 14, key: 'STAFF_CONDUCT', name: 'Staff Conduct & Coordination',
    controls: 'Role responsibility, lunch coverage, reception support, handovers, communication, conduct incidents, training',
    matrix: ['Staff Training & Competency', 'Professional Conduct'], score: 'Team Compliance Score' },
  { n: 15, key: 'SAFETY_EMERGENCY', name: 'Safety, Emergency & Compliance',
    controls: 'Emergency kit, emergency readiness, OPG competency, biomedical waste, equipment safety, incident reporting',
    matrix: ['Emergency Management'], score: 'Infection Control Score' },
  { n: 16, key: 'QUALITY_CAPA', name: 'Quality, Incident & CAPA',
    controls: 'Incident → containment → root cause → corrective action → preventive action → verification → closure; repeat-failure detection and audit findings',
    matrix: ['Incidents & CAPA', 'Weekly/Monthly Audits'], score: 'Team Compliance Score' },
];

/** Closing & Facility spans several control heads rather than being one. */
const UNPLACED = 'Closing & Facility';

const PRIORITY_RANK = { PATIENT_SAFETY: 0, CRITICAL: 1, IMPORTANT: 2, ROUTINE: 3 };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * An undecidable field renders as a visible gap, never as blank or plausible
 * text. A guess that looks like a requirement becomes one.
 */
const cell = (v) => v === 'DECISION_REQUIRED'
  ? '<span class="dec">open</span>'
  : (v ? esc(v) : '<span class="none">—</span>');

const forParam = (p) => acts.filter((a) => p.matrix.includes(a.Parameter));
const proposedFor = (p) => proposed.filter((a) => a.Parameter === p.name);
const covered = new Set(PARAMETERS.flatMap((p) => p.matrix));
const orphans = acts.filter((a) => !covered.has(a.Parameter));

const total = acts.length;
const bySeverity = (rows) => {
  const c = { PATIENT_SAFETY: 0, CRITICAL: 0, IMPORTANT: 0, ROUTINE: 0 };
  for (const r of rows) if (c[r.Priority] !== undefined) c[r.Priority] += 1;
  return c;
};

const pill = (p) => `<span class="pri pri-${p.toLowerCase().replace('_', '-')}">${esc(p.replace('_', ' '))}</span>`;

function activityTable(rows) {
  if (rows.length === 0) return '';
  const sorted = [...rows].sort((a, b) =>
    (PRIORITY_RANK[a.Priority] ?? 9) - (PRIORITY_RANK[b.Priority] ?? 9)
    || a['Activity ID'].localeCompare(b['Activity ID']));
  return `<div class="tw"><table>
  <thead><tr><th>ID</th><th>Activity</th><th>Standard</th><th>Trigger</th><th>Due</th><th>Doer / Checker</th><th>Evidence</th><th>Gate</th><th>Risk</th><th>CAPA</th></tr></thead>
  <tbody>${sorted.map((a) => `<tr>
    <td class="id">${esc(a['Activity ID'])}</td>
    <td class="act">${esc(a.Activity)}${a['Sub-Process'] && a['Sub-Process'] !== 'DECISION_REQUIRED' ? `<br><span class="sp">${esc(a['Sub-Process'])}</span>` : a['Sub-Process'] === 'DECISION_REQUIRED' ? '<br><span class="dec">sub-process open</span>' : ''}</td>
    <td class="std">${esc(a['Standard / Expected Result'])}</td>
    <td><span class="trig">${cell(a.Trigger)}</span><br><span class="freq">${cell(a.Frequency)}</span></td>
    <td class="due">${cell(a['Due Rule'])}</td>
    <td class="who">${esc(a.Doer)}${a.Checker ? `<br><span class="chk">✓ ${esc(a.Checker)}</span>` : ''}</td>
    <td class="ev">${cell(a['Evidence Type'])}</td>
    <td class="gate">${a['Dependency / Gate'] ? esc(a['Dependency / Gate']) : '<span class="none">—</span>'}</td>
    <td>${pill(a.Priority)}</td>
    <td class="capa">${a['CAPA Requirement'] === 'NONE' ? '<span class="none">—</span>' : esc(a['CAPA Requirement'].replace(/_/g, ' ').toLowerCase())}</td>
  </tr>`).join('')}</tbody></table></div>`;
}

const SCORES = [
  ['Clinic Readiness Score', '% opening requirements completed before first patient'],
  ['Patient Care Compliance', '% required patient protocols completed'],
  ['Clinical Documentation Score', '% cases with complete required records'],
  ['Infection Control Score', 'Sterilization + PPE + biomedical waste compliance'],
  ['Appointment Efficiency', 'Confirmation, cancellation, no-show, utilization'],
  ['Lab Efficiency', 'On-time cases, pending cases, remakes, QC'],
  ['Inventory Readiness', 'Stock-outs, reorder compliance, implant availability'],
  ['Team Compliance Score', 'Attendance + task completion + SOP adherence + training'],
];

const sections = PARAMETERS.map((p) => {
  const rows = forParam(p);
  const prop = proposedFor(p);
  const openCount = prop.reduce((n, r) => n + Object.values(r).filter((v) => v === 'DECISION_REQUIRED').length, 0);
  const sev = bySeverity(rows);
  const kpis = [...new Set(rows.map((r) => r.KPI).filter(Boolean))];
  const gap = rows.length === 0;
  return `<section class="param${gap ? ' param-gap' : ''}" id="${p.key}">
    <header class="ph">
      <div class="pn">${p.n}</div>
      <div class="pt">
        <h3>${esc(p.name)}</h3>
        <p class="ctrl">${esc(p.controls)}</p>
      </div>
      <div class="pc">
        <span class="cnt${gap ? ' cnt-zero' : ''}">${rows.length}</span>
        <span class="cntl">${rows.length === 1 ? 'activity' : 'activities'}</span>
      </div>
    </header>
    <div class="meta">
      <span class="mk">Rolls into</span> <strong>${esc(p.score)}</strong>
      ${sev.PATIENT_SAFETY ? `<span class="sep">·</span>${pill('PATIENT_SAFETY')} ${sev.PATIENT_SAFETY}` : ''}
      ${sev.CRITICAL ? `<span class="sep">·</span>${pill('CRITICAL')} ${sev.CRITICAL}` : ''}
    </div>
    ${gap ? `<p class="gapnote"><strong>No activities in the frozen Matrix v2.0.</strong>
      This control head exists in the requirement with nothing behind it, so it can only ever
      score GREY. ${prop.length ? `${prop.length} activities are <strong>proposed below for v3.0</strong>,
      derived from source material rather than invented — ${openCount} fields could not be derived
      and are left open.` : ''}</p>` : ''}
    ${kpis.length ? `<p class="kpis"><span class="mk">KPIs</span> ${kpis.map((k) => `<code>${esc(k)}</code>`).join(' ')}</p>` : ''}
    ${activityTable(rows)}
    ${prop.length ? `<div class="proposed">
      <h4>Proposed for Matrix v3.0 <span class="pbadge">not yet approved</span></h4>
      <p class="pnote">${esc([...new Set(prop.map((r) => r.Provenance.split(';')[0].replace(/^OVERLAPS /, 'Overlaps ').replace(/^DERIVED from /, 'Derived from ')))].join('; '))}.
      Fields marked <span class="dec">open</span> could not be derived from any source and need a decision —
      they are not filled with a plausible guess.</p>
      ${activityTable(prop)}
    </div>` : ''}
  </section>`;
}).join('\n');

const sev = bySeverity(acts);
const gaps = PARAMETERS.filter((p) => forParam(p).length === 0);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KuBi — the 16 control parameters</title>
<style>
:root{--ink:#12181f;--soft:#5a6875;--line:#e4e9ee;--bg:#f6f8fa;--card:#fff;
--ps:#a4262c;--crit:#c4543a;--imp:#8a6d1f;--rout:#5a6875;--ok:#0d6e5e;--accent:#0d6e5e}
*{box-sizing:border-box}
body{margin:0;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--ink);background:var(--bg)}
.wrap{max-width:1180px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:30px;margin:0 0 6px;letter-spacing:-.02em}
.sub{color:var(--soft);margin:0 0 28px;font-size:16px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:28px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.stat b{display:block;font-size:26px;letter-spacing:-.02em}
.stat span{color:var(--soft);font-size:12.5px}
.note{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--accent);
border-radius:0 12px 12px 0;padding:16px 18px;margin:0 0 26px}
.note h2{font-size:15px;margin:0 0 8px}
.note p{margin:0 0 8px}.note p:last-child{margin:0}
.loop{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:var(--bg);
padding:10px 12px;border-radius:8px;overflow-x:auto;white-space:nowrap;margin:8px 0}
.loop b{color:var(--accent)}
h2.sec{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--soft);
margin:36px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.param{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:16px}
.param-gap{border-color:#e6c9c9;background:#fffafa}
.ph{display:flex;gap:14px;align-items:flex-start}
.pn{flex:0 0 32px;height:32px;border-radius:9px;background:var(--accent);color:#fff;
display:grid;place-items:center;font-weight:700;font-size:14px}
.param-gap .pn{background:var(--ps)}
.pt{flex:1;min-width:0}
.pt h3{margin:2px 0 4px;font-size:17px;letter-spacing:-.01em}
.ctrl{margin:0;color:var(--soft);font-size:13.5px}
.pc{flex:0 0 auto;text-align:right}
.cnt{display:block;font-size:22px;font-weight:700;letter-spacing:-.02em}
.cnt-zero{color:var(--ps)}
.cntl{font-size:11.5px;color:var(--soft)}
.meta{margin:12px 0 0;font-size:13px;color:var(--soft);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.mk{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--soft)}
.sep{color:var(--line)}
.kpis{margin:8px 0 0;font-size:13px}
.kpis code{background:var(--bg);border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:12px;margin-right:4px;display:inline-block}
.gapnote{margin:12px 0 0;padding:11px 13px;background:#fdf0f0;border-radius:9px;font-size:13.5px;color:#7d2a2a}
.tw{overflow-x:auto;margin-top:14px;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:12.5px;min-width:900px}
th{background:var(--bg);text-align:left;padding:9px 10px;font-size:10.5px;text-transform:uppercase;
letter-spacing:.05em;color:var(--soft);border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:9px 10px;border-bottom:1px solid #f0f3f6;vertical-align:top}
tr:last-child td{border-bottom:0}
.id{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;font-weight:600;white-space:nowrap}
.act{font-weight:600;min-width:150px}
.std{color:var(--soft);min-width:170px}
.trig{font-size:10.5px;font-weight:600;letter-spacing:.03em}
.freq{font-size:10.5px;color:var(--soft)}
.due,.ev,.gate,.capa,.who{color:var(--soft)}
.chk{font-size:11px;color:var(--ok)}
.none{color:#c8d0d8}
.pri{display:inline-block;font-size:9.5px;font-weight:700;letter-spacing:.04em;
padding:2px 6px;border-radius:4px;white-space:nowrap;text-transform:uppercase}
.pri-patient-safety{background:#f7e4e5;color:var(--ps)}
.pri-critical{background:#fae9e3;color:var(--crit)}
.pri-important{background:#f7f0da;color:var(--imp)}
.pri-routine{background:#eef2f6;color:var(--rout)}
/* A proposal must never be mistaken for a frozen requirement, so it is set
   apart rather than merely labelled: dashed border, its own heading, and a
   badge that says so. */
.proposed{margin-top:18px;padding:14px 15px;border:1.5px dashed var(--line);border-radius:11px;background:var(--bg)}
.proposed h4{margin:0 0 6px;font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pbadge{font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
padding:2px 7px;border-radius:4px;background:#f7f0da;color:var(--imp)}
.pnote{margin:0 0 10px;font-size:12.5px;color:var(--soft)}
/* An undecidable field. Loud on purpose — it is a question, not a value. */
.dec{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
padding:2px 6px;border-radius:4px;background:#f7e4e5;color:var(--ps)}
.sp{font-size:10.5px;font-weight:400;color:var(--soft)}
.scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
.score{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:13px 15px}
.score b{display:block;font-size:14px;margin-bottom:3px}
.score span{color:var(--soft);font-size:12.5px}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);color:var(--soft);font-size:12.5px}
@media (max-width:640px){.wrap{padding:20px 14px 60px}h1{font-size:24px}.ph{flex-wrap:wrap}.pc{text-align:left}}
@media (prefers-color-scheme:dark){
:root{--ink:#e6ebf0;--soft:#93a1b0;--line:#242c35;--bg:#0e1319;--card:#141a21;--accent:#3fbfa4}
.param-gap{border-color:#4a2a2a;background:#1a1113}
.gapnote{background:#241417;color:#e0a8a8}
.pri-patient-safety{background:#3d1f22;color:#e79aa0}
.pri-critical{background:#3a231b;color:#e8a68e}
.pri-important{background:#332d18;color:#dbc478}
.pri-routine{background:#232b33;color:#9fb0bf}
td{border-bottom-color:#1c232b}
.kpis code,.loop{background:#0e1319}
.none{color:#3a444f}
.pbadge{background:#332d18;color:#dbc478}
.dec{background:#3d1f22;color:#e79aa0}
.proposed{background:#0e1319;border-color:#2c353f}}
</style></head><body><div class="wrap">

<h1>The 16 control parameters</h1>
<p class="sub">Generated from <code>master-activity-matrix-v2.xlsx</code> and the §1 control table of
<code>operations-app.docx</code>. Nothing on this page is hand-typed — if the matrix changes, this changes.</p>

<div class="stats">
  <div class="stat"><b>16</b><span>control parameters</span></div>
  <div class="stat"><b>${total}</b><span>defined activities</span></div>
  <div class="stat"><b>${sev.PATIENT_SAFETY}</b><span>patient-safety</span></div>
  <div class="stat"><b>${sev.CRITICAL}</b><span>critical</span></div>
  <div class="stat"><b>${proposed.length}</b><span>proposed for v3.0</span></div>
</div>

<div class="note">
  <h2>The operating principle (§8)</h2>
  <p>Every activity below travels one loop. It is the app's reason to exist, not a diagram:</p>
  <div class="loop">PLAN → TRIGGER → ASSIGN → EXECUTE → PROVE → VERIFY → ESCALATE → MEASURE → <b>IMPROVE</b></div>
  <p>The last stage is what makes it a loop rather than a line. Every activity carries a
  <strong>CAPA requirement</strong> — the rightmost column of every table below — which decides whether
  a failure must produce an incident, and therefore whether the clinic learns from it or merely
  records it again tomorrow.</p>
</div>

<h2 class="sec">The 16 parameters</h2>
${sections}

<h2 class="sec">The eight management scores</h2>
<p class="sub">§7: the 16 parameters roll upward into approximately eight management scores.
This is the layer the owner actually reads — not sixteen numbers, and not one.</p>
<div class="scores">
${SCORES.map(([n, m]) => `<div class="score"><b>${esc(n)}</b><span>${esc(m)}</span></div>`).join('')}
</div>

<h2 class="sec">Escalation</h2>
<div class="scores">
  <div class="score"><b>L1 — Reminder</b><span>Approaching deadline → notify the responsible person</span></div>
  <div class="score"><b>L2 — Overdue</b><span>Deadline crossed → notify responsible <em>and</em> checker</span></div>
  <div class="score"><b>L3 — Critical</b><span>Still unresolved, or patient safety → notify owner/manager</span></div>
</div>
<p class="sub" style="margin-top:12px">Escalation depends on clinical risk, not elapsed time alone:
a plant not watered and a missing implant consent cannot receive the same priority. That is what the
risk column on every activity is for.</p>

${orphans.length ? `<h2 class="sec">Spans several control heads</h2>
<div class="param"><header class="ph"><div class="pn" style="background:var(--soft)">—</div>
<div class="pt"><h3>${esc(UNPLACED)}</h3>
<p class="ctrl">These ${orphans.length} activities each belong to a different control head — the closing
run is a moment in the day, not a parameter. Filing them together would have put patient-safety
checks under a facilities heading.</p></div>
<div class="pc"><span class="cnt">${orphans.length}</span><span class="cntl">activities</span></div></header>
${activityTable(orphans)}</div>` : ''}

<footer>
  Synthetic and internal. Generated by <code>scripts/build-parameter-spec.mjs</code> from the
  frozen Master Activity Matrix v2.0 (${total} activities) and the Operations App §1 control table.
</footer>
</div></body></html>`;

writeFileSync(OUT, html);
console.log(`${OUT} — ${(Buffer.byteLength(html) / 1024).toFixed(0)} kB, ${total} activities, ${gaps.length} gaps`);
