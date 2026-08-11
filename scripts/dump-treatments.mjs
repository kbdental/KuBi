/**
 * The treatment catalogue, as JSON, for the workbook builder.
 *
 * The workbook is generated rather than maintained: this reads TREATMENTS out
 * of the engine so a change to a protocol reaches the spreadsheet without
 * anybody retyping a row.
 *
 *   node scripts/dump-treatments.mjs > /tmp/treatments.json
 */
import { TREATMENTS } from '../packages/contracts/src/index.ts';

const rows = [];
for (const t of TREATMENTS) {
  for (const i of t.items) {
    rows.push({
      code: t.code, name: t.name, category: t.category,
      minutes: t.minutes, sittings: t.sittings,
      itemId: i.id, label: i.label, owner: i.owner, stage: i.stage,
      offset: i.offsetMinutes, gate: i.gate, because: i.because,
      needs: i.needs ?? '', needsAbsent: i.needsAbsent ?? false,
    });
  }
}

const treatments = TREATMENTS.map((t) => ({
  code: t.code, name: t.name, category: t.category, minutes: t.minutes,
  sittings: t.sittings, items: t.items.length,
  before: t.items.filter((i) => i.stage === 'BEFORE').length,
  after: t.items.filter((i) => i.stage === 'AFTER').length,
  blocking: t.items.filter((i) => i.gate === 'BLOCK').length,
  conditional: t.items.filter((i) => i.needs !== undefined).length,
}));

process.stdout.write(JSON.stringify({ treatments, rows }));
