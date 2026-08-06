/**
 * The patients who stopped coming.
 *
 * The owner's line: *"Dr's to do follow up with existing patient and patient
 * that have come but not started treatment or not coming back for any reason
 * to be done more effectively."* Thirty days is theirs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this screen refuses to be
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A sales list. It would be easy to sort by the value of the untaken plan and
 * put a rupee figure at the top, and it would be a worse screen: the first
 * call of the morning should be the patient with the unfinished root canal,
 * not the patient with the expensive one. So the order is clinical — treatment
 * left open first, then longest gone — and no money appears anywhere.
 *
 * The answer at the top is the count of open treatments, not the count of
 * patients, for the same reason.
 */
import { useState } from 'react';
import { api, type RetentionItem, type OutreachOutcome } from '../api.js';
import {
  Screen, Title, Answer, Group, Row, Tag, Empty, Notice, Action, Facts, Fact,
  useLoad, Loading, Unavailable,
} from '../ui.js';

const REASON_WORD: Record<string, string> = {
  STOPPED_MID_TREATMENT: 'Treatment unfinished',
  NEVER_STARTED: 'Never started',
};

/**
 * What each answer means, said plainly enough that the person on the phone
 * picks the right one without a manual.
 *
 * The order matters: the two that close the loop honestly come first, and
 * "couldn't reach" sits at the end where it belongs — it is not an outcome,
 * it is the absence of one.
 */
const OUTCOMES: Array<{ code: OutreachOutcome; label: string; hint: string }> = [
  { code: 'RETURNING', label: 'Coming back', hint: 'Booked, or agreed to book' },
  { code: 'DECLINED', label: 'Not coming back', hint: 'Said no. They will not be asked again.' },
  { code: 'WILL_DECIDE', label: 'Thinking about it', hint: 'Returns to this list in two weeks' },
  { code: 'NOT_APPLICABLE', label: 'Does not apply', hint: 'Treated elsewhere, or the record is wrong' },
  { code: 'NO_ANSWER', label: 'No answer', hint: 'Stays on the list — nobody has spoken to them' },
  { code: 'UNREACHABLE', label: 'Number is wrong', hint: 'Reception needs to fix the contact details' },
];

export function Retention() {
  const { data, failed, reload } = useLoad(() => api.retention(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (failed) return <Unavailable what="the retention list" />;
  if (!data) return <Loading />;

  const { items, summary, dormantAfterDays } = data;
  const midTreatment = items.filter((i) => i.reason === 'STOPPED_MID_TREATMENT');
  const neverStarted = items.filter((i) => i.reason === 'NEVER_STARTED');

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      reload();
      setOpen(null);
    } catch (e) {
      // Shown rather than swallowed. The most likely message here is "somebody
      // is already following this patient up", which is information the doctor
      // needs before they dial, not a failure to hide.
      setProblem(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <Screen>
        <Title question="Who has stopped coming?">Patients to follow up</Title>
        <Empty big="Nobody has gone quiet">
          Every patient with treatment outstanding has been seen or is booked in
          within {dormantAfterDays} days.
        </Empty>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title question="Who has stopped coming?">Patients to follow up</Title>

      {/* The answer is treatments left open, not patients on a list. A patient
          who declines is a closed loop; an open tooth is not. */}
      <Answer
        verdict={midTreatment.length === 0
          ? 'Nobody is mid-treatment and out of contact'
          : `${midTreatment.length} treatment${midTreatment.length === 1 ? '' : 's'} left unfinished`}
        why={midTreatment.length === 0
          ? `${items.length} patients have a plan they never began.`
          : 'These patients started something and stopped coming.'}
        tone={midTreatment.length > 0 ? 'stop' : 'calm'}
      />

      {summary && (
        <Facts>
          <Fact value={items.length} label={`quiet over ${dormantAfterDays} days`} />
          <Fact value={summary.contactedThisMonth} label="called this month" />
          <Fact value={summary.returningThisMonth} label="coming back" />
        </Facts>
      )}

      {problem && <Notice tone="stop" title="That did not work">{problem}</Notice>}

      <Group
        title="Treatment left unfinished"
        count={midTreatment.length}
        note="Clinical first. An unfinished root canal is an open tooth, not a lost sale."
        {...(midTreatment.length > 0 ? { tone: 'stop' as const } : {})}
      >
        {midTreatment.length === 0
          ? <Empty>Nobody is mid-treatment and out of contact.</Empty>
          : midTreatment.map((i) => (
            <Patient
              key={i.patientId} i={i} busy={busy}
              open={open === i.patientId}
              onOpen={() => setOpen(open === i.patientId ? null : i.patientId)}
              onClaim={() => act(() => api.openRetention(i.patientId))}
              onRecord={(o, note) => act(() => api.recordRetention(i.outreach!.id, o, note))}
            />
          ))}
      </Group>

      <Group
        title="Planned, never begun"
        count={neverStarted.length}
        note="They were given a plan and did not start it. Worth knowing why."
      >
        {neverStarted.length === 0
          ? <Empty>Every plan has been started.</Empty>
          : neverStarted.map((i) => (
            <Patient
              key={i.patientId} i={i} busy={busy}
              open={open === i.patientId}
              onOpen={() => setOpen(open === i.patientId ? null : i.patientId)}
              onClaim={() => act(() => api.openRetention(i.patientId))}
              onRecord={(o, note) => act(() => api.recordRetention(i.outreach!.id, o, note))}
            />
          ))}
      </Group>
    </Screen>
  );
}

function Patient({ i, open, busy, onOpen, onClaim, onRecord }: {
  i: RetentionItem;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onClaim: () => void;
  onRecord: (outcome: OutreachOutcome, note?: string) => void;
}) {
  const [note, setNote] = useState('');

  return (
    <>
      <Row
        title={i.patientLabel}
        note={`${i.stake} · last seen ${i.daysSinceLastVisit} days ago`}
        {...(i.reason === 'STOPPED_MID_TREATMENT' ? { tone: 'stop' as const } : {})}
        tags={(
          <>
            <Tag mono>{i.uhid}</Tag>
            <Tag tone={i.reason === 'STOPPED_MID_TREATMENT' ? 'stop' : 'warn'}>
              {REASON_WORD[i.reason]}
            </Tag>
            {/* Somebody has already picked this up. Shown before the doctor
                dials, because the second call is the one the patient minds. */}
            {i.outreach && (
              <Tag tone="warn">
                {i.outreach.contactedAt ? 'called, still open' : 'being followed up'}
              </Tag>
            )}
          </>
        )}
        onOpen={onOpen}
      />

      {open && (
        <div style={{ padding: '0 0 16px 16px' }}>
          {!i.outreach
            ? (
              <Action onClick={onClaim} disabled={busy}>
                I will call {i.patientLabel}
              </Action>
            )
            : (
              <>
                {i.outreach.note && (
                  <Notice title="Last time">{i.outreach.note}</Notice>
                )}
                <p className="screen-sub">What did they say?</p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="In their words if you can — &ldquo;the crown cost more than the car repair&rdquo; is information; &ldquo;declined&rdquo; is not."
                  rows={2}
                  style={{ width: '100%', maxWidth: 520, marginBottom: 12, padding: 8, fontSize: 15 }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {OUTCOMES.map((o) => (
                    <Action
                      key={o.code}
                      onClick={() => onRecord(o.code, note.trim() || undefined)}
                      disabled={busy}
                    >
                      {o.label}
                    </Action>
                  ))}
                </div>
                {/* What each answer does, said once under the row rather than
                    hidden in a tooltip nobody on a phone can reach. */}
                <ul className="screen-sub" style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                  {OUTCOMES.map((o) => (
                    <li key={o.code}><b>{o.label}</b> — {o.hint}</li>
                  ))}
                </ul>
              </>
            )}
        </div>
      )}
    </>
  );
}
