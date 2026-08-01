/**
 * The Owner MIS.
 *
 * The requirement is more specific about this screen than any other, and it is
 * mostly a list of things NOT to show:
 *
 *   "You should not see 150 tasks. You should see: Operational Health, eight
 *   domains, requires your attention. Everything else stays in the background."
 *
 * So this screen has no task list, no schedule and no checklists. It has one
 * number, eight domains, and the exceptions behind them. An owner opening KuBi
 * should be able to close it again in fifteen seconds having learned whether
 * the clinic is fine — and if it is not, exactly what is wrong.
 *
 * ---
 *
 * Two rules the numbers obey, both of which exist to stop the dashboard
 * flattering the clinic:
 *
 *   GREY is never zero. A domain whose module is not built cannot be measured,
 *   and averaging an unmeasurable domain in as 0% would make a good week look
 *   like a failing one. It says so in words instead.
 *
 *   The target is shown beside the score, always. A number without the bar it
 *   is meant to clear is decoration — 88% means nothing until you know whether
 *   the standard is 85 or 100.
 */
import { useEffect, useState } from 'react';
import { api, type OwnerMis, type MisDomain } from '../api';

const RAG: Record<string, { cls: string; word: string }> = {
  GREEN: { cls: 'rag-green', word: 'On target' },
  AMBER: { cls: 'rag-amber', word: 'Below target' },
  RED: { cls: 'rag-red', word: 'Needs action' },
  GREY: { cls: 'rag-grey', word: 'Not measured' },
};

export function OwnerMIS({ onGoToQuality }: { onGoToQuality?: () => void }) {
  const [mis, setMis] = useState<OwnerMis | null>(null);

  useEffect(() => {
    void api.ownerMis().then(setMis).catch(() => setMis(null));
  }, []);

  if (!mis) return <div className="screen"><p className="screen-sub">Loading…</p></div>;

  const worst = [...mis.domains]
    .filter((d) => d.status === 'RED' || d.status === 'AMBER')
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100));

  return (
    <div className="screen screen-wide">
      <div className="mis-top">
        <div>
          <h1 className="screen-title">Today — {mis.clinicName.replace('SYNTHETIC ', '')}</h1>
          <p className="screen-sub">
            {worst.length === 0
              ? 'Everything measured is on target.'
              : `${worst.length} of ${mis.domains.length} domains below target.`}
          </p>
        </div>
        <div className="health">
          <div className="health-num">{mis.health === null ? '—' : `${mis.health}%`}</div>
          <div className="health-cap">Operational health</div>
        </div>
      </div>

      {/* Attention first. The requirement's owner view leads with what is
          wrong, not with a grid of numbers that happen to include it. */}
      {(mis.critical.length > 0 || mis.attention.length > 0) && (
        <section className="needs">
          <h2 className="group-head">Requires your attention</h2>
          {mis.critical.map((a) => (
            <div key={a.id} className="need need-critical">
              <span className="pill pill-safety">Critical</span>
              <div>
                <div className="row-title">{a.headline}</div>
                {a.detail && <div className="row-note">{a.detail}</div>}
              </div>
            </div>
          ))}
          {mis.attention.map((a) => (
            <div key={a.id} className="need">
              <span className="pill pill-important">Attention</span>
              <div>
                <div className="row-title">{a.headline}</div>
                {a.detail && <div className="row-note">{a.detail}</div>}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Counted, not written. §7 says "approximately eight"; hardcoding the
          word left the heading claiming eight while nine were on screen. */}
      <h2 className="group-head">
        {mis.domains.length} management {mis.domains.length === 1 ? 'domain' : 'domains'}
      </h2>
      <div className="domains">
        {mis.domains.map((d) => <DomainCard key={d.name} d={d} />)}
      </div>

      {/* "Recurring failures become root-cause/CAPA learning." The owner's
          real question is not what broke — it is what keeps breaking. */}
      {mis.repeatFailures.length > 0 && (
        <>
          <h2 className="group-head">Keeps happening</h2>
          {mis.repeatFailures.map((r) => (
            <div key={r.reference} className="repeat">
              <span className="repeat-n">{r.attempts}</span>
              <div>
                <div className="row-title">{r.summary}</div>
                <div className="row-note">
                  {r.reference} · {r.attempts} attempts — the last fix did not hold
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <h2 className="group-head">Learning</h2>
      <div className="capa-row">
        <button className="capa-stat" type="button" onClick={onGoToQuality}>
          <b>{mis.capa.open}</b><span>open</span>
        </button>
        <button className="capa-stat" type="button" onClick={onGoToQuality}>
          <b>{mis.capa.awaitingEffectiveness}</b><span>awaiting proof it worked</span>
        </button>
        <button className="capa-stat" type="button" onClick={onGoToQuality}>
          <b>{mis.capa.closed}</b><span>closed</span>
        </button>
      </div>
    </div>
  );
}

function DomainCard({ d }: { d: MisDomain }) {
  const rag = RAG[d.status] ?? RAG.GREY!;
  return (
    <article className={`domain ${rag.cls}`}>
      <div className="domain-head">
        <span className="domain-name">{d.name}</span>
        <span className="domain-score">{d.score === null ? '—' : `${d.score}%`}</span>
      </div>

      {/* A number without the bar it must clear is decoration. */}
      <div className="domain-meta">
        <span className={`rag-word ${rag.cls}`}>{rag.word}</span>
        {d.built && <span className="domain-target">target {d.target}%</span>}
      </div>

      {d.built && d.trend.length > 1 ? (
        <Spark values={d.trend} status={d.status} />
      ) : (
        // GREY is never zero. It says what it is instead of drawing a flat
        // line at the bottom of the chart, which would read as total failure.
        <p className="domain-note">{d.note}</p>
      )}
    </article>
  );
}

/**
 * Seven days, drawn without a chart library.
 *
 * Scaled from 0 so a run of 90s does not look like a cliff — a sparkline
 * auto-scaled to its own range exaggerates ordinary variation into drama,
 * which on a clinical dashboard is worse than showing nothing.
 */
function Spark({ values, status }: { values: number[]; status: string }) {
  const w = 100;
  const h = 26;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (Math.max(0, Math.min(100, v)) / 100) * h).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      className={`spark spark-${status.toLowerCase()}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={points} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
