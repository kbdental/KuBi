import { useState } from 'react';
import { api, ApiError, type TaskSheet, type ChecklistAnswer, type CompleteResult } from '../api.js';
import { IconTick } from '../icons.js';

/**
 * DO THIS — one task, start to finish.
 *
 * Three things this screen is careful about:
 *
 *  1. It says who checks the work BEFORE the work starts, not after. Being
 *     told at the end that someone else has to look is how people learn to
 *     resent a checklist.
 *  2. When the server refuses because something can't be confirmed, the
 *     refusal comes WITH the two honest ways forward. The Finish button is
 *     never quietly greyed out — a disabled button is not a control, and
 *     pretending otherwise would put the rule in the browser, where it does
 *     not belong.
 *  3. Reporting a problem is one press away at all times, and never feels
 *     like failing. It is the cheapest honest path, on purpose.
 */

type Panel = 'CHECKLIST' | 'PROBLEM' | 'WHY' | 'AUTHORISE' | 'DONE';

export function TaskSheetScreen({
  sheet, onBack, onFinished,
}: {
  sheet: TaskSheet;
  onBack: () => void;
  onFinished: () => void;
}) {
  const [ticks, setTicks] = useState<Record<string, boolean>>(
    () => Object.fromEntries(sheet.items.map((i) => [i.id, i.checked])),
  );
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(sheet.items.map((i) => [i.id, i.value == null ? '' : String(i.value)])),
  );
  const [panel, setPanel] = useState<Panel>('CHECKLIST');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [result, setResult] = useState<CompleteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(sheet.status === 'IN_PROGRESS');

  // Taps are measured, not estimated: every press a person makes on this
  // screen is counted and sent with the completion, so the real cost of a
  // checklist is a number we can look at rather than argue about.
  const [taps, setTaps] = useState(1); // opening this screen was one
  const countTap = () => setTaps((n) => n + 1);

  async function ensureStarted() {
    if (started) return;
    await api.startTask(sheet.id).catch(() => undefined);
    setStarted(true);
  }

  function toggle(id: string) {
    countTap();
    void ensureStarted();
    setTicks((t) => ({ ...t, [id]: !t[id] }));
  }

  function answers(): ChecklistAnswer[] {
    return sheet.items.map((i) => {
      const raw = values[i.id];
      const n = i.requiresValue && raw !== undefined && raw !== '' ? Number(raw) : undefined;
      return {
        itemId: i.id,
        checked: ticks[i.id] ?? false,
        ...(n !== undefined && Number.isFinite(n) ? { numericValue: n } : {}),
      };
    });
  }

  async function finish(overrideReason?: string) {
    setBusy(true);
    setRefusal(null);
    try {
      await ensureStarted();
      const r = await api.completeTask(sheet.id, {
        responses: answers(),
        taps: taps + 1,
        ...(overrideReason ? { overrideReason } : {}),
      });
      setResult(r);
      setPanel('DONE');
    } catch (err) {
      if (err instanceof ApiError) {
        setRefusal(err.message);
        // The server said a reason could unblock this. Offer to take one.
        setPanel(err.canOverride ? 'WHY' : 'CHECKLIST');
      } else {
        setRefusal('We could not save that just now. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const ticked = sheet.items.filter((i) => ticks[i.id]).length;
  const everythingTicked = ticked === sheet.items.length;

  if (panel === 'DONE' && result) {
    return <Finished sheet={sheet} result={result} onBack={onFinished} />;
  }

  if (panel === 'PROBLEM') {
    return (
      <ReportProblem
        sheet={sheet}
        onCancel={() => { countTap(); setPanel('CHECKLIST'); }}
        onReported={onFinished}
        onTap={countTap}
      />
    );
  }

  if (panel === 'AUTHORISE') {
    return (
      <Authorise
        sheet={sheet}
        onCancel={() => { countTap(); setPanel('CHECKLIST'); }}
        onAuthorised={onFinished}
      />
    );
  }

  if (panel === 'WHY') {
    return (
      <SayWhy
        message={refusal}
        busy={busy}
        onCancel={() => { countTap(); setPanel('CHECKLIST'); setRefusal(null); }}
        onConfirm={(reason) => { countTap(); void finish(reason); }}
        onReportInstead={() => { countTap(); setPanel('PROBLEM'); }}
      />
    );
  }

  return (
    <div className="screen">
      <button className="back" onClick={() => { countTap(); onBack(); }} type="button">‹ Today</button>
      <h1 className="screen-title">{sheet.title}</h1>
      {sheet.standard && <p className="screen-sub">{sheet.standard}</p>}

      {sheet.blockedBy && (
        <div className="notice notice-warn">
          <div className="notice-title">This is on hold</div>
          {sheet.blockedBy}. Someone has been asked to sort it out — you don&rsquo;t need to chase it.
        </div>
      )}

      {/* Once the server has refused, its message says this and more. Showing
          both stacks two warnings that mean the same thing. */}
      {sheet.cantConfirm && !refusal && (
        <div className="notice notice-warn">
          <div className="notice-title">{sheet.cantConfirm}</div>
          Tell us what you can see, and we&rsquo;ll take it from there.
        </div>
      )}

      {refusal && (
        <div className="notice notice-stop" role="alert">
          <div className="notice-title">Not finished yet</div>
          {refusal}
        </div>
      )}

      {sheet.needsSomeoneElseToCheck && (
        <div className="notice notice-calm">
          When you finish, someone else will confirm this. We&rsquo;ll ask them — you don&rsquo;t
          need to find anyone.
        </div>
      )}

      {/* Usability review: show progress through the list. On a five-item
          checklist a person can count for themselves — the value is on the
          longer ones, and in knowing the tick registered. */}
      {sheet.items.length > 0 && (
        <div className="progress">
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={ticked}
            aria-valuemin={0}
            aria-valuemax={sheet.items.length}
            aria-label="Checklist progress"
          >
            <div
              className="progress-fill"
              style={{ width: `${(ticked / sheet.items.length) * 100}%` }}
            />
          </div>
          <span className="progress-count">{ticked} of {sheet.items.length} done</span>
        </div>
      )}

      {sheet.items.map((item) => (
        <div key={item.id}>
          <button
            className="tick"
            type="button"
            aria-pressed={ticks[item.id] ? 'true' : 'false'}
            onClick={() => toggle(item.id)}
          >
            <span className="tick-box" aria-hidden="true"><IconTick /></span>
            <span className="tick-label">{item.label}</span>
            {item.requiresValue && (
              <input
                className="tick-value"
                inputMode="decimal"
                placeholder={item.unit ?? ''}
                value={values[item.id] ?? ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setValues((v) => ({ ...v, [item.id]: e.target.value }))}
                aria-label={`${item.label} reading${item.unit ? ` in ${item.unit}` : ''}`}
              />
            )}
          </button>
        </div>
      ))}

      <button
        className="btn"
        type="button"
        disabled={busy || !everythingTicked}
        onClick={() => { countTap(); void finish(); }}
      >
        {busy ? 'Saving…' : 'Finish'}
      </button>

      <button
        className="btn btn-quiet"
        type="button"
        onClick={() => { countTap(); setPanel('PROBLEM'); }}
      >
        Report a problem
      </button>

      {/* A manager looking at somebody else's blocked task can release it.
          The server decides whether they may; this only offers it when there
          is actually something blocking. */}
      {sheet.cantConfirm && sheet.canOverrideBlock && !sheet.isMine && (
        <button
          className="btn btn-quiet"
          type="button"
          onClick={() => { countTap(); setPanel('AUTHORISE'); }}
        >
          Let this go ahead
        </button>
      )}

      {sheet.spec && <WhyThisExists spec={sheet.spec} />}
    </div>
  );
}

/**
 * Why this task exists, who the four people are, and what it moves.
 *
 * Below the fold on purpose — somebody doing the work at 09:40 needs the
 * checklist, not the governance. But it is on the same screen, because the
 * moment anyone asks "why am I doing this" or "who is waiting on me", the
 * answer has to be one scroll away and not in a policy folder.
 *
 * The four levels are the point. Doer and checker alone leave nobody
 * accountable for the result and nobody to hear about it when it does not
 * happen — which is exactly how "I thought somebody else had done it" happens.
 */
function WhyThisExists({ spec }: { spec: NonNullable<TaskSheet['spec']> }) {
  const role = (r: string) => r.replace(/_/g, ' ').toLowerCase();

  return (
    <details className="why">
      <summary className="why-summary">
        <span className="why-origin">{spec.originLabel}</span>
        Why this exists
      </summary>

      <div className="why-body">
        <dl className="why-chain">
          <div><dt>Control</dt><dd>{role(spec.parameter)}</dd></div>
          <div><dt>Process</dt><dd>{spec.process}</dd></div>
          <div><dt>Triggered by</dt><dd>{spec.trigger}</dd></div>
          <div><dt>Engine</dt><dd>{role(spec.engine)}</dd></div>
        </dl>

        <div className="why-head">Who is responsible</div>
        <dl className="why-chain">
          <div><dt>Doer</dt><dd>{role(spec.responsibility.doer)}</dd></div>
          <div>
            <dt>Checker</dt>
            {/* Null is "may check their own", never "nobody checks". */}
            <dd>{spec.responsibility.checker
              ? role(spec.responsibility.checker)
              : 'may verify their own'}</dd>
          </div>
          <div><dt>Owner</dt><dd>{role(spec.responsibility.owner)}</dd></div>
          <div><dt>Escalates to</dt><dd>{role(spec.responsibility.escalation)}</dd></div>
        </dl>

        <div className="why-head">If it does not happen</div>
        <ol className="why-ladder">
          {spec.escalation.map((r) => (
            <li key={r.level}>
              <b>{r.afterMinutes} min late</b> → {role(r.to)}
            </li>
          ))}
        </ol>

        {spec.kpi && (
          <p className="why-kpi">
            Moves <b>{spec.kpi}</b>
          </p>
        )}
      </div>
    </details>
  );
}

/** Five reasons, big targets, an optional note. Nothing is mandatory but the reason. */
function ReportProblem({
  sheet, onCancel, onReported, onTap,
}: {
  sheet: TaskSheet;
  onCancel: () => void;
  onReported: () => void;
  onTap: () => void;
}) {
  const [kind, setKind] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!kind) return;
    setBusy(true);
    try {
      await api.reportProblem(sheet.id, {
        kind,
        ...(itemId ? { itemId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onReported();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <button className="back" onClick={onCancel} type="button">‹ Back</button>
      <h1 className="screen-title">Report a problem</h1>
      <p className="screen-sub">
        This goes straight to whoever can fix it. You can stop here.
      </p>

      <div className="group-label">What&rsquo;s wrong?</div>
      {sheet.problemKinds.map((k) => (
        <button
          key={k.key}
          type="button"
          className="row"
          aria-pressed={kind === k.key}
          style={kind === k.key ? { borderColor: 'var(--ink)', borderWidth: 2 } : undefined}
          onClick={() => { onTap(); setKind(k.key); }}
        >
          <div className="row-main"><div className="row-title">{k.label}</div></div>
        </button>
      ))}

      {sheet.items.length > 0 && (
        <>
          <div className="group-label" style={{ marginTop: 22 }}>Which one? (optional)</div>
          {sheet.items.map((i) => (
            <button
              key={i.id}
              type="button"
              className="row"
              aria-pressed={itemId === i.id}
              style={itemId === i.id ? { borderColor: 'var(--ink)', borderWidth: 2 } : undefined}
              onClick={() => { onTap(); setItemId(itemId === i.id ? null : i.id); }}
            >
              <div className="row-main"><div className="row-title">{i.label}</div></div>
            </button>
          ))}
        </>
      )}

      <textarea
        className="field"
        style={{ marginTop: 22 }}
        placeholder="Anything else worth knowing? (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <button className="btn" type="button" disabled={!kind || busy} onClick={() => void send()}>
        {busy ? 'Sending…' : 'Send'}
      </button>
      <button className="btn btn-quiet" type="button" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/**
 * The server refused, but said a recorded reason can unblock it. This is not
 * a way around the rule — it is the rule: the reason is audited and raised to
 * the clinic manager whether or not anyone reports it.
 */
function SayWhy({
  message, busy, onCancel, onConfirm, onReportInstead,
}: {
  message: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  onReportInstead: () => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <div className="screen">
      <button className="back" onClick={onCancel} type="button">‹ Back</button>
      <h1 className="screen-title">Before you finish</h1>

      <div className="notice notice-warn">{message}</div>

      <p className="screen-sub">
        If something is wrong, report it — that&rsquo;s usually the right call. If you&rsquo;ve
        checked another way and it&rsquo;s safe to go ahead, say how. Your manager will see this.
      </p>

      <button className="btn btn-quiet" type="button" onClick={onReportInstead}>
        Report a problem instead
      </button>

      <textarea
        className="field"
        style={{ marginTop: 22 }}
        placeholder="How did you check?"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        className="btn"
        type="button"
        disabled={busy || reason.trim().length === 0}
        onClick={() => onConfirm(reason.trim())}
      >
        {busy ? 'Saving…' : 'Go ahead and finish'}
      </button>
    </div>
  );
}

/**
 * A manager releases one blocked task so the person holding it can finish.
 *
 * The split is the point: the manager decides, the assignee does the work.
 * Neither can do the other's part, and the reason given here is the record —
 * the assignee is never asked to justify a judgement that was not theirs.
 */
function Authorise({
  sheet, onCancel, onAuthorised,
}: {
  sheet: TaskSheet;
  onCancel: () => void;
  onAuthorised: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      await api.authoriseTask(sheet.id, reason.trim());
      onAuthorised();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not go through.');
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <button className="back" onClick={onCancel} type="button">‹ Back</button>
      <h1 className="screen-title">Let this go ahead</h1>
      <div className="notice notice-warn">{sheet.cantConfirm}</div>
      <p className="screen-sub">
        You&rsquo;re saying it is safe to finish <strong>{sheet.title}</strong> without that
        confirmation, just for today. Whoever is doing it will be told they can carry on.
      </p>

      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      <label className="field-label" htmlFor="why-safe">How do you know it&rsquo;s safe?</label>
      <textarea
        id="why-safe"
        className="field"
        placeholder="This is the record, so a sentence that would make sense in six months."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        className="btn"
        type="button"
        disabled={busy || reason.trim().length === 0}
        onClick={() => void submit()}
      >
        {busy ? 'Saving…' : 'Let it go ahead'}
      </button>
      <button className="btn btn-quiet" type="button" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/** Confirmation, and what happens next — stated, not implied. */
function Finished({
  sheet, result, onBack,
}: {
  sheet: TaskSheet;
  result: CompleteResult;
  onBack: () => void;
}) {
  return (
    <div className="screen">
      <div className="empty">
        <div className="empty-big">Done — thank you</div>
        <div>{sheet.title}</div>
      </div>

      {result.outOfRange.length > 0 && (
        <div className="notice notice-warn">
          <div className="notice-title">One reading looked off</div>
          {result.outOfRange.map((o) => (
            <div key={o.label}>{o.label}: {o.value}{o.unit ?? ''}</div>
          ))}
          <div style={{ marginTop: 6 }}>We&rsquo;ve flagged it for your manager.</div>
        </div>
      )}

      <div className="notice notice-calm">
        {result.waitingForCheck
          ? 'Someone else will confirm this shortly. Nothing more for you to do.'
          : 'This one didn’t need a second pair of eyes.'}
      </div>

      <button className="btn" type="button" onClick={onBack}>Back to Today</button>
    </div>
  );
}
