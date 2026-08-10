import {
  useClinic, ownedBy, BlockList, Meter, Loading, hhmm,
} from './day-blocks.js';

/**
 * CLINIC CLOSING — the evening, and only the evening.
 *
 * Its own place in the rail rather than a second panel under readiness. The
 * owner: *"clinic closing should be in a different tab… it should not be mixed
 * with opening procedures which are making the clinic ready for the patient"*.
 *
 * The evening asks a different question from the morning. The morning is
 * *"can we open"* — one answer, yes or no. The evening is *"can we leave"*,
 * and it has a state the morning never has: patient-safety work outstanding,
 * which the day cannot be closed through. That is called out above the list
 * rather than left to be discovered in it.
 */
export function ClinicClosing() {
  const { view, problem, busy, report } = useClinic();
  if (!view) return <Loading problem={problem} />;

  const c = view.closing;
  const mine = ownedBy(view.role);

  return (
    <div className="screen screen-wide">
      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      <section className="ready-panel">
        <div className="ready-head">
          <div>
            <div className="ready-kicker">BEFORE THE TEAM LEAVES</div>
            <h2 className={`ready-verdict ${c.clear ? 'is-good' : c.runningLate ? 'is-bad' : ''}`}>
              {c.unconfigured.length > 0
                ? 'Clinic not set up'
                : c.clear ? 'Day closed down' : `${c.outstanding.length} still to do`}
            </h2>
            <p className="ready-sub">
              {c.unconfigured.length > 0
                ? c.unconfigured[0]
                : c.shutAt === null
                  ? 'No shut time is set for this clinic.'
                  : c.clear
                    ? c.overrunMinutes === null
                      ? `Finished at ${hhmm(c.closedAt)}.`
                      : `Out at ${hhmm(c.closedAt)} — closing took ${c.overrunMinutes} min.`
                    : c.runningLate
                      ? `The team should have left at ${hhmm(c.expectedCloseAt)}.`
                      : c.closingNow
                        ? `Shut at ${hhmm(c.shutAt)}. Out by ${hhmm(c.expectedCloseAt)}.`
                        : `Shuts at ${hhmm(c.shutAt)}. Out by ${hhmm(c.expectedCloseAt)}.`}
            </p>
          </div>
          <Meter percent={Math.round(c.compliance * 100)} good={c.clear} />
        </div>

        {/* The one state the morning never has. Said before the list, because
            "the day cannot be closed" is not something to find out at the
            bottom of a scroll. */}
        {c.criticalException.length > 0 && (
          <p className="ready-note is-bad">
            {c.criticalException.length} patient-safety item
            {c.criticalException.length === 1 ? '' : 's'} outstanding.
            The day cannot be closed until {c.criticalException.length === 1 ? 'it is' : 'they are'}.
          </p>
        )}

        <BlockList blocks={c.blocks} busy={busy} mine={mine}
          onReport={(b) => void report(b)} />
      </section>
    </div>
  );
}
