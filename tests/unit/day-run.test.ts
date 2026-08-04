/**
 * The day, running.
 *
 * These tests exist because the owner said *"I see no systemized running"* —
 * so the running has to be a thing that can be asserted, not a thing you have
 * to squint at on a screen. Each test below is a sentence about a real clinic
 * at a real minute.
 */
import { describe, it, expect } from 'vitest';
import {
  runDay, dueTimes, ladderFor, clockLabel, CLINIC_DAY,
  DAILY_STANDARD, Rhythm, openingGate, closingGate,
} from '../../packages/contracts/src/index.js';

const at = (h: number, m = 0) => h * 60 + m;

describe('the clock', () => {
  it('reads times the way a person says them', () => {
    expect(clockLabel(at(8, 45))).toBe('8:45am');
    expect(clockLabel(at(12))).toBe('12:00pm');
    expect(clockLabel(at(19, 30))).toBe('7:30pm');
  });

  it('never puts patient work on a timeline', () => {
    // Thirteen tasks are raised by a patient arriving. Giving them a due time
    // would claim a schedule the clinic does not have.
    for (const s of DAILY_STANDARD) {
      if (s.rhythm !== Rhythm.EVERY_PATIENT) continue;
      expect(dueTimes(s), `${s.id} was given a clock time`).toEqual([]);
    }
    expect(runDay(at(11)).patientDriven).toHaveLength(13);
  });

  it('repeats the cadences through the day', () => {
    const hourly = DAILY_STANDARD.find((s) => s.rhythm === Rhythm.HOURLY)!;
    const twoHourly = DAILY_STANDARD.find((s) => s.rhythm === Rhythm.TWO_HOURLY)!;
    expect(dueTimes(hourly).length).toBeGreaterThan(dueTimes(twoHourly).length);
    // The 11:00 round and the 13:00 round are different pieces of work.
    expect(new Set(dueTimes(twoHourly)).size).toBe(dueTimes(twoHourly).length);
  });
});

describe('the clinic cannot open on the clock alone', () => {
  it('is locked before anybody is in', () => {
    expect(runDay(at(7)).clinic).toBe('LOCKED');
  });

  it('is still preparing at nine when the opening set is outstanding', () => {
    const day = runDay(at(9, 0));
    expect(day.clinic).toBe('PREPARING');
    expect(day.blocking.length).toBe(openingGate().length);
    expect(day.why).toMatch(/outstanding/);
  });

  it('says how many minutes late it is, rather than just that it is late', () => {
    expect(runDay(at(9, 20)).why).toContain('20 minutes late');
  });

  it('opens the moment the opening set is done, and not before', () => {
    const done = new Set(openingGate().map((s) => `${s.id}@${CLINIC_DAY.readyBy}`));
    expect(runDay(at(9, 0), done).clinic).toBe('OPEN');
    expect(runDay(at(9, 0), done).blocking).toEqual([]);
    // One left undone is enough to hold the doors.
    const almost = new Set([...done].slice(1));
    expect(runDay(at(9, 0), almost).clinic).toBe('PREPARING');
  });
});

describe('work goes late and climbs a ladder', () => {
  const openDone = new Set(openingGate().map((s) => `${s.id}@${CLINIC_DAY.readyBy}`));

  it('has nothing late at nine when the morning was done', () => {
    expect(runDay(at(9, 0), openDone).late).toEqual([]);
  });

  it('turns an untouched two-hourly round late once its time passes', () => {
    const day = runDay(at(11, 20), openDone);
    const round = day.late.find((i) => i.standard.rhythm === Rhythm.TWO_HOURLY);
    expect(round, 'the 11:00 round should be late at 11:20').toBeTruthy();
    expect(round!.minutesLate).toBe(20);
  });

  it('climbs the rungs as the minutes pass, on a real governed control', () => {
    // The final sterilisation cycle is governed by STER-004, so it has a real
    // ladder out of the frozen matrix.
    const cycle = DAILY_STANDARD.find((s) => s.rhythm === Rhythm.LAST_PATIENT)!;
    expect(ladderFor(cycle)).not.toBeNull();

    const key = (mins: number) => runDay(mins, openDone).items
      .find((i) => i.standard.id === cycle.id)!;

    expect(key(at(19, 30)).state).toBe('LATE');
    expect(key(at(19, 30)).level).toBeNull();      // 0 minutes late — nobody yet
    expect(key(at(19, 46)).level).toBe(1);          // 16 minutes — the doer
    expect(key(at(20, 5)).level).toBe(2);           // 35 minutes — their senior
    expect(key(at(20, 35)).level).toBe(3);          // 65 minutes — the clinic head
  });

  it('names somebody at every rung it reaches', () => {
    for (const item of runDay(at(21), new Set()).late) {
      if (item.unsupervised) continue;
      expect(item.escalatedTo, `${item.standard.id} climbed to nobody`).toBeTruthy();
    }
  });
});

describe('the finding, made visible', () => {
  it('escalates ungoverned work to nobody, and says so rather than inventing a manager', () => {
    const day = runDay(at(21), new Set());
    expect(day.unsupervised.length).toBeGreaterThan(0);
    for (const item of day.unsupervised) {
      expect(item.standard.covers).toBeNull();
      expect(item.escalatedTo, `${item.standard.id} was escalated to a made-up role`).toBeNull();
    }
  });

  it('leaves the housekeeping rounds reaching nobody all day', () => {
    const rounds = runDay(at(18), new Set()).unsupervised
      .filter((i) => i.standard.rhythm === Rhythm.TWO_HOURLY);
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds.every((i) => i.escalatedTo === null)).toBe(true);
  });
});

describe('the keys do not turn on a schedule either', () => {
  const openDone = new Set(openingGate().map((s) => `${s.id}@${CLINIC_DAY.readyBy}`));

  it('is closing, not closed, while the closing list is outstanding', () => {
    const day = runDay(at(20, 40), openDone);
    expect(day.clinic).toBe('CLOSING');
    expect(day.blocking.length).toBe(closingGate().length);
    expect(day.why).toMatch(/Nobody locks up/);
  });

  it('closes only when the closing list is done', () => {
    const done = new Set([
      ...openDone,
      ...closingGate().map((s) => `${s.id}@${CLINIC_DAY.closeBy}`),
    ]);
    expect(runDay(at(20, 40), done).clinic).toBe('CLOSED');
    expect(runDay(at(20, 40), done).why).toMatch(/nothing left behind/);
  });
});

describe('the run is pure', () => {
  it('gives the same day for the same clock, every time', () => {
    expect(runDay(at(14, 15))).toEqual(runDay(at(14, 15)));
  });

  it('ticks one occurrence without ticking its later repeats', () => {
    const round = DAILY_STANDARD.find((s) => s.rhythm === Rhythm.TWO_HOURLY)!;
    const times = dueTimes(round);
    const done = new Set([`${round.id}@${times[0]}`]);
    const day = runDay(at(18), done);
    const mine = day.items.filter((i) => i.standard.id === round.id);
    expect(mine.filter((i) => i.state === 'DONE')).toHaveLength(1);
    expect(mine.filter((i) => i.state === 'LATE').length).toBeGreaterThan(0);
  });
});
