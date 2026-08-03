import { useEffect, useState } from 'react';
import { api, type CheckRow, type CheckDetail } from '../api.js';
import { IconGo, IconTick } from '../icons.js';

/**
 * CHECKS — work someone else finished that needs a second pair of eyes.
 *
 * The list only ever contains other people's work: the server filters out
 * anything this person completed themselves, and refuses it again if asked
 * directly. Segregation of duties is not something this screen implements —
 * it is something this screen can rely on.
 *
 * Saying "not right" is deliberately as easy as saying "looks right". A
 * confirmation that is easier to give than to withhold is not a check.
 *
 * Usability review Q5: the checker now sees each item as it was actually
 * recorded. Confirming without seeing what was claimed is a signature, not a
 * check. Names stay off this screen (Q6) — what was done is the question here,
 * not who did it.
 */
export function Checks({
  items, onDone, embedded = false,
}: {
  items: CheckRow[];
  onDone: () => void;
  /** Rendered inside Today, which already asks "what is my work". */
  embedded?: boolean;
}) {
  const [open, setOpen] = useState<CheckRow | null>(null);

  if (open) return <OneCheck item={open} onCancel={() => setOpen(null)} onDone={onDone} />;

  const body = (
    <>
      <h1 className="screen-title">Checks</h1>
      <p className="screen-sub">
        {items.length === 0 ? 'Nothing to confirm.' : 'Work waiting on your confirmation.'}
      </p>

      {items.length === 0 && (
        <div className="empty">
          <div className="empty-big">Nothing waiting</div>
          <div>We&rsquo;ll bring you anything that needs confirming.</div>
        </div>
      )}

      {items.map((item) => (
        <button key={item.id} className="row" type="button" onClick={() => setOpen(item)}>
          <div className="row-main">
            <div className="row-title">{item.title}</div>
            <div className="row-note">
              Finished at {new Date(item.completedAt).toLocaleTimeString([], {
                hour: 'numeric', minute: '2-digit',
              })}
            </div>
          </div>
          <span className="row-go"><IconGo /></span>
        </button>
      ))}
    </>
  );

  if (embedded) return body;
  return <div className="screen">{body}</div>;
}

function OneCheck({
  item, onCancel, onDone,
}: {
  item: CheckRow;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [askingWhy, setAskingWhy] = useState(false);
  const [detail, setDetail] = useState<CheckDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api.check(item.id)
      .then((d) => { if (live) setDetail(d); })
      .catch(() => { if (live) setDetailFailed(true); });
    return () => { live = false; };
  }, [item.id]);

  async function submit(result: 'PASS' | 'FAIL') {
    setBusy(true);
    setProblem(null);
    try {
      await api.submitCheck(item.id, result, comment.trim() || undefined);
      onDone();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not go through. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <button className="back" onClick={onCancel} type="button">‹ Checks</button>
      <h1 className="screen-title">{item.title}</h1>
      {item.standard && <p className="screen-sub">{item.standard}</p>}

      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      {!askingWhy ? (
        <>
          <div className="group-label" style={{ marginTop: 18 }}>What was recorded</div>
          {detail
            ? detail.items.map((i) => (
                <div key={i.id} className="recorded">
                  <span
                    className={i.checked ? 'recorded-mark is-yes' : 'recorded-mark is-no'}
                    aria-hidden="true"
                  >
                    {i.checked ? <IconTick size={14} /> : '—'}
                  </span>
                  <span className="recorded-label">{i.label}</span>
                  {i.value != null && (
                    <span className="recorded-value">{i.value}{i.unit ?? ''}</span>
                  )}
                </div>
              ))
            : (
              <div className="notice notice-calm">
                {detailFailed
                  ? 'We could not load what was recorded. Please try again before confirming.'
                  : 'Loading what was recorded…'}
              </div>
            )}

          <div className="notice notice-calm" style={{ marginTop: 16 }}>
            Have a look for yourself before confirming.
          </div>
          {/* Confirming without having seen the work is the one thing this
              screen exists to prevent, so it waits for the detail to load. */}
          <button
            className="btn"
            type="button"
            disabled={busy || !detail}
            onClick={() => void submit('PASS')}
          >
            {busy ? 'Saving…' : 'Looks right'}
          </button>
          <button
            className="btn btn-quiet"
            type="button"
            disabled={busy}
            onClick={() => setAskingWhy(true)}
          >
            Not right
          </button>
        </>
      ) : (
        <>
          <label className="field-label" htmlFor="what-was-wrong">What wasn&rsquo;t right?</label>
          <textarea
            id="what-was-wrong"
            className="field"
            placeholder="So the person who did it knows what to fix."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            className="btn btn-danger"
            type="button"
            disabled={busy || comment.trim().length === 0}
            onClick={() => void submit('FAIL')}
          >
            {busy ? 'Saving…' : 'Send it back'}
          </button>
          <button className="btn btn-quiet" type="button" onClick={() => setAskingWhy(false)}>
            Back
          </button>
        </>
      )}
    </div>
  );
}
