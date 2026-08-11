/**
 * Attendance, leave and staff availability — ATT-001 to ATT-008.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why this belongs to readiness rather than to HR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The owner: *"this is an important part of clinic readiness."* It is more
 * than important — it is the part that decides whether the rest of the morning
 * is even possible. Four operatories, a 45-minute floor, a 75-minute
 * sterilisation cycle and a 50-minute whole-clinic window are all statements
 * about *work*, and every one of them assumes somebody is in the building to
 * do it. A readiness engine that reports nine outstanding blocks without
 * noticing that the sterilization technician is on leave is reporting the
 * symptom.
 *
 * So the output of this file is not a timesheet. It is the answer to one
 * question at 09:15: **is every job that this morning needs owned by somebody
 * who is actually here?**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A contradiction the clinic's own standards contain
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Three numbers, each of them stated by the clinic, none of them controversial
 * on its own: staff report at 09:00 and housekeeping at 08:45; the morning
 * takes fifty minutes and the sterilisation cycle seventy-five to cooling;
 * appointments may be booked from 09:30.
 *
 * They do not fit. A 09:30 patient needs the autoclave loaded at 08:15 and the
 * rooms started at 08:40 — three quarters of an hour before the technician is
 * due and five minutes before the housekeeper unlocks. Nobody is being
 * careless; the arithmetic simply was never done in one place.
 *
 * So it is done here. `contradiction()` measures each role against its own
 * arrival time, and `bookingWindow()` answers the question the booking clerk
 * is actually asking — *what is the earliest slot this roster can deliver?*
 * Both compute rather than assert, so the finding moves on its own if any of
 * the three numbers changes, without anybody editing a sentence.
 *
 * Nothing here overrides the standard. The clinic's numbers stand until the
 * owner changes them; the engine reports that they cannot all be met.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Where the data comes from
 * ─────────────────────────────────────────────────────────────────────────
 *
 * *"Attendance will be captured and be picked from a separate Google Sheet."*
 * So `AttendanceRow` and `LeaveRow` are import shapes, deliberately flat and
 * stringly-typed at the edges — the sheet is the source, and this file is what
 * makes sense of it. A person missing from the sheet is `UNKNOWN`, never
 * absent: ATT-003 asks for *every absence classified*, and an unclassified one
 * is the thing that control exists to catch.
 */
import { RoleCode } from './enums.js';

const T = (h: number, m = 0) => h * 60 + m;

/* -------------------------------------------------------------------------
 * The standards, as the owner wrote them
 * ---------------------------------------------------------------------- */

/**
 * ATT-001 — corrected twice by the owner, and now per role.
 *
 * The matrix said 09:45 for everybody. When the engine showed that five of six
 * roles could not deliver the morning from there, the owner corrected the fact
 * rather than the rule: *"staff will report at 9 am, first patient at 10."*
 * Then: *"the house keeping staff arrives at 8.45."*
 *
 * That second correction is why this is no longer one number. Housekeeping
 * arriving fifteen minutes before everybody else is not an exception to the
 * standard, it *is* the standard for that role — and a blanket 09:00 would
 * have marked her fifteen minutes early every single day, which is the kind of
 * noise that teaches people to ignore the column. So `reportBy` lives on
 * `RequiredRole`, and this constant is only the default for roles the morning
 * does not name.
 */
export const REPORT_BY = T(9, 0);

/**
 * The earliest minute reception may put a patient in the book.
 *
 * *"Appointments can start at 9.30."*
 *
 * Held here rather than in the scheduler because it is a **claim about
 * staffing** — booking a 09:30 patient asserts that every role the morning
 * needs can be finished by 09:30, and that assertion is this file's to check.
 * `bookingWindow()` does the arithmetic; see the note there, because as the
 * roster stands the two numbers do not agree.
 */
export const EARLIEST_APPOINTMENT = T(9, 30);

/** ATT-004. *"≥7 days prior whenever possible."* */
export const LEAVE_NOTICE_DAYS = 7;

/**
 * ATT-006 — and it is not built.
 *
 * *"Sunday considered according to clinic policy when leave spans
 * Saturday/Monday."* KuBi does not hold that policy, and there are at least
 * three ordinary versions of it: Sunday counts as leave, Sunday is free, or
 * Sunday counts only when both flanking days are taken. Each gives a different
 * leave balance, and guessing would quietly cost somebody a day.
 *
 * Constitution rule 4: never silently resolve an open Owner Decision. So the
 * rule is named, the case is detected, and the calculation is refused.
 */
export const SUNDAY_RULE_DECIDED = false;
export const SUNDAY_RULE_QUESTION =
  'When leave spans a Saturday and the following Monday, does the Sunday count '
  + 'as a leave day? Three policies are common and they give different '
  + 'balances, so KuBi refuses to compute rather than pick one.';

/* -------------------------------------------------------------------------
 * What the morning needs
 * ---------------------------------------------------------------------- */

/**
 * The roles the morning cannot be done without, and when each has to be here.
 *
 * Derived from the opening procedure's own numbers, not invented: housekeeping
 * owns forty-five minutes of floors, the technician owns a seventy-five-minute
 * cycle, the rooms are fifteen minutes each. `minutesBefore` is how long before
 * the first patient that role's work has to begin.
 *
 * A test holds this against the readiness blocks, so a role that gains a
 * mandatory block and is not listed here fails the build rather than quietly
 * having nobody rostered.
 */
export interface RequiredRole {
  role: RoleCode;
  /** How many people of this role the morning needs. */
  count: number;
  minutesBefore: number;
  /**
   * ATT-001 for this role. The minute they are due in the building.
   *
   * Separate from `minutesBefore` on purpose: one is when the *work* has to
   * start, the other is when the *person* has to be here, and the whole point
   * of this engine is that the clinic can state both and discover they do not
   * line up.
   */
  reportBy: number;
  /** What stops if nobody holds it. */
  owns: string;
  /** Whether the clinic can open at all without it. */
  critical: boolean;
}

export const REQUIRED_ROLES: readonly RequiredRole[] = [
  {
    role: RoleCode.STERILIZATION_TECHNICIAN, count: 1, minutesBefore: 75,
    reportBy: REPORT_BY,
    owns: 'the morning sterilisation run — 75 minutes to cooling',
    critical: true,
  },
  {
    // *"One thing I forgot — the house keeping staff arrives at 8.45."*
    role: RoleCode.HOUSEKEEPING, count: 1, minutesBefore: 50,
    reportBy: T(8, 45),
    owns: 'floors, pantry and washroom — 45 minutes',
    critical: true,
  },
  {
    role: RoleCode.DENTAL_ASSISTANT, count: 2, minutesBefore: 50,
    reportBy: REPORT_BY,
    owns: 'four operatories at 15 minutes each',
    critical: true,
  },
  {
    role: RoleCode.SENIOR_ASSISTANT, count: 1, minutesBefore: 50,
    reportBy: REPORT_BY,
    owns: 'the equipment round — nobody else may report it',
    critical: true,
  },
  {
    role: RoleCode.RECEPTION, count: 1, minutesBefore: 50,
    reportBy: REPORT_BY,
    owns: 'the waiting and billing area, and the front door',
    critical: true,
  },
  {
    role: RoleCode.TREATING_DOCTOR, count: 1, minutesBefore: 15,
    reportBy: REPORT_BY,
    owns: 'seeing the patients',
    critical: true,
  },
];

/**
 * When this person is due in, given everything they hold.
 *
 * The earliest of their roles' times, because somebody who is both a
 * housekeeper and an assistant is due at the housekeeper's hour — you cannot
 * do the 08:45 job at 09:00. A person holding no named morning role falls back
 * to the general standard rather than to nothing: absence of a rule is not
 * permission to arrive whenever.
 */
export function reportByFor(roles: readonly RoleCode[]): number {
  const mine = REQUIRED_ROLES.filter((r) => roles.includes(r.role));
  return mine.length === 0 ? REPORT_BY : Math.min(...mine.map((r) => r.reportBy));
}

/* -------------------------------------------------------------------------
 * The import shapes — one row of the clinic's own sheet
 * ---------------------------------------------------------------------- */

export interface StaffMember {
  employeeCode: string;
  /** How a person says it. Names are allowed for staff records; roles rule the engine. */
  label: string;
  roles: readonly RoleCode[];
  active: boolean;
}

/** One row of the attendance sheet, for one person on one day. */
export interface AttendanceRow {
  employeeCode: string;
  /** Minutes from midnight. Null when the sheet has no in-time. */
  inAt: number | null;
  outAt: number | null;
  /** What the clinic says this is. Empty is not the same as absent. */
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | '' | null;
  /** ATT-002. A late arrival with no reason is the thing that escalates. */
  reason: string | null;
}

export interface LeaveRow {
  employeeCode: string;
  /** Day numbers, so a span can be measured without a calendar library. */
  fromDay: number;
  toDay: number;
  kind: 'ANNUAL' | 'SICK' | 'UNPAID' | 'MATERNITY' | 'COMPENSATORY';
  status: 'REQUESTED' | 'APPROVED' | 'REFUSED' | 'CANCELLED';
  /** The day the request was made, for the seven-day notice rule. */
  requestedOnDay: number;
  /** ATT-007. Who is covering. Null means nobody has been named. */
  coverEmployeeCode: string | null;
  /** True when the span includes a Sunday between a Saturday and a Monday. */
  spansSunday: boolean;
}

/* -------------------------------------------------------------------------
 * What the engine says about one person
 * ---------------------------------------------------------------------- */

export const AttendanceState = {
  PRESENT: 'PRESENT',
  /** In, and after the standard. ATT-001. */
  LATE: 'LATE',
  /** Late, and nobody has said why. ATT-002 — this one escalates. */
  LATE_UNEXPLAINED: 'LATE_UNEXPLAINED',
  /** Absent, and the absence has been classified. ATT-003 satisfied. */
  ABSENT: 'ABSENT',
  /** Approved leave. Expected, and covered or not — see ATT-007. */
  ON_LEAVE: 'ON_LEAVE',
  /**
   * Nothing in the sheet at all.
   *
   * Not absent. ATT-003 asks for every absence to be classified, and an
   * unclassified one is exactly what that control exists to catch — so this is
   * its own state, louder than ABSENT rather than quieter.
   */
  UNKNOWN: 'UNKNOWN',
} as const;
export type AttendanceState = (typeof AttendanceState)[keyof typeof AttendanceState];

export interface PersonToday {
  employeeCode: string;
  label: string;
  roles: readonly RoleCode[];
  state: AttendanceState;
  inAt: number | null;
  /** ATT-001 for this person — their own role's hour, not a clinic-wide one. */
  dueIn: number;
  /** Minutes past their own standard. Null when not late. */
  lateBy: number | null;
  reason: string | null;
  /** The earliest minute any of their roles was needed. */
  neededBy: number | null;
  /** In on time and still after their own work had to start. */
  lateForTheirWork: boolean;
  headline: string;
}

/** ATT-008 — one required position, and whether it is covered. */
export interface Coverage {
  role: RoleCode;
  needed: number;
  /** Present or late — in the building, whatever time they got here. */
  here: number;
  onLeave: number;
  unknown: number;
  covered: boolean;
  critical: boolean;
  owns: string;
  /** The minute this role's work had to start. */
  neededBy: number | null;
  because: string;
}

export interface LeaveFinding {
  employeeCode: string;
  label: string;
  kind: string;
  fromDay: number;
  toDay: number;
  /** ATT-004. Days of notice given. Negative where it was retrospective. */
  noticeDays: number;
  shortNotice: boolean;
  /** ATT-005. Approved, refused, or still sitting there. */
  status: LeaveRow['status'];
  pendingAndImminent: boolean;
  /** ATT-007. A critical role on leave with nobody named to cover it. */
  uncoveredCritical: boolean;
  /** ATT-006. Detected, and deliberately not calculated. */
  needsSundayRuling: boolean;
  because: string;
}

export interface AttendanceView {
  people: readonly PersonToday[];
  /** ATT-001. In after their own role's hour. */
  late: readonly PersonToday[];
  /** ATT-002. Late with no reason — escalates. */
  lateUnexplained: readonly PersonToday[];
  /** ATT-003. Nobody has said what happened to them. */
  unaccounted: readonly PersonToday[];
  /** ATT-008. Required positions, and whether each is covered. */
  coverage: readonly Coverage[];
  gaps: readonly Coverage[];
  /** Can the morning be done at all by the people who are here? */
  staffed: boolean;
  /** ATT-004 to ATT-007. */
  leave: readonly LeaveFinding[];
  shortNotice: readonly LeaveFinding[];
  pendingApproval: readonly LeaveFinding[];
  uncovered: readonly LeaveFinding[];
  needsSundayRuling: readonly LeaveFinding[];
  /** The one sentence for the manager at 09:15. */
  headline: string;
}

/* -------------------------------------------------------------------------
 * The calculation
 * ---------------------------------------------------------------------- */

/**
 * Where the clinic's staffing stands, as of `now`.
 *
 * Pure, like every other engine here. `firstPatientAt` is null when nothing is
 * booked, and a clinic with no patients has no arrival deadline — reporting
 * one would be inventing a state we do not have.
 */
export function attendance(
  staff: readonly StaffMember[],
  rows: readonly AttendanceRow[],
  leave: readonly LeaveRow[],
  firstPatientAt: number | null,
  today: number,
  now: number,
): AttendanceView {
  const byCode = new Map(rows.map((r) => [r.employeeCode, r]));
  const onLeaveToday = new Set(
    leave
      .filter((l) => l.status === 'APPROVED' && l.fromDay <= today && today <= l.toDay)
      .map((l) => l.employeeCode),
  );

  const neededByFor = (roles: readonly RoleCode[]): number | null => {
    if (firstPatientAt === null) return null;
    const mine = REQUIRED_ROLES.filter((r) => roles.includes(r.role));
    if (mine.length === 0) return null;
    return firstPatientAt - Math.max(...mine.map((r) => r.minutesBefore));
  };

  const people: PersonToday[] = staff.filter((s) => s.active).map((s) => {
    const row = byCode.get(s.employeeCode);
    const neededBy = neededByFor(s.roles);

    if (onLeaveToday.has(s.employeeCode)
      || row?.status === 'LEAVE' || row?.status === 'HOLIDAY') {
      return {
        employeeCode: s.employeeCode, label: s.label, roles: s.roles,
        state: AttendanceState.ON_LEAVE, inAt: null,
        dueIn: reportByFor(s.roles), lateBy: null,
        reason: row?.reason ?? null, neededBy, lateForTheirWork: false,
        headline: 'On approved leave.',
      };
    }

    // Nothing in the sheet is not absence. ATT-003 asks for every absence to
    // be classified, and this is the state that makes an unclassified one
    // visible instead of letting it read as "not in yet".
    if (row === undefined || (row.inAt === null && (row.status ?? '') === '')) {
      return {
        employeeCode: s.employeeCode, label: s.label, roles: s.roles,
        state: AttendanceState.UNKNOWN, inAt: null,
        dueIn: reportByFor(s.roles), lateBy: null,
        reason: null, neededBy, lateForTheirWork: neededBy !== null && now > neededBy,
        headline: 'No attendance recorded, and no absence classified. Nobody knows where they are.',
      };
    }

    if (row.inAt === null) {
      return {
        employeeCode: s.employeeCode, label: s.label, roles: s.roles,
        state: AttendanceState.ABSENT, inAt: null,
        dueIn: reportByFor(s.roles), lateBy: null,
        reason: row.reason, neededBy,
        lateForTheirWork: false,
        headline: row.reason ? `Absent — ${row.reason}` : 'Absent, classified.',
      };
    }

    const dueIn = reportByFor(s.roles);
    const lateBy = row.inAt > dueIn ? row.inAt - dueIn : null;
    const lateForTheirWork = neededBy !== null && row.inAt > neededBy;
    const unexplained = lateBy !== null && (row.reason ?? '').trim() === '';

    return {
      employeeCode: s.employeeCode, label: s.label, roles: s.roles,
      state: lateBy === null ? AttendanceState.PRESENT
        : unexplained ? AttendanceState.LATE_UNEXPLAINED : AttendanceState.LATE,
      inAt: row.inAt,
      dueIn,
      lateBy,
      reason: row.reason,
      neededBy,
      lateForTheirWork,
      headline: lateBy === null
        ? (lateForTheirWork
          ? `In at ${clock(row.inAt)} — inside their ${clock(dueIn)} standard, `
            + 'and after their own work had to start.'
          : `In at ${clock(row.inAt)}.`)
        : unexplained
          ? `In at ${clock(row.inAt)}, ${lateBy} minutes after their ${clock(dueIn)}, `
            + 'and no reason recorded.'
          : `In at ${clock(row.inAt)}, ${lateBy} minutes after their ${clock(dueIn)} — ${row.reason}`,
    };
  });

  /* ── ATT-008 · the manpower check ─────────────────────────────────── */
  const inBuilding = (p: PersonToday) =>
    p.state === AttendanceState.PRESENT
    || p.state === AttendanceState.LATE
    || p.state === AttendanceState.LATE_UNEXPLAINED;

  const coverage: Coverage[] = REQUIRED_ROLES.map((need) => {
    const holders = people.filter((p) => p.roles.includes(need.role));
    const here = holders.filter(inBuilding).length;
    const onLeave = holders.filter((p) => p.state === AttendanceState.ON_LEAVE).length;
    const unknown = holders.filter((p) => p.state === AttendanceState.UNKNOWN).length;
    const covered = here >= need.count;
    const neededBy = firstPatientAt === null ? null : firstPatientAt - need.minutesBefore;

    return {
      role: need.role,
      needed: need.count,
      here,
      onLeave,
      unknown,
      covered,
      critical: need.critical,
      owns: need.owns,
      neededBy,
      because: covered
        ? `${here} of ${need.count} here.`
        : `${here} of ${need.count} here — nobody is holding ${need.owns}.`,
    };
  });

  const gaps = coverage.filter((c) => !c.covered);

  /* ── ATT-004 to ATT-007 · leave ───────────────────────────────────── */
  const label = new Map(staff.map((s) => [s.employeeCode, s.label]));
  const criticalRoles = new Set(REQUIRED_ROLES.filter((r) => r.critical).map((r) => r.role));
  const rolesOf = new Map(staff.map((s) => [s.employeeCode, s.roles]));

  const leaveFindings: LeaveFinding[] = leave
    .filter((l) => l.status !== 'CANCELLED' && l.status !== 'REFUSED')
    .map((l) => {
      const noticeDays = l.fromDay - l.requestedOnDay;
      const shortNotice = noticeDays < LEAVE_NOTICE_DAYS;
      const pending = l.status === 'REQUESTED';
      const holdsCritical = (rolesOf.get(l.employeeCode) ?? [])
        .some((r) => criticalRoles.has(r));
      const uncoveredCritical = l.status === 'APPROVED'
        && holdsCritical && l.coverEmployeeCode === null;

      return {
        employeeCode: l.employeeCode,
        label: label.get(l.employeeCode) ?? l.employeeCode,
        kind: l.kind,
        fromDay: l.fromDay,
        toDay: l.toDay,
        noticeDays,
        shortNotice,
        status: l.status,
        pendingAndImminent: pending && l.fromDay <= today + LEAVE_NOTICE_DAYS,
        uncoveredCritical,
        needsSundayRuling: l.spansSunday && !SUNDAY_RULE_DECIDED,
        because: uncoveredCritical
          ? 'Approved leave on a critical role with nobody named to cover it'
          : pending
            ? `Requested ${noticeDays} days ahead and still not decided`
            : shortNotice
              ? `Only ${noticeDays} days’ notice, against a standard of ${LEAVE_NOTICE_DAYS}`
              : 'Approved.',
      };
    });

  const late = people.filter((p) => p.state === AttendanceState.LATE
    || p.state === AttendanceState.LATE_UNEXPLAINED);
  const lateUnexplained = people.filter((p) => p.state === AttendanceState.LATE_UNEXPLAINED);
  const unaccounted = people.filter((p) => p.state === AttendanceState.UNKNOWN);
  const uncovered = leaveFindings.filter((l) => l.uncoveredCritical);

  return {
    people,
    late,
    lateUnexplained,
    unaccounted,
    coverage,
    gaps,
    staffed: gaps.length === 0,
    leave: leaveFindings,
    shortNotice: leaveFindings.filter((l) => l.shortNotice),
    pendingApproval: leaveFindings.filter((l) => l.pendingAndImminent),
    uncovered,
    needsSundayRuling: leaveFindings.filter((l) => l.needsSundayRuling),
    headline: headlineFor(gaps, unaccounted, lateUnexplained, uncovered),
  };
}

function headlineFor(
  gaps: readonly Coverage[], unaccounted: readonly PersonToday[],
  lateUnexplained: readonly PersonToday[], uncovered: readonly LeaveFinding[],
): string {
  const criticalGap = gaps.find((g) => g.critical);
  if (criticalGap) {
    return `Nobody is holding ${criticalGap.owns}. The morning cannot be done as it stands.`;
  }
  if (unaccounted.length > 0) {
    return `${unaccounted.length} ${unaccounted.length === 1 ? 'person is' : 'people are'} `
      + 'unaccounted for — no attendance and no classified absence.';
  }
  if (uncovered.length > 0) {
    return `${uncovered.length} approved leave on a critical role with no cover named.`;
  }
  if (lateUnexplained.length > 0) {
    return `${lateUnexplained.length} late with no reason recorded.`;
  }
  if (gaps.length > 0) return `${gaps.length} position short.`;
  return 'Every position the morning needs is covered.';
}

/* -------------------------------------------------------------------------
 * The contradiction between two of the clinic's own standards
 * ---------------------------------------------------------------------- */

export interface Contradiction {
  role: RoleCode;
  /** ATT-001's blanket standard. */
  reportBy: number;
  /** When this role's own work actually has to start. */
  workStartsAt: number;
  /** How many minutes short the standard is. */
  shortMinutes: number;
  owns: string;
}

/**
 * Which roles cannot deliver the morning from their own arrival time.
 *
 * Not an opinion — arithmetic on numbers the clinic already published. Each
 * role is measured against *its own* ATT-001 hour, which is why housekeeping's
 * 08:45 shows up as fifteen minutes of relief rather than as an exception
 * somebody has to remember.
 *
 * Returned rather than resolved, because it is the owner's to settle: either
 * the arrival times move, or the first patient moves, or the morning starts on
 * somebody else's shift.
 */
export function contradiction(firstPatientAt: number | null): Contradiction[] {
  if (firstPatientAt === null) return [];
  return REQUIRED_ROLES
    .map((r) => ({
      role: r.role,
      reportBy: r.reportBy,
      workStartsAt: firstPatientAt - r.minutesBefore,
      shortMinutes: r.reportBy - (firstPatientAt - r.minutesBefore),
      owns: r.owns,
    }))
    .filter((x) => x.shortMinutes > 0)
    .sort((a, b) => b.shortMinutes - a.shortMinutes);
}

/* -------------------------------------------------------------------------
 * What the booking book may promise
 * ---------------------------------------------------------------------- */

export interface BookingWindow {
  /** What reception is allowed to offer today. */
  bookableFrom: number;
  /** The earliest slot the roster can actually be ready for. */
  deliverableFrom: number;
  /** The role that sets `deliverableFrom`. Move this one or nothing moves. */
  binding: RoleCode;
  bindingOwns: string;
  /** Minutes by which the book runs ahead of the roster. Zero when they agree. */
  overpromisedBy: number;
  honest: boolean;
  because: string;
}

/**
 * The earliest appointment this roster can honestly be ready for.
 *
 * *"Appointments can start at 9.30."* That sentence is a promise made to a
 * patient on the telephone, and this function is the only thing standing
 * between it and the morning it depends on. For every required role, the
 * earliest first-patient time that role can support is `reportBy +
 * minutesBefore`; the clinic can be ready no sooner than the slowest of them.
 *
 * As the numbers stand the sterilisation technician is binding — a 75-minute
 * cycle begun at 09:00 finishes at 10:15 — so a 09:30 booking is a promise the
 * building cannot keep, by three quarters of an hour. This is not a fault in
 * the booking rule or in the technician; it is the gap that appears the first
 * time two separately sensible standards are laid against each other.
 *
 * Constitution rule 4 applies: KuBi reports the gap and refuses to pick which
 * number gives. Three fixes are ordinary — the technician comes in at 08:15,
 * the instruments are cycled the evening before, or the book opens at 10:15 —
 * and they cost different things, so the choice is the owner's.
 */
export function bookingWindow(bookableFrom = EARLIEST_APPOINTMENT): BookingWindow {
  const earliest = REQUIRED_ROLES
    .map((r) => ({ at: r.reportBy + r.minutesBefore, role: r }))
    .sort((a, b) => b.at - a.at);
  const worst = earliest[0]!;
  const overpromisedBy = Math.max(0, worst.at - bookableFrom);

  return {
    bookableFrom,
    deliverableFrom: worst.at,
    binding: worst.role.role,
    bindingOwns: worst.role.owns,
    overpromisedBy,
    honest: overpromisedBy === 0,
    because: overpromisedBy === 0
      ? `Every role is ready by ${clock(worst.at)}, so a ${clock(bookableFrom)} `
        + 'slot can be kept.'
      : `The book opens at ${clock(bookableFrom)}, but the roster is not ready `
        + `until ${clock(worst.at)} — ${overpromisedBy} minutes later. `
        + `${clock(worst.role.reportBy)} plus ${worst.role.minutesBefore} minutes `
        + `for ${worst.role.owns}.`,
  };
}

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/* -------------------------------------------------------------------------
 * The sheet
 * ---------------------------------------------------------------------- */

/**
 * The columns the attendance sheet must carry.
 *
 * Named here so the importer and the workbook cannot drift apart, and so that
 * a missing column is a named failure rather than a silently empty field.
 */
export const ATTENDANCE_SHEET_COLUMNS: readonly string[] = [
  'employee_code', 'date', 'in_time', 'out_time', 'status', 'reason',
];

export const LEAVE_SHEET_COLUMNS: readonly string[] = [
  'employee_code', 'from_date', 'to_date', 'kind', 'status',
  'requested_on', 'cover_employee_code',
];

/**
 * Turn "09:52" into 592. Blank, dashes and rubbish all become null.
 *
 * Null is the important case: a blank in-time is not midnight, and a sheet
 * with a typo in it must not produce a person who arrived at 00:00.
 */
export function parseClock(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?\s*$/i.exec(text);
  if (m === null) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const suffix = m[3]?.toLowerCase();
  if (suffix === 'pm' && h < 12) h += 12;
  if (suffix === 'am' && h === 12) h = 0;
  return h * 60 + min;
}
