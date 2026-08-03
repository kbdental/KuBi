/**
 * The Owner's dashboard, as §7 and §8 specify it.
 *
 *   Clinic Operational Score: 94%
 *   Opening 100% · Clinical 96% · Infection control 100% · Lab 82% ⚠ …
 *
 *   Requires your attention
 *     🔴 2 critical
 *     🟠 5 attention
 *
 *   Then clicking Lab 76% reveals ONLY the exceptions:
 *     3 lab cases overdue · 1 crown received but QC pending ·
 *     2 patients awaiting appointment · 1 remake
 *
 * That last part is the whole design. A drill-down that shows a report has
 * changed the subject; the owner asked what is wrong, and the answer is the
 * deviations and nothing else. "Everything else stays in the background."
 *
 * Rewritten from a version that showed a different set of numbers invented at
 * the screen — a five-light clinic score and a list of missing modules. That
 * list still matters and still appears, but below, because it answers a
 * question the owner asked once rather than the one they ask every morning.
 */
import { useEffect, useState } from 'react';
import { api, type Scoreboard, type ScoreLine } from '../api.js';

const OUTCOME_CLASS: Record<string, string> = {
  GREEN: 'sb-green', AMBER: 'sb-amber', RED: 'sb-red', GREY: 'sb-grey',
};

export function OwnerBusiness({ onOpenQuality }: { onOpenQuality?: () => void }) {
  const [sb, setSb] = useState<Scoreboard | null>(null);
  const [open, setOpen] = useState<ScoreLine | null>(null);

  useEffect(() => { void api.scoreboard().then(setSb).catch(() => setSb(null)); }, []);
  if (!sb) return <div className="screen"><p className="screen-sub">Loading…</p></div>;

  // The weakest line that actually has something wrong with it. Sorting by
  // percentage alone would point at a low score with nothing to act on.
  const worst = [...sb.lines]
    .filter((l) => l.deviationCount > 0)
    .sort((a, b) => (a.value ?? 101) - (b.value ?? 101))[0] ?? null;

  // "If this number changes, what will the user do?" — for a line with no
  // deviations behind it, nothing. It is reported, not offered as a control.
  const actionable = sb.lines.filter((l) => l.deviationCount > 0);
  const clear = sb.lines.filter((l) => l.deviationCount === 0);

  // The drill-down. Only deviations — never a report.
  if (open) {
    return (
      <div className="screen screen-wide">
        <button className="back" type="button" onClick={() => setOpen(null)}>Back</button>
        <h1 className="screen-title">{open.label}</h1>
        <p className="screen-sub">{open.measure}</p>

        {open.deviations.length === 0 ? (
          <div className="empty"><div className="empty-big">Nothing wrong here</div></div>
        ) : (
          <ul className="sb-devs">
            {open.deviations.map((d, i) => (
              <li key={`${d.label}-${i}`} className={`sb-dev sb-dev-${d.severity.toLowerCase()}`}>
                <div className="sb-dev-label">{d.label}</div>
                {d.detail && <div className="row-note">{d.detail}</div>}
              </li>
            ))}
          </ul>
        )}

        <p className="cc-note">
          Only the deviations are shown. The work that went to standard is not listed —
          it is not what this screen is for.
        </p>
      </div>
    );
  }

  return (
    <div className="screen screen-wide">
      <h1 className="screen-title">Today — {sb.clinicName.replace('SYNTHETIC ', '')}</h1>

      <div className="sb-top">
        <div className="sb-op">
          {/* Null is "nothing to measure". A clinic that ran nothing today has
              not scored zero, and drawing it as zero would be a lie. */}
          {sb.operational === null
            ? <span className="sb-nil">nothing to measure yet</span>
            : <><b>{sb.operational}</b><span>%</span></>}
        </div>
        <div className="sb-op-label">Clinic operational score</div>

        {/* The answer, and one thing to do about it. The screen previously
            opened with eight equal lines and no action at all — an owner could
            read it and still not know where to start. */}
        <div className={`sb-verdict ${worst ? 'is-bad' : 'is-ok'}`}>
          {worst ? (
            <>
              <b>{worst.label} is your weakest line</b>
              <span>
                {worst.value === null ? 'nothing to measure' : `${worst.value}%`}
                {worst.deviationCount > 0
                  && ` · ${worst.deviationCount} thing${worst.deviationCount === 1 ? '' : 's'} wrong`}
              </span>
              <button className="btn" type="button" onClick={() => setOpen(worst)}>
                Show me what is wrong
              </button>
            </>
          ) : (
            <>
              <b>Everything is running to standard</b>
              <span>No line is below its threshold and nothing is outstanding.</span>
            </>
          )}
        </div>
      </div>

      {/* Two of the eight had nothing wrong with them, and pressing either
          opened a screen saying "nothing wrong here". A number you cannot act
          on does not deserve a control — so the clear lines are stated once,
          quietly, and the pressable list is only what has something behind it. */}
      {clear.length > 0 && (
        <p className="sb-clear">
          Running to standard: {clear.map((l) => l.label.toLowerCase()).join(', ')}.
        </p>
      )}

      <ul className="sb-lines">
        {actionable.map((l) => (
          <li key={l.id}>
            <button
              className="sb-line"
              type="button"
              onClick={() => setOpen(l)}
              aria-label={
                `${l.label}, ${l.value ?? 'nothing to measure'}, ${l.deviationCount} to look at`
              }
            >
              <span className={`sb-dot ${OUTCOME_CLASS[l.outcome]}`} aria-hidden="true" />
              <span className="sb-label">{l.label}</span>
              <span className={`sb-value ${OUTCOME_CLASS[l.outcome]}`}>
                {l.value === null ? '—' : `${l.value}%`}
              </span>
              {l.deviationCount > 0 && (
                <span className="sb-count">{l.deviationCount}</span>
              )}
              <span className="sb-go" aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ul>

      <h2 className="cc-head">Requires your attention</h2>

      {sb.critical.length === 0 && sb.attention.length === 0 ? (
        <div className="empty"><div className="empty-big">Nothing right now</div></div>
      ) : (
        <>
          {sb.critical.length > 0 && (
            <div className="sb-group">
              <div className="sb-group-head sb-red">{sb.critical.length} critical</div>
              {sb.critical.map((c) => (
                <div key={c.id} className="sb-item sb-item-red">{c.headline}</div>
              ))}
            </div>
          )}
          {sb.attention.length > 0 && (
            <div className="sb-group">
              <div className="sb-group-head sb-amber">{sb.attention.length} attention</div>
              {sb.attention.map((a) => (
                <div key={a.id} className="sb-item sb-item-amber">{a.headline}</div>
              ))}
            </div>
          )}
        </>
      )}

      <button className="btn btn-quiet biz-cta" type="button" onClick={onOpenQuality}>
        What the clinic is learning from
      </button>

      {/* Still true, still worth saying — but below, because it answers a
          question asked once rather than the one asked every morning. */}
      <p className="cc-note">
        Money is not in KuBi yet. Revenue, collections, pending payments, chair utilisation
        and treatment acceptance all need a billing module, so they are absent here rather
        than estimated.
      </p>
    </div>
  );
}
