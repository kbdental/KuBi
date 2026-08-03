/**
 * The compliance gate — engine D.
 *
 * The distinction the whole product turns on, and prototype B rendered it
 * better than anything in A: **this is not a checklist.** A checklist can be
 * ticked while the thing is wrong, and a missing item quietly disappears when
 * somebody scrolls past it. A gate produces a verdict, and the verdict is the
 * screen.
 *
 *   ⚠ PROCEDURE NOT READY — 2 mandatory requirements outstanding.
 *   ✓ READY FOR SURGERY
 *
 * Toggling a requirement re-renders the verdict immediately, because the point
 * is that the verdict is *derived* — nobody declares a procedure ready.
 */
import { useEffect, useState } from 'react';
import { api, type GateView } from '../api.js';

export function Gate() {
  const [g, setG] = useState<GateView | null>(null);
  const load = () => { void api.gate().then(setG).catch(() => setG(null)); };
  useEffect(load, []);
  if (!g) return <div className="screen"><p className="screen-sub">Loading…</p></div>;

  async function toggle(id: string) {
    await api.toggleGateCheck(id);
    load();
  }

  return (
    <div className="screen screen-tight">
      <h1 className="screen-title">Procedure readiness</h1>
      <p className="screen-sub">{g.procedure}</p>

      <ul className="gt-list">
        {g.checks.map((c) => (
          <li key={c.id}>
            <button className="gt-check" type="button" onClick={() => void toggle(c.id)}>
              <span className={`gt-box ${c.met ? 'is-met' : 'is-missing'}`} aria-hidden="true">
                {c.met ? '✓' : '!'}
              </span>
              <span className="gt-label">{c.label}</span>
              <span className={`gt-state ${c.met ? 'is-met' : 'is-missing'}`}>
                {c.met ? 'met' : 'missing'}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* The verdict IS the screen. Derived, never declared. */}
      <div className={`gt-verdict ${g.ready ? 'is-ready' : 'is-not'}`}>
        {g.ready ? (
          <b>✓ READY FOR SURGERY</b>
        ) : (
          <>
            <b>⚠ PROCEDURE NOT READY</b>
            <p>
              {g.missingCount} mandatory requirement{g.missingCount === 1 ? '' : 's'}{' '}
              outstanding. The procedure cannot be started, and the requirement does not
              disappear.
            </p>
          </>
        )}
      </div>

      <p className="cc-note">
        This is a gate, not a checklist. A checklist can be ticked while the thing is
        wrong; a gate refuses, and says which requirement is refusing.
      </p>
    </div>
  );
}
