/**
 * The morning confirmation board — the owner's §6 worked example.
 *
 *   Patient | Appointment | Confirmation | Reminder | Special instructions | Status
 *
 * Two things make this the example rather than a table:
 *
 * 1. **Status is derived, never typed.** Confirmed / No response / Reschedule
 *    / Cancelled / Action required all fall out of what actually happened —
 *    the visit's state and the number of call attempts. A status somebody sets
 *    by hand goes stale within a morning, and then the list lies while looking
 *    tidy.
 *
 * 2. **The summary leads with what is unresolved.** "Management needs to see
 *    the exceptions, not 18 green ticks." So the unconfirmed and
 *    action-required counts are the ones given weight, and the confirmed count
 *    is present but quiet.
 */
import { useLoad, Unavailable, Loading } from '../ui.js';

import { api, type Confirmations as Data } from '../api.js';

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  NO_RESPONSE: 'No response',
  RESCHEDULE: 'Reschedule',
  CANCELLED: 'Cancelled',
  ACTION_REQUIRED: 'Action required',
};
const STATUS_CLASS: Record<string, string> = {
  CONFIRMED: 'cf-ok',
  NO_RESPONSE: 'cf-warn',
  RESCHEDULE: 'cf-warn',
  CANCELLED: 'cf-grey',
  ACTION_REQUIRED: 'cf-bad',
};

export function ConfirmationsBoard() {
  const { data: d, failed } = useLoad<Data>(() => api.confirmations());

  if (failed) return <Unavailable what="The morning confirmation board is not served by this server yet." />;
  if (!d) return <Loading />;

  const s = d.summary;
  const unresolved = s.unconfirmed + s.actionRequired;

  return (
    <div className="screen screen-wide">
      <h1 className="screen-title">Today’s confirmations</h1>
      <p className="screen-sub">
        {unresolved === 0
          ? 'Everybody booked today has confirmed.'
          : `${unresolved} of ${s.appointments} still unresolved.`}
      </p>

      {/* Exceptions first, given size. The confirmed count is present but
          deliberately not the headline. */}
      <dl className="cf-summary">
        <div className={s.actionRequired > 0 ? 'is-bad' : ''}>
          <dt>{s.actionRequired}</dt><dd>action required</dd>
        </div>
        <div className={s.unconfirmed > 0 ? 'is-warn' : ''}>
          <dt>{s.unconfirmed}</dt><dd>no response</dd>
        </div>
        <div><dt>{s.cancelled}</dt><dd>cancelled</dd></div>
        <div className="is-quiet"><dt>{s.confirmed}</dt><dd>confirmed</dd></div>
      </dl>

      <div className="cf-wrap">
        <table className="cf-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Appointment</th>
              <th>Confirmation</th>
              <th>Reminder</th>
              <th>Special instructions</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.id} className={r.status === 'CANCELLED' ? 'is-off' : ''}>
                <td className="cf-name">{r.patientLabel}</td>
                <td>
                  {r.appointment}
                  <div className="row-note">
                    {r.startsInMinutes <= 0 ? 'now' : `in ${r.startsInMinutes} min`}
                  </div>
                </td>
                <td>{r.confirmation}</td>
                <td>{r.reminderSent ? 'Sent' : '—'}</td>
                {/* An instruction nobody reads is the same as no instruction,
                    so it sits in the row rather than behind a tap. */}
                <td className="cf-note">{r.specialInstructions ?? '—'}</td>
                <td>
                  <span className={`cf-status ${STATUS_CLASS[r.status] ?? 'cf-grey'}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="cc-note">
        Status is worked out from what happened — the visit’s state and how many times
        somebody called. Nobody sets it by hand, so it cannot go stale.
      </p>
    </div>
  );
}
