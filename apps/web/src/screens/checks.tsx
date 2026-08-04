import { useEffect, useState } from 'react';
import { api, type CheckRow, type CheckDetail } from '../api.js';
import { Screen, Title, Answer, Group, Row, Tag, Empty, Notice, Action } from '../ui.js';

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

  const list = items.length === 0
    ? <Empty big="Nothing waiting">We’ll bring you anything that needs confirming.</Empty>
    : items.map((item) => (
      <Row
        key={item.id}
        title={item.title}
        note={`Finished at ${new Date(item.completedAt).toLocaleTimeString([], {
          hour: 'numeric', minute: '2-digit',
        })}`}
        onOpen={() => setOpen(item)}
      />
    ));

  // Embedded inside Today, which has already said whose work this is and
  // already carries the answer. Repeating both would be the system saying the
  // same thing twice in two different sizes.
  if (embedded) return <>{list}</>;

  return (
    <Screen>
      <Title>Checks</Title>
      <Answer
        verdict={items.length === 0
          ? 'Nothing to confirm'
          : `${items.length} waiting on you`}
        why={items.length === 0
          ? 'Nobody is held up by a confirmation.'
          : 'Work someone else finished that needs a second pair of eyes.'}
        tone={items.length === 0 ? 'good' : 'warn'}
      />
      {list}
    </Screen>
  );
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
    <Screen back={onCancel}>
      <Title {...(item.standard ? { question: item.standard } : {})}>{item.title}</Title>

      {problem && <Notice tone="stop">{problem}</Notice>}

      {!askingWhy ? (
        <>
          <Group title="What was recorded" note="Have a look for yourself before confirming.">
            {detail
              ? detail.items.map((i) => (
                <Row
                  key={i.id}
                  title={i.label}
                  tone={i.checked ? 'good' : 'calm'}
                  right={(
                    <Tag tone={i.checked ? 'good' : 'calm'}>
                      {i.value != null ? `${i.value}${i.unit ?? ''}` : i.checked ? 'done' : 'not done'}
                    </Tag>
                  )}
                />
              ))
              : (
                <Notice tone="calm">
                  {detailFailed
                    ? 'We could not load what was recorded. Please try again before confirming.'
                    : 'Loading what was recorded…'}
                </Notice>
              )}
          </Group>

          {/* Confirming without having seen the work is the one thing this
              screen exists to prevent, so it waits for the detail to load. */}
          <Action busy={busy} disabled={!detail} onClick={() => void submit('PASS')}>
            Looks right
          </Action>
          <Action quiet disabled={busy} onClick={() => setAskingWhy(true)}>
            Not right
          </Action>
        </>
      ) : (
        <>
          <label className="field-label" htmlFor="what-was-wrong">What wasn’t right?</label>
          <textarea
            id="what-was-wrong"
            className="field"
            placeholder="So the person who did it knows what to fix."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Action
            danger
            busy={busy}
            disabled={comment.trim().length === 0}
            onClick={() => void submit('FAIL')}
          >
            Send it back
          </Action>
          <Action quiet onClick={() => setAskingWhy(false)}>Back</Action>
        </>
      )}
    </Screen>
  );
}
