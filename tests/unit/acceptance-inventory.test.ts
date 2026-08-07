/**
 * The inventory has to match the tests, or it is just a nicer-looking claim.
 *
 * The owner asked for a count that cannot drift: *"Create an explicit numbered
 * acceptance-test inventory so that the total number of scenarios and their
 * status is unambiguous. Do not delete or combine a scenario merely to make
 * the percentage look better."*
 *
 * A markdown table alone cannot honour that — somebody deletes a scenario, the
 * table keeps saying ten, and the percentage improves for the wrong reason. So
 * this reads both files and refuses to let them disagree.
 *
 * A previous lesson applies directly here: existence is not correctness. It is
 * not enough that a row names a scenario; the scenario it names has to be the
 * one that is actually in the suite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const inventory = readFileSync(join(root, 'docs/architecture/acceptance-inventory.md'), 'utf8');
const suite = readFileSync(join(root, 'tests/scenarios/clinic-day.test.ts'), 'utf8');

type Row = { n: number; status: string };

/** The numbered rows of the inventory table, in file order. */
const rows: Row[] = [...inventory.matchAll(/^\|\s*(\d+)\s*\|.*?\|\s*\*\*(\w+)\*\*\s*\|/gm)]
  .map((m) => ({ n: Number(m[1]), status: m[2]! }));

/** Every scenario number the suite actually declares, from its describe names. */
const declared = new Set(
  [...suite.matchAll(/(?:describe|it)\(\s*'Scenario (\d+)/g)].map((m) => Number(m[1])),
);

describe('the acceptance inventory is the real count', () => {
  it('lists exactly the ten scenarios the owner set — no more, no fewer', () => {
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('states the denominator in words, so it cannot be read off a percentage', () => {
    expect(inventory).toMatch(/\*\*Ten\.\*\*/);
    expect(inventory).toMatch(/\*\*8 pass · 1 partial · 1 blocked\.\*\*/);
  });

  it('agrees with itself — the tally matches the rows', () => {
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    expect(count('PASS')).toBe(8);
    expect(count('PARTIAL')).toBe(1);
    expect(count('BLOCKED')).toBe(1);
    expect(rows).toHaveLength(10);
  });

  it('has a real test behind every scenario it calls PASS or PARTIAL', () => {
    for (const r of rows) {
      if (r.status === 'BLOCKED') continue;
      expect(declared, `Scenario ${r.n} is claimed ${r.status} but the suite never names it`)
        .toContain(r.n);
    }
  });

  it('does not claim a scenario the owner never set', () => {
    // The eleventh scenario does not exist. It was referred to once in earlier
    // work and back-filling one would be inventing an acceptance criterion.
    expect(rows.some((r) => r.n > 10)).toBe(false);
    expect(declared.has(11)).toBe(false);
  });

  it('keeps the blocked scenario blocked in the suite, not deleted from it', () => {
    // The failure mode this guards against is reaching green by removal.
    expect(suite).toMatch(/Scenario 5 · chair frees while three wait — BLOCKED/);
    expect(suite).toMatch(/D-07/);
  });

  it('names what is still open rather than rounding it away', () => {
    expect(inventory).toMatch(/D-07/);
    expect(inventory).toMatch(/D-08/);
    expect(inventory).toMatch(/v1\.1 correction/);
    // 1 of 13 exception flows. Counted as unbuilt, not omitted.
    expect(inventory).toMatch(/Exception flows — 1 of 13/);
  });

  it('refuses to average a partial into a percentage', () => {
    expect(inventory).toMatch(/Not "80%"/);
  });
});
