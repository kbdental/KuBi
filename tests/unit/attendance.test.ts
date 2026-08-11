/**
 * Attendance, leave and staff availability — ATT-001 to ATT-008.
 *
 * The owner: *"this is an important part of clinic readiness."* So the tests
 * are not about a timesheet. They are about one question at 09:15: is every
 * job this morning needs held by somebody who is actually here?
 *
 * The most useful thing in this file is the last block, which proves that two
 * of the clinic's own published standards cannot both be met.
 */
import { describe, it, expect } from 'vitest';
import {
  RoleCode, attendance, contradiction, parseClock,
  REPORT_BY, REQUIRED_ROLES, LEAVE_NOTICE_DAYS,
  EARLIEST_APPOINTMENT, bookingWindow, reportByFor,
  SUNDAY_RULE_DECIDED, SUNDAY_RULE_QUESTION,
  ATTENDANCE_SHEET_COLUMNS, LEAVE_SHEET_COLUMNS,
  AttendanceState, readiness,
  type StaffMember, type AttendanceRow, type LeaveRow, type Operatory,
} from '@kubi/contracts';

const T = (h: number, m = 0) => h * 60 + m;
const FIRST_PATIENT = T(10, 0);
const TODAY = 400;
const NOW = T(9, 15);

const staff: StaffMember[] = [
  { employeeCode: 'e1', label: 'Priya', roles: [RoleCode.DENTAL_ASSISTANT], active: true },
  { employeeCode: 'e2', label: 'Meera', roles: [RoleCode.DENTAL_ASSISTANT], active: true },
  { employeeCode: 'e3', label: 'Kavita', roles: [RoleCode.RECEPTION], active: true },
  { employeeCode: 'e4', label: 'Sunita', roles: [RoleCode.HOUSEKEEPING], active: true },
  { employeeCode: 'e5', label: 'Rahul', roles: [RoleCode.STERILIZATION_TECHNICIAN], active: true },
  { employeeCode: 'e6', label: 'Nisha', roles: [RoleCode.SENIOR_ASSISTANT], active: true },
  { employeeCode: 'e7', label: 'Dr Iyer', roles: [RoleCode.TREATING_DOCTOR], active: true },
  // A second receptionist, so a test can lose one person without also
  // creating a coverage gap — the two findings are different and the engine
  // ranks the gap higher, which is right.
  { employeeCode: 'e8', label: 'Anjali', roles: [RoleCode.RECEPTION], active: true },
];

const row = (
  employeeCode: string, inAt: number | null,
  over: Partial<AttendanceRow> = {},
): AttendanceRow => ({
  employeeCode, inAt, outAt: null, status: inAt === null ? '' : 'PRESENT',
  reason: null, ...over,
});

/** Everybody in on time. */
const allIn = (): AttendanceRow[] => staff.map((s) => row(s.employeeCode, T(8, 45)));

const view = (
  rows: AttendanceRow[], leave: LeaveRow[] = [], now = NOW,
  firstPatientAt: number | null = FIRST_PATIENT,
) => attendance(staff, rows, leave, firstPatientAt, TODAY, now);

const leaveRow = (over: Partial<LeaveRow> = {}): LeaveRow => ({
  employeeCode: 'e5', fromDay: TODAY + 20, toDay: TODAY + 22, kind: 'ANNUAL',
  status: 'APPROVED', requestedOnDay: TODAY, coverEmployeeCode: 'e1',
  spansSunday: false, ...over,
});

/* ═══════════════════════════════════════════════════════════════════════ */

describe('ATT-001 · report for duty, by role', () => {
  it('holds the owner’s corrected standard', () => {
    // The matrix said 09:45; the owner corrected it to 09:00 once the
    // arithmetic showed five of six roles could not make the morning.
    expect(REPORT_BY).toBe(T(9, 0));
  });

  it('gives housekeeping her own hour rather than the clinic-wide one', () => {
    // *"One thing I forgot — the house keeping staff arrives at 8.45."*
    // Judged against a blanket 09:00 she would read fifteen minutes early
    // every day of her working life, which is how a column stops being read.
    expect(reportByFor([RoleCode.HOUSEKEEPING])).toBe(T(8, 45));
    expect(reportByFor([RoleCode.DENTAL_ASSISTANT])).toBe(REPORT_BY);

    const v = view(allIn());
    const sunita = v.people.find((p) => p.employeeCode === 'e4')!;
    expect(sunita.dueIn).toBe(T(8, 45));
    expect(sunita.state).toBe(AttendanceState.PRESENT);

    // Same minute, different verdict — the assistant is early, not on time.
    const priya = v.people.find((p) => p.employeeCode === 'e1')!;
    expect(priya.dueIn).toBe(REPORT_BY);
  });

  it('makes housekeeping late at 08:46, when nobody else is', () => {
    const v = view(allIn().map((r) =>
      r.employeeCode === 'e4' ? row('e4', T(8, 46)) : r));
    expect(v.late.map((p) => p.employeeCode)).toEqual(['e4']);
    expect(v.late[0]!.lateBy).toBe(1);
  });

  it('takes the earlier hour when somebody holds two roles', () => {
    // You cannot do the 08:45 job at 09:00. Absence of a rule is not
    // permission to arrive whenever, so an unnamed role falls back to 09:00.
    expect(reportByFor([RoleCode.DENTAL_ASSISTANT, RoleCode.HOUSEKEEPING]))
      .toBe(T(8, 45));
    expect(reportByFor([RoleCode.LAB_COORDINATOR])).toBe(REPORT_BY);
  });

  it('is on time at 09:00 and late at 09:01', () => {
    expect(view([row('e1', T(9, 0))]).late).toHaveLength(0);
    const late = view([row('e1', T(9, 1), { reason: 'Traffic' })]).late;
    expect(late).toHaveLength(1);
    expect(late[0]!.lateBy).toBe(1);
  });

  it('says the time they actually arrived, not just that they were late', () => {
    const p = view([row('e1', T(10, 5), { reason: 'Train' })]).people
      .find((x) => x.employeeCode === 'e1')!;
    expect(p.headline).toContain('10:05');
    // Against their own hour, and it says which hour that was — an assistant
    // and a housekeeper both "65 minutes late" would mean two different times.
    expect(p.headline).toContain('65 minutes after their 09:00');
  });
});

describe('ATT-002 · a late arrival with no reason escalates', () => {
  it('separates late-with-a-reason from late-with-none', () => {
    const withReason = view([row('e1', T(10, 0), { reason: 'Child unwell' })]);
    const without = view([row('e1', T(10, 0))]);
    expect(withReason.lateUnexplained).toHaveLength(0);
    expect(without.lateUnexplained).toHaveLength(1);
    expect(without.people.find((p) => p.employeeCode === 'e1')!.state)
      .toBe(AttendanceState.LATE_UNEXPLAINED);
  });

  it('does not accept whitespace as a reason', () => {
    expect(view([row('e1', T(10, 0), { reason: '   ' })]).lateUnexplained).toHaveLength(1);
  });
});

describe('ATT-003 · every absence classified', () => {
  /**
   * The one that matters most. A person missing from the sheet is not absent
   * — nobody has said anything about them, and that is a different and worse
   * fact than a recorded absence.
   */
  it('reports nothing-in-the-sheet as UNKNOWN, not as absent', () => {
    const v = view([row('e1', T(8, 45))]);        // only one person recorded
    const p = v.people.find((x) => x.employeeCode === 'e2')!;
    expect(p.state).toBe(AttendanceState.UNKNOWN);
    expect(p.headline).toContain('no absence classified');
    expect(v.unaccounted.map((x) => x.employeeCode)).toContain('e2');
  });

  it('accepts a classified absence as classified', () => {
    const v = view([
      ...allIn().filter((r) => r.employeeCode !== 'e2'),
      row('e2', null, { status: 'ABSENT', reason: 'Sick' }),
    ]);
    const p = v.people.find((x) => x.employeeCode === 'e2')!;
    expect(p.state).toBe(AttendanceState.ABSENT);
    expect(p.headline).toContain('Sick');
    expect(v.unaccounted).toHaveLength(0);
  });

  it('leads on the unaccounted, once no position is actually short', () => {
    // Anjali is the second receptionist, so losing her from the sheet leaves
    // every position covered. A coverage gap would outrank this, and should.
    const v = view(allIn().filter((r) => r.employeeCode !== 'e8'));
    expect(v.staffed).toBe(true);
    expect(v.headline).toContain('unaccounted for');
  });
});

describe('ATT-004 · seven days’ notice', () => {
  it('flags anything requested inside the standard', () => {
    const short = view(allIn(), [leaveRow({ fromDay: TODAY + 3, requestedOnDay: TODAY })]);
    expect(short.shortNotice).toHaveLength(1);
    expect(short.shortNotice[0]!.noticeDays).toBe(3);
    expect(short.shortNotice[0]!.because).toContain(String(LEAVE_NOTICE_DAYS));
  });

  it('does not flag proper notice', () => {
    expect(view(allIn(), [leaveRow({ fromDay: TODAY + 14, requestedOnDay: TODAY })])
      .shortNotice).toHaveLength(0);
  });

  it('handles leave requested after it started, without pretending otherwise', () => {
    const v = view(allIn(), [leaveRow({ fromDay: TODAY - 2, requestedOnDay: TODAY })]);
    expect(v.shortNotice[0]!.noticeDays).toBe(-2);
  });
});

describe('ATT-005 · approve or reject before the leave date', () => {
  it('raises a request still sitting there with the date approaching', () => {
    const v = view(allIn(), [leaveRow({
      status: 'REQUESTED', fromDay: TODAY + 3, requestedOnDay: TODAY - 10,
    })]);
    expect(v.pendingApproval).toHaveLength(1);
    expect(v.pendingApproval[0]!.because).toContain('not decided');
  });

  it('leaves a distant request alone', () => {
    expect(view(allIn(), [leaveRow({ status: 'REQUESTED', fromDay: TODAY + 40 })])
      .pendingApproval).toHaveLength(0);
  });

  it('ignores refused and cancelled requests entirely', () => {
    const v = view(allIn(), [
      leaveRow({ status: 'REFUSED' }), leaveRow({ status: 'CANCELLED' }),
    ]);
    expect(v.leave).toHaveLength(0);
  });
});

describe('ATT-006 · the Sunday rule is not built, and says so', () => {
  /**
   * *"Sunday considered according to clinic policy."* KuBi does not hold that
   * policy. Three ordinary versions of it give three different balances, and
   * guessing would quietly cost somebody a day — so the case is detected and
   * the calculation refused. Constitution rule 4.
   */
  it('refuses to compute it', () => {
    expect(SUNDAY_RULE_DECIDED).toBe(false);
    expect(SUNDAY_RULE_QUESTION).toContain('does the Sunday count');
  });

  it('detects the case rather than ignoring it', () => {
    const v = view(allIn(), [leaveRow({ spansSunday: true })]);
    expect(v.needsSundayRuling).toHaveLength(1);
  });

  it('says nothing about leave that does not span a Sunday', () => {
    expect(view(allIn(), [leaveRow({ spansSunday: false })]).needsSundayRuling)
      .toHaveLength(0);
  });
});

describe('ATT-007 · a critical role on leave needs cover', () => {
  it('raises approved leave with nobody named', () => {
    const v = view(allIn(), [leaveRow({
      employeeCode: 'e5', status: 'APPROVED', coverEmployeeCode: null,
    })]);
    expect(v.uncovered).toHaveLength(1);
    expect(v.uncovered[0]!.because).toContain('nobody named to cover');
  });

  it('is satisfied when somebody is named', () => {
    expect(view(allIn(), [leaveRow({ coverEmployeeCode: 'e6' })]).uncovered)
      .toHaveLength(0);
  });

  it('does not chase cover for leave that has not been approved yet', () => {
    // A request is not yet a hole in the roster. ATT-005 chases the decision;
    // ATT-007 chases the cover, and only once there is something to cover.
    expect(view(allIn(), [leaveRow({ status: 'REQUESTED', coverEmployeeCode: null })])
      .uncovered).toHaveLength(0);
  });
});

describe('ATT-008 · the daily manpower check', () => {
  it('reports every position the morning needs as covered when everybody is in', () => {
    const v = view(allIn());
    expect(v.staffed).toBe(true);
    expect(v.gaps).toHaveLength(0);
    expect(v.headline).toBe('Every position the morning needs is covered.');
  });

  it('names what stops when a position is empty', () => {
    const v = view(allIn().filter((r) => r.employeeCode !== 'e5'));
    expect(v.staffed).toBe(false);
    const gap = v.gaps.find((g) => g.role === RoleCode.STERILIZATION_TECHNICIAN)!;
    expect(gap.because).toContain('morning sterilisation run');
    expect(v.headline).toContain('morning sterilisation run');
  });

  it('counts somebody late as being in the building', () => {
    // They are here, and the work can be done. Whether they were late is a
    // different control — conflating the two would report a covered position
    // as a gap and teach people to ignore both.
    const late = allIn().map((r) =>
      r.employeeCode === 'e4' ? row('e4', T(10, 10), { reason: 'Bus' }) : r);
    const v = view(late);
    expect(v.staffed).toBe(true);
    expect(v.late).toHaveLength(1);
  });

  it('needs two assistants, and says so when only one is in', () => {
    const v = view(allIn().filter((r) => r.employeeCode !== 'e2'));
    const gap = v.gaps.find((g) => g.role === RoleCode.DENTAL_ASSISTANT)!;
    expect(gap.needed).toBe(2);
    expect(gap.here).toBe(1);
  });

  it('shows leave and unknown separately in the coverage, not as one number', () => {
    const v = view(
      allIn().filter((r) => r.employeeCode !== 'e1' && r.employeeCode !== 'e2'),
      [leaveRow({ employeeCode: 'e1', fromDay: TODAY, toDay: TODAY })],
    );
    const c = v.coverage.find((x) => x.role === RoleCode.DENTAL_ASSISTANT)!;
    expect(c.onLeave).toBe(1);      // e1, approved leave today
    expect(c.unknown).toBe(1);      // e2, nothing in the sheet
    expect(c.here).toBe(0);
  });

  it('reports no deadline when nothing is booked', () => {
    // A clinic with no patients has no arrival deadline, and inventing one
    // would be reporting a state we do not have.
    const v = view(allIn(), [], NOW, null);
    expect(v.coverage.every((c) => c.neededBy === null)).toBe(true);
  });
});

describe('two of the clinic’s own standards cannot both be met', () => {
  /**
   * ATT-001 says present by 09:45. The opening procedure says the
   * sterilisation cycle is 75 minutes and the morning is 50. With a 10:00
   * first patient the technician had to start at 08:45.
   *
   * This is arithmetic on two published numbers, not an opinion, and it is
   * returned rather than resolved — the owner decides whether arrival times
   * differ by role, the first patient moves, or the morning belongs to an
   * earlier shift.
   */
  it('is down to one role at 09:00, and names it', () => {
    // The owner's correction did the work. At 09:45 five of six roles could
    // not make the morning; at 09:00 only the technician is short, because a
    // 75-minute cycle before a 10:00 patient has to start at 08:45.
    const found = contradiction(FIRST_PATIENT);
    expect(found.map((c) => c.role)).toEqual([RoleCode.STERILIZATION_TECHNICIAN]);
    expect(found[0]!.workStartsAt).toBe(T(8, 45));
    expect(found[0]!.shortMinutes).toBe(15);
  });

  it('leaves the fifty-minute roles alone, which now have ten minutes in hand', () => {
    const roles = contradiction(FIRST_PATIENT).map((c) => c.role);
    for (const r of [RoleCode.HOUSEKEEPING, RoleCode.DENTAL_ASSISTANT,
      RoleCode.SENIOR_ASSISTANT, RoleCode.RECEPTION, RoleCode.TREATING_DOCTOR]) {
      expect(roles, `${r} should now be comfortable`).not.toContain(r);
    }
  });

  it('says nothing when there is no first patient to work back from', () => {
    expect(contradiction(null)).toEqual([]);
  });

  it('moves on its own if the clinic changes either standard', () => {
    // A midday first patient makes 09:45 comfortable for everybody.
    expect(contradiction(T(12, 0))).toEqual([]);
  });

  it('flags somebody inside the standard who is still late for their own work', () => {
    // In at 08:55: inside the 09:00 standard, and after the cycle had to start.
    const v = view(allIn().map((r) =>
      r.employeeCode === 'e5' ? row('e5', T(8, 55)) : r));
    const tech = v.people.find((p) => p.employeeCode === 'e5')!;
    expect(tech.state).toBe(AttendanceState.PRESENT);
    expect(tech.lateForTheirWork).toBe(true);
    expect(tech.headline).toContain('after their own work had to start');
  });
});

describe('the booking book promises what the roster cannot deliver', () => {
  /**
   * *"Appointments can start at 9.30."*
   *
   * That is a promise made to a patient on the telephone. This block is the
   * arithmetic nobody had done: for each role the earliest first-patient time
   * it can support is its own arrival plus the work it owns, and the clinic is
   * ready no sooner than the slowest of them.
   */
  it('holds the booking rule as the owner stated it', () => {
    expect(EARLIEST_APPOINTMENT).toBe(T(9, 30));
  });

  it('finds the roster cannot be ready until 10:15, and names the binding role', () => {
    // 09:00 + a 75-minute cycle to cooling = 10:15. The technician sets the
    // opening time of the whole clinic and nobody had noticed, because the
    // two numbers lived in two different documents.
    const w = bookingWindow();
    expect(w.deliverableFrom).toBe(T(10, 15));
    expect(w.binding).toBe(RoleCode.STERILIZATION_TECHNICIAN);
    expect(w.honest).toBe(false);
    expect(w.overpromisedBy).toBe(45);
    expect(w.because).toContain('10:15');
  });

  it('does not blame the housekeeper, whose early start is already absorbed', () => {
    // 08:45 + 50 = 09:35. Five minutes over, and not the constraint — which
    // is the point of measuring each role against its own hour.
    const w = bookingWindow();
    expect(w.binding).not.toBe(RoleCode.HOUSEKEEPING);
  });

  it('agrees with itself once the book opens late enough', () => {
    const w = bookingWindow(T(10, 15));
    expect(w.honest).toBe(true);
    expect(w.overpromisedBy).toBe(0);
    expect(w.because).toContain('can be kept');
  });

  it('refuses to pick which number gives', () => {
    // Constitution rule 4. Three fixes are ordinary — the technician comes in
    // at 08:15, the instruments are cycled the evening before, or the book
    // opens at 10:15 — and they cost different things. Not KuBi's call.
    const w = bookingWindow();
    expect(w.bookableFrom).toBe(T(9, 30));
    expect(w.deliverableFrom).toBe(T(10, 15));
    // Both numbers survive. Neither is quietly overwritten by the other.
  });
});

describe('the required roles stay in step with the morning', () => {
  const FOUR: Operatory[] = [1, 2, 3, 4].map((i) => ({
    id: `op-${i}`, label: `Operatory ${i}`, position: i,
  }));

  it('lists every role that owns a mandatory readiness block', () => {
    // If a block gains a new owning role and nobody adds it here, the clinic
    // would need somebody it never checks is present. This test is the thing
    // that stops that.
    const owners = new Set(
      readiness([], FOUR, FIRST_PATIENT, NOW).blocks
        .filter((b) => b.mandatory).map((b) => b.owner),
    );
    const listed = new Set(REQUIRED_ROLES.map((r) => r.role));
    for (const owner of owners) {
      expect(listed, `${owner} owns a mandatory block and is not a required role`)
        .toContain(owner);
    }
  });

  it('gives every required role something it owns, in words', () => {
    for (const r of REQUIRED_ROLES) {
      expect(r.owns.length, `${r.role} has no stated job`).toBeGreaterThan(15);
      expect(r.minutesBefore, `${r.role} has no lead time`).toBeGreaterThan(0);
    }
  });
});

describe('reading the clinic’s sheet', () => {
  it('names the columns it needs, so a missing one is a named failure', () => {
    expect(ATTENDANCE_SHEET_COLUMNS).toContain('employee_code');
    expect(ATTENDANCE_SHEET_COLUMNS).toContain('in_time');
    expect(ATTENDANCE_SHEET_COLUMNS).toContain('reason');
    expect(LEAVE_SHEET_COLUMNS).toContain('cover_employee_code');
  });

  it('reads the times a person would actually type', () => {
    expect(parseClock('09:52')).toBe(T(9, 52));
    expect(parseClock('9:52')).toBe(T(9, 52));
    expect(parseClock('9.52')).toBe(T(9, 52));
    expect(parseClock(' 09:52 ')).toBe(T(9, 52));
    expect(parseClock('9:52 am')).toBe(T(9, 52));
    expect(parseClock('1:05 pm')).toBe(T(13, 5));
    expect(parseClock('12:30 am')).toBe(T(0, 30));
  });

  it('returns null for a blank rather than midnight', () => {
    // The failure this prevents: a blank in-time becoming 00:00 and reporting
    // somebody as present twelve hours early.
    for (const bad of ['', '  ', null, undefined, '-', 'n/a', '25:00', '09:75']) {
      expect(parseClock(bad), `"${bad}" should not parse`).toBeNull();
    }
  });
});
