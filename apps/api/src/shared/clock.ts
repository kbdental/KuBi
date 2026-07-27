/**
 * The injectable clock. Phase 0.5 §18.
 *
 * Nothing in KuBi calls `new Date()` directly — the ESLint rule forbids it.
 * Time-triggered behaviour (TIME and DEADLINE triggers, SLA clocks, validity
 * windows) is only testable if time is a dependency rather than an ambient fact.
 *
 * All clinic-facing time is evaluated in the CLINIC's timezone; this port
 * returns UTC instants and the caller converts using clinic.timezone.
 */
export interface Clock {
  /** Current instant, UTC. */
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Test double. Advance deliberately; never wall-clock in a test. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(d: Date): void {
    this.current = d;
  }
}
