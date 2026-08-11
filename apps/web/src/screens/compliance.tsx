import { useCallback, useEffect, useState } from 'react';
import { api, type ComplianceScreenView, type ComplianceView, type GateResultView } from '../api.js';
import { hhmm, who, Loading } from './day-blocks.js';

/**
 * MANDATORY — what must be true, and what happened when it was not.
 *
 * Named twice by the owner and both times better than my word for it. First
 * *"I will put it as requirement tab rather than compliance tab"* — nobody
 * opens a compliance department, and a tab named after one is a tab clinical
 * staff learn to avoid. Then *"Mandatory is a better word for requirement"* —
 * a requirement sounds like something you might negotiate, and the entire
 * argument of this screen is that these cannot be.
 *
 * The engine behind it is still `compliance.ts`, because compliance is what it
 * produces. Mandatory is what the clinic experiences.
 *
 * The owner: *"If mandatory requirements are missing: ⚠ PROCEDURE NOT READY.
 * The software should not quietly allow the missing requirement to
 * disappear."*
 *
 * So the screen has three sections and they are in order of how badly they
 * matter, which is the opposite of how most compliance software is laid out:
 *
 *   BREACHED    delivered without something mandatory. Permanent.
 *   NOT READY   cannot start now.
 *   READY       the quiet ones.
 *
 * Breaches come first because they are the only thing here that cannot be
 * fixed. A procedure that is not ready becomes ready when somebody does the
 * work; a procedure that was delivered without consent stays that way, and a
 * screen that buried it under today's outstanding items would be helping it
 * disappear.
 *
 * There is no button on this screen that lets anybody past a gate. That is not
 * an omission — it is the enforcement. The engine takes no argument that could
 * override one, so there is nothing for a screen to offer.
 */

export function ComplianceScreen() {
  const [view, setView] = useState<ComplianceScreenView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.compliance());
      setProblem(null);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not read the mandatory list.');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (view === null) return <Loading problem={problem} />;

  const ready = view.all.filter((c) => c.ready && c.breaches.length === 0);

  return (
    <div className="screen screen-wide">
      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      <section className="ready-panel">
        <div className="ready-head">
          <div>
            <div className="ready-kicker">MANDATORY BEFORE TREATMENT</div>
            <h2 className={`ready-verdict ${view.breached.length > 0 || view.notReady.length > 0
              ? 'is-bad' : 'is-good'}`}>
              {view.notReady.length === 0 && view.breached.length === 0
                ? 'Every procedure clear'
                : `${view.notReady.length} not ready${view.breached.length > 0
                  ? `, ${view.breached.length} breached` : ''}`}
            </h2>
            <p className="ready-sub">
              {Math.round(view.rate * 100)}% of today’s bookings have every
              mandatory requirement met. The catalogue defines {view.gateCount} of them.
            </p>
          </div>
        </div>

        {view.refusalCount > 0 && (
          <p className="ready-note is-warn">
            {view.refusalCount} recorded attempt{view.refusalCount === 1 ? '' : 's'} to
            start a procedure that was not ready. Every one is in the log — a
            refusal nobody can count is one people learn to route around.
          </p>
        )}

        {view.worstGates.length > 0 && (
          <div className="gate-tally">
            <div className="care-group-title">What fails most often</div>
            {view.worstGates.slice(0, 5).map((g) => (
              <div key={g.id} className="gate-tally-row">
                <span className={`gate-basis ${basisClass(g.basis)}`}>{g.basis}</span>
                <span className="gate-tally-label">{g.label}</span>
                <span className="gate-tally-count">{g.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Breached: first, because it is the only thing here that cannot
             be fixed by doing the work. ─────────────────────────────────── */}
      {view.breached.length > 0 && (
        <Section title="BREACHED — delivered without a mandatory requirement"
          note="A gate met afterwards does not clear these. They stay against the treatment for as long as the log exists."
          bad
          items={view.breached} open={open} setOpen={setOpen} />
      )}

      {view.notReady.length > 0 && (
        <Section title="⚠ PROCEDURE NOT READY"
          note="Nothing on this screen lets anybody past. The work is the only way through."
          bad
          items={view.notReady} open={open} setOpen={setOpen} />
      )}

      {ready.length > 0 && (
        <Section title="READY" note={null} bad={false}
          items={ready} open={open} setOpen={setOpen} />
      )}
    </div>
  );
}

function Section({ title, note, bad, items, open, setOpen }: {
  title: string; note: string | null; bad: boolean;
  items: ComplianceView[];
  open: string | null; setOpen: (id: string | null) => void;
}) {
  return (
    <section className="ready-panel">
      <div className="ready-kicker">{title}</div>
      {note !== null && (
        <p className={`ready-note ${bad ? 'is-bad' : ''}`}>{note}</p>
      )}
      <div className="asset-list">
        {items.map((c) => (
          <ProcedureCard key={c.bookingId} c={c}
            expanded={open === c.bookingId}
            onToggle={() => setOpen(open === c.bookingId ? null : c.bookingId)} />
        ))}
      </div>
    </section>
  );
}

function ProcedureCard({ c, expanded, onToggle }: {
  c: ComplianceView; expanded: boolean; onToggle: () => void;
}) {
  const state = c.breaches.length > 0 ? 'BREACHED' : c.ready ? 'READY' : 'NOT_READY';
  return (
    <div className={`asset ${EDGE[state]}`}>
      <div className="asset-head">
        <div className="asset-id">
          <span className="tag tag-mono">{hhmm(c.at)}</span>
          <span className={`asset-state ${PILL[state]}`}>{WORD[state]}</span>
        </div>
        <div className="asset-name">{c.treatmentName}</div>
        <div className="asset-where">{c.patientLabel}</div>
        <div className={`asset-headline ${state === 'READY' ? '' : 'is-bad'}`}>
          {c.headline}
        </div>
      </div>

      {/* The breach, said in full, before anything else about the case. */}
      {c.breaches.map((b) => (
        <div key={b.gateId} className="breach">
          <div className="breach-title">{b.label}</div>
          <div className="breach-line">
            Not held at {hhmm(b.deliveredAt % 1440)}, when the treatment was delivered.
            {b.metLateAt !== null
              ? ` Recorded afterwards at ${hhmm(b.metLateAt % 1440)} — which does not undo it.`
              : ' Still not held.'}
          </div>
          <div className="breach-line is-quiet">Would have needed: {b.evidence}</div>
        </div>
      ))}

      {c.refusals.length > 0 && (
        <p className="asset-line is-bad">
          {c.refusals.length} recorded attempt{c.refusals.length === 1 ? '' : 's'} to
          start this anyway — {c.refusals.map((r) => hhmm(r.at % 1440)).join(', ')}.
        </p>
      )}

      <button className="btn btn-quiet care-more" type="button" onClick={onToggle}>
        {expanded ? 'Hide them' : `Show all ${c.gates.length}`}
      </button>

      {expanded && (
        <div className="asset-detail">
          <GateGroup title="Before the procedure may start" gates={c.before} />
          <GateGroup title="Before the day may close on it" gates={c.after} />
        </div>
      )}
    </div>
  );
}

function GateGroup({ title, gates }: { title: string; gates: GateResultView[] }) {
  if (gates.length === 0) return null;
  return (
    <div className="care-group">
      <div className="care-group-title">{title}</div>
      <div className="block-list">
        {gates.map((x) => (
          <div key={x.id} className={`block ${x.verdict === 'MET' ? 'is-done' : ''}`}>
            <span className={`care-pip ${pip(x.verdict)}`} aria-hidden="true" />
            <div className="block-body">
              <div className="block-label">
                {x.label}
                <span className={`gate-basis ${basisClass(x.basis)}`}>{x.basis}</span>
              </div>
              <div className="block-meta">
                {who(x.owner)}
                {x.attestedBy !== null ? ` · only ${who(x.attestedBy)} may attest it` : ''}
              </div>
              {/* Evidence, not a tick. This is what makes an audit possible a
                  year later, when everyone who was there has forgotten. */}
              <div className="care-why is-quiet">Proved by: {x.evidence}</div>
              {(x.verdict === 'MISSING' || x.verdict === 'UNKNOWN') && (
                <div className="care-why">{x.because}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const EDGE: Record<string, string> = {
  READY: 'asset-operational',
  NOT_READY: 'asset-overdue',
  BREACHED: 'asset-down',
};

const PILL: Record<string, string> = {
  READY: 'asset-state-operational',
  NOT_READY: 'asset-state-overdue',
  BREACHED: 'asset-state-down',
};

const WORD: Record<string, string> = {
  READY: 'Ready',
  NOT_READY: 'Not ready',
  BREACHED: 'Breached',
};

const pip = (v: string) =>
  v === 'MET' ? 'is-met'
    : v === 'NOT_APPLICABLE' ? 'is-aside'
      : v === 'UNKNOWN' ? 'is-unknown' : 'is-late';

/**
 * The basis is shown on every gate, because it decides who may argue.
 *
 * A clinical gate is the clinical director's to change. A statutory one is
 * nobody's — an exposure with no written justification is not a matter of
 * house style, and a badge that says so stops the whole list being read as
 * one.
 */
const basisClass = (b: string) => ({
  STATUTORY: 'gate-statutory',
  CONSENT: 'gate-consent',
  SAFETY: 'gate-safety',
  CLINICAL: 'gate-clinical',
  RECORD: 'gate-record',
}[b] ?? 'gate-clinical');
