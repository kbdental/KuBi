/**
 * The asset register, as JSON, for the workbook builder.
 *
 * Same reason as the treatment dump: the workbook is generated rather than
 * maintained, so a change to a service interval reaches the spreadsheet
 * without anybody retyping a row.
 */
import { ASSETS } from '../packages/contracts/src/index.ts';

const cycles = [];
for (const a of ASSETS) {
  for (const c of a.cycles) {
    cycles.push({
      tag: a.tag, assetName: a.name, category: a.category,
      cycleId: c.id, label: c.label, everyDays: c.everyDays,
      warnAheadDays: c.warnAheadDays, owner: c.owner,
      blocks: c.blocks, because: c.because,
    });
  }
}

const assets = ASSETS.map((a) => ({
  tag: a.tag, name: a.name, category: a.category, location: a.location,
  responsible: a.responsible, criticality: a.criticality,
  make: a.make, model: a.model, serial: a.serial,
  amcVendor: a.amc?.vendor ?? null,
  amcCovers: a.amc?.covers ?? null,
  amcKnownExpiry: a.amc ? a.amc.until !== null : null,
  documents: [...a.documents],
  dailyCheck: a.dailyCheck,
  cycles: a.cycles.length,
  blocking: a.cycles.filter((c) => c.blocks).length,
  hasService: a.cycles.some((c) => c.id === 'SERVICE'),
}));

process.stdout.write(JSON.stringify({ assets, cycles }));
