/**
 * Clinic Operating Standards — the spine, promoted to a primary destination.
 *
 * This is KuBi's differentiator made visible. Every other product in this
 * market ships a task list, and a task list answers "was it ticked". This
 * answers "against what standard, decided by whom, weighted how, depending on
 * what, proved how well, and moving which way".
 *
 * Five layers on one screen, because they are only useful together:
 *
 *   weight        attendance is not sterilisation
 *   owner         one name, or nobody is accountable
 *   dependency    a parameter cannot outrank what it stands on
 *   health        with a direction, which matters more than the number
 *   confidence    a photo is not an autoclave printout
 */
import {
  PARAMETER_SPEC, PARAMETER_LABEL, CLASS_WEIGHT, DECISION_REQUIRED,
  weightOf, dependents, unattainableClasses, attainableWeight,
  type Parameter, type WeightClass,
} from '@kubi/contracts';
import { useEffect, useState } from 'react';
import { api, type ParameterHealthRow } from '../api.js';
import { ActivityLibrary } from './activity-library.js';

const CLASS_LABEL: Record<WeightClass, string> = {
  PATIENT_SAFETY: 'Patient safety',
  CLINICAL_QUALITY: 'Clinical quality',
  PATIENT_EXPERIENCE: 'Patient experience',
  OPERATIONS: 'Operations',
  BUSINESS: 'Business',
};

const TREND_LABEL: Record<string, string> = {
  IMPROVING: 'improving',
  STABLE: 'stable',
  DECLINING: 'declining',
  NEEDS_INTERVENTION: 'needs intervention',
  UNKNOWN: 'not enough history',
};
const TREND_MARK: Record<string, string> = {
  IMPROVING: '↑', STABLE: '→', DECLINING: '↓',
  NEEDS_INTERVENTION: '↓↓', UNKNOWN: '·',
};

const ORDER: WeightClass[] = [
  'PATIENT_SAFETY', 'CLINICAL_QUALITY', 'PATIENT_EXPERIENCE', 'OPERATIONS', 'BUSINESS',
];

export function Standards() {
  const [health, setHealth] = useState<ParameterHealthRow[] | null>(null);
  // Parameters and Activities are two views of one spine, so they share a
  // destination rather than adding a tab. Navigation is unchanged.
  const [view, setView] = useState<'PARAMETERS' | 'ACTIVITIES'>('PARAMETERS');
  useEffect(() => { void api.parameterHealth().then(setHealth).catch(() => setHealth([])); }, []);

  const byId = new Map((health ?? []).map((h) => [h.parameter, h]));
  const params = Object.keys(PARAMETER_SPEC) as Parameter[];
  const gap = unattainableClasses();

  return (
    <div className="screen screen-wide">
      <h1 className="screen-title">Clinic operating standards</h1>

      <div className="std-switch">
        <button
          className={`std-tab ${view === 'PARAMETERS' ? 'is-on' : ''}`}
          type="button"
          onClick={() => setView('PARAMETERS')}
        >
          Parameters
        </button>
        <button
          className={`std-tab ${view === 'ACTIVITIES' ? 'is-on' : ''}`}
          type="button"
          onClick={() => setView('ACTIVITIES')}
        >
          Activities
        </button>
      </div>

      {view === 'ACTIVITIES' && <ActivityLibrary />}

      {view === 'PARAMETERS' && <>
      <p className="screen-sub">
        Sixteen control parameters. What each is worth, who owns it, what it stands on,
        and which way it is moving.
      </p>

      {/* Ten points nobody can earn yet. Said once, plainly, rather than
          quietly folded into the arithmetic. */}
      {gap.length > 0 && (
        <p className="std-gap">
          A clinic can currently earn <b>{attainableWeight()}</b> of 100.{' '}
          {gap.map((c) => CLASS_LABEL[c]).join(' and ')} has no parameters yet, so its{' '}
          {gap.reduce((n, c) => n + CLASS_WEIGHT[c], 0)} points are reserved rather than
          shared out — a score that jumped on a release day would not mean anything.
        </p>
      )}

      {ORDER.map((cls) => {
        const inClass = params.filter((p) => PARAMETER_SPEC[p].weightClass === cls);
        return (
          <section key={cls} className="std-class">
            <h2 className="std-class-head">
              <span>{CLASS_LABEL[cls]}</span>
              <span className="std-class-weight">{CLASS_WEIGHT[cls]}%</span>
            </h2>

            {inClass.length === 0 ? (
              <p className="std-empty">
                No parameters yet — Phase 4. Its {CLASS_WEIGHT[cls]} points are held open.
              </p>
            ) : (
              <div className="std-rows">
                {inClass.map((p) => (
                  <Row key={p} p={p} health={byId.get(p) ?? null} />
                ))}
              </div>
            )}
          </section>
        );
      })}
      </>}
    </div>
  );
}

function Row({ p, health }: { p: Parameter; health: ParameterHealthRow | null }) {
  const spec = PARAMETER_SPEC[p];
  const feeds = dependents(p);
  const trend = health?.trend ?? 'UNKNOWN';
  const unowned = spec.owner === DECISION_REQUIRED;

  return (
    <div className="std-row">
      <div className="std-main">
        <div className="std-name">{PARAMETER_LABEL[p]}</div>

        <div className="std-meta">
          <span className="std-weight">{weightOf(p).toFixed(1)} pts</span>
          {/* One owner, or the absence said out loud rather than left blank. */}
          {unowned ? (
            <span className="std-unowned">owner not decided</span>
          ) : (
            <span className="std-owner">{spec.owner.replace(/_/g, ' ').toLowerCase()}</span>
          )}
        </div>

        {/* The graph, in the two directions that matter operationally. */}
        {spec.dependsOn.length > 0 && (
          <div className="std-dep">
            needs {spec.dependsOn.map((d) => PARAMETER_LABEL[d]).join(', ').toLowerCase()}
          </div>
        )}
        {feeds.length > 0 && (
          <div className="std-dep std-feeds">
            feeds {feeds.map((d) => PARAMETER_LABEL[d]).join(', ').toLowerCase()}
          </div>
        )}

        {/* A parameter cannot honestly outrank what it stands on. */}
        {health && health.blockedBy.length > 0 && (
          <div className="std-blocked">
            held back by {health.blockedBy
              .map((d) => PARAMETER_LABEL[d as Parameter] ?? d).join(', ').toLowerCase()}
          </div>
        )}
      </div>

      <div className="std-health">
        <div className={`std-score std-${trend.toLowerCase()}`}>
          {/* Null is "nothing to measure", never 0. */}
          {health?.score === null || health === null
            ? <span className="std-nil">not measured</span>
            : <>{health.score}<span className="std-pct">%</span></>}
        </div>
        <div className="std-trend">
          <span aria-hidden="true">{TREND_MARK[trend]}</span> {TREND_LABEL[trend]}
          {health?.days ? ` ${health.days}d` : ''}
        </div>
        {health?.confidence !== null && health?.confidence !== undefined && (
          // Two clinics can both report 100% while one proves it with printouts
          // and the other with ticked boxes. This is the difference.
          <div className="std-conf">evidence {health.confidence}%</div>
        )}
      </div>
    </div>
  );
}
