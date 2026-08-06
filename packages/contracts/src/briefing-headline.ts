/**
 * The one answer at the top of a briefing, and the rule that it must not
 * promise something the screen cannot deliver.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why this file exists
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The owner, using the app: *"a lot of glitches for an assistant — if there is
 * something missing in sterilization and it says take me to it, it goes there
 * but cannot do anything."*
 *
 * They were right, and the cause was exactly what it looked like. The headline
 * offered "Take me to it" for whichever section was worst, without ever asking
 * whether that section contained anything a person could press. For an
 * assistant the worst section was always Sterilisation — a list of batches
 * somebody else owns, rendered as facts, which are deliberately not buttons.
 * So the button scrolled to a red wall and stopped.
 *
 * Two copies of that logic existed, one in the API and one in the demo
 * backend, and both had the bug. That is the second reason this file exists:
 * a rule that decides what a screen promises should have one implementation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The rule
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. The headline names the most serious section that has anything in it.
 *    RED before AMBER; within a tone, the earlier section wins, because
 *    sections are already ordered by how much they matter to this role.
 * 2. It offers an action ONLY if that section contains something this person
 *    can open.
 * 3. When it does not, it says who the work is with instead — and if nobody
 *    knows, it says that too rather than showing a button that does nothing.
 *
 * The tempting shortcut, rejected: when the worst section has no action,
 * quietly headline a lesser section that does. That trades a dead button for
 * a false statement about the clinic, which is a worse bug and a harder one to
 * notice.
 */

/** What the headline needs to know about one row. A subset of BriefingItem. */
export interface HeadlineItem {
  kind: 'task' | 'fact';
  text: string;
  /** Tasks only. A task with no id cannot be opened, whatever its kind says. */
  taskId?: string | null;
  /** Set when the row is waiting on something; such a row is not pressable. */
  blockedBy?: string | null;
  /**
   * Who this sits with, when it is somebody else's work. Job title, never a
   * name — "with the sterilisation technician" survives that person leaving.
   */
  owner?: string | null;
}

export interface HeadlineSection {
  key: string;
  label: string;
  /** GREEN | AMBER | RED. */
  tone: string;
  items: HeadlineItem[];
}

export interface Headline {
  verdict: string;
  why: string;
  tone: string;
  /** The section key to scroll to. Null when there is nothing to press. */
  action: string | null;
  /**
   * Who the headline work is with, when this person cannot act on it. Null
   * when they can act, and null when nobody has said who owns it — those are
   * different states and the screen renders them differently.
   */
  waitingOn: string | null;
}

/** Whether this person can actually open this row. */
export function isActionable(i: HeadlineItem): boolean {
  if (i.blockedBy) return false;         // waiting on something; shown as a lock
  if (i.kind !== 'task') return false;   // a fact is not a button
  return Boolean(i.taskId);
}

/** The first job title named in a section, or null if none is. */
function ownerOf(items: readonly HeadlineItem[]): string | null {
  return items.find((i) => i.owner)?.owner ?? null;
}

export function headlineFor(sections: readonly HeadlineSection[]): Headline {
  const live = sections.filter((s) => s.items.length > 0);
  const worst = live.find((s) => s.tone === 'RED')
    ?? live.find((s) => s.tone === 'AMBER')
    ?? null;

  if (!worst) {
    return {
      verdict: 'All clear',
      why: 'Nothing needs you right now.',
      tone: 'GREEN',
      action: null,
      waitingOn: null,
    };
  }

  const canAct = worst.items.some(isActionable);
  const owner = canAct ? null : ownerOf(worst.items);

  const why = worst.items.length === 1
    ? worst.items[0]!.text
    : `${worst.items.length} things — ${worst.items[0]!.text} and ${worst.items.length - 1} more`;

  return {
    verdict: worst.label,
    tone: worst.tone,
    // Said in the same sentence rather than in a tooltip: a person reading a
    // red headline needs to know within one line whether it is theirs.
    why: canAct
      ? why
      : owner
        ? `${why} — with the ${owner}`
        : `${why}. Nothing here is yours to do.`,
    action: canAct ? worst.key : null,
    waitingOn: owner,
  };
}
