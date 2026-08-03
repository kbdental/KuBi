/**
 * The Activity as the atomic unit of KuBi.
 *
 * The owner's inversion, and it is the right one. Today activities *belong to*
 * parameters — a parameter owns a list, and everything else (KPIs, dashboards,
 * roles, SOPs, training, audits, incidents, CAPA) is joined to the parameter or
 * to nothing at all. That makes the parameter the unit and forces every new
 * concern to be hung off it.
 *
 * Inverted: the activity knows all of its own relationships, and a parameter
 * becomes a *view* — the set of activities that name it. So does a dashboard,
 * a role's work, an SOP's contents, a training syllabus, an audit's scope.
 *
 * What this buys, concretely:
 *
 *   - "Which training does this failure imply?" becomes a field lookup rather
 *     than a join nobody wrote.
 *   - "What does this SOP actually govern?" is answerable, so an SOP can be
 *     generated from the system instead of drifting beside it.
 *   - A new concern — say, which maturity grade an activity counts toward — is
 *     one field on one record, not a new table joined to sixteen parameters.
 *   - An activity can serve two parameters honestly, which the old shape could
 *     only fake by duplicating the row. Prototype #1 had 136 rows for 119
 *     activities for exactly this reason.
 *
 * Nothing here changes what an activity *is*. The frozen matrix remains the
 * single source and every field below is either read from it or derived from
 * it — non-negotiable 4.
 */
import type { Parameter, RoleCode, EvidenceType } from './enums.js';

/** A reference that may not be resolvable yet. Absence is stated, not implied. */
export type Ref<T extends string> = T | null;

export interface ActivityRecord {
  /** ATT-001, STER-004. Stable across matrix versions. */
  id: string;
  title: string;
  standard: string;

  // ── What kind of control this is ──────────────────────────────────────
  /**
   * Usually one. A few activities genuinely serve two control heads — an
   * emergency-kit check is both safety and opening readiness — and saying so
   * once beats duplicating the row and letting the copies drift.
   */
  parameters: Parameter[];
  /** The workflow it sits in. Orthogonal to parameter — see enums.ts. */
  process: string;
  priority: 'PATIENT_SAFETY' | 'CRITICAL' | 'IMPORTANT' | 'ROUTINE';

  // ── When, who, and what proves it ─────────────────────────────────────
  trigger: string;
  frequency: string;
  /** Null where the matrix has not decided. Seeds DISABLED rather than guessed. */
  dueRule: string | null;
  doer: Ref<string>;
  /** Null means self-verification is permitted; it is not "nobody checks". */
  checker: Ref<string>;
  accountableOwner: Ref<string>;
  evidenceType: EvidenceType;
  evidenceRequired: boolean;

  // ── The relationships the inversion adds ──────────────────────────────
  /** KPIs this activity feeds. Empty is legitimate; null would not be. */
  kpis: string[];
  /** Dashboards that surface it, by registry id. */
  dashboards: string[];
  /** Roles that see it at all — doer, checker and owner resolved to codes. */
  roles: RoleCode[];
  /** The written procedure it implements. Null until SOPs exist. */
  sop: Ref<string>;
  /** Competency required to perform it. Null until Learning ships. */
  training: Ref<string>;
  /** Audit programme that samples it. */
  audit: Ref<string>;
  /** Failure of this activity raises an incident of this type. */
  incidentType: Ref<string>;
  /** Whether failure obliges a CAPA, and under what condition. */
  capaRule: Ref<string>;

  /** Where the rule came from. DISABLED unless resolved. */
  provenance: string;
  enabled: boolean;
}

/**
 * A view over activities. Every "screen" in the standards spine is one of
 * these, which is the whole point of the inversion — none of them needs its
 * own storage.
 */
export interface ActivityView {
  key: string;
  label: string;
  activityIds: string[];
}

const byPredicate = (
  key: string, label: string, all: ActivityRecord[], p: (a: ActivityRecord) => boolean,
): ActivityView => ({ key, label, activityIds: all.filter(p).map((a) => a.id) });

/** A parameter is now a view, not an owner. */
export const activitiesInParameter = (all: ActivityRecord[], parameter: Parameter) =>
  byPredicate(parameter, parameter, all, (a) => a.parameters.includes(parameter));

export const activitiesForRole = (all: ActivityRecord[], role: RoleCode) =>
  byPredicate(role, role, all, (a) => a.roles.includes(role));

export const activitiesOnDashboard = (all: ActivityRecord[], dashboardId: string) =>
  byPredicate(dashboardId, dashboardId, all, (a) => a.dashboards.includes(dashboardId));

export const activitiesForKpi = (all: ActivityRecord[], kpi: string) =>
  byPredicate(kpi, kpi, all, (a) => a.kpis.includes(kpi));

export const activitiesUnderSop = (all: ActivityRecord[], sop: string) =>
  byPredicate(sop, sop, all, (a) => a.sop === sop);

export const activitiesNeedingTraining = (all: ActivityRecord[], training: string) =>
  byPredicate(training, training, all, (a) => a.training === training);

export const activitiesInAudit = (all: ActivityRecord[], audit: string) =>
  byPredicate(audit, audit, all, (a) => a.audit === audit);
