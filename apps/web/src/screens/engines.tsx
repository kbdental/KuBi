/**
 * The six engines, the cascade, and one activity fully modelled.
 *
 * Merged in from prototype B, which made this argument and prototype A never
 * did. Three sections because they are one claim in three parts:
 *
 *   1. Work is created by engines, not by anybody remembering.
 *   2. A clinical event raises its own consequences — press the button and
 *      watch six activities appear across three roles.
 *   3. One line of the SOP is stored as a whole specification, not a checkbox.
 *
 * The third is the one that convinces people. "Same-day instruments should be
 * ultrasonic cleaned and autoclaved" is not a tick — it is a parameter, a
 * process, a trigger, an owner, a due rule, a nine-step SOP, an evidence type,
 * a verification, and a KPI with a formula and a target.
 */

import { useLoad, Unavailable } from '../ui.js';
import { api, type EnginesView } from '../api.js';

export function Engines({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: d, failed, reload: load } = useLoad<EnginesView>(() => api.engines());
  if (failed) {
    return <Unavailable what="The engine view is not served by this server yet." />;
  }
  if (!d) return <p className="screen-sub">Loading…</p>;

  const a = d.anatomy;
  const pct = Math.round((a.numerator / a.denominator) * 1000) / 10;
  const band = pct >= 95 ? 'ok' : pct >= 85 ? 'warn' : 'bad';

  async function fire(on: boolean) {
    await api.fireCascade(on);
    load();
  }

  const body = (
    <>
      <p className="screen-sub">
        Nothing on anybody’s list was typed in by hand. Six engines raise it.
      </p>

      <ul className="eng-list">
        {d.engines.map((e) => (
          <li key={e.id} className="eng">
            <div className="eng-top">
              <span className="eng-name">{e.name}</span>
              {e.count === null
                ? <span className="eng-live">live</span>
                : <span className="eng-count">{e.count}</span>}
            </div>
            <p className="eng-what">{e.what}</p>
          </li>
        ))}
      </ul>

      {/* Engine B, interactive. The claim is only convincing if you can watch
          it happen. */}
      <h2 className="cc-head">Patient event engine</h2>
      <section className="casc">
        {!d.cascade.fired ? (
          <>
            <p className="casc-lead">
              Record the clinical event and the system raises the work it implies — to the
              right person, at the right time. Nobody types these in.
            </p>
            <button className="btn" type="button" onClick={() => void fire(true)}>
              Record: {d.cascade.event}
            </button>
          </>
        ) : (
          <>
            <p className="casc-lead">
              <b>{d.cascade.event}</b> raised {d.cascade.spawn.length} activities across
              three roles, automatically.
            </p>
            {['Today', 'Tomorrow', 'Later'].map((when) => {
              const rows = d.cascade.spawn.filter((s) => s.when === when);
              if (rows.length === 0) return null;
              return (
                <div key={when} className="casc-when">
                  <div className="casc-when-head">{when}</div>
                  {rows.map((s) => (
                    <div key={s.title} className="casc-row">
                      <span className="casc-title">{s.title}</span>
                      <span className="casc-role">{s.role}</span>
                      <span className="row-note">{s.due}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            <button className="btn btn-quiet" type="button" onClick={() => void fire(false)}>
              Reset
            </button>
          </>
        )}
      </section>

      {/* The owner's §5, on screen rather than in a document. */}
      <h2 className="cc-head">How one line of the SOP is actually stored</h2>
      <section className="anat">
        <p className="anat-req">{a.requirement}</p>
        <p className="anat-not">Not stored as: {a.notStoredAs}</p>

        <dl className="anat-chain">
          <div><dt>Parameter</dt><dd>{a.parameter}</dd></div>
          <div><dt>Process</dt><dd>{a.process}</dd></div>
          <div><dt>Trigger</dt><dd>{a.trigger}</dd></div>
          <div><dt>Owner</dt><dd>{a.owner}</dd></div>
          <div><dt>Due</dt><dd>{a.due}</dd></div>
        </dl>

        <div className="anat-sop">{a.sop.join(' → ')}</div>

        <dl className="anat-chain">
          <div><dt>Evidence</dt><dd>{a.evidence}</dd></div>
          <div><dt>Verification</dt><dd>{a.verification}</dd></div>
          <div><dt>KPI</dt><dd>{a.kpi}</dd></div>
        </dl>

        <div className="anat-kpi">
          <div className="row-note">{a.formula}</div>
          <div className="anat-kpi-row">
            <span className={`anat-pct anat-${band}`}>{pct}%</span>
            <span className="row-note">
              {a.numerator} of {a.denominator} · target {a.target}%
            </span>
          </div>
        </div>

        <p className="cc-note">
          Management does not ask “did you autoclave everything?”. The one instrument set
          that missed is in the exception queue with a name against it.
        </p>
      </section>
    </>
  );

  // Reference material, like the parameters and the activity library — so it
  // shares their destination rather than taking a twelfth tab.
  if (embedded) return body;
  return (
    <div className="screen screen-wide">
      <h1 className="screen-title">How work appears</h1>
      {body}
    </div>
  );
}
