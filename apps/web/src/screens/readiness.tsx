import {
  useClinic, ownedBy, BlockList, Meter, Loading, hhmm,
} from './day-blocks.js';

/**
 * CLINIC READINESS — the morning, and only the morning.
 *
 * Getting the clinic ready for the first patient. The evening is its own place
 * in the rail, at the owner's instruction: *"clinic closing should be in a
 * different tab… it should not be mixed with opening procedures which are
 * making the clinic ready for the patient"*. Nobody standing in the clinic at
 * nine in the morning is thinking about fumigation, and a list that mixes the
 * two makes them read past half of it.
 */
export function ClinicReadiness() {
  const { view, problem, busy, report } = useClinic();
  if (!view) return <Loading problem={problem} />;

  const r = view.readiness;
  const mine = ownedBy(view.role);

  return (
    <div className="screen screen-wide">
      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      <section className="ready-panel">
        <div className="ready-head">
          <div>
            <div className="ready-kicker">BEFORE THE FIRST PATIENT</div>
            <h2 className={`ready-verdict ${r.ready ? 'is-good' : r.overdue ? 'is-bad' : ''}`}>
              {r.unconfigured.length > 0
                ? 'Clinic not set up'
                : !view.unlocked
                  ? 'The clinic has not been unlocked'
                  : r.ready ? 'Clinic is ready' : `${r.outstanding.length} still to do`}
            </h2>
            <p className="ready-sub">
              {r.unconfigured.length > 0
                ? r.unconfigured[0]
                : r.ready
                  ? r.varianceMinutes === null
                    ? `Ready at ${hhmm(r.readyAt)}.`
                    : r.varianceMinutes <= 0
                      ? `Ready at ${hhmm(r.readyAt)} — ${Math.abs(r.varianceMinutes)} min before the first patient.`
                      : `Ready at ${hhmm(r.readyAt)} — ${r.varianceMinutes} min after the first patient was due.`
                  : r.targetAt === null
                    ? 'Nobody is booked today, so there is no time to be ready by.'
                    : r.overdue
                      ? `The first patient was due at ${hhmm(r.targetAt)}.`
                      : `First patient at ${hhmm(r.targetAt)}, in ${r.minutesToTarget} min.`}
            </p>
          </div>
          <Meter percent={Math.round(r.compliance * 100)} good={r.ready} />
        </div>

        {r.startBy !== null && !r.ready && (
          <p className="ready-note">
            Must start by <strong>{hhmm(r.startBy)}</strong> — driven by {r.startDrivenBy}.
          </p>
        )}

        {/* Mandatory only. The as-required work has its own section below, and
            listing it twice made the count and the list disagree. */}
        <BlockList
          blocks={r.blocks.filter((b) => b.mandatory !== false)}
          busy={busy}
          mine={mine}
          onReport={(b) => void report(b)}
        />

        {r.advisory.length > 0 && (
          <div className="ready-advisory">
            <div className="ready-advisory-head">As required — does not hold the clinic</div>
            <BlockList blocks={r.advisory} busy={busy} mine={mine}
              onReport={(b) => void report(b)} />
          </div>
        )}
      </section>
    </div>
  );
}
