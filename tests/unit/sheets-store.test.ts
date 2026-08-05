/**
 * Google Sheets as the backend, and what it costs.
 *
 * Two jobs. The first is the ordinary one: prove the adapter reads, appends
 * and updates correctly. The second is the reason this file is worth reading —
 * **demonstrate the trade-offs rather than assert them.** The owner decided to
 * put the clinic on Sheets after being told the risks; the least I can do is
 * make those risks reproducible instead of rhetorical.
 *
 * The fake below is deliberately faithful, including its faults. It loses a
 * write when two arrive together, exactly as Sheets does, because a fake that
 * behaved better than the real thing would let these tests pass and the clinic
 * fail.
 */
import { describe, it, expect } from 'vitest';
import {
  SheetsStore, Quota, SHEETS_QUOTA, estimateLoad,
  QuotaExceededError, ConcurrentWriteError, AppendOnlyError,
  type SheetsTransport, type SheetSpec,
} from '../../apps/api/src/platform/sheets/sheets-store.js';

/** A spreadsheet with Google's semantics: last write wins, no transactions. */
class FakeSheets implements SheetsTransport {
  grids = new Map<string, string[][]>();
  calls = 0;

  constructor(specs: SheetSpec[]) {
    for (const s of specs) this.grids.set(s.name, [[...s.headers]]);
  }

  async batchGet(ranges: string[]): Promise<string[][][]> {
    this.calls += 1;
    return ranges.map((range) => {
      const [name, span] = range.split('!');
      const grid = this.grids.get(name!) ?? [];
      const single = /^A(\d+):/.exec(span ?? '');
      if (single) {
        const row = grid[Number(single[1]) - 1];
        return row ? [row] : [];
      }
      return grid;
    });
  }

  async append(sheet: string, values: string[]): Promise<number> {
    this.calls += 1;
    const grid = this.grids.get(sheet)!;
    grid.push(values);
    return grid.length;
  }

  async update(sheet: string, rowNumber: number, values: string[]): Promise<void> {
    this.calls += 1;
    // No compare-and-set, no locking. Whoever writes last wins, and the loser
    // is never told. This one line is the whole risk.
    this.grids.get(sheet)![rowNumber - 1] = values;
  }
}

const SPECS: SheetSpec[] = [
  { name: 'Tasks', headers: ['id', 'title', 'status', 'completedBy'] },
  { name: 'Audit', headers: ['at', 'action', 'by'], appendOnly: true },
];

function store(now = () => 1_000_000) {
  const fake = new FakeSheets(SPECS);
  return { fake, s: new SheetsStore(fake, new Quota(now), SPECS) };
}

describe('it works as a store', () => {
  it('appends a row and reads it back with its headers', async () => {
    const { s } = store();
    const rowNumber = await s.append('Tasks', { id: 't1', title: 'Open the clinic', status: 'DUE' });
    expect(rowNumber).toBe(2);

    const rows = (await s.read(['Tasks'])).get('Tasks')!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.values).toEqual({
      id: 't1', title: 'Open the clinic', status: 'DUE', completedBy: '',
    });
  });

  it('reads many sheets in one round trip, because latency is per call', async () => {
    const { fake, s } = store();
    await s.append('Tasks', { id: 't1', title: 'Open the clinic', status: 'DUE' });
    const before = fake.calls;
    await s.read(['Tasks', 'Audit']);
    expect(fake.calls - before).toBe(1);
  });

  it('updates a row when nobody else has touched it', async () => {
    const { s } = store();
    await s.append('Tasks', { id: 't1', title: 'Open the clinic', status: 'DUE' });
    await s.updateRow('Tasks', 2, { status: 'DUE' }, { status: 'COMPLETED', completedBy: 'priya' });

    const rows = (await s.read(['Tasks'])).get('Tasks')!;
    expect(rows[0]!.values.status).toBe('COMPLETED');
    expect(rows[0]!.values.completedBy).toBe('priya');
  });
});

describe('what Sheets cannot give you: no transactions', () => {
  it('loses a write when two people finish the same task, with no check', async () => {
    // The failure, reproduced. Priya and Anita both complete the task; the
    // sheet ends up naming one of them and nobody is told the other was lost.
    const { fake } = store();
    fake.grids.get('Tasks')!.push(['t1', 'Open the clinic', 'DUE', '']);

    await fake.update('Tasks', 2, ['t1', 'Open the clinic', 'COMPLETED', 'priya']);
    await fake.update('Tasks', 2, ['t1', 'Open the clinic', 'COMPLETED', 'anita']);

    expect(fake.grids.get('Tasks')![1]![3]).toBe('anita');
    // Priya's completion is gone. Not merged, not flagged — gone.
  });

  it('refuses instead, when the adapter checks first', async () => {
    const { s } = store();
    await s.append('Tasks', { id: 't1', title: 'Open the clinic', status: 'DUE' });

    await s.updateRow('Tasks', 2, { status: 'DUE' }, { status: 'COMPLETED', completedBy: 'priya' });
    // Anita still believes it is DUE, because it was when her screen loaded.
    await expect(
      s.updateRow('Tasks', 2, { status: 'DUE' }, { status: 'COMPLETED', completedBy: 'anita' }),
    ).rejects.toThrow(ConcurrentWriteError);

    const rows = (await s.read(['Tasks'])).get('Tasks')!;
    expect(rows[0]!.values.completedBy).toBe('priya');
  });

  it('is still not a transaction, and the comment says so', async () => {
    // Two writers can pass the check in the same instant and the later one
    // wins. The window shrinks from minutes to milliseconds; it does not close.
    // Recorded as a known limit rather than left for somebody to discover.
    const { s } = store();
    await s.append('Tasks', { id: 't1', title: 'Open the clinic', status: 'DUE' });
    const both = await Promise.allSettled([
      s.updateRow('Tasks', 2, { status: 'DUE' }, { status: 'COMPLETED', completedBy: 'priya' }),
      s.updateRow('Tasks', 2, { status: 'DUE' }, { status: 'COMPLETED', completedBy: 'anita' }),
    ]);
    // Both read DUE before either wrote, so both are allowed through.
    expect(both.filter((r) => r.status === 'fulfilled').length).toBe(2);
  });
});

describe('what Sheets cannot give you: an audit trail that holds', () => {
  it('refuses to update an append-only sheet at all', async () => {
    const { s } = store();
    await s.append('Audit', { at: '09:00', action: 'COMPLETED', by: 'priya' });
    await expect(
      s.updateRow('Audit', 2, { by: 'priya' }, { by: 'somebody else' }),
    ).rejects.toThrow(AppendOnlyError);
  });

  it('cannot stop anybody editing the same row in the spreadsheet itself', () => {
    // Nothing in this file can prevent that, and no test can assert it away.
    // Whoever can open the sheet can retype a completion time. In PostgreSQL
    // the audit table is append-only by grant; here it is append-only by
    // this adapter's good manners, which is not the same thing.
    expect(SPECS.find((s) => s.name === 'Audit')?.appendOnly).toBe(true);
  });
});

describe('what Sheets cannot give you: room for a clinic', () => {
  it('shares one quota across every member of staff', () => {
    let t = 0;
    const q = new Quota(() => t);
    for (let i = 0; i < SHEETS_QUOTA.readsPerMinutePerUser; i += 1) q.take('read');
    expect(() => q.take('read')).toThrow(QuotaExceededError);

    // A minute later there is room again. More staff does not help; waiting does.
    t += 60_001;
    expect(() => q.take('read')).not.toThrow();
  });

  it('runs out with nine staff refreshing every thirty seconds', () => {
    const nine = estimateLoad(9, 30);
    expect(nine.readsPerMinute).toBe(18);
    expect(nine.overBudget).toBe(false);
    // Comfortable — until each screen needs more than one batched read.
  });

  it('runs out at thirty-one people, or at ten with a ten-second refresh', () => {
    expect(estimateLoad(31, 30).overBudget).toBe(true);
    expect(estimateLoad(30, 30).overBudget).toBe(false);

    const fast = estimateLoad(10, 10);
    expect(fast.readsPerMinute).toBe(60);
    expect(fast.maxStaff).toBe(10);
  });

  it('gives the ceiling for a single clinic at a comfortable refresh', () => {
    // The number to hold on to: one clinic, thirty people, refreshing every
    // thirty seconds, one batched read each. That is the whole budget.
    expect(estimateLoad(30, 30).maxStaff).toBe(30);
    // Two clinics on one spreadsheet halve it, because the limit is the key's.
    expect(estimateLoad(60, 30).overBudget).toBe(true);
  });
});
