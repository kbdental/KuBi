import { useCallback, useEffect, useState } from 'react';
import { api, type EquipmentScreenView, type AssetRecordView } from '../api.js';
import { who, Loading } from './day-blocks.js';

/**
 * EQUIPMENT — every asset's record, and the work it generated.
 *
 * The owner: *"Every important asset should have its own digital record… If
 * Next Service Date = Today, the app automatically creates the service task."*
 *
 * So there is nothing on this screen anybody typed. The register holds when
 * each asset was last serviced and how often it needs to be; everything else —
 * what is due, what is overdue, what is unusable, how long the compressor has
 * been down — is arithmetic, done server-side and arriving already decided.
 *
 * Four states, and the order they are shown in is the argument:
 *
 *   DOWN        broken now
 *   UNSERVICED  nobody has ever recorded a service against it
 *   OVERDUE     serviced once, and the next one has passed
 *   OPERATIONAL in date
 *
 * `UNSERVICED` sits above `OVERDUE` deliberately. The obvious arithmetic —
 * next = last + interval — produces *nothing at all* when there is no last,
 * so an asset nobody has touched reports "no service due", which is the
 * opposite of the truth. Here it is the loudest row on the page.
 */

export function Equipment() {
  const [view, setView] = useState<EquipmentScreenView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('ATTENTION');

  const load = useCallback(async () => {
    try {
      setView(await api.equipment());
      setProblem(null);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not read the asset register.');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (view === null) return <Loading problem={problem} />;

  const needsAttention = view.records.filter((r) => r.state !== 'OPERATIONAL');
  const shown = filter === 'ATTENTION' ? needsAttention
    : filter === 'ALL' ? view.records
      : view.records.filter((r) => r.category === filter);

  return (
    <div className="screen screen-wide">
      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      {/* ── Where the register is ──────────────────────────────────────── */}
      <section className="ready-panel">
        <div className="ready-head">
          <div>
            <div className="ready-kicker">THE ASSET REGISTER</div>
            <h2 className={`ready-verdict ${needsAttention.length > 0 ? 'is-bad' : 'is-good'}`}>
              {view.records.length} assets, {view.tasks.length} things they generated
            </h2>
            <p className="ready-sub">
              Nobody created a service task. Each record holds its own intervals
              and the dates do the rest.
            </p>
          </div>
        </div>

        {view.down.length > 0 && (
          <p className="ready-note is-bad">
            {view.down.length} out of service now — {view.down.map((r) => r.name).join(', ')}.
          </p>
        )}
        {view.unusable.length > 0 && (
          <p className="ready-note is-bad">
            {view.unusable.length} may not be used: something that blocks their
            use has gone overdue.
          </p>
        )}
        {view.unserviced.length > 0 && (
          <p className="ready-note is-bad">
            {view.unserviced.length} have no service history at all. That is not
            the same as nothing being due — the date arithmetic cannot run.
          </p>
        )}
        {view.checksDue.length > 0 && (
          <p className="ready-note is-warn">
            {view.checksDue.length} daily checks still owed today.
          </p>
        )}
      </section>

      {/* ── What the signed-in role owes ───────────────────────────────── */}
      {view.mine.length > 0 && (
        <section className="ready-panel">
          <div className="ready-kicker">{who(view.role).toUpperCase()} — YOUR ASSETS</div>
          <div className="block-list">
            {view.mine.slice(0, 10).map((t) => (
              <div key={`${t.assetTag}#${t.cycleId}`} className="block">
                <span className={`care-pip ${t.overdue ? 'is-unknown' : 'is-open'}`} aria-hidden="true" />
                <div className="block-body">
                  <div className="block-label">{t.label} — {t.assetName}</div>
                  <div className="block-meta">
                    {t.assetTag}
                    {t.dueAt === null
                      ? ' · never recorded'
                      : t.overdue
                        ? ` · ${t.daysLate} day${t.daysLate === 1 ? '' : 's'} overdue`
                        : ' · coming up'}
                    {t.blocks ? ' · stops the asset being used' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── The register ───────────────────────────────────────────────── */}
      <section className="ready-panel">
        <div className="switch" role="tablist">
          {[
            ['ATTENTION', `Needs attention (${needsAttention.length})`],
            ['ALL', `All (${view.records.length})`],
            ...view.categories.map((c) => [c, categoryWord(c)] as const),
          ].map(([id, label]) => (
            <button key={id} type="button" role="tab"
              className={`switch-opt ${filter === id ? 'is-on' : ''}`}
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
            >{label}</button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            <div className="empty-big">Nothing outstanding</div>
            <div className="empty-line">Every asset here is in date and working.</div>
          </div>
        ) : (
          <div className="asset-list">
            {shown.map((r) => (
              <AssetCard key={r.tag} record={r}
                expanded={open === r.tag}
                onToggle={() => setOpen(open === r.tag ? null : r.tag)} />
            ))}
          </div>
        )}
      </section>

      {view.unratified && (
        <section className="ready-panel">
          <div className="ready-kicker">WHOSE LIST THIS IS</div>
          <p className="ready-note is-warn">
            This register is synthetic — the tags, serial numbers and contract
            dates are made up so the engine had something to run on. Send the
            clinic’s own asset list and it replaces this one row for row,
            without a line of the engine changing.
          </p>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * One asset
 * ---------------------------------------------------------------------- */

function AssetCard({ record, expanded, onToggle }: {
  record: AssetRecordView; expanded: boolean; onToggle: () => void;
}) {
  const r = record;
  return (
    <div className={`asset ${EDGE[r.state]}`}>
      <div className="asset-head">
        <div className="asset-id">
          <span className="tag tag-mono">{r.tag}</span>
          <span className={`asset-state ${PILL[r.state]}`}>{stateWord(r.state)}</span>
        </div>
        <div className="asset-name">{r.name}</div>
        <div className="asset-where">
          {r.location} · {who(r.responsible)}
          {r.criticality === 'STOPS_CLINIC' ? ' · the clinic stops without it' : ''}
        </div>
        <div className={`asset-headline ${r.state === 'OPERATIONAL' ? '' : 'is-bad'}`}>
          {r.headline}
        </div>
      </div>

      <div className="asset-facts">
        {/* Three different states, and the screen must not show two of them
            the same way: no service interval at all, an interval nobody has
            ever met, and one that has lapsed. */}
        <Fact label="Last service"
          value={!r.hasServiceCycle ? 'no service interval'
            : r.lastServicedDay ?? 'never recorded'}
          bad={r.hasServiceCycle && r.lastServicedDay === null} />
        <Fact label="Next service"
          value={!r.hasServiceCycle ? '—'
            : r.nextServiceDay ?? 'cannot be calculated'}
          bad={r.hasServiceCycle && r.nextServiceDay === null} />
        <Fact label="Breakdowns" value={String(r.breakdowns)} />
        <Fact label="Downtime" value={downtimeWord(r.downtimeMinutes)} />
        <Fact label="AMC" value={amcWord(r)} bad={r.amcAction === 'EXPIRED'
          || r.amcAction === 'NO_EXPIRY_RECORDED'} />
        <Fact label="Documents" value={r.documents.length > 0
          ? r.documents.join(', ') : 'none held'} bad={r.documents.length === 0} />
      </div>

      <button className="btn btn-quiet care-more" type="button" onClick={onToggle}>
        {expanded ? 'Hide the record' : 'Show the record'}
      </button>

      {expanded && (
        <div className="asset-detail">
          {r.dailyCheck !== null && (
            <div className="asset-block">
              <div className="care-group-title">
                Daily check {r.checkDue ? '— still owed today' : '— done today'}
              </div>
              <p className="asset-line">{r.dailyCheck}</p>
            </div>
          )}

          <div className="asset-block">
            <div className="care-group-title">Cycles</div>
            <div className="block-list">
              {r.cycles.map((c) => (
                <div key={c.id} className="block">
                  <span className={`care-pip ${c.due === null ? 'is-met'
                    : c.due.overdue ? 'is-unknown' : 'is-open'}`} aria-hidden="true" />
                  <div className="block-body">
                    <div className="block-label">{c.label}</div>
                    <div className="block-meta">
                      every {intervalWord(c.everyDays)} · {who(c.owner)}
                      {c.blocks ? ' · stops the asset being used' : ''}
                    </div>
                    {c.due !== null && <div className="care-why">{c.due.because}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {r.unknowns.length > 0 && (
            <div className="asset-block">
              <div className="care-group-title">Not answered</div>
              {r.unknowns.map((u) => (
                <p key={u} className="asset-line is-bad">{u}</p>
              ))}
            </div>
          )}

          <div className="asset-block">
            <div className="care-group-title">The record</div>
            <p className="asset-line">
              {r.make} {r.model} · serial {r.serial}
              {r.amcCovers !== null ? ` · AMC covers: ${r.amcCovers}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="fact">
      <div className={`fact-value ${bad ? 'fact-stop' : ''}`}>{value}</div>
      <div className="fact-label">{label}</div>
    </div>
  );
}

/**
 * The four states, spelled out rather than built from the state name.
 *
 * `asset-${state.toLowerCase()}` would work and is banned: the library test
 * reads class names out of the source, and a name assembled at runtime cannot
 * be checked. Written in full, both the test and a reader can see every class
 * the screen can produce.
 */
const EDGE: Record<string, string> = {
  OPERATIONAL: 'asset-operational',
  OVERDUE: 'asset-overdue',
  DOWN: 'asset-down',
  UNSERVICED: 'asset-unserviced',
};

const PILL: Record<string, string> = {
  OPERATIONAL: 'asset-state-operational',
  OVERDUE: 'asset-state-overdue',
  DOWN: 'asset-state-down',
  UNSERVICED: 'asset-state-unserviced',
};

const stateWord = (s: string) => ({
  DOWN: 'Out of service',
  UNSERVICED: 'No history',
  OVERDUE: 'Overdue',
  OPERATIONAL: 'In service',
}[s] ?? s);

const categoryWord = (c: string) =>
  c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, ' ');

/** "every 7 days" reads badly; "every week" is how a clinic says it. */
function intervalWord(d: number): string {
  if (d === 1) return 'day';
  if (d === 7) return 'week';
  if (d === 30) return 'month';
  if (d === 90) return 'quarter';
  if (d === 180) return 'six months';
  if (d === 365) return 'year';
  if (d === 730) return 'two years';
  if (d === 1825) return 'five years';
  return `${d} days`;
}

function downtimeWord(m: number): string {
  if (m === 0) return 'none';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} days`;
}

function amcWord(r: AssetRecordView): string {
  switch (r.amcAction) {
    case 'NONE': return 'no contract';
    case 'NO_EXPIRY_RECORDED': return `${r.amcVendor ?? 'vendor'} — no expiry recorded`;
    case 'EXPIRED': return `${r.amcVendor ?? 'vendor'} — expired`;
    case 'EXPIRING': return `${r.amcVendor ?? 'vendor'} — expiring`;
    default: return r.amcVendor ?? 'in date';
  }
}
