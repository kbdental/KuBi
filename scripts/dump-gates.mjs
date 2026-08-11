/** The mandatory gate list, as JSON, for the workbook builder. */
import { TREATMENTS, mustListFor, GATE_EVIDENCE } from '../packages/contracts/src/index.ts';

const rows = [];
for (const t of TREATMENTS) {
  for (const m of mustListFor(t.code)) {
    rows.push({
      code: t.code, treatment: t.name, category: t.category,
      gateId: m.id, label: m.label, stage: m.stage, owner: m.owner,
      basis: m.spec.basis, evidence: m.spec.evidence,
      attestedBy: m.spec.attestedBy, needs: m.needs,
    });
  }
}

const gates = Object.entries(GATE_EVIDENCE).map(([id, spec]) => ({
  id, basis: spec.basis, evidence: spec.evidence,
  attestedBy: spec.attestedBy,
  label: rows.find((r) => r.gateId === id)?.label ?? id,
  usedBy: rows.filter((r) => r.gateId === id).length,
  stage: rows.find((r) => r.gateId === id)?.stage ?? 'BEFORE',
}));

const treatments = TREATMENTS.map((t) => {
  const list = mustListFor(t.code);
  return {
    code: t.code, name: t.name, category: t.category,
    before: list.filter((m) => m.stage === 'BEFORE').length,
    after: list.filter((m) => m.stage === 'AFTER').length,
    total: list.length,
  };
});

process.stdout.write(JSON.stringify({ treatments, gates, rows }));
