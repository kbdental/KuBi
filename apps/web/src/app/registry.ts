/**
 * The dashboard registry.
 *
 * A dashboard is **a question, an audience and a set of sections**. It is not
 * a role, and it is not a filtered list of somebody else's screen.
 *
 * This file exists because of one line in the owner's review: *"don't
 * architect yourself into six."* Before it, adding a dashboard meant editing
 * the `Place` union, `TAB_ICON`, the nav list, the screen imports and the
 * render switch — five edits to shared files, repeated by every domain after
 * it. The shell now reads this table and contains no role names at all.
 *
 * The test for whether this is working: **adding HR should be a folder and a
 * registration.** If it needs an edit to `app.tsx`, this contract has failed
 * and this contract is what gets fixed.
 *
 * Fourteen entries, six of them live. The other eight are not aspirations in
 * a document — they are here, with their question written and an honest
 * status, because principle 3 says say the gap out loud. A registered gap is
 * visible in the product; a gap in a roadmap is visible to nobody.
 *
 * See docs/kubi-v3-dashboard-strategy.md §3–§4.
 */
import type { ReactElement } from 'react';

/** Where a dashboard has got to. Only LIVE renders a screen. */
export const DashboardStatus = {
  /** Built and reachable. */
  LIVE: 'LIVE',
  /** The data exists; the screen does not. Blocked on build time, nothing else. */
  PLANNED: 'PLANNED',
  /**
   * Nobody has decided what this domain *is* yet. Distinct from PLANNED on
   * purpose, and the distinction is the same one the evaluation model makes
   * between UNKNOWN and NOT_CONFIGURED: one is waiting on work, the other is
   * waiting on a decision. Rider is the worked example — the clinic has
   * riders, so the dashboard is justified; what is missing is what a rider
   * carries, who they are, and what proves a handover.
   */
  PENDING_DOMAIN_DEFINITION: 'PENDING_DOMAIN_DEFINITION',
} as const;
export type DashboardStatus = (typeof DashboardStatus)[keyof typeof DashboardStatus];

/**
 * Phase, per the owner's roadmap in docs/product-vision.md §7.
 *
 * 1 build · 2 pilot · 3 first external clinic · 4 after the core proves itself.
 * Phases 2 and 3 deliberately add no features.
 */
export type Phase = 1 | 2 | 3 | 4;

export interface Dashboard {
  id: string;
  /**
   * The ONE question this screen answers, in the words the person would use.
   * If you cannot write it in a sentence, it is not a dashboard — it is a
   * report, or it is two dashboards.
   */
  question: string;
  /** Nav label. Short: it sits in a 252px sidebar and a bottom tab bar. */
  label: string;
  /**
   * Roles that land here. Many-to-one on purpose: several roles ask the same
   * question, and sharing one implementation until they demonstrably diverge
   * beats maintaining nine copies of a briefing on a guess.
   */
  roles: string[];
  phase: Phase;
  status: DashboardStatus;
  /** For anything not LIVE: what is missing. Shown to the user, not hidden. */
  blockedBy?: string;
  /**
   * Rendered only when LIVE. Absent for the rest — which is what stops a
   * placeholder screen existing at all, rather than relying on discipline.
   */
  render?: (ctx: DashboardContext) => ReactElement;
  /** Where this role starts. Exactly one per role across the whole registry. */
  home?: boolean;
}

/** What the shell hands a dashboard. Deliberately small. */
export interface DashboardContext {
  go: (dashboardId: string) => void;
  reload: () => void;
  openTask: (taskId: string) => void;
}

const registry = new Map<string, Dashboard>();

export function registerDashboard(d: Dashboard): void {
  if (registry.has(d.id)) {
    // A duplicate id silently overwriting its predecessor would show one
    // role someone else's screen, which is the failure this file exists to
    // prevent. Refuse it at startup instead.
    throw new Error(`Dashboard "${d.id}" is already registered`);
  }
  if (d.status === DashboardStatus.LIVE && !d.render) {
    throw new Error(`Dashboard "${d.id}" is LIVE but has no render function`);
  }
  if (d.status !== DashboardStatus.LIVE && d.render) {
    throw new Error(`Dashboard "${d.id}" is not LIVE but has a render function`);
  }
  if (d.status !== DashboardStatus.LIVE && !d.blockedBy) {
    // Principle 3. A gap with no stated reason is indistinguishable from an
    // oversight, which is exactly how Patient Experience went unnoticed.
    throw new Error(`Dashboard "${d.id}" is ${d.status} and must say what it is blocked by`);
  }
  registry.set(d.id, d);
}

export function allDashboards(): Dashboard[] {
  return [...registry.values()];
}

/** Every dashboard this person can reach, registration order preserved. */
export function dashboardsFor(roleCodes: readonly string[]): Dashboard[] {
  return allDashboards().filter((d) => d.roles.some((r) => roleCodes.includes(r)));
}

/**
 * Where this person lands.
 *
 * Their marked home if they have one, else their first reachable dashboard.
 * Returns null rather than guessing when nothing matches — a role with no
 * dashboard is a real state (housekeeping, before the Assistant dashboard
 * ships) and the shell shows their task list instead.
 */
export function homeFor(roleCodes: readonly string[]): Dashboard | null {
  const mine = dashboardsFor(roleCodes);
  return mine.find((d) => d.home && d.status === DashboardStatus.LIVE)
    ?? mine.find((d) => d.status === DashboardStatus.LIVE)
    ?? null;
}

/** Test seam. Never called by the app. */
export function resetRegistry(): void {
  registry.clear();
}
