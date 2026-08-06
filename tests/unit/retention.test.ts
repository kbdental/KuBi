/**
 * Thirty days, and the four ways a patient is not dormant.
 *
 * The owner gave the number when asked, so the boundary can be tested rather
 * than argued about. Day 29 is not dormant, day 30 is — and that line is here,
 * once, where somebody who disagrees with it can find it.
 *
 * The tests that matter most are the negative ones. A retention list that
 * includes people who are booked in next week, or who finished their treatment
 * happily two months ago, gets ignored within a fortnight and then the two
 * patients with an open tooth are lost inside it.
 */
import { describe, it, expect } from 'vitest';
import {
  dormancyOf, retentionOrder, isRecallNotDormancy,
  DORMANT_AFTER_DAYS, RetentionReason, OutreachOutcome, CLOSING_OUTCOMES,
  type PatientActivity,
} from '@kubi/contracts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-06T10:00:00Z');
const daysAgo = (n: number) => NOW - n * DAY;

function patient(over: Partial<PatientActivity> = {}): PatientActivity {
  return {
    patientId: 'p1',
    lastAttendedAt: daysAgo(60),
    nextBookedAt: null,
    plannedNotStarted: 1,
    startedNotCompleted: 0,
    completed: 0,
    ...over,
  };
}

describe('the thirty-day line', () => {
  it('is thirty days, in one place', () => {
    expect(DORMANT_AFTER_DAYS).toBe(30);
  });

  it('leaves a patient alone on day twenty-nine', () => {
    expect(dormancyOf(patient({ lastAttendedAt: daysAgo(29) }), NOW)).toBeNull();
  });

  it('raises them on day thirty', () => {
    const d = dormancyOf(patient({ lastAttendedAt: daysAgo(30) }), NOW);
    expect(d).not.toBeNull();
    expect(d!.daysSinceLastVisit).toBe(30);
  });

  it('counts whole days, so an hour either side does not flicker', () => {
    // 30 days and 23 hours is still day 30. Without the floor, a list refreshed
    // twice in an afternoon would show different numbers for the same patient.
    const almost = dormancyOf(patient({ lastAttendedAt: daysAgo(30) - 23 * 60 * 60 * 1000 }), NOW);
    expect(almost!.daysSinceLastVisit).toBe(30);
  });
});

describe('the four ways a patient is not dormant', () => {
  it('is booked in — whatever the gap behind them', () => {
    // The check that most often prevents a pointless and slightly insulting
    // call: somebody who has not been for a year but is in next Tuesday.
    const d = dormancyOf(patient({
      lastAttendedAt: daysAgo(400),
      nextBookedAt: NOW + 7 * DAY,
    }), NOW);
    expect(d).toBeNull();
  });

  it('has never attended at all', () => {
    // Booked once and never arrived. That is APT-006's no-show, handled the
    // day it happens by somebody else.
    expect(dormancyOf(patient({ lastAttendedAt: null }), NOW)).toBeNull();
  });

  it('finished their treatment and is simply due a check-up', () => {
    // CND-092's recall. Putting forty of these on a doctor's screen buries the
    // two people who actually stopped mid-course.
    const done = patient({ plannedNotStarted: 0, startedNotCompleted: 0, completed: 3 });
    expect(isRecallNotDormancy(done)).toBe(true);
    expect(dormancyOf(done, NOW)).toBeNull();
  });

  it('has nothing outstanding at all', () => {
    expect(dormancyOf(patient({ plannedNotStarted: 0 }), NOW)).toBeNull();
  });

  it('does not treat a past booking as a future one', () => {
    // A booking yesterday that they did not attend must not shield them.
    const d = dormancyOf(patient({ nextBookedAt: NOW - DAY }), NOW);
    expect(d).not.toBeNull();
  });
});

describe('two populations, because they need different conversations', () => {
  it('calls an unstarted plan NEVER_STARTED', () => {
    const d = dormancyOf(patient({ plannedNotStarted: 2, startedNotCompleted: 0 }), NOW)!;
    expect(d.reason).toBe(RetentionReason.NEVER_STARTED);
    expect(d.stake).toBe('2 planned treatments never begun');
  });

  it('calls an unfinished course STOPPED_MID_TREATMENT', () => {
    const d = dormancyOf(patient({ plannedNotStarted: 0, startedNotCompleted: 1 }), NOW)!;
    expect(d.reason).toBe(RetentionReason.STOPPED_MID_TREATMENT);
    expect(d.stake).toBe('1 treatment left unfinished');
  });

  it('says mid-treatment when both are true', () => {
    // A patient with an unfinished root canal and an unstarted crown plan is,
    // first, a patient with an unfinished root canal.
    const d = dormancyOf(patient({ plannedNotStarted: 3, startedNotCompleted: 1 }), NOW)!;
    expect(d.reason).toBe(RetentionReason.STOPPED_MID_TREATMENT);
  });

  it('still raises somebody whose other treatments finished', () => {
    // Two crowns done, one root canal abandoned. The finished work does not
    // cancel the open tooth.
    const d = dormancyOf(patient({ startedNotCompleted: 1, completed: 2 }), NOW);
    expect(d).not.toBeNull();
    expect(d!.reason).toBe(RetentionReason.STOPPED_MID_TREATMENT);
  });
});

describe('the order a doctor should work down', () => {
  it('puts unfinished treatment above unstarted plans, however old', () => {
    const oldPlan = dormancyOf(patient({ patientId: 'a', lastAttendedAt: daysAgo(300) }), NOW)!;
    const recentStop = dormancyOf(patient({
      patientId: 'b', lastAttendedAt: daysAgo(31), plannedNotStarted: 0, startedNotCompleted: 1,
    }), NOW)!;

    expect([oldPlan, recentStop].sort(retentionOrder).map((d) => d.patientId))
      .toEqual(['b', 'a']);
  });

  it('puts the longest gone first within a group', () => {
    const a = dormancyOf(patient({ patientId: 'a', lastAttendedAt: daysAgo(45) }), NOW)!;
    const b = dormancyOf(patient({ patientId: 'b', lastAttendedAt: daysAgo(90) }), NOW)!;
    expect([a, b].sort(retentionOrder).map((d) => d.patientId)).toEqual(['b', 'a']);
  });

  it('is not sorted by anything resembling money', () => {
    // Recorded as a test because it is a decision, not an accident. Dormancy
    // carries no value, price or plan total, so a sort by revenue is not
    // available to write without changing the type first — which is where
    // somebody would have to argue for it.
    const d = dormancyOf(patient(), NOW)!;
    expect(Object.keys(d).sort()).toEqual(
      ['daysSinceLastVisit', 'patientId', 'reason', 'stake'],
    );
  });
});

describe('which answers close the loop', () => {
  it('closes on a real answer', () => {
    expect(CLOSING_OUTCOMES).toContain(OutreachOutcome.RETURNING);
    expect(CLOSING_OUTCOMES).toContain(OutreachOutcome.DECLINED);
    expect(CLOSING_OUTCOMES).toContain(OutreachOutcome.NOT_APPLICABLE);
  });

  it('never closes on an unanswered phone', () => {
    // An unanswered call is not a decision the patient made. Treating it as
    // one is how somebody quietly falls off the list.
    expect(CLOSING_OUTCOMES).not.toContain(OutreachOutcome.NO_ANSWER);
    expect(CLOSING_OUTCOMES).not.toContain(OutreachOutcome.UNREACHABLE);
  });

  it('does not permanently close on "thinking about it"', () => {
    expect(CLOSING_OUTCOMES).not.toContain(OutreachOutcome.WILL_DECIDE);
  });
});
