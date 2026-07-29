import { useCallback, useEffect, useState } from 'react';
import {
  api, ApiError,
  type Me, type MyDay, type TaskSheet, type AttentionRow, type CheckRow, type Schedule,
} from './api.js';
import { SignIn } from './screens/sign-in.js';
import { Today } from './screens/today.js';
import { TaskSheetScreen } from './screens/task-sheet.js';
import { Attention } from './screens/attention.js';
import { Checks } from './screens/checks.js';
import { Clinic } from './screens/clinic.js';

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

type Place = 'TODAY' | 'CLINIC' | 'ATTENTION' | 'CHECKS' | 'ME';

interface Loaded {
  me: Me;
  day: MyDay;
  attention: AttentionRow[];
  checks: CheckRow[];
  schedule: Schedule;
}

export function App() {
  const [data, setData] = useState<Loaded | null>(null);
  const [place, setPlace] = useState<Place>('TODAY');
  const [openTask, setOpenTask] = useState<TaskSheet | null>(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    // The schedule is not fatal: someone who cannot see it still has a Today.
    const [me, day, attention, checks, schedule] = await Promise.all([
      api.me(), api.myDay(), api.attention(), api.checks(),
      api.schedule().catch((): Schedule => ({ rows: [], periodKey: null })),
    ]);
    setData({ me, day, attention, checks, schedule });
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
        <TaskSheetScreen
          sheet={openTask}
          onBack={() => setOpenTask(null)}
          onFinished={() => { setOpenTask(null); reload(); }}
        />
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

  const showChecks = data.checks.length > 0;

  return (
    <div className="app">
      {place === 'TODAY' && (
        <Today day={data.day} onOpenTask={(id) => void open(id)} onRefresh={reload} />
      )}
      {place === 'CLINIC' && (
        <Clinic
          schedule={data.schedule}
          canAct={CAN_MOVE_VISITS.some((r) => data.me.roleCodes.includes(r))}
          onChanged={reload}
        />
      )}
      {place === 'ATTENTION' && (
        <Attention
          items={data.attention}
          onResolved={reload}
          onOpenTask={(id) => void open(id)}
        />
      )}
      {place === 'CHECKS' && <Checks items={data.checks} onDone={reload} />}
      {place === 'ME' && (
        <MeScreen me={data.me} onSignedOut={() => { setData(null); setPlace('TODAY'); }} />
      )}

      <nav className="tabs">
        <Tab id="TODAY" label="Today" now={place} go={setPlace} />
        {data.schedule.rows.length > 0 && (
          <Tab id="CLINIC" label="Clinic" now={place} go={setPlace} />
        )}
        <Tab
          id="ATTENTION"
          label="Attention"
          now={place}
          go={setPlace}
          count={data.attention.length}
        />
        {showChecks && (
          <Tab id="CHECKS" label="Checks" now={place} go={setPlace} count={data.checks.length} />
        )}
        <Tab id="ME" label="Me" now={place} go={setPlace} />
      </nav>
    </div>
  );
}

function Tab({
  id, label, now, go, count,
}: {
  id: Place;
  label: string;
  now: Place;
  go: (p: Place) => void;
  count?: number;
}) {
  return (
    <button
      className="tab"
      type="button"
      onClick={() => go(id)}
      {...(now === id ? { 'aria-current': 'page' as const } : {})}
    >
      <span className="tab-mark" aria-hidden="true" />
      <span>
        {label}
        {count !== undefined && count > 0 && <span className="tab-count" style={{ marginLeft: 6 }}>{count}</span>}
      </span>
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
