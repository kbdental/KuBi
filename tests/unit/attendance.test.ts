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

describe('ATT-001 · report for duty by 09:45', () => {
  it('holds the owner’s standard exactly', () => {
    expect(REPORT_BY).toBe(T(9, 45));
  });

  it('is on time at 09:45 and late at 09:46', () => {
    expect(view([row('e1', T(9, 45))]).late).toHaveLength(0);
    const late = view([row('e1', T(9, 46), { reason: 'Traffic' })]).late;
    expect(late).toHaveLength(1);
    expect(late[0]!.lateBy).toBe(1);
  });

  it('says the time they actually arrived, not just that they were late', () => {
    const p = view([row('e1', T(10, 5), { reason: 'Train' })]).people
      .find((x) => x.employeeCode === 'e1')!;
    expect(p.headline).toContain('10:05');
    expect(p.headline).toContain('20 minutes late');
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
  it('finds the roles that cannot make it', () => {
    const found = contradiction(FIRST_PATIENT);
    expect(found.length).toBeGreaterThan(0);
    const tech = found.find((c) => c.role === RoleCode.STERILIZATION_TECHNICIAN)!;
    expect(tech.workStartsAt).toBe(T(8, 45));
    expect(tech.shortMinutes).toBe(60);
  });

  it('puts the worst one first', () => {
    const found = contradiction(FIRST_PATIENT);
    expect(found[0]!.role).toBe(RoleCode.STERILIZATION_TECHNICIAN);
  });

  it('leaves the doctor alone, who genuinely can arrive at 09:45', () => {
    expect(contradiction(FIRST_PATIENT).map((c) => c.role))
      .not.toContain(RoleCode.TREATING_DOCTOR);
  });

  it('says nothing when there is no first patient to work back from', () => {
    expect(contradiction(null)).toEqual([]);
  });

  it('moves on its own if the clinic changes either standard', () => {
    // A midday first patient makes 09:45 comfortable for everybody.
    expect(contradiction(T(12, 0))).toEqual([]);
  });

  it('flags somebody inside the 09:45 standard who is still late for their own work', () => {
    const v = view(allIn().map((r) =>
      r.employeeCode === 'e5' ? row('e5', T(9, 30)) : r));
    const tech = v.people.find((p) => p.employeeCode === 'e5')!;
    expect(tech.state).toBe(AttendanceState.PRESENT);   // inside 09:45
    expect(tech.lateForTheirWork).toBe(true);           // and after 08:45
    expect(tech.headline).toContain('after their own work had to start');
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
