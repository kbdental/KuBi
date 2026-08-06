/**
 * The registry is the promise that a fifteenth dashboard costs a folder and a
 * registration. These tests are that promise written down.
 *
 * The interesting ones are not "does it register" — they are the refusals.
 * A dashboard that is not LIVE and does not say why would let a gap look like
 * an oversight, which is precisely how Patient Experience went unnoticed for
 * the whole first pass of this design.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerDashboard, allDashboards, dashboardsFor, homeFor, resetRegistry,
  DashboardStatus,
} from '../../apps/web/src/app/registry.js';
import { registerAllDashboards } from '../../apps/web/src/app/dashboards.js';

const live = {
  id: 'X', question: 'Q?', label: 'X', roles: ['R'], phase: 1 as const,
  status: DashboardStatus.LIVE, render: () => <div />,
};

describe('the registry refuses what would mislead', () => {
  beforeEach(resetRegistry);

  it('refuses a duplicate id, rather than showing one role another’s screen', () => {
    registerDashboard(live);
    expect(() => registerDashboard(live)).toThrow(/already registered/i);
  });

  it('refuses a LIVE dashboard with nothing to render', () => {
    expect(() => registerDashboard({ ...live, render: undefined }))
      .toThrow(/LIVE but has no render/i);
  });

  it('refuses a render function on a dashboard that is not built', () => {
    // This is what stops a placeholder screen existing at all. The brief said
    // "no placeholder screens"; this makes it structural rather than a habit.
    expect(() => registerDashboard({
      ...live, status: DashboardStatus.PLANNED, blockedBy: 'x',
    })).toThrow(/not LIVE but has a render/i);
  });

  it('refuses an unbuilt dashboard that does not say what it is waiting for', () => {
    expect(() => registerDashboard({
      ...live, status: DashboardStatus.PLANNED, render: undefined,
    })).toThrow(/must say what it is blocked by/i);
  });
});

describe('routing by role', () => {
  beforeEach(() => { resetRegistry(); registerAllDashboards(); });

  it('gives the owner and the manager different dashboards, not one filtered', () => {
    const owner = dashboardsFor(['OWNER_DIRECTOR']).map((d) => d.id);
    const manager = dashboardsFor(['CLINIC_MANAGER']).map((d) => d.id);
    expect(owner).toContain('OWNER');
    expect(manager).toContain('COMMAND');
    expect(owner).not.toContain('COMMAND');
    expect(manager).not.toContain('OWNER');
  });

  it('lands each role on its own home', () => {
    expect(homeFor(['OWNER_DIRECTOR'])?.id).toBe('OWNER');
    expect(homeFor(['CLINIC_MANAGER'])?.id).toBe('COMMAND');
    expect(homeFor(['RECEPTION'])?.id).toBe('DESK');
  });

  it('returns null rather than guessing for a role with no live dashboard', () => {
    // A role with no dashboard must land on its own task list, never on
    // somebody else's screen. Housekeeping used to be the example here and now
    // has one of its own — INVENTORY_COORDINATOR is the current case.
    expect(homeFor(['INVENTORY_COORDINATOR'])).toBeNull();
    expect(homeFor([])).toBeNull();
  });

  it('never routes anyone to an unbuilt dashboard', () => {
    const roles = ['TREATING_DOCTOR', 'DENTAL_ASSISTANT', 'LAB_COORDINATOR',
      'SENIOR_ASSISTANT', 'INVENTORY_COORDINATOR', 'QUALITY_COMPLIANCE'];
    for (const r of roles) {
      const home = homeFor([r]);
      expect(home === null || home.status === DashboardStatus.LIVE).toBe(true);
    }
  });

  it('gives a role with two hats both dashboards', () => {
    const both = dashboardsFor(['CLINIC_MANAGER', 'RECEPTION']).map((d) => d.id);
    expect(both).toEqual(expect.arrayContaining(['COMMAND', 'DESK']));
  });
});

describe('the registry as a record of what is missing', () => {
  beforeEach(() => { resetRegistry(); registerAllDashboards(); });

  it('registers far more than it builds, and knows the difference', () => {
    // The owner's instruction: "don't architect yourself into six." An exact
    // total is churn — what matters is that the registry keeps growing without
    // the shell changing, and that it never loses track of which are real.
    const all = allDashboards();
    const built = all.filter((d) => d.status === DashboardStatus.LIVE);
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(built.length).toBeLessThan(all.length);
  });

  it('builds exactly the clinical workflow in phase 1, and nothing else', () => {
    // Doctor, assistant, lab, reception, sterilisation — the five the owner
    // scoped — plus the owner's and manager's, which were already live, plus
    // RETENTION, the first dashboard built from the staff guidelines rather
    // than from the original scope.
    const built = allDashboards()
      .filter((d) => d.status === DashboardStatus.LIVE).map((d) => d.id).sort();
    expect(built).toEqual([
      'ASSISTANT', 'COMMAND', 'DESK', 'DOCTOR', 'HOUSEKEEPING', 'LAB', 'OWNER',
      'RETENTION', 'STERILIZATION',
    ]);
  });

  it('keeps Rider registered rather than removed', () => {
    const rider = allDashboards().find((d) => d.id === 'RIDER');
    expect(rider).toBeDefined();
    expect(rider?.status).toBe(DashboardStatus.PENDING_DOMAIN_DEFINITION);
    expect(rider?.question).toMatch(/carrying/i);
  });

  it('gives every dashboard a question somebody would actually ask', () => {
    for (const d of allDashboards()) {
      expect(d.question, `${d.id} has no question`).toMatch(/\?$/);
    }
  });

  it('says out loud what each unbuilt dashboard is waiting for', () => {
    for (const d of allDashboards()) {
      if (d.status === DashboardStatus.LIVE) continue;
      expect(d.blockedBy, `${d.id} is silent about why`).toBeTruthy();
      expect(d.blockedBy!.length).toBeGreaterThan(20);
    }
  });

  it('marks exactly one home per role that has one', () => {
    for (const role of ['OWNER_DIRECTOR', 'CLINIC_MANAGER', 'RECEPTION']) {
      const homes = dashboardsFor([role]).filter((d) => d.home);
      expect(homes, `${role} has ${homes.length} homes`).toHaveLength(1);
    }
  });
});
