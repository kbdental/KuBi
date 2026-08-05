/**
 * Read the owner's edited operating standard back into KuBi.
 *
 * The other half of docs/kubi-operating-standard.xlsx. The owner edits the
 * standard in Google Sheets — the tool they already have, on a phone, without
 * me — downloads it, and this puts their wording back into the libraries.
 *
 *   node scripts/import-standard.mjs ~/Downloads/kubi-operating-standard.xlsx
 *   node scripts/import-standard.mjs --check   (report only, change nothing)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this does and does not touch
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It rewrites the *standard* — what should happen, who owns it, what good
 * looks like. It never touches the *record* — what actually happened, which
 * lives in PostgreSQL and is append-only. A spreadsheet is the right home for
 * the first and a dangerous home for the second: two people ticking the same
 * task at once in a sheet silently overwrite one another, and the loser never
 * finds out.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Three rules, because an importer is where a library quietly rots
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. **A blank cell means "not decided", and stays blank.** It never becomes
 *    an empty string, a dash, or a plausible guess. The whole value of these
 *    libraries is that 322 rows honestly say nobody owns them.
 * 2. **An unknown role is refused, not coerced.** If the sheet says
 *    "implantologist" and KuBi has no such role, the import stops and says
 *    so. Silently mapping it to the nearest existing role would name the
 *    wrong person at a critical moment.
 * 3. **Every change is printed before anything is written.** An import that
 *    reports "47 rows updated" tells you nothing; this says which rows, and
 *    from what to what.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  RoleCode, DAILY_STANDARD, PATIENT_JOURNEY, CONDITION_LIBRARY, EXCEPTION_LIBRARY,
} from '@kubi/contracts';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const file = args.find((a) => !a.startsWith('--'));

if (!file) {
  console.error('Give me the edited file:\n'
    + '  node scripts/import-standard.mjs <file.xlsx>\n'
    + '  node scripts/import-standard.mjs <file.xlsx> --check');
  process.exit(1);
}

/**
 * Read a sheet as rows of objects, keyed by its header row.
 *
 * Uses Python because the repository already depends on openpyxl for building
 * the file, and a second XLSX parser in a different language is exactly the
 * kind of duplication these libraries exist to prevent.
 */
function readSheet(path, sheetName) {
  const py = `
import json, sys
from openpyxl import load_workbook
wb = load_workbook(${JSON.stringify(path)}, data_only=True, read_only=True)
if ${JSON.stringify(sheetName)} not in wb.sheetnames:
    print(json.dumps({"missing": True})); sys.exit(0)
ws = wb[${JSON.stringify(sheetName)}]
rows = list(ws.iter_rows(values_only=True))
if not rows:
    print(json.dumps({"rows": []})); sys.exit(0)
head = [str(h).strip() if h is not None else "" for h in rows[0]]
out = []
for r in rows[1:]:
    if all(c is None or str(c).strip() == "" for c in r): continue
    out.append({head[i]: (str(c).strip() if c is not None else "") for i, c in enumerate(r) if i < len(head)})
print(json.dumps({"rows": out}))
`;
  const raw = execFileSync('python3', ['-c', py], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(raw);
}

/** "dental assistant" → DENTAL_ASSISTANT, or null. Never a near miss. */
const ROLES = new Map(
  Object.values(RoleCode).map((r) => [r.replace(/_/g, ' ').toLowerCase(), r]),
);
function roleOf(text, where, problems) {
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return null;                       // not decided — and it stays that way
  const found = ROLES.get(t);
  if (!found) {
    problems.push(`${where}: "${text}" is not one of KuBi's roles. `
      + 'Either use one of them, or tell me to add this role — I will not guess '
      + 'which existing one you meant.');
    return null;
  }
  return found;
}

/* -------------------------------------------------------------------------
 * The sheets, and which library column each one writes.
 * ---------------------------------------------------------------------- */

const SHEETS = [
  {
    sheet: 'Daily standard',
    rows: DAILY_STANDARD,
    idColumn: 'ID',
    fields: [
      { column: 'Role', kind: 'role', property: 'role' },
      { column: 'Your standard', kind: 'text', property: 'standard' },
    ],
  },
  {
    sheet: 'Patient journey',
    rows: PATIENT_JOURNEY,
    idColumn: 'ID',
    fields: [
      { column: 'Role', kind: 'role', property: 'role' },
      { column: 'Your KPI', kind: 'text', property: 'kpi' },
    ],
  },
  {
    sheet: 'Conditions',
    rows: CONDITION_LIBRARY,
    idColumn: 'ID',
    fields: [
      { column: 'Role', kind: 'role', property: 'role' },
      { column: 'Due', kind: 'text', property: 'due' },
    ],
  },
  {
    sheet: 'Exceptions',
    rows: EXCEPTION_LIBRARY,
    idColumn: 'ID',
    fields: [{ column: 'Escalate to', kind: 'text', property: 'escalateTo' }],
  },
];

const problems = [];
const changes = [];
let readRows = 0;

for (const spec of SHEETS) {
  const result = readSheet(file, spec.sheet);
  if (result.missing) {
    problems.push(`The sheet "${spec.sheet}" is not in this file. `
      + 'Sheet tabs and header rows are what the importer matches on, so they '
      + 'must keep their names.');
    continue;
  }

  // Compared against the library's own values, not against its source text.
  // The first attempt searched the .ts file for the quoted value and reported
  // seventy-seven false changes, because the library writes RoleCode.HOUSEKEEPING
  // rather than the string. A diff tool that cries wolf is worse than none.
  const byId = new Map(spec.rows.map((r) => [r.id, r]));

  for (const row of result.rows) {
    readRows += 1;
    const id = row[spec.idColumn];
    if (!id) continue;              // a new row the owner added; assigning ids is a later job

    for (const field of spec.fields) {
      const raw = row[field.column] ?? '';
      const where = `${spec.sheet} row ${id}, column "${field.column}"`;
      const value = field.kind === 'role' ? roleOf(raw, where, problems) : (raw || null);
      if (value === null) continue;  // blank stays blank — rule 1

      const current = byId.get(id)?.[field.property] ?? null;
      // Compared as written: a change of wording counts even where the meaning
      // is the same, because the owner's exact phrasing is what gets stored.
      if (current !== value) {
        changes.push({ where, property: field.property, from: current, to: value });
      }
    }
  }
}

/* -------------------------------------------------------------------------
 * Report before writing. Rule 3.
 * ---------------------------------------------------------------------- */

console.log(`\nRead ${readRows} rows from ${file}\n`);

if (problems.length > 0) {
  console.log(`${problems.length} thing${problems.length === 1 ? '' : 's'} I will not guess at:\n`);
  for (const p of problems) console.log(`  • ${p}`);
  console.log('\nNothing has been changed. Fix these and run it again.\n');
  process.exit(1);
}

if (changes.length === 0) {
  console.log('Nothing to change — the libraries already say what the sheet says.\n');
  process.exit(0);
}

console.log(`${changes.length} change${changes.length === 1 ? '' : 's'}:\n`);
for (const c of changes.slice(0, 40)) {
  console.log(`  ${c.where}\n      ${c.property}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
}
if (changes.length > 40) console.log(`  … and ${changes.length - 40} more`);

if (checkOnly) {
  console.log('\n--check: nothing written.\n');
  process.exit(0);
}

/**
 * Written as a plan rather than applied directly.
 *
 * The libraries are hand-written TypeScript with the reasoning in comments
 * beside each row, and a regex that rewrote them would eventually destroy a
 * comment explaining why a row is the way it is. So the import produces the
 * exact list of edits and they are applied deliberately. When the libraries
 * move into the database this step disappears — the sheet will write to a
 * table, not to source code.
 */
const plan = 'docs/standard-import-plan.json';
writeFileSync(plan, JSON.stringify({ file, when: new Date().toISOString(), changes }, null, 2));
console.log(`\nWritten to ${plan}. Hand it to me and I will apply them.\n`);
