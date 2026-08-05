/**
 * Reception's board. Patients, not statistics.
 *
 * The order is the order the desk actually works in: who is next, who is
 * waiting, who is late, who still needs calling. Nothing on this screen is a
 * percentage, because nobody at a reception desk has ever acted on one.
 *
 * "Payments pending" was asked for and is absent: KuBi holds no billing. It
 * says so once rather than showing a zero that would be read as "nobody owes
 * anything".
 */
import { useLoad, Unavailable, Loading } from '../ui.js';

import { api, type ReceptionBoard as Board } from '../api';

export function ReceptionBoard({ onOpenClinic }: { onOpenClinic?: () => void }) {
  const { data: b, failed } = useLoad<Board>(() => api.receptionBoard());

  if (failed) return <Unavailable what="The reception board is not served by this server yet." />;
  if (!b) return <Loading />;

  return (
    <div className="screen screen-wide">
      <h1 className="screen-title">The desk</h1>
      <p className="screen-sub">Who is next, who is waiting, and who still needs a call.</p>

      {/* The single most useful fact at a reception desk, given its own card. */}
      <section className="rc-next">
        {b.next ? (
          <>
            <div className="rc-next-when">
              {b.next.inMinutes <= 0 ? 'now' : `in ${b.next.inMinutes} min`}
            </div>
            <div>
              <div className="rc-next-who">{b.next.patientLabel}</div>
              <div className="row-note">{b.next.visitType} · {b.next.chairLabel}</div>
            </div>
          </>
        ) : (
          // Not "0 patients" — there is genuinely nobody left, which is a
          // different thing and reads differently at four in the afternoon.
          <div className="rc-next-who">Nobody else booked today</div>
        )}
      </section>

      {b.delayed.length > 0 && (
        <>
          <h2 className="cc-head">Kept waiting</h2>
          <div className="cc-cards">
            {b.delayed.map((d) => (
              <div key={d.id} className="cc-card cc-critical">
                {d.patientLabel} — {d.lateMinutes} min past their slot
              </div>
            ))}
          </div>
        </>
      )}

      <div className="cc-split">
        <section className="cc-panel">
          <h2 className="cc-head">Waiting now</h2>
          {b.waiting.length === 0 ? (
            <p className="row-note">Nobody in the waiting room.</p>
          ) : (
            <ul className="rc-list">
              {b.waiting.map((w) => (
                <li key={w.id}>
                  <span className="rc-name">{w.patientLabel}</span>
                  <span className="row-note">{w.visitType}</span>
                  <span className="rc-mins">{w.waitingMinutes} min</span>
                </li>
              ))}
            </ul>
          )}
          <button className="btn btn-quiet" type="button" onClick={onOpenClinic}>
            Open the day’s list
          </button>
        </section>

        <section className="cc-panel">
          <h2 className="cc-head">Calls to make</h2>
          <ul className="rc-list">
            <li>
              <span className="rc-name">Confirmations</span>
              <span className="rc-mins">{b.confirmations}</span>
            </li>
            {b.followups.map((f) => (
              <li key={f.id}>
                <span className="rc-name">{f.patientLabel}</span>
                <span className="row-note">
                  {f.procedureName} follow-up{f.overdue && <span className="overdue"> · overdue</span>}
                </span>
                <span className="rc-mins">{f.dueLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {b.labReady.length > 0 && (
        <>
          <h2 className="cc-head">Ready to book</h2>
          <p className="row-note ops-note">
            Arrived and passed its check. These are the only cases that may be given a delivery
            appointment.
          </p>
          <div className="cc-cards">
            {b.labReady.map((l) => (
              <div key={l.id} className="cc-card cc-ok">
                {l.patientLabel} — {l.workType.toLowerCase()} ready ({l.reference})
              </div>
            ))}
          </div>
        </>
      )}

      {!b.paymentsAvailable && (
        // Said once. A zero here would be read as "nobody owes anything".
        <p className="cc-note">
          Payments are not in KuBi yet — there is no billing module, so this board cannot show
          what is outstanding.
        </p>
      )}
    </div>
  );
}
