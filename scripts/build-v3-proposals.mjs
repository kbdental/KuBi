/**
 * Constructs the two missing parameters as PROPOSALS for Matrix v3.0.
 *
 * Matrix v2.0 is frozen (CLAUDE.md), so nothing here edits it. These are
 * candidate rows for the next version, in the same 23-column shape, generated
 * from source material rather than invented: parameter 3 has fourteen
 * housekeeping activities in the earlier workbook's sheet C that never made it
 * into v2.0, and parameter 6 has four sub-processes in the master matrix's own
 * summary sheet.
 *
 * Two rules govern what this may fill in, both from the working agreement:
 *
 *   - Derive only what the frozen matrix's own patterns support, and record
 *     that it was derived.
 *   - Where a field genuinely cannot be derived, write DECISION_REQUIRED and
 *     leave it for the owner. A register row that quietly resolves an open
 *     decision carries no value -- worse, it launders a guess into a
 *     requirement, which is how the last several rounds of this went wrong.
 *
 * The commonest DECISION_REQUIRED here is the due rule for anything sheet C
 * calls "Scheduled": it says a round happens, never how many or when.
 */
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const OUT = 'docs/requirements/matrix-v3-proposals.tsv';

// Extract sheet C and the parameter-6 block via python (openpyxl is there).
const raw = execSync(`python3 - <<'PY'
import openpyxl, json
w=openpyxl.load_workbook('docs/requirements/operations-app.xlsx')
hk=[]
for r in w['Sheet4'].iter_rows(values_only=True):
    if r[0] and str(r[0]).startswith('HK-'):
        hk.append([('' if c is None else str(c).strip()) for c in r[:9]])
print(json.dumps(hk))
PY`, { encoding: 'utf8' });
const hk = JSON.parse(raw.trim());

const HEAD = ['Activity ID','Parameter','Process','Sub-Process','Activity','Standard / Expected Result',
  'Trigger','Frequency','Due Rule','Doer','Checker','Accountable Owner','Priority','Evidence Type',
  'Evidence Required','Dependency / Gate','Automation Rule','Failure Definition','Escalation L1',
  'Escalation L2','Escalation L3','KPI','CAPA Requirement','Provenance'];

const DECIDE = 'DECISION_REQUIRED';

/** Sheet C's single-letter risk codes, per its own legend. */
const PRIORITY = { R: 'ROUTINE', I: 'IMPORTANT', C: 'CRITICAL', PS: 'PATIENT_SAFETY' };

/**
 * CAPA requirement by risk. Not invented — this is the correlation v2.0 itself
 * holds across all 101 rows, applied unchanged so the new rows behave like
 * their neighbours rather than introducing a second convention.
 */
const CAPA_BY_PRIORITY = {
  PATIENT_SAFETY: 'REQUIRED_ON_CRITICAL',
  CRITICAL: 'REQUIRED_ON_REPEAT',
  IMPORTANT: 'REQUIRED_ON_REPEAT',
  ROUTINE: 'NONE',
};

/** Sheet C's evidence words mapped onto the frozen EvidenceType enum. */
const EVIDENCE = {
  'Checklist': 'CONFIRMATION',
  'Completion': 'CONFIRMATION',
  'Qty/status': 'VALUE',
  'Status': 'CONFIRMATION',
};

/**
 * Frequency/trigger phrasing → the TriggerType enum plus a due rule.
 *
 * "Scheduled" is the honest problem: sheet C says a round happens and never
 * says when or how many. Inventing "three times daily" would look like a
 * requirement inside a week. It stays DECISION_REQUIRED.
 */
function timing(phrase) {
  const p = phrase.toLowerCase();
  if (p.includes('opening') && p.includes('turnover')) {
    return { trigger: 'EVENT', frequency: 'PER_PATIENT', due: 'Opening, then each patient turnover' };
  }
  if (p.includes('opening')) return { trigger: 'TIME', frequency: 'DAILY', due: 'Opening' };
  if (p.includes('closing') || p.includes('after use')) {
    return { trigger: 'TIME', frequency: 'DAILY', due: 'Closing' };
  }
  if (p === 'daily') return { trigger: 'TIME', frequency: 'DAILY', due: DECIDE };
  if (p.includes('schedule')) return { trigger: 'TIME', frequency: DECIDE, due: DECIDE };
  return { trigger: DECIDE, frequency: DECIDE, due: DECIDE };
}

/**
 * The four sub-processes parameter 3 already has in the master matrix's own
 * summary sheet, each with its own KPI. Sheet C lists activities without
 * saying which sub-process they serve, but the mapping is legible from what
 * each activity cleans -- so it is derived rather than deferred.
 *
 * Two activities have no home in that taxonomy: reception is not a clinical
 * area, and plants are not an area at all. Rather than stretch a sub-process
 * to swallow them, both stay open. A taxonomy quietly widened to fit its
 * awkward cases stops being a taxonomy.
 */
const SUB_PROCESS = {
  'HK-001': 'Clinical areas', 'HK-002': 'Clinical areas', 'HK-003': 'Clinical areas',
  'HK-004': 'Clinical areas', 'HK-005': 'Clinical areas',
  'HK-006': 'High-touch areas', 'HK-007': 'High-touch areas',
  'HK-008': 'Washrooms', 'HK-009': 'Washrooms', 'HK-010': 'Washrooms', 'HK-011': 'Washrooms',
  'HK-012': 'Staff areas',
  // HK-013 (reception) and HK-014 (plants) deliberately absent.
};

/** Each sub-process carries its own KPI in the summary sheet. */
const SUB_KPI = {
  'Clinical areas': 'Treatment-Room Hygiene %',
  'Washrooms': 'Washroom Compliance %',
  'Staff areas': 'Housekeeping Compliance %',
  'High-touch areas': 'Housekeeping Compliance %',
};

/**
 * Timing the summary sheet states per sub-process, which is more specific than
 * sheet C's blanket "Scheduled" for the same rows. Where both speak, the more
 * specific one wins; where neither gives a count or a clock time, it stays open.
 */
const SUB_TIMING = {
  'Clinical areas': { trigger: 'TIME', frequency: 'DAILY', due: 'Opening, between patients, and closing' },
};

const rows = [];

for (const [id, activity, standard, freq, doer, checker, evidence, pri, failure] of hk) {
  const priority = PRIORITY[pri] ?? DECIDE;
  const sub = SUB_PROCESS[id] ?? DECIDE;
  // Sub-process timing is more specific than sheet C's phrasing for the same
  // row, so it takes precedence where it exists.
  const t = SUB_TIMING[sub] ?? timing(freq);
  rows.push([
    id, 'Cleanliness & Housekeeping', 'Housekeeping',
    sub,
    activity, standard,
    t.trigger, t.frequency, t.due,
    doer,
    checker === '—' ? '' : checker,
    'Clinic Manager',                        // v2.0's owner for every non-clinical parameter
    priority,
    EVIDENCE[evidence] ?? DECIDE,
    evidence,
    '',                                      // no gate: housekeeping blocks nothing directly
    failure.toLowerCase().includes('refill') || failure.toLowerCase().includes('ticket')
      ? `Auto-create follow-on task: ${failure}` : '',
    failure,
    doer, 'Clinic Manager', 'Clinic Head',   // v2.0's ladder: doer → manager → head
    SUB_KPI[sub] ?? DECIDE,                  // the summary sheet's per-sub-process KPI
    CAPA_BY_PRIORITY[priority] ?? DECIDE,
    `DERIVED from Operation_App.xlsx sheet C${SUB_TIMING[sub] ? ' + matrix Sheet1 sub-process timing' : ''}`,
  ]);
}

/**
 * Parameter 6, from the master matrix's own summary sheet, which gives four
 * sub-processes with doer, evidence and KPI but no activity IDs.
 *
 * Two of these overlap activities v2.0 already has under other headings
 * (CLN-005 chairside setup, INV-001 consumable check). That overlap is flagged
 * rather than resolved: whether to move those rows or cross-reference them is
 * exactly the kind of call that belongs to whoever owns the matrix.
 */
const RCR = [
  ['RCR-001', 'Consumables', 'Consumables ready for the day',
   'Gloves, gauze, tissues, RVG sleeves and procedure consumables available',
   'TIME', 'DAILY', 'Opening', 'Assistant', '', 'CRITICAL', 'CONFIRMATION', 'Stock check',
   'Room readiness', 'Consumable availability %',
   'OVERLAPS INV-001 in v2.0 — cross-reference or move'],
  ['RCR-002', 'Instruments', 'Procedure instruments available',
   'Procedure-specific instruments present and sterile before the procedure',
   'DEPENDENCY', 'PER_PROCEDURE', 'Before procedure', 'Assistant', 'Senior Assistant',
   'PATIENT_SAFETY', 'VERIFICATION', 'Checklist',
   'Sterile stock + procedure plan', 'Procedure readiness %',
   'OVERLAPS CLN-005 in v2.0 — cross-reference or move'],
  ['RCR-003', 'Equipment', 'Chair and equipment operational',
   'Chair, suction and attached equipment functional before patient seating',
   'TIME', 'DAILY', 'Opening', 'Assistant', '', 'PATIENT_SAFETY', 'CONFIRMATION', 'Functional check',
   'Asset active', 'Chair uptime %',
   'DERIVED from matrix Sheet1 parameter 6; FAIL must mark the chair unavailable for allocation'],
  ['RCR-004', 'Turnaround', 'Reset chair after every patient',
   'Chair reset and surfaces disinfected before the next patient is seated',
   'EVENT', 'PER_PATIENT', 'At patient checkout', 'Assistant', '', 'PATIENT_SAFETY',
   'CONFIRMATION', 'Timestamp',
   'Patient checkout', 'Turnaround time',
   'DERIVED from matrix Sheet1 parameter 6; overlaps HK-002'],
];

for (const [id, sub, activity, standard, trig, freq, due, doer, checker, pri, evT, evR, gate, kpi, prov] of RCR) {
  rows.push([
    id, 'Room & Chair Readiness', 'Room Readiness', sub, activity, standard,
    trig, freq, due, doer, checker, 'Clinic Manager', pri, evT, evR, gate,
    '', `${activity} not confirmed before the dependent step`,
    doer, 'Clinic Manager', 'Clinic Head', kpi,
    CAPA_BY_PRIORITY[pri], prov,
  ]);
}

writeFileSync(OUT, [HEAD, ...rows].map((r) => r.join('\t')).join('\n') + '\n');

const decisions = rows.reduce((n, r) => n + r.filter((c) => c === DECIDE).length, 0);
const withDecisions = rows.filter((r) => r.includes(DECIDE)).length;
console.log(`${OUT} — ${rows.length} proposed activities, ${decisions} open decisions across ${withDecisions} rows`);
