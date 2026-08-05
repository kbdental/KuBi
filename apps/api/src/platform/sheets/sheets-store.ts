/**
 * Google Sheets as the data backend.
 *
 * Built because the owner asked for it after being shown the trade-offs and
 * reaffirming the decision. It is theirs to make: they run the clinic, they
 * own the data, and a system they can open and repair themselves has real
 * value that a database they cannot touch does not.
 *
 * What follows is the adapter, written honestly — which means it does not
 * pretend Sheets is a database. Where the semantics differ from PostgreSQL it
 * says so at the point of difference, and where a guarantee cannot be offered
 * it refuses rather than approximating one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The four differences that matter, at the places they bite
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. **No transactions.** `updateRow` is read-modify-write across the network.
 *    Two people completing the same task both read version N, both write
 *    N+1, and the second silently wins. `updateRow` therefore takes the row
 *    contents it expects to find and refuses if the sheet has moved on — an
 *    optimistic check, which is the strongest guarantee available here.
 *
 * 2. **Quota is per service account, not per person.** Every member of staff
 *    reaches Sheets through one key, so Google's 60-requests-per-minute
 *    per-user limit applies to the whole clinic at once, not to each person.
 *    `Quota` below models that and refuses early rather than letting Google
 *    return 429 in the middle of a morning.
 *
 * 3. **No row-level security.** Two-level tenancy — one clinic cannot see
 *    another's rows, enforced by the database itself — has no equivalent.
 *    Whoever holds the key holds everything. `SheetsStore` takes a clinic id
 *    and filters, but that is a courtesy in application code, exactly what
 *    constitution rule 3 says a UI check is. It is not enforcement.
 *
 * 4. **Latency is per call, not per query.** A round trip is roughly 200ms to
 *    1s. A screen that needs four sheets needs four round trips unless they
 *    are batched, so batching is the default here rather than an optimisation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this is allowed to hold
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Everything, if the owner says so. But the safety-critical record — the
 * append-only audit trail, and anything a gate reads to decide whether a
 * procedure may start — has a rule the adapter enforces rather than advises:
 * `appendOnly` sheets reject `updateRow` outright. An audit trail that can be
 * silently overwritten by a second writer is not an audit trail.
 */

export interface SheetsCredentials {
  /** Service account email, e.g. kubi@project.iam.gserviceaccount.com */
  clientEmail: string;
  /** PEM private key. Never logged, never persisted by this module. */
  privateKey: string;
  /** The spreadsheet id from its URL. */
  spreadsheetId: string;
}

export interface SheetRow {
  /** 1-based row number in the sheet. The only stable handle Sheets offers. */
  rowNumber: number;
  values: Record<string, string>;
}

/**
 * Google's published limits, as of writing.
 *
 * Verify these against the current quota page before relying on them — Google
 * changes them, and a number baked into code is a number nobody rechecks.
 *
 *   https://developers.google.com/sheets/api/limits
 */
export const SHEETS_QUOTA = {
  /** Read requests per minute, per project. */
  readsPerMinutePerProject: 300,
  /**
   * Read requests per minute, per user — and every member of staff arrives as
   * the same service account, so this is the clinic's whole budget.
   */
  readsPerMinutePerUser: 60,
  writesPerMinutePerProject: 300,
  writesPerMinutePerUser: 60,
} as const;

export class QuotaExceededError extends Error {
  constructor(kind: 'read' | 'write', used: number, limit: number) {
    super(
      `Google Sheets ${kind} quota exhausted: ${used} of ${limit} requests in the last minute. `
      + 'Every member of staff shares one service account, so this limit belongs to the '
      + 'whole clinic rather than to one person. Waiting will clear it; more staff will not.',
    );
    this.name = 'QuotaExceededError';
  }
}

export class ConcurrentWriteError extends Error {
  constructor(sheet: string, rowNumber: number, field: string) {
    super(
      `${sheet} row ${rowNumber} changed while you were working on it (${field}). `
      + 'Google Sheets has no transactions, so KuBi checked the row before writing rather '
      + 'than overwriting somebody else. Reload and try again.',
    );
    this.name = 'ConcurrentWriteError';
  }
}

export class AppendOnlyError extends Error {
  constructor(sheet: string) {
    super(
      `${sheet} is append-only and cannot be updated. An audit trail a second writer can `
      + 'silently overwrite is not an audit trail.',
    );
    this.name = 'AppendOnlyError';
  }
}

/**
 * A sliding one-minute window, because that is the window Google enforces.
 *
 * Deliberately refuses before the call rather than retrying after a 429: a
 * retry storm during a busy morning turns one slow screen into every screen
 * being slow.
 */
export class Quota {
  private readonly reads: number[] = [];
  private readonly writes: number[] = [];

  constructor(private readonly now: () => number) {}

  private prune(list: number[]) {
    const cutoff = this.now() - 60_000;
    while (list.length > 0 && list[0]! < cutoff) list.shift();
  }

  take(kind: 'read' | 'write', n = 1): void {
    const list = kind === 'read' ? this.reads : this.writes;
    const limit = kind === 'read'
      ? SHEETS_QUOTA.readsPerMinutePerUser
      : SHEETS_QUOTA.writesPerMinutePerUser;
    this.prune(list);
    if (list.length + n > limit) throw new QuotaExceededError(kind, list.length + n, limit);
    for (let i = 0; i < n; i += 1) list.push(this.now());
  }

  /** What is left this minute. For a screen that wants to warn before it fails. */
  remaining(kind: 'read' | 'write'): number {
    const list = kind === 'read' ? this.reads : this.writes;
    const limit = kind === 'read'
      ? SHEETS_QUOTA.readsPerMinutePerUser
      : SHEETS_QUOTA.writesPerMinutePerUser;
    this.prune(list);
    return Math.max(0, limit - list.length);
  }
}

/**
 * The wire underneath. The real one calls Google; the fake in the tests
 * behaves identically, including losing a write when two arrive together.
 */
export interface SheetsTransport {
  /** One call, many ranges. Batching is the default because latency is per call. */
  batchGet(ranges: string[]): Promise<string[][][]>;
  append(sheet: string, values: string[]): Promise<number>;
  update(sheet: string, rowNumber: number, values: string[]): Promise<void>;
}

export interface SheetSpec {
  name: string;
  headers: string[];
  /** Audit and evidence. Update is refused outright. */
  appendOnly?: boolean;
}

export class SheetsStore {
  private headers = new Map<string, string[]>();

  constructor(
    private readonly transport: SheetsTransport,
    private readonly quota: Quota,
    private readonly sheets: SheetSpec[],
  ) {
    for (const s of sheets) this.headers.set(s.name, s.headers);
  }

  private spec(sheet: string): SheetSpec {
    const s = this.sheets.find((x) => x.name === sheet);
    if (!s) throw new Error(`No sheet named "${sheet}" is configured.`);
    return s;
  }

  /**
   * Read several sheets in one round trip.
   *
   * Takes a list rather than one name on purpose. A screen that needs four
   * sheets and asks four times costs four round trips and four quota units;
   * the same screen batched costs one of each. At 60 units a minute for the
   * whole clinic, that difference decides whether the product works.
   */
  async read(sheetNames: string[]): Promise<Map<string, SheetRow[]>> {
    this.quota.take('read', 1);
    const grids = await this.transport.batchGet(sheetNames.map((n) => `${n}!A:ZZ`));

    const out = new Map<string, SheetRow[]>();
    sheetNames.forEach((name, i) => {
      const grid = grids[i] ?? [];
      const head = grid[0] ?? this.headers.get(name) ?? [];
      const rows: SheetRow[] = [];
      for (let r = 1; r < grid.length; r += 1) {
        const line = grid[r] ?? [];
        if (line.every((c) => (c ?? '').trim() === '')) continue;
        const values: Record<string, string> = {};
        head.forEach((h, c) => { values[h] = (line[c] ?? '').trim(); });
        rows.push({ rowNumber: r + 1, values });
      }
      out.set(name, rows);
    });
    return out;
  }

  async append(sheet: string, values: Record<string, string>): Promise<number> {
    this.quota.take('write', 1);
    const head = this.headers.get(sheet) ?? [];
    return this.transport.append(sheet, head.map((h) => values[h] ?? ''));
  }

  /**
   * Update a row, refusing if somebody else got there first.
   *
   * `expect` is what the caller believes the row currently says. The read
   * costs a quota unit and a round trip, and it is not optional: without it
   * this method silently discards another person's work, which is the single
   * most damaging thing a clinic system can do quietly.
   *
   * It is still not a transaction. Two writers can pass the check in the same
   * instant and the later one wins. The window is milliseconds rather than
   * minutes, which is a real improvement and not a guarantee.
   */
  async updateRow(
    sheet: string,
    rowNumber: number,
    expect: Record<string, string>,
    next: Record<string, string>,
  ): Promise<void> {
    const spec = this.spec(sheet);
    if (spec.appendOnly) throw new AppendOnlyError(sheet);

    this.quota.take('read', 1);
    const grid = await this.transport.batchGet([`${sheet}!A${rowNumber}:ZZ${rowNumber}`]);
    const line = grid[0]?.[0] ?? [];
    const head = this.headers.get(sheet) ?? [];
    const current: Record<string, string> = {};
    head.forEach((h, c) => { current[h] = (line[c] ?? '').trim(); });

    for (const [field, was] of Object.entries(expect)) {
      if ((current[field] ?? '') !== was) {
        throw new ConcurrentWriteError(sheet, rowNumber, field);
      }
    }

    this.quota.take('write', 1);
    await this.transport.update(sheet, rowNumber, head.map((h) => next[h] ?? current[h] ?? ''));
  }

  /** How much of this minute's budget is left. */
  budget(): { reads: number; writes: number } {
    return { reads: this.quota.remaining('read'), writes: this.quota.remaining('write') };
  }
}

/* -------------------------------------------------------------------------
 * What a clinic day costs
 *
 * Not a benchmark — arithmetic, from the shape of the product. It is here in
 * code rather than in a document because it is the number that decides
 * whether this backend works, and a number in a document is a number nobody
 * rechecks when the product changes.
 * ---------------------------------------------------------------------- */

export interface LoadEstimate {
  staff: number;
  pollSeconds: number;
  readsPerMinute: number;
  limit: number;
  overBudget: boolean;
  /** How many people this backend supports at that polling rate. */
  maxStaff: number;
}

export function estimateLoad(staff: number, pollSeconds: number): LoadEstimate {
  // One batched read per refresh — the best case this adapter can achieve.
  const perPersonPerMinute = 60 / pollSeconds;
  const readsPerMinute = Math.ceil(staff * perPersonPerMinute);
  const limit = SHEETS_QUOTA.readsPerMinutePerUser;
  return {
    staff,
    pollSeconds,
    readsPerMinute,
    limit,
    overBudget: readsPerMinute > limit,
    maxStaff: Math.floor(limit / perPersonPerMinute),
  };
}
