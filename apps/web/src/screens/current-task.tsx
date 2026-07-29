import { useEffect, useState } from 'react';
import { api, ApiError, type TaskSheet } from '../api.js';

/**
 * The thing being done right now, open on TODAY rather than one tap away.
 *
 * This exists because of a challenge worth taking seriously: opening the
 * clinic cost 7 taps, and 2 of those were not work. Five of them are — each
 * tick is a person asserting that something is actually true, and removing any
 * of those is how a checklist turns into a signature. The other two were
 * overhead: one to open the task, one to finish it. This removes the first.
 *
 * The shape follows from the morning, not from the screen: a person arriving
 * at 9:40 does not want a list of things to choose between. There is one thing
 * happening, and it should already be in front of them.
 *
 * Anything that is not the straightforward case — a blocked task, a
 * requirement that cannot be confirmed, reporting a problem — hands off to the
 * full task screen. Those need room, and cramming them in here would trade a
 * saved tap for a worse decision.
 */
export function CurrentTask({
  taskId, onOpenFull, onDone,
}: {
  taskId: string;
  onOpenFull: (id: string) => void;
  onDone: () => void;
}) {
  const [sheet, setSheet] = useState<TaskSheet | null>(null);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let live = true;
    setSheet(null);
    setRefusal(null);
    api.task(taskId)
      .then((s) => {
        if (!live) return;
        setSheet(s);
        setTicks(Object.fromEntries(s.items.map((i) => [i.id, i.checked])));
        setValues(Object.fromEntries(s.items.map((i) => [i.id, i.value == null ? '' : String(i.value)])));
        setStarted(s.status === 'IN_PROGRESS');
      })
      .catch(() => { /* Today still renders; the row below opens it properly. */ });
    return () => { live = false; };
  }, [taskId]);

  if (!sheet) return null;

  // Edge cases belong on the full screen, where there is room to explain them.
  // But "one thing in front of you" still holds: rather than disappearing, the
  // task says what it is and opens properly. Losing a saved tap is the right
  // trade when the alternative is a cramped decision about patient safety.
  const needsFullScreen = sheet.cantConfirm !== null || sheet.blockedBy !== null
    || sheet.items.length === 0;

  if (needsFullScreen) {
    return (
      <section className="current">
        <div className="current-label">Happening now</div>
        <h2 className="current-title">{sheet.title}</h2>
        {sheet.cantConfirm && <div className="notice notice-warn">{sheet.cantConfirm}</div>}
        {sheet.blockedBy && (
          <div className="notice notice-warn">
            <div className="notice-title">This is on hold</div>
            {sheet.blockedBy}
          </div>
        )}
        <button className="btn" type="button" onClick={() => onOpenFull(taskId)}>
          Open this
        </button>
      </section>
    );
  }

  const ticked = sheet.items.filter((i) => ticks[i.id]).length;
  const all = ticked === sheet.items.length;

  async function toggle(id: string) {
    if (!started) {
      setStarted(true);
      await api.startTask(taskId).catch(() => undefined);
    }
    setTicks((t) => ({ ...t, [id]: !t[id] }));
  }

  async function finish() {
    if (!sheet) return;
    setBusy(true);
    setRefusal(null);
    try {
      await api.completeTask(taskId, {
        responses: sheet.items.map((i) => {
          const raw = values[i.id];
          const n = i.requiresValue && raw ? Number(raw) : undefined;
          return {
            itemId: i.id,
            checked: ticks[i.id] ?? false,
            ...(n !== undefined && Number.isFinite(n) ? { numericValue: n } : {}),
          };
        }),
        taps: sheet.items.length + 1,
      });
      onDone();
    } catch (err) {
      // A refusal needs the full screen: it comes with choices.
      if (err instanceof ApiError && err.status === 409) onOpenFull(taskId);
      else setRefusal('We could not save that just now. Please try again.');
      setBusy(false);
    }
  }

  return (
    <section className="current">
      <div className="current-label">Happening now</div>
      <h2 className="current-title">{sheet.title}</h2>

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

      {refusal && <div className="notice notice-stop" role="alert">{refusal}</div>}

      {sheet.items.map((item) => (
        <button
          key={item.id}
          className="tick"
          type="button"
          aria-pressed={ticks[item.id] ? 'true' : 'false'}
          onClick={() => void toggle(item.id)}
        >
          <span className="tick-box" aria-hidden="true">✓</span>
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
      ))}

      <button className="btn" type="button" disabled={busy || !all} onClick={() => void finish()}>
        {busy ? 'Saving…' : 'Finish'}
      </button>
      <button className="btn btn-quiet" type="button" onClick={() => onOpenFull(taskId)}>
        Report a problem
      </button>
    </section>
  );
}
