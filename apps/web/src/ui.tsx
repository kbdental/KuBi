/**
 * One vocabulary.
 *
 * The honest reason this file exists: KuBi had twenty-seven screens and forty
 * families of class name. `bf-answer` and `p360-verdict` were the same
 * component built twice, at 22px and 21px, with tone names that did not match
 * (`critical/important/ok` against `is-blocked/is-ready`). The row was built
 * four times — `row`, `bf-item`, `p360-row`, `ops-row`. None of it was wrong
 * on its own screen, and together it looked like four products.
 *
 * So there is now one place where each idea lives, and a rule: if a screen
 * needs something that is not here, it is added here first. A screen may not
 * invent a second way to say a thing that already has a way.
 *
 * The vocabulary is deliberately small, because the hierarchy the owner asked
 * for only has three levels:
 *
 *   Answer   — biggest. What is true right now. One per screen.
 *   Group    — medium. The question behind the answer.
 *   Row      — small. The explanation, and the thing you press.
 *
 * Everything else (Tag, Fact, Empty, Notice, Switch) is furniture that hangs
 * off those three.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { IconGo } from './icons.js';

/* -------------------------------------------------------------------------
 * Tone
 *
 * One scale, used by every component here. The four outcomes of the
 * management model map onto it directly, so a screen never has to translate:
 *
 *   GREEN → good     AMBER → warn     RED → stop     GREY → calm
 *
 * GREY is not zero and is not failure — it is "nothing to measure", and it
 * has to look different from both.
 * ---------------------------------------------------------------------- */

export type Tone = 'good' | 'warn' | 'stop' | 'calm';

const OUTCOME_TONE: Record<string, Tone> = {
  GREEN: 'good', AMBER: 'warn', RED: 'stop', GREY: 'calm',
  PASS: 'good', FAIL: 'stop', UNKNOWN: 'calm', NOT_APPLICABLE: 'calm',
  NOT_CONFIGURED: 'calm',
  OK: 'good', IMPORTANT: 'warn', CRITICAL: 'stop', ROUTINE: 'calm',
  PATIENT_SAFETY: 'stop',
};

/** Translate any of the model's verdict words into the one tone scale. */
export function toneOf(v: string | null | undefined, fallback: Tone = 'calm'): Tone {
  if (!v) return fallback;
  return OUTCOME_TONE[v.toUpperCase()] ?? fallback;
}

/* ---- the page ---------------------------------------------------------- */

/**
 * The page frame.
 *
 * `wide` is for screens that genuinely hold two columns of related work — a
 * clinic list beside a chair, a briefing beside its sections. It is not for
 * screens that merely have a lot on them; those need less on them.
 */
export function Screen({
  wide, back, children,
}: {
  wide?: boolean;
  back?: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`screen${wide ? ' screen-wide' : ''}`}>
      {back && <button className="back" type="button" onClick={back}>Back</button>}
      {children}
    </div>
  );
}

/** Who this screen is for, and the one question it answers. */
export function Title({ children, question }: { children: ReactNode; question?: string }) {
  return (
    <>
      <h1 className="screen-title">{children}</h1>
      {question && <p className="screen-sub">{question}</p>}
    </>
  );
}

/**
 * Two columns on a laptop, stacked on a phone.
 *
 * `main` is the thing being done; `side` is what is still to come. A
 * phone-shaped app blown up to fill a monitor is the thing that makes software
 * look unfinished, so this is in the library rather than in one screen.
 */
export function Columns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="today-columns">
      <div className="today-main">{main}</div>
      <div className="today-side">{side}</div>
    </div>
  );
}

/* ---- level 1: the answer ----------------------------------------------- */

/**
 * The answer. One per screen, and it is the largest thing on it.
 *
 * `verdict` is the state in as few words as will carry it — READY, NOT READY,
 * ON TRACK, BEHIND. `why` is the reason in one sentence. `action` is the
 * single thing to do about it; a screen with two primary actions has none.
 */
export function Answer({
  verdict, why, tone = 'calm', action,
}: {
  verdict: string;
  why?: string;
  tone?: Tone;
  action?: { label: string; onClick: () => void; busy?: boolean };
}) {
  return (
    <div className={`answer answer-${tone}`}>
      <b className="answer-verdict">{verdict}</b>
      {why && <span className="answer-why">{why}</span>}
      {action && (
        <button
          className="btn answer-do"
          type="button"
          disabled={action.busy}
          onClick={action.onClick}
        >
          {action.busy ? 'Working…' : action.label}
        </button>
      )}
    </div>
  );
}

/* ---- level 2: the group ------------------------------------------------ */

/**
 * A titled section. `count` goes in the heading rather than the body, so the
 * eye can size a section without reading it.
 */
export function Group({
  title, count, note, tone, id, children,
}: {
  title: string;
  count?: number;
  note?: string;
  tone?: Tone;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className="group" {...(id ? { id } : {})}>
      <h2 className={`group-title${tone ? ` group-${tone}` : ''}`}>
        {title}
        {count !== undefined && count > 0 && <span className="group-count">{count}</span>}
      </h2>
      {note && <p className="group-note">{note}</p>}
      {children}
    </section>
  );
}

/* ---- level 3: the row -------------------------------------------------- */

/**
 * The universal row — a task, a patient, a lab case, a standard, a batch.
 *
 * It presses if you give it `onOpen` and reads as text if you do not. That
 * distinction matters more than it looks: a control that does nothing when
 * pressed is worse than a line of prose, and four of the old row components
 * disagreed about whether they were buttons.
 *
 * `blockedBy` renders the row as waiting rather than hiding it or offering a
 * button that fails on submit. Naming what it waits for is the whole value.
 */
export function Row({
  title, note, tone, tags, blockedBy, onOpen, right, children,
}: {
  title: ReactNode;
  note?: ReactNode;
  tone?: Tone;
  tags?: ReactNode;
  blockedBy?: string | null;
  onOpen?: () => void;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const cls = [
    'row',
    blockedBy ? 'is-blocked' : '',
    tone && !blockedBy ? `row-${tone}` : '',
    onOpen ? '' : 'row-static',
  ].filter(Boolean).join(' ');

  const body = (
    <>
      <span className="row-main">
        <span className="row-title">{title}</span>
        {blockedBy
          ? <span className="row-note">Waiting for {blockedBy}</span>
          : note && <span className="row-note">{note}</span>}
        {tags && <span className="row-tags">{tags}</span>}
        {children}
      </span>
      {onOpen ? (right ?? <span className="row-go"><IconGo /></span>) : right}
    </>
  );

  if (!onOpen) return <div className={cls}>{body}</div>;
  return <button className={cls} type="button" onClick={onOpen}>{body}</button>;
}

/* ---- furniture --------------------------------------------------------- */

/**
 * A one-word label on a row: which engine raised it, which standard it traces
 * to, what state it is in. Never more than two on a row — past that it is a
 * table, and a table is a different screen.
 */
export function Tag({ children, tone = 'calm', mono }: { children: ReactNode; tone?: Tone; mono?: boolean }) {
  return <span className={`tag tag-${tone}${mono ? ' tag-mono' : ''}`}>{children}</span>;
}

/**
 * A number that explains the answer. If a reader cannot say what they would
 * do differently at a different value, it does not belong on the screen —
 * that rule removed more from KuBi than any other.
 */
export function Fact({ value, label, tone }: { value: ReactNode; label: string; tone?: Tone }) {
  return (
    <div className={`fact${tone ? ` fact-${tone}` : ''}`}>
      <div className="fact-value">{value}</div>
      <div className="fact-label">{label}</div>
    </div>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return <div className="facts">{children}</div>;
}

/** Nothing here — said once, in the words the section would use. */
export function Empty({ children, big }: { children: ReactNode; big?: string }) {
  if (big) {
    return (
      <div className="empty">
        <div className="empty-big">{big}</div>
        <div>{children}</div>
      </div>
    );
  }
  return <p className="empty-line">{children}</p>;
}

/** Something the system needs to say, in place, right now. */
export function Notice({ tone = 'calm', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'stop' ? 'alert' : undefined}>
      {title && <div className="notice-title">{title}</div>}
      {children}
    </div>
  );
}

/**
 * Two or three views of one question — my work against work I check, the
 * clinic today against the clinic this month.
 *
 * Deliberately not tabs: tabs are navigation and live in the shell. This
 * changes what a screen is showing, not where you are.
 */
export function Switch<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
}) {
  return (
    <div className="switch" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          className={`switch-opt${o.value === value ? ' is-on' : ''}`}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && <span className="group-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** The primary thing to do. `quiet` for anything that is not. */
export function Action({
  children, onClick, quiet, danger, busy, disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  quiet?: boolean;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`btn${quiet ? ' btn-quiet' : ''}${danger ? ' btn-danger' : ''}`}
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy ? 'Working…' : children}
    </button>
  );
}

/**
 * Detail, folded away.
 *
 * Progressive disclosure has one rule here: what is hidden must be detail,
 * never a decision. If a reader has to open this to know what to do, it was
 * the wrong thing to hide.
 */
export function More({
  label, open, onToggle, children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <button className="btn btn-quiet" type="button" onClick={onToggle} aria-expanded={open}>
        {open ? 'Hide the detail' : label}
      </button>
      {open && <div className="more">{children}</div>}
    </>
  );
}

/* ---- the journey -------------------------------------------------------- */

export type Step = {
  key: string;
  label: string;
  /** NOW is where the clinic is. BLOCKED says why it cannot move. */
  state: 'DONE' | 'NOW' | 'BLOCKED' | 'WAITING' | 'ABSENT';
  detail?: string | null;
  /** What is standing in the way, by name. Never "incomplete". */
  needs?: string | null;
  act?: { label: string; onClick: () => void; busy?: boolean } | null;
};

const STEP_CLASS: Record<Step['state'], string> = {
  DONE: 'jr-done', NOW: 'jr-now', BLOCKED: 'jr-blocked',
  WAITING: 'jr-waiting', ABSENT: 'jr-absent',
};
const STEP_MARK: Record<Step['state'], string> = {
  DONE: '✓', NOW: '●', BLOCKED: '✗', WAITING: '·', ABSENT: '–',
};

/**
 * A journey — the spine of a screen that follows something through a day.
 *
 * There are three of them in KuBi (open the clinic, treat a patient, close the
 * clinic) and they are the same shape, so they are one component. When it was
 * only Journey 2 it lived inside the patient record and would have been built
 * a second time for the other two, differently, which is how this product got
 * into trouble in the first place.
 *
 * The rule that makes it worth having: the action lives at the step it
 * belongs to. Moving somebody through a morning should not mean leaving the
 * record for a list and coming back.
 */
export function Journey({ steps }: { steps: Step[] }) {
  return (
    <ol className="jr">
      {steps.map((s) => (
        <li key={s.key} className={`jr-step ${STEP_CLASS[s.state]}`}>
          <span className="jr-mark" aria-hidden="true">{STEP_MARK[s.state]}</span>
          <div className="jr-main">
            <div className="jr-label">{s.label}</div>
            {s.detail && <div className="row-note">{s.detail}</div>}
            {s.needs && <div className="jr-needs">{s.needs}</div>}
            {s.act && (
              <button
                className="btn jr-act"
                type="button"
                disabled={s.act.busy}
                onClick={s.act.onClick}
              >
                {s.act.busy ? 'Working…' : s.act.label}
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Load something, and tell the truth about what happened.
 *
 * Five screens independently wrote `catch(() => setThing(null))` and then
 * rendered "Loading…" whenever the thing was null. Against the demo backend
 * that never mattered, because nothing ever failed. Against the real server it
 * meant a screen whose endpoint does not exist yet spun for ever — the
 * software telling a person it is working when it is not, which is the one
 * thing this product is not allowed to do.
 *
 * Three states, never two: waiting, failed, and loaded.
 */
export function useLoad<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList = [],
): { data: T | null; failed: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    setFailed(false);
    let alive = true;
    void fetcher()
      .then((v) => { if (alive) setData(v); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
    // The caller owns when this re-runs. `fetcher` is a fresh closure on every
    // render, so including it would loop for ever — the deps the caller passes
    // are the whole contract.
  }, deps);

  useEffect(reload, [reload]);
  return { data, failed, reload };
}

/**
 * An endpoint this build cannot reach.
 *
 * Says which screen and why, rather than a spinner or a generic apology. The
 * distinction that matters to somebody standing in a clinic: the thing is not
 * broken, it is not there yet.
 */
export function Unavailable({ what }: { what: string }) {
  return (
    <Screen>
      <Notice tone="calm" title="Not available on this server yet">
        {what}
      </Notice>
    </Screen>
  );
}

/** Waiting, and failed. Two lines, said the same way on every screen. */
export function Loading() {
  return <div className="screen"><p className="screen-sub">Loading…</p></div>;
}

export function Failed({ what, back }: { what: string; back?: () => void }) {
  return (
    <Screen {...(back ? { back } : {})}>
      <p className="screen-sub">{what}</p>
    </Screen>
  );
}
