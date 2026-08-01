import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  api, ApiError,
  type Me, type MyDay, type TaskSheet, type AttentionRow, type CheckRow, type Schedule,
  type Overview as OverviewData, type Handover as HandoverData,
} from './api.js';
import { Handover } from './screens/handover.js';
import { SignIn } from './screens/sign-in.js';
import { Today } from './screens/today.js';
import { TaskSheetScreen } from './screens/task-sheet.js';
import { Attention } from './screens/attention.js';
import { OwnerMIS } from './screens/owner-mis.js';
import { Operations } from './screens/operations.js';
import { Patients } from './screens/patients.js';
import { Quality } from './screens/quality.js';
import { Checks } from './screens/checks.js';
import { Clinic } from './screens/clinic.js';
import { Overview } from './screens/overview.js';
import {
  IconToday, IconClinic, IconAttention, IconChecks,
  IconQuality, IconPatients, IconOperations, IconMe, IconOverview,
} from './icons.js';

/**
 * The shell.
 *
 * Deliberately not a router: VS-01 has a handful of places to be, and a URL
 * scheme would be a promise about navigation we haven't designed yet. When
 * there is a real reason to deep-link, that is the moment to add one.
 *
 * Tabs only appear when they have something behind them. Checks is hidden
 * from people who are nobody's checker, rather than shown empty — an empty
 * tab is a small daily lie about what this person's job is.
 */

/**
 * Who moves a visit along. A courtesy only — the server decides, and refuses
 * anyone else. Hiding a button they cannot use beats offering a dead end.
 */
const CAN_MOVE_VISITS = [
  'RECEPTION', 'CLINIC_MANAGER', 'CLINIC_HEAD', 'OWNER_DIRECTOR',
  'TREATING_DOCTOR', 'CLINICAL_DIRECTOR',
];

type Place = 'MIS' | 'OPERATIONS' | 'OVERVIEW' | 'TODAY' | 'CLINIC' | 'PATIENTS' | 'ATTENTION' | 'QUALITY' | 'CHECKS' | 'ME';

interface Loaded {
  me: Me;
  day: MyDay;
  attention: AttentionRow[];
  checks: CheckRow[];
  schedule: Schedule;
  /** Null for anyone who may not see clinic-wide performance. */
  overview: OverviewData | null;
}

export function App() {
  const [data, setData] = useState<Loaded | null>(null);
  const [place, setPlace] = useState<Place>('TODAY');
  const [openTask, setOpenTask] = useState<TaskSheet | null>(null);
  const [openHandover, setOpenHandover] = useState<HandoverData | null>(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    // The schedule is not fatal: someone who cannot see it still has a Today.
    const [me, day, attention, checks, schedule, overview] = await Promise.all([
      api.me(), api.myDay(), api.attention(), api.checks(),
      api.schedule().catch((): Schedule => ({ rows: [], periodKey: null })),
      // A 403 here is the correct answer for most people, not a failure.
      api.overview().catch(() => null),
    ]);
    setData({ me, day, attention, checks, schedule, overview });
  }, []);

  // On load, find out whether the cookie we may already hold is still good.
  useEffect(() => {
    refresh()
      .catch(() => setData(null))
      .finally(() => setChecking(false));
  }, [refresh]);

  const reload = useCallback(() => {
    refresh().catch((err) => {
      if (err instanceof ApiError && err.status === 401) setData(null);
    });
  }, [refresh]);

  if (checking) return <div className="empty">One moment…</div>;

  if (!data) {
    return (
      <SignIn
        onSignedIn={() => {
          setPlace('TODAY');
          reload();
        }}
      />
    );
  }

  if (openTask) {
    return (
      <div className="app">
        <main className="main">
          <TaskSheetScreen
            sheet={openTask}
            onBack={() => setOpenTask(null)}
            onFinished={() => { setOpenTask(null); reload(); }}
          />
        </main>
      </div>
    );
  }

  if (openHandover) {
    return (
      <div className="app">
        <main className="main">
          <div className="screen screen-tight">
            <button className="back" type="button" onClick={() => setOpenHandover(null)}>
              Back
            </button>
          </div>
          <Handover data={openHandover} />
        </main>
      </div>
    );
  }

  async function open(id: string) {
    try {
      setOpenTask(await api.task(id));
    } catch {
      reload();
    }
  }

  // Fetched on demand rather than with every refresh: it is read once at the
  // end of a day, and paying for it on every poll all morning is waste.
  async function openTheHandover() {
    try {
      setOpenHandover(await api.handover());
    } catch {
      reload();
    }
  }

  const showChecks = data.checks.length > 0;
  // The owner's KuBi is a different app, not a filtered one.
  const isOwner = data.me.roleCodes.includes('OWNER_DIRECTOR');
  // TODAY does not exist for an owner, so landing there would show an empty
  // frame. Resolved at render rather than by an effect: a redirect that runs
  // after paint shows the wrong screen first, which is the flicker every
  // dashboard has and nobody admits to.
  const here: Place = isOwner && place === 'TODAY' ? 'MIS' : place;

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-brand">
          <span className="nav-mark">KuBi</span>
          {data.day.clinic && <span className="nav-clinic">{data.day.clinic.name}</span>}
        </div>
        <div className="nav-items">
          {/* An owner is not a manager with more permissions. "You should not
              see 150 tasks" is a different screen, not a filtered one — so the
              owner gets the MIS and none of the operational tabs. */}
          {isOwner && <Tab id="MIS" label="Dashboard" now={here} go={setPlace} />}
          {!isOwner && data.overview && <Tab id="OVERVIEW" label="Overview" now={here} go={setPlace} />}
          {!isOwner && <Tab id="TODAY" label="Today" now={here} go={setPlace} />}
          {!isOwner && data.schedule.rows.length > 0 && (
            <Tab id="CLINIC" label="Clinic" now={here} go={setPlace} />
          )}
          {/* Readiness before the chair, follow-up after it. Clinical work, so
              it follows the same permission as the clinic-wide views. */}
          {!isOwner && data.overview && <Tab id="PATIENTS" label="Patients" now={here} go={setPlace} />}
          {/* Equipment, stock and sterilisation. Clinic-wide, so it follows the
              same permission as the other whole-clinic views. */}
          {!isOwner && data.overview && <Tab id="OPERATIONS" label="Operations" now={here} go={setPlace} />}
          {!isOwner && (
            <Tab
              id="ATTENTION"
              label="Attention"
              now={place}
              go={setPlace}
              count={data.attention.length}
            />
          )}
          {!isOwner && showChecks && (
            <Tab id="CHECKS" label="Checks" now={here} go={setPlace} count={data.checks.length} />
          )}
          {/* The IMPROVE stage. Clinic-wide, like Overview: an assistant has a
              day, a manager has a clinic — and learning is a clinic's job. */}
          {data.overview && <Tab id="QUALITY" label="Quality" now={here} go={setPlace} />}
          <Tab id="ME" label="Me" now={here} go={setPlace} />
        </div>
        <div className="nav-who">
          <span className="nav-who-name">{data.me.displayLabel}</span>
        </div>
      </nav>

      <main className="main">
      {here === 'OVERVIEW' && data.overview && (
        <Overview
          data={data.overview}
          attention={data.attention}
          schedule={data.schedule}
          onGoToAttention={() => setPlace('ATTENTION')}
          onGoToClinic={() => setPlace('CLINIC')}
        />
      )}
      {here === 'TODAY' && (
        <Today
          day={data.day}
          onOpenTask={(id) => void open(id)}
          onRefresh={reload}
          onOpenHandover={() => void openTheHandover()}
        />
      )}
      {here === 'CLINIC' && (
        <Clinic
          schedule={data.schedule}
          canAct={CAN_MOVE_VISITS.some((r) => data.me.roleCodes.includes(r))}
          onChanged={reload}
        />
      )}
      {here === 'ATTENTION' && (
        <Attention
          items={data.attention}
          onResolved={reload}
          onOpenTask={(id) => void open(id)}
        />
      )}
      {here === 'MIS' && <OwnerMIS onGoToQuality={() => setPlace('QUALITY')} />}
      {here === 'PATIENTS' && <Patients onChanged={reload} />}
      {here === 'OPERATIONS' && <Operations onChanged={reload} />}
      {here === 'QUALITY' && <Quality onChanged={reload} />}
      {here === 'CHECKS' && <Checks items={data.checks} onDone={reload} />}
      {here === 'ME' && (
        <MeScreen me={data.me} onSignedOut={() => { setData(null); setPlace('TODAY'); }} />
      )}
      </main>
    </div>
  );
}

const TAB_ICON: Record<Place, (p: { filled: boolean }) => ReactElement> = {
  OVERVIEW: ({ filled }) => <IconOverview filled={filled} />,
  TODAY: ({ filled }) => <IconToday filled={filled} />,
  CLINIC: ({ filled }) => <IconClinic filled={filled} />,
  ATTENTION: ({ filled }) => <IconAttention filled={filled} />,
  MIS: ({ filled }) => <IconOverview filled={filled} />,
  PATIENTS: ({ filled }) => <IconPatients filled={filled} />,
  OPERATIONS: ({ filled }) => <IconOperations filled={filled} />,
  QUALITY: ({ filled }) => <IconQuality filled={filled} />,
  CHECKS: ({ filled }) => <IconChecks filled={filled} />,
  ME: ({ filled }) => <IconMe filled={filled} />,
};

function Tab({
  id, label, now, go, count,
}: {
  id: Place;
  label: string;
  now: Place;
  go: (p: Place) => void;
  count?: number;
}) {
  const on = now === id;
  const Icon = TAB_ICON[id];
  return (
    <button
      className="tab"
      type="button"
      onClick={() => go(id)}
      // Without this the badge is read before the label — "2Attention".
      aria-label={count ? `${label}, ${count} waiting` : label}
      {...(on ? { 'aria-current': 'page' as const } : {})}
    >
      <span className="tab-icon">
        <Icon filled={on} />
        {count !== undefined && count > 0 && (
          <span className="tab-count" aria-hidden="true">{count > 9 ? '9+' : count}</span>
        )}
      </span>
      <span className="tab-label" aria-hidden="true">{label}</span>
    </button>
  );
}

/** Who you are, where you are, and the way out. Nothing else belongs here yet. */
function MeScreen({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="screen">
      <h1 className="screen-title">{me.displayLabel}</h1>
      <p className="screen-sub">
        {me.crossClinic
          ? 'You can see every clinic.'
          : `You're working at ${me.clinicIds.length === 1 ? 'one clinic' : `${me.clinicIds.length} clinics`}.`}
      </p>

      <button
        className="btn btn-quiet"
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void api.logout().finally(onSignedOut);
        }}
      >
        Sign out
      </button>
    </div>
  );
}
