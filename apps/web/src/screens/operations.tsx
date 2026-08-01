/**
 * Operations — equipment, stock, implants and sterilisation on one screen.
 *
 * The FRS groups these together and it is right to: they are the four things
 * that stop a clinic treating patients, and a manager checking whether today
 * will work should not have to visit four places to find out.
 *
 * Ordered by what blocks care rather than alphabetically. An out-of-service
 * chair and an empty box of masks are both "operations", but only one of them
 * empties a room.
 *
 * Two things this screen refuses to do:
 *
 *   It never shows a stock figure without saying what is usable. "10 in stock,
 *   4 usable" is the honest line; showing 10 alone is how a clinic runs out of
 *   something it believed it had.
 *
 *   It never offers to advance a quarantined sterilisation batch. Sheet L is
 *   explicit that a failed cycle cannot release packs, so the control is
 *   absent rather than present-and-refusing.
 */
import { useEffect, useState } from 'react';
import { api, type Operations, type DemoAsset, type DemoStock } from '../api';

const ASSET_STATUS: Record<string, { label: string; cls: string }> = {
  OPERATIONAL: { label: 'In service', cls: 'ok' },
  RESTRICTED: { label: 'Restricted', cls: 'warn' },
  OUT_OF_SERVICE: { label: 'Out of service', cls: 'bad' },
  UNDER_REPAIR: { label: 'Under repair', cls: 'warn' },
  RETIRED: { label: 'Retired', cls: 'quiet' },
};

const STOCK_STATE: Record<string, { label: string; cls: string }> = {
  OK: { label: 'OK', cls: 'ok' },
  REORDER: { label: 'Reorder', cls: 'warn' },
  SHORTAGE: { label: 'Shortage', cls: 'bad' },
};

/** Where a batch is, in order. QUARANTINED is off the line, not late on it. */
const STAGES = ['COLLECTED', 'ULTRASONIC', 'INSPECTED', 'PACKED', 'AUTOCLAVED', 'VERIFIED', 'RELEASED'];

export function Operations({ onChanged }: { onChanged?: () => void }) {
  const [ops, setOps] = useState<Operations | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try { setOps(await api.operations()); } catch { setOps(null); }
  }
  useEffect(() => { void reload(); }, []);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); await reload(); onChanged?.(); } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    }
  }

  if (!ops) return <div className="screen"><p className="screen-sub">Loading…</p></div>;

  const c = ops.counts;
  const down = ops.assets.filter((a) => a.status !== 'OPERATIONAL');
  const serviceDue = ops.assets.filter((a) => a.nextServiceInDays !== null && a.nextServiceInDays <= 7);
  const short = ops.stock.filter((s) => s.state !== 'OK');
  const gaps = ops.implants.filter((i) => i.quantity === 0);

  return (
    <div className="screen screen-wide">
      <h1 className="screen-title">Operations</h1>
      <p className="screen-sub">
        Equipment, stock and sterilisation — the four things that stop the clinic treating people.
      </p>

      {error && <div className="notice notice-stop" role="alert">{error}</div>}

      <div className="ops-tiles">
        <Tile n={c.assetsDown} label="out of service" bad={c.assetsDown > 0} />
        <Tile n={c.serviceDue} label="service due" bad={false} />
        <Tile n={c.shortages} label="shortages" bad={c.shortages > 0} />
        <Tile n={c.implantGaps} label="implant gaps" bad={c.implantGaps > 0} />
        <Tile n={c.batchesPending} label="batches in progress" bad={false} />
      </div>

      {/* What blocks care, first. */}
      {(down.length > 0 || gaps.length > 0 || short.some((s) => s.state === 'SHORTAGE')) && (
        <>
          <h2 className="group-head">Stopping work right now</h2>
          {down.map((a) => (
            <div key={a.id} className="need need-critical">
              <span className="pill pill-safety">Equipment</span>
              <div>
                <div className="row-title">{a.name} is out of service</div>
                <div className="row-note">
                  {a.code} · {a.location} · needs a repair and a second person’s sign-off
                </div>
              </div>
            </div>
          ))}
          {gaps.map((i) => (
            <div key={i.id} className="need need-critical">
              <span className="pill pill-safety">Implant</span>
              <div>
                <div className="row-title">
                  {i.componentType.toLowerCase().replace(/_/g, ' ')} {i.size} — none in stock
                </div>
                <div className="row-note">{i.brand} {i.line} {i.platform}</div>
              </div>
            </div>
          ))}
          {short.filter((s) => s.state === 'SHORTAGE').map((s) => (
            <div key={s.id} className="need">
              <span className="pill pill-critical">Stock</span>
              <div>
                {/* Neutral phrasing: an item name may be singular or plural
                    ("Surgical masks is below minimum" reads as a bug). */}
                <div className="row-title">{s.name} — below minimum</div>
                <div className="row-note">
                  {s.available} usable against a minimum of {s.minimumQty}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <h2 className="group-head">Equipment</h2>
      <div className="ops-list">
        {ops.assets.map((a) => <AssetRow key={a.id} a={a} onAct={act} />)}
      </div>

      {serviceDue.length > 0 && (
        <p className="row-note ops-foot">
          {serviceDue.length} {serviceDue.length === 1 ? 'asset needs' : 'assets need'} servicing
          within a week — raised as attention items rather than left on this page.
        </p>
      )}

      <h2 className="group-head">Stock</h2>
      <div className="ops-list">
        {ops.stock.map((s) => <StockRow key={s.id} s={s} />)}
      </div>

      <h2 className="group-head">Implants</h2>
      <p className="row-note ops-note">
        Counted to the component. Knowing “five implants available” says nothing about whether
        the right platform, diameter and abutment are on the shelf.
      </p>
      <div className="tw">
        <table className="ops-table">
          <thead>
            <tr><th>Component</th><th>System</th><th>Size</th><th>Qty</th></tr>
          </thead>
          <tbody>
            {ops.implants.map((i) => (
              <tr key={i.id} className={i.quantity === 0 ? 'row-gap' : ''}>
                <td>{i.componentType.toLowerCase().replace(/_/g, ' ')}</td>
                <td className="row-note">{i.brand} {i.line} · {i.platform}</td>
                <td>{i.size}</td>
                <td>
                  <strong className={i.quantity === 0 ? 'zero' : ''}>{i.quantity}</strong>
                  {i.expiringSoon && <span className="tag tag-correct">expiring</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="group-head">Sterilisation</h2>
      <p className="row-note ops-note">
        A batch, not a closing tick. Each one travels the stages, and a failed cycle cannot
        release packs.
      </p>
      <div className="ops-list">
        {ops.batches.map((b) => {
          const i = STAGES.indexOf(b.stage);
          const held = b.stage === 'QUARANTINED' || b.cycleResult === 'FAIL';
          return (
            <div key={b.id} className="row row-static">
              <div className="row-main">
                <div className="inc-head">
                  <span className="inc-ref">{b.batchRef}</span>
                  <span className="inc-meta">{b.packCount} packs · {b.operator}</span>
                  {held && <span className="pill pill-safety">Held</span>}
                </div>

                {held ? (
                  // No advance control at all, rather than one that refuses.
                  <div className="next-step">
                    Cycle {b.cycleResult?.toLowerCase()} — cannot release until resolved
                  </div>
                ) : (
                  <>
                    <ol className="rail" aria-label="Stage">
                      {STAGES.map((label, n) => (
                        <li key={label} className={`rail-step ${n < i ? 'done' : n === i ? 'here' : ''}`}>
                          <span className="rail-dot" aria-hidden="true" />
                          <span className="rail-label">{label.charAt(0) + label.slice(1).toLowerCase()}</span>
                        </li>
                      ))}
                    </ol>
                    {b.stage !== 'RELEASED' && (
                      <button
                        className="btn btn-quiet"
                        type="button"
                        onClick={() => void act(() => api.advanceBatch(b.id))}
                      >
                        Move to {STAGES[i + 1]!.toLowerCase()}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ n, label, bad }: { n: number; label: string; bad: boolean }) {
  return (
    <div className={`ops-tile ${bad && n > 0 ? 'ops-tile-bad' : ''}`}>
      <b>{n}</b><span>{label}</span>
    </div>
  );
}

function AssetRow({
  a, onAct,
}: {
  a: DemoAsset;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const st = ASSET_STATUS[a.status] ?? ASSET_STATUS.OPERATIONAL!;
  return (
    <div className="row row-static">
      <div className="row-main">
        <div className="inc-head">
          <span className={`ops-state ops-${st.cls}`}>{st.label}</span>
          <span className="inc-ref">{a.code}</span>
          <span className="inc-meta">{a.location}</span>
        </div>
        <div className="row-title">{a.name}</div>
        <div className="row-note">
          {a.nextServiceInDays === null
            ? 'No maintenance plan'
            : `${a.serviceKind?.toLowerCase()} due in ${a.nextServiceInDays} days`}
          {a.checkedToday === null && ' · not checked today'}
        </div>

        {/* Only offered where it can change something. A failed asset needs a
            repair, not another check. */}
        {a.status === 'OPERATIONAL' && a.checkedToday === null && (
          <div className="pt-actions">
            <button className="btn btn-quiet" type="button"
              onClick={() => void onAct(() => api.checkAsset(a.id, 'PASS'))}>Working</button>
            <button className="btn btn-quiet" type="button"
              onClick={() => void onAct(() => api.checkAsset(a.id, 'FAIL'))}>Not working</button>
          </div>
        )}
      </div>
    </div>
  );
}

function StockRow({ s }: { s: DemoStock }) {
  const st = STOCK_STATE[s.state] ?? STOCK_STATE.OK!;
  return (
    <div className="row row-static">
      <div className="row-main">
        <div className="inc-head">
          <span className={`ops-state ops-${st.cls}`}>{st.label}</span>
          <span className="inc-ref">{s.code}</span>
        </div>
        <div className="row-title">{s.name}</div>
        <div className="row-note">
          {/* Never a figure without what is usable beside it. */}
          <strong>{s.available}</strong> usable
          {s.onHand !== s.available && ` of ${s.onHand} on hand`}
          {' · '}min {s.minimumQty}, reorder at {s.reorderLevel}
          {s.expired > 0 && ` · ${s.expired} expired ${s.expired === 1 ? 'batch' : 'batches'}`}
          {s.expiringSoon > 0 && ` · ${s.expiringSoon} expiring soon`}
        </div>
      </div>
    </div>
  );
}
