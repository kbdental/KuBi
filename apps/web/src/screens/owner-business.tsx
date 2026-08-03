/**
 * The Owner's dashboard — business, not operations.
 *
 * A different app from the manager's, deliberately. The manager asks "can we
 * work today and what is stopping us"; the owner asks "is this practice
 * healthy". Those are not the same screen with different filters.
 *
 * ---
 *
 * The honest part, and the reason this screen looks the way it does.
 *
 * Of the twelve things asked for — revenue, collections, pending payments,
 * chair utilisation, treatment acceptance, Google reviews, doctor
 * productivity, profit, lab revenue, clinic score, attendance, satisfaction —
 * KuBi can source three. It holds no money at all: no billing, no payments
 * ledger, no CRM, no review integration.
 *
 * So the missing nine are shown as missing, each naming the module that would
 * answer it. Not hidden, because the owner asked for them and their absence is
 * the most useful thing this screen can currently say. Not filled with a
 * plausible figure either: a number nobody can source is worse than a blank,
 * because a blank prompts a question and an invented figure ends one.
 *
 * When billing lands, these become real and this list shortens. That is the
 * intended reading.
 */
import { useEffect, useState } from 'react';
import { api, type OwnerBusiness as Business } from '../api';

export function OwnerBusiness({ onOpenQuality }: { onOpenQuality?: () => void }) {
  const [b, setB] = useState<Business | null>(null);
  useEffect(() => { void api.ownerBusiness().then(setB).catch(() => setB(null)); }, []);
  if (!b) return <div className="screen"><p className="screen-sub">Loading…</p></div>;

  return (
    <div className="screen screen-wide">
      <h1 className="screen-title">{b.clinicName.replace('SYNTHETIC ', '')}</h1>
      <p className="screen-sub">Today, in the terms an owner asks about.</p>

      {/* Anything that stops a patient being treated outranks every number on
          this page, so it sits above them. */}
      {b.critical.length > 0 && (
        <section className="needs">
          {b.critical.map((c) => (
            <div key={c.id} className="need need-critical">
              <span className="pill pill-safety">Critical</span>
              <div className="row-title">{c.headline}</div>
            </div>
          ))}
        </section>
      )}

      <div className="biz-grid">
        {b.known.map((k) => (
          <div key={k.name} className="biz-tile">
            <b>{k.value}</b>
            <span>{k.name}</span>
          </div>
        ))}
      </div>

      {b.attention.length > 0 && (
        <>
          <h2 className="cc-head">Wants a look</h2>
          <div className="cc-cards">
            {b.attention.slice(0, 5).map((a) => (
              <div key={a.id} className="cc-card cc-important">{a.headline}</div>
            ))}
          </div>
        </>
      )}

      <h2 className="cc-head">Not yet answerable</h2>
      <p className="row-note ops-note">
        You asked for these. KuBi holds no billing, payments, reviews or attendance data, so
        rather than show you a number nobody can source, here is what each one needs.
      </p>
      <div className="biz-grid">
        {b.missing.map((m) => (
          <div key={m.name} className="biz-tile biz-missing">
            <b>—</b>
            <span>{m.name}</span>
            <em>needs {m.module}</em>
          </div>
        ))}
      </div>

      <button className="btn btn-quiet biz-cta" type="button" onClick={onOpenQuality}>
        What the clinic is learning from
      </button>
    </div>
  );
}
