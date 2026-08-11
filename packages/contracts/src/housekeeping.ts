/**
 * HK-001 to HK-014 — cleanliness and housekeeping.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why this one needed unpicking before it could be built
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The owner: *"I would like to have a clean picture of the clinic readiness
 * module with no confusion and overlap… there should be clean demarcation of
 * who is doing what so that the dashboard shows a proper percentage of clinic
 * readiness."*
 *
 * That instruction arrived with this matrix, and the two things are connected:
 * this matrix is where the overlap comes from. The clinic now has two
 * documents describing the same physical work in the same room at the same
 * hour, written by different people and giving it to different roles:
 *
 *   HK-001    Treatment-room cleaning · Opening · Doer **Housekeeping**,
 *             Checker **Assistant**
 *   §2.1      Operatory preparation · before first patient · twenty-four
 *             disinfection actions · Doer **Dental assistant**
 *
 * Neither is wrong. They are two halves of one morning that nobody had written
 * down as halves. Adding both as blocks would have made the readiness
 * percentage count the same room twice; picking one would have quietly deleted
 * somebody's job. So `HK_OVERLAPS` names every place the two documents touch,
 * says which reading KuBi has taken, and marks the ones that are genuinely the
 * owner's to settle.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The demarcation, in one sentence
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **Housekeeping cleans the room. The assistant disinfects the clinical
 * surfaces and sets it up. The assistant checks the first before starting the
 * second.**
 *
 * That is not invented — it is what the matrix already says when the two rows
 * are read together. HK-001 names the Assistant as *Checker* of housekeeping's
 * work, and HK-002 gives her the chair surfaces outright. The handover was
 * always in the document; it had never been drawn.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Fourteen controls, and only some of them are the morning
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Three trigger at opening and gate it. The rest are *scheduled*, *daily* or
 * *after use*, and a system that put all fourteen in front of somebody at
 * 08:45 would be showing them the plants alongside the hand wash. They are
 * tracked, they are measured — the owner's four KPIs are computed from them —
 * and they do not hold the door.
 */
import { RoleCode } from './enums.js';

/* -------------------------------------------------------------------------
 * The matrix's own priority letters
 * ---------------------------------------------------------------------- */

/**
 * PS · C · I · R, as every one of the owner's matrices uses them.
 *
 * Formalised here because this is the first matrix where the letter changes
 * what the engine does: a `C` washroom with no soap holds the clinic and an
 * `R` unwatered plant does not, and until now that judgement lived in whoever
 * was reading the table.
 */
export const ControlPriority = {
  /** Patient safety. No override path exists, by design. */
  PS: 'PS',
  /** Critical. The clinic does not open without it. */
  C: 'C',
  /** Important. Tracked, chased, and does not hold the door. */
  I: 'I',
  /** Routine. Real work, measured, never urgent. */
  R: 'R',
} as const;
export type ControlPriority = (typeof ControlPriority)[keyof typeof ControlPriority];

/** Whether a control's failure stops the clinic opening. */
export const gatesOpening = (p: ControlPriority): boolean =>
  p === ControlPriority.PS || p === ControlPriority.C;

/* -------------------------------------------------------------------------
 * Where the work happens — which is how the KPIs are grouped
 * ---------------------------------------------------------------------- */

/**
 * The owner's four KPIs are about places, not about people.
 *
 *   *"Housekeeping Compliance %, Treatment-Room Hygiene %, Washroom
 *   Compliance %, Failed Hygiene Audits."*
 *
 * Two of those name an area, so area has to be a field rather than something
 * inferred from a control's wording. A KPI computed by matching on the word
 * "toilet" is a KPI that breaks the first time somebody writes "washroom".
 */
export const HygieneArea = {
  TREATMENT_ROOM: 'TREATMENT_ROOM',
  WASHROOM: 'WASHROOM',
  SHARED: 'SHARED',
  RECEPTION: 'RECEPTION',
  PANTRY: 'PANTRY',
} as const;
export type HygieneArea = (typeof HygieneArea)[keyof typeof HygieneArea];

export const HYGIENE_AREA_LABEL: Readonly<Record<HygieneArea, string>> = {
  TREATMENT_ROOM: 'Treatment rooms',
  WASHROOM: 'Washroom',
  SHARED: 'Shared areas',
  RECEPTION: 'Reception',
  PANTRY: 'Staff dining',
};

/** When it is due, which decides whether it is anybody's job this morning. */
export const HygieneTrigger = {
  /** Before the first patient. Part of the morning and counted in it. */
  OPENING: 'OPENING',
  /** Between patients, in the room that just emptied. */
  TURNOVER: 'TURNOVER',
  /** Once a day, at no fixed hour. */
  DAILY: 'DAILY',
  /** On a written round — twice a day, hourly, whatever the schedule says. */
  SCHEDULED: 'SCHEDULED',
  /** After the thing has been used, or at closing. */
  AFTER_USE: 'AFTER_USE',
} as const;
export type HygieneTrigger = (typeof HygieneTrigger)[keyof typeof HygieneTrigger];

/* -------------------------------------------------------------------------
 * The fourteen controls
 * ---------------------------------------------------------------------- */

export interface HygieneControl {
  id: string;
  activity: string;
  standard: string;
  trigger: HygieneTrigger;
  /**
   * Who does it.
   *
   * One role. Where the matrix names two — HK-012 *"Staff/HK"*, HK-013
   * *"HK/Reception"* — the second goes in `alsoDoneBy` and the row is listed
   * in `HK_OVERLAPS` as an open question, because "either of you" is how a job
   * ends up belonging to nobody.
   */
  doer: RoleCode;
  alsoDoneBy: RoleCode | null;
  /** The second signature the matrix asks for, where it asks for one. */
  checker: RoleCode | null;
  area: HygieneArea;
  priority: ControlPriority;
  /** What happens when it fails, in the matrix's own words. */
  failure: string;
  /**
   * The readiness block that carries it, or null.
   *
   * This is the anti-double-counting field. Three controls gate the morning
   * and each names exactly one block; every other control names null and is
   * measured without being counted in clinic readiness. A control that named
   * two blocks would be the overlap coming back.
   */
  opensAs: string | null;
  /** Said to whoever finds it undone. */
  ifUndone: string;
}

const hk = (
  id: string, activity: string, standard: string, trigger: HygieneTrigger,
  doer: RoleCode, checker: RoleCode | null, area: HygieneArea,
  priority: ControlPriority, failure: string, ifUndone: string,
  opensAs: string | null = null, alsoDoneBy: RoleCode | null = null,
): HygieneControl =>
  ({ id, activity, standard, trigger, doer, alsoDoneBy, checker, area, priority, failure, opensAs, ifUndone });

const HK = RoleCode.HOUSEKEEPING;
const ASST = RoleCode.DENTAL_ASSISTANT;
const MGR = RoleCode.CLINIC_MANAGER;
const RCP = RoleCode.RECEPTION;

export const HYGIENE_CONTROLS: readonly HygieneControl[] = [
  hk('HK-001', 'Treatment-room cleaning', 'Clean before operations',
    HygieneTrigger.OPENING, HK, ASST, HygieneArea.TREATMENT_ROOM, ControlPriority.C,
    'Room readiness fails',
    'The rooms have not been cleaned, so there is nothing for the assistant to '
    + 'disinfect and set up on top of',
    // The one housekeeping block the morning cannot open without, and the
    // first half of the handover described at the top of this file.
    'HK_ROOMS'),

  hk('HK-002', 'Dental chair surfaces', 'Clean and disinfected',
    HygieneTrigger.TURNOVER, ASST, null, HygieneArea.TREATMENT_ROOM, ControlPriority.PS,
    'Patient turnover blocked',
    'The chair has not been disinfected, and nobody may be seated on it',
    // Already inside "Prepare Operatory N" at opening — one of the owner's
    // twenty-four actions. Named here rather than given a block of its own,
    // because the same surface cannot be two blocks.
    null),

  hk('HK-003', 'Slabs and worktops', 'Clean and disinfected',
    HygieneTrigger.SCHEDULED, ASST, null, HygieneArea.TREATMENT_ROOM, ControlPriority.C,
    'Exception',
    'Worktops have not been wiped down since the last round'),

  hk('HK-004', 'Mirrors and glass', 'Clean',
    HygieneTrigger.DAILY, HK, null, HygieneArea.SHARED, ControlPriority.R,
    'Exception',
    'Mirrors and glass have not been done today'),

  hk('HK-005', 'Floors', 'Clean and dry',
    HygieneTrigger.SCHEDULED, HK, null, HygieneArea.SHARED, ControlPriority.I,
    'Exception',
    'The floors have not been done since the last round — and a wet floor is '
    + 'its own hazard, so "dry" is half the standard'),

  hk('HK-006', 'Door handles', 'Clean and disinfected',
    HygieneTrigger.SCHEDULED, HK, null, HygieneArea.SHARED, ControlPriority.I,
    'Exception',
    'Door handles have not been wiped since the last round'),

  hk('HK-007', 'Switches and high-touch surfaces', 'Clean',
    HygieneTrigger.SCHEDULED, HK, null, HygieneArea.SHARED, ControlPriority.I,
    'Exception',
    'High-touch surfaces have not been wiped since the last round'),

  hk('HK-008', 'Washbasins and taps', 'Clean and functioning',
    HygieneTrigger.SCHEDULED, HK, null, HygieneArea.WASHROOM, ControlPriority.I,
    'Maintenance ticket if defective',
    'The basins have not been done — and this control asks two questions, '
    + 'clean and working, of which only the second raises a ticket'),

  hk('HK-009', 'Toilets', 'Clean and hygienic',
    HygieneTrigger.SCHEDULED, HK, MGR, HygieneArea.WASHROOM, ControlPriority.I,
    'Alert',
    'The toilets have not been done since the last round'),

  hk('HK-010', 'Soap and hand wash', 'Available',
    HygieneTrigger.SCHEDULED, HK, null, HygieneArea.WASHROOM, ControlPriority.C,
    'Refill task',
    'There is no hand wash. Hand hygiene is the one infection control every '
    + 'other one rests on, and it cannot be done without soap',
    // C, and it earns it. The hand hygiene protocol the clinic already has is
    // unperformable without this, so it holds the door.
    'WASHROOM_STOCK'),

  hk('HK-011', 'Toilet paper and tissue', 'Available',
    HygieneTrigger.SCHEDULED, HK, null, HygieneArea.WASHROOM, ControlPriority.I,
    'Refill task',
    'The washroom is out of paper'),

  hk('HK-012', 'Staff dining area', 'Clean',
    HygieneTrigger.AFTER_USE, HK, null, HygieneArea.PANTRY, ControlPriority.R,
    'Exception',
    'The staff dining area has not been cleared after use',
    null, RoleCode.SENIOR_ASSISTANT),

  hk('HK-013', 'Reception', 'Clean and organised',
    HygieneTrigger.OPENING, HK, null, HygieneArea.RECEPTION, ControlPriority.I,
    'Exception',
    'Reception has not been cleaned and tidied',
    // Deliberately not a block. The waiting area already has one, owned by
    // reception, and this row names two doers — see HK_OVERLAPS.
    null, RCP),

  hk('HK-014', 'Plants', 'Watered according to schedule',
    HygieneTrigger.SCHEDULED, HK, null, HygieneArea.SHARED, ControlPriority.R,
    'Reminder',
    'The plants have not been watered on schedule'),
];

export const HYGIENE_BY_ID: ReadonlyMap<string, HygieneControl> =
  new Map(HYGIENE_CONTROLS.map((c) => [c.id, c]));

/* -------------------------------------------------------------------------
 * Where the two documents describe the same work
 * ---------------------------------------------------------------------- */

export interface Overlap {
  /** The housekeeping control. */
  hk: string;
  /** The opening block or procedure section it touches. */
  opening: string;
  what: string;
  /** What KuBi does about it today. */
  taken: string;
  /** True when the owner still has to settle it. */
  open: boolean;
}

/**
 * Every place the housekeeping matrix and the opening procedure meet.
 *
 * The register exists so that "no confusion and overlap" is a thing a test can
 * check rather than a thing somebody remembers. Four of these are resolved by
 * reading the two documents together; one is not, and is marked `open` rather
 * than resolved quietly.
 */
export const HK_OVERLAPS: readonly Overlap[] = [
  {
    hk: 'HK-001', opening: 'OPERATORY:* — Prepare each operatory',
    what: 'Both describe work in the treatment room before the first patient, '
      + 'and they give it to different roles.',
    taken: 'Split, on the matrix\'s own words: housekeeping cleans the room '
      + '(HK_ROOMS), then the assistant disinfects the clinical surfaces and '
      + 'sets up (OPERATORY). HK-001 names the assistant as Checker, which is '
      + 'that handover — she inspects what housekeeping did before starting.',
    open: false,
  },
  {
    hk: 'HK-002', opening: 'OPERATORY:* — the chair, one of the 24 actions',
    what: 'The chair surfaces appear in both, and in both they belong to the '
      + 'assistant.',
    taken: 'No second block. At opening it is one line of the operatory block; '
      + 'HK-002 adds the turnover run between patients, which opening has no '
      + 'concept of. The same surface may not be two blocks.',
    open: false,
  },
  {
    hk: 'HK-005, HK-004', opening: 'COMMON_AREAS — floors, pantry, washroom',
    what: 'The floors are in both, with the same role.',
    taken: 'COMMON_AREAS is the opening pass and counts towards readiness; '
      + 'HK-005 is the scheduled repeat during the day and does not.',
    open: false,
  },
  {
    hk: 'HK-008 to HK-011', opening: 'COMMON_AREAS — the washroom',
    what: 'The washroom is cleaned in the morning pass and stocked on a round.',
    taken: 'Cleaning stays in COMMON_AREAS. Only the hand wash is separated '
      + 'out (WASHROOM_STOCK) because it is the one C on the washroom rows and '
      + 'the hand hygiene protocol cannot run without it.',
    open: false,
  },
  {
    hk: 'HK-013', opening: 'RECEPTION — ready the waiting and billing area',
    what: 'HK-013 names two doers — "HK/Reception" — for an area that already '
      + 'has a block owned by reception.',
    taken: 'Left as a tracked control with no block, so nothing is counted '
      + 'twice. Who actually cleans reception in the morning is not settled, '
      + 'and "either of you" is how a job ends up belonging to nobody.',
    open: true,
  },
];

/** The overlaps the owner still has to settle. */
export const OPEN_OVERLAPS = HK_OVERLAPS.filter((o) => o.open);

/**
 * The questions this matrix raises that KuBi will not answer for itself.
 *
 * Constitution rule 4. Each one changes what the engine reports and each has
 * more than one defensible answer.
 */
export const HYGIENE_QUESTIONS: readonly string[] = [
  'HK-013 — who cleans reception in the morning, housekeeping or reception? '
  + 'The matrix names both, and a job named to two people is a job named to '
  + 'nobody.',
  'HK-012 — staff dining is "after use / closing". Is it a closing block, or '
  + 'is it done whenever the last person leaves the room?',
  '"Scheduled" is the trigger on seven of these fourteen and no schedule '
  + 'exists. Twice a day, hourly, or on a written round? Until that is set, '
  + 'KuBi can report that a round happened and cannot report that one is late.',
  'HK-001 — does housekeeping clean the treatment rooms before the assistants '
  + 'arrive, or alongside them? The morning is fifty minutes and this decides '
  + 'whether the two jobs are in series or in parallel.',
];

/* -------------------------------------------------------------------------
 * What was reported
 * ---------------------------------------------------------------------- */

/** One round, done and signed by somebody. */
export interface HygieneReport {
  controlId: string;
  at: number;
  byEmployeeCode: string;
  /** The room, where the control is per-room. Null for a clinic-wide one. */
  subjectId: string | null;
  /** HK-008's second question. Null where the control does not ask it. */
  defectFound: boolean | null;
  note: string | null;
}

/** The checker's signature, where the matrix asks for one. */
export interface HygieneCheck {
  controlId: string;
  at: number;
  byEmployeeCode: string;
  byRole: RoleCode;
  /** False when the checker looked and was not satisfied. A real outcome. */
  passed: boolean;
  note: string | null;
}

/* -------------------------------------------------------------------------
 * What the engine says
 * ---------------------------------------------------------------------- */

export const HygieneState = {
  /** Done, and checked where a checker is named. */
  DONE: 'DONE',
  /** Done, and the named checker has not looked yet. */
  AWAITING_CHECK: 'AWAITING_CHECK',
  /** The checker looked and failed it. This is what a failed audit is. */
  FAILED_CHECK: 'FAILED_CHECK',
  /** Not reported. Never a pass. */
  NOT_DONE: 'NOT_DONE',
  /**
   * Not due yet.
   *
   * A turnover control at 08:50 is not outstanding — nobody has left a chair.
   * Reporting it as undone every morning is how a list stops being read.
   */
  NOT_DUE: 'NOT_DUE',
} as const;
export type HygieneState = (typeof HygieneState)[keyof typeof HygieneState];

export interface ControlResult {
  control: HygieneControl;
  state: HygieneState;
  /** Whether this state stops the clinic opening. */
  blocksOpening: boolean;
  doneAt: number | null;
  doneBy: string | null;
  checkedBy: string | null;
  /** HK-008 raised a maintenance ticket. */
  defect: boolean;
  because: string;
}

/**
 * The owner's four KPIs, plus the denominators they were computed over.
 *
 * The denominator travels with the number on purpose. "82%" over eleven
 * controls and "82%" over two are different statements, and a dashboard that
 * shows only the percentage lets the second pass as the first.
 */
export interface HygieneKpi {
  label: string;
  /** Null when there is nothing to measure — never a reassuring zero. */
  percent: number | null;
  done: number;
  of: number;
}

export interface HygieneView {
  controls: readonly ControlResult[];
  /** Due now and not done. */
  outstanding: readonly ControlResult[];
  /** Due now, not done, and holding the clinic shut. */
  blocking: readonly ControlResult[];
  /** Reported and waiting on the named checker. */
  awaitingCheck: readonly ControlResult[];
  /** The checker looked and was not satisfied. */
  failedChecks: readonly ControlResult[];
  /** HK-008 defects, which are maintenance rather than cleaning. */
  defects: readonly ControlResult[];
  housekeepingCompliance: HygieneKpi;
  treatmentRoomHygiene: HygieneKpi;
  washroomCompliance: HygieneKpi;
  failedHygieneAudits: number;
  headline: string;
}

/* -------------------------------------------------------------------------
 * The calculation
 * ---------------------------------------------------------------------- */

/**
 * Where cleanliness stands, as of `now`.
 *
 * Pure. `openedAt` is the minute the clinic unlocked, so a report from
 * yesterday is not this morning's answer — the same rule the emergency kit
 * uses, and for the same reason.
 *
 * `turnoverDue` is the set of control ids that a room emptying has made due.
 * Passed in rather than worked out here, because whether a chair is free is a
 * fact about the day's board and not about cleaning.
 */
export function housekeeping(
  controls: readonly HygieneControl[],
  reports: readonly HygieneReport[],
  checks: readonly HygieneCheck[],
  openedAt: number | null,
  turnoverDue: readonly string[],
  now: number,
): HygieneView {
  const since = openedAt ?? 0;
  const latest = new Map<string, HygieneReport>();
  for (const r of reports) {
    if (r.at < since) continue;
    const prev = latest.get(r.controlId);
    if (prev === undefined || r.at > prev.at) latest.set(r.controlId, r);
  }
  const checkOf = new Map<string, HygieneCheck>();
  for (const c of checks) {
    if (c.at < since) continue;
    const prev = checkOf.get(c.controlId);
    if (prev === undefined || c.at > prev.at) checkOf.set(c.controlId, c);
  }

  const due = new Set(turnoverDue);

  const results: ControlResult[] = controls.map((control) => {
    const report = latest.get(control.id);
    const check = checkOf.get(control.id);

    // A turnover control with no chair to turn over is not outstanding.
    // Reporting it undone every morning is how a list stops being read.
    if (control.trigger === HygieneTrigger.TURNOVER && !due.has(control.id)
      && report === undefined) {
      return {
        control, state: HygieneState.NOT_DUE, blocksOpening: false,
        doneAt: null, doneBy: null, checkedBy: null, defect: false,
        because: 'Due when a patient leaves the chair, not at opening.',
      };
    }

    if (report === undefined) {
      return {
        control,
        state: HygieneState.NOT_DONE,
        blocksOpening: gatesOpening(control.priority) && control.opensAs !== null,
        doneAt: null, doneBy: null, checkedBy: null, defect: false,
        because: control.ifUndone,
      };
    }

    const defect = report.defectFound === true;

    if (check !== undefined && !check.passed) {
      // The one outcome a tick sheet cannot produce, and the reason the matrix
      // names a Checker at all. Somebody looked and was not satisfied.
      return {
        control, state: HygieneState.FAILED_CHECK,
        blocksOpening: gatesOpening(control.priority) && control.opensAs !== null,
        doneAt: report.at, doneBy: report.byEmployeeCode,
        checkedBy: check.byEmployeeCode, defect,
        because: check.note
          ?? 'Reported done, and the checker was not satisfied with it.',
      };
    }

    if (control.checker !== null && check === undefined) {
      return {
        control, state: HygieneState.AWAITING_CHECK,
        // The work is done. The signature is outstanding, and an unsigned
        // control is a control failure rather than a dirty room.
        blocksOpening: false,
        doneAt: report.at, doneBy: report.byEmployeeCode,
        checkedBy: null, defect,
        because: `Done, and waiting on the ${roleWord(control.checker)} to check it.`,
      };
    }

    return {
      control, state: HygieneState.DONE, blocksOpening: false,
      doneAt: report.at, doneBy: report.byEmployeeCode,
      checkedBy: check?.byEmployeeCode ?? null, defect,
      because: defect
        ? `Done, and a defect was reported${report.note ? ` — ${report.note}` : ''}.`
        : 'Done.',
    };
  });

  const countable = results.filter((r) => r.state !== HygieneState.NOT_DUE);
  const isDone = (r: ControlResult) =>
    r.state === HygieneState.DONE || r.state === HygieneState.AWAITING_CHECK;

  const kpi = (label: string, rows: readonly ControlResult[]): HygieneKpi => ({
    label,
    // Null, not zero. Nothing to measure is not a score of nought, and a
    // dashboard drawing 0% for an empty denominator has invented a failure.
    percent: rows.length === 0 ? null
      : Math.round((rows.filter(isDone).length / rows.length) * 100),
    done: rows.filter(isDone).length,
    of: rows.length,
  });

  const outstanding = results.filter(
    (r) => r.state === HygieneState.NOT_DONE || r.state === HygieneState.FAILED_CHECK);
  const blocking = results.filter((r) => r.blocksOpening);
  const failedChecks = results.filter((r) => r.state === HygieneState.FAILED_CHECK);

  return {
    controls: results,
    outstanding,
    blocking,
    awaitingCheck: results.filter((r) => r.state === HygieneState.AWAITING_CHECK),
    failedChecks,
    defects: results.filter((r) => r.defect),
    housekeepingCompliance: kpi('Housekeeping compliance',
      countable.filter((r) => r.control.doer === RoleCode.HOUSEKEEPING)),
    treatmentRoomHygiene: kpi('Treatment-room hygiene',
      countable.filter((r) => r.control.area === HygieneArea.TREATMENT_ROOM)),
    washroomCompliance: kpi('Washroom compliance',
      countable.filter((r) => r.control.area === HygieneArea.WASHROOM)),
    failedHygieneAudits: failedChecks.length,
    headline: headlineFor(blocking, failedChecks, outstanding, now),
  };
}

function headlineFor(
  blocking: readonly ControlResult[], failed: readonly ControlResult[],
  outstanding: readonly ControlResult[], now: number,
): string {
  void now;
  if (blocking.length > 0) {
    return `${blocking[0]!.control.activity} — ${blocking[0]!.because}`;
  }
  if (failed.length > 0) {
    return `${failed.length} hygiene check${failed.length === 1 ? '' : 's'} failed. `
      + 'Somebody looked and was not satisfied.';
  }
  if (outstanding.length > 0) {
    return `${outstanding.length} cleaning round${outstanding.length === 1 ? '' : 's'} `
      + 'outstanding. None of them holds the clinic.';
  }
  return 'Every cleaning round due so far is done.';
}

const roleWord = (r: RoleCode): string =>
  String(r).toLowerCase().replace(/_/g, ' ');

/** The columns the housekeeping sheet must carry. */
export const HYGIENE_SHEET_COLUMNS: readonly string[] = [
  'date', 'control_id', 'subject', 'done_at', 'done_by',
  'defect_found', 'note', 'checked_by', 'check_passed',
];
