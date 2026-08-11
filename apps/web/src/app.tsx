import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
import { dashboardsFor, homeFor, DashboardStatus } from './app/registry.js';
import { registerAllDashboards } from './app/dashboards.js';
import { Patients } from './screens/patients.js';
import { Quality } from './screens/quality.js';
import { Standards } from './screens/standards.js';
import { ConfirmationsBoard } from './screens/confirmations.js';
import { Gate } from './screens/gate.js';
import { Clinic } from './screens/clinic.js';
import { Patient360 } from './screens/patient-360.js';
import { CommandPalette, useCommandKey } from './screens/command-palette.js';
import {
  IconToday, IconClinic, IconOverview, IconPatients, IconOperations,
} from './icons.js';
import { Shell, type RailItem } from './app/shell.js';
import { placesFor, type RoleCode } from '@kubi/contracts';
import { Dashboard } from './screens/dashboard.js';
import { ClinicReadiness } from './screens/readiness.js';
import { ClinicClosing } from './screens/closing.js';
import { PatientEvents } from './screens/patient-events.js';
import { Reception } from './screens/reception.js';
import { Equipment } from './screens/equipment.js';

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

/**
 * Somewhere to be. The fixed screens are named; dashboard ids come from the
 * registry, so this is a string rather than a closed union — closing it would
 * mean editing this file for every new dashboard, which is the coupling the
 * registry exists to remove.
 */
type Place = string;

// Once, at module load. Registration throws on a duplicate id or a dashboard
// that is LIVE with nothing to render, so a mistake here fails at startup
// rather than on the one screen nobody opened before shipping.
registerAllDashboards();

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
  // Null until the person navigates. Their role's home is the default, so the
  // landing screen is right without an effect that would flash the wrong one
  // first — and, crucially, WITHOUT a render-time redirect, which made the
  // manager's own task list unreachable: every click on it bounced back.
  const [chosen, setChosen] = useState<Place | null>(null);
  const [openTask, setOpenTask] = useState<TaskSheet | null>(null);
  const [openHandover, setOpenHandover] = useState<HandoverData | null>(null);
  // The patient record is opened over whatever you were doing and returns you
  // there. Everything in a clinic ends at a patient, so it is reachable from
  // several places rather than living behind one tab.
  const [openPatient, setOpenPatient] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  // Ctrl-K from anywhere. The fastest way to use KuBi, and the only thing on
  // the review list that removes navigation rather than adding to it.
  const [palette, setPalette] = useState(false);

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

  useCommandKey(() => setPalette(true));

  if (checking) return <div className="empty">One moment…</div>;

  if (!data) {
    return (
      <SignIn
        onSignedIn={() => {
          // Null, not a place: the default is resolved at render, so signing
          // in lands wherever the shell's home is rather than pinning the old
          // task list into state before the rail has been drawn.
          setChosen(null);
          reload();
        }}
      />
    );
  }

  const paletteEl = (
    <CommandPalette
      open={palette}
      onClose={() => setPalette(false)}
      onGo={(place) => { setOpenTask(null); setOpenPatient(null); setChosen(place); }}
      onOpenPatient={(label) => { setOpenTask(null); setOpenPatient(label); }}
    />
  );

  if (openTask) {
    return (
      <div className="app">
        {paletteEl}
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

  if (openPatient) {
    return (
      <div className="app">
        {paletteEl}
        <main className="main">
          <Patient360 patientLabel={openPatient} onBack={() => setOpenPatient(null)} />
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

  // The owner's KuBi is a different app, not a filtered one.
  const isOwner = data.me.roleCodes.includes('OWNER_DIRECTOR');

  // Which dashboards this person can reach, and where they land, both come
  // from the registry — the shell names no roles. Adding a dashboard is a
  // registration; it does not appear here.
  const myDashboards = dashboardsFor(data.me.roleCodes)
    .filter((d) => d.status === DashboardStatus.LIVE);
  const myHome = homeFor(data.me.roleCodes);

  // Resolved at render rather than by an effect: a redirect that runs after
  // paint shows the wrong screen first, which is the flicker every dashboard
  // has and nobody admits to. Someone with no dashboard yet — housekeeping,
  // until the Assistant screen ships — lands on their task list rather than
  // on somebody else's screen.
  // The dashboard is where everybody lands. The old role-homes are still
  // reachable — they are on the More list, not deleted — but "where is the
  // clinic" comes before "what do I owe", which is the design principle.
  const home: Place = 'DASHBOARD';
  const here: Place = chosen ?? home;
  void myHome;

  /**
   * The rail, which is a different rail for each role.
   *
   * *"All the task should not be seen by all, only related, so that confusion
   * does not happen — so all the staff will have a different look of the app."*
   *
   * `placesFor` decides, not this file, and it lives in the contracts package
   * beside the rest of the rules — a rail assembled from role checks scattered
   * through a component is a rail nobody can audit. The shell draws what it is
   * handed.
   *
   * Read the owner's sentence as written: a **different look**, not a smaller
   * one. The housekeeper's app is three places, so the rail itself tells her
   * what her job is; it is not the manager's six with three greyed out.
   *
   * The order never changes between roles. Muscle memory is worth more than
   * tailoring — readiness is always left of closing, for everybody.
   */
  const ICON: Record<string, ReactNode> = {
    DASHBOARD: <IconOverview filled={here === 'DASHBOARD'} />,
    READINESS: <IconClinic filled={here === 'READINESS'} />,
    RECEPTION: <IconPatients filled={here === 'RECEPTION'} />,
    PATIENT_EVENTS: <IconPatients filled={here === 'PATIENT_EVENTS'} />,
    EQUIPMENT: <IconOperations filled={here === 'EQUIPMENT'} />,
    CLOSING: <IconToday filled={here === 'CLOSING'} />,
    MORE: <IconToday filled={here === 'MORE'} />,
  };
  const RAIL_LABEL: Record<string, string> = {
    DASHBOARD: 'Dashboard',
    // Straight after the dashboard, on the owner's instruction: the clinic is
    // made ready, and then the patients it was made ready for arrive.
    READINESS: 'Clinic readiness',
    // *"This needs an extra tab after clinic readiness."* And it is the right
    // sequence: the clinic is made ready, the patient arrives, the patient
    // event happens.
    RECEPTION: 'Reception',
    PATIENT_EVENTS: 'Patient events',
    EQUIPMENT: 'Equipment',
    CLOSING: 'Clinic closing',
    MORE: 'More',
  };

  const myPlaces = placesFor(data.me.roleCodes as RoleCode[]).map(String);

  const rail: RailItem[] = myPlaces.map((id) => ({
    id,
    label: RAIL_LABEL[id] ?? id,
    icon: ICON[id] ?? <IconToday filled={here === id} />,
    ...(id === 'MORE'
      ? { count: data.attention.length, urgent: data.attention.length > 0 }
      : {}),
  }));

  const TITLES: Record<string, string> = {
    DASHBOARD: 'Dashboard',
    READINESS: 'Clinic readiness',
    // *"This needs an extra tab after clinic readiness."* And it is the right
    // sequence: the clinic is made ready, the patient arrives, the patient
    // event happens.
    RECEPTION: 'Reception',
    PATIENT_EVENTS: 'Patient events',
    EQUIPMENT: 'Equipment',
    CLOSING: 'Clinic closing',
    MORE: 'More',
  };

  // Everything under More is the previous shell's set, reached by its own id.
  const inMore = !['DASHBOARD', 'READINESS', 'RECEPTION', 'PATIENT_EVENTS',
    'EQUIPMENT', 'CLOSING'].includes(here);

  /**
   * A place this role may not reach, reached anyway.
   *
   * Only a courtesy — constitution rule 3 puts the real check on the server,
   * and every endpoint behind these screens already narrows by role. This is
   * here so a stale link or a back button lands on a sentence rather than on
   * an empty screen that looks broken.
   */
  const forbidden = ['READINESS', 'RECEPTION', 'PATIENT_EVENTS', 'EQUIPMENT', 'CLOSING']
    .includes(here) && !myPlaces.includes(here);

  return (
    <>
    {paletteEl}
    <Shell
      clinicName={data.day.clinic?.name ?? 'KB Dental'}
      items={rail}
      here={inMore ? 'MORE' : here}
      go={setChosen}
      whoRole={roleWord(data.me.roleCodes[0] ?? '')}
      title={TITLES[here] ?? label(here, myDashboards)}
      onSignOut={() => { void api.logout().finally(() => { setData(null); setChosen(null); }); }}
    >
      {forbidden && (
        <div className="screen">
          <p className="screen-sub">
            That part of KuBi belongs to another role. Your work is on the
            dashboard.
          </p>
        </div>
      )}
      {here === 'DASHBOARD' && <Dashboard go={setChosen} />}
      {here === 'READINESS' && !forbidden && <ClinicReadiness />}
      {here === 'RECEPTION' && !forbidden && <Reception />}
      {here === 'PATIENT_EVENTS' && !forbidden && <PatientEvents />}
      {here === 'EQUIPMENT' && !forbidden && <Equipment />}
      {here === 'CLOSING' && !forbidden && <ClinicClosing />}
      {here === 'MORE' && (
        <MoreMenu
          items={[
            ...myDashboards.map((d) => ({ id: d.id, label: d.label, question: d.question })),
            ...(!isOwner ? [{ id: 'TODAY', label: 'My tasks', question: 'What do I owe today?' }] : []),
            ...(!isOwner && data.schedule.rows.length > 0
              ? [{ id: 'CLINIC', label: 'Clinic', question: 'Who is here and who is next?' }] : []),
            ...(!isOwner && data.overview
              ? [{ id: 'PATIENTS', label: 'Patients', question: 'Who has stopped coming?' }] : []),
            ...(!isOwner ? [{ id: 'ATTENTION', label: 'Attention', question: 'What has gone wrong?' }] : []),
            ...(data.overview ? [{ id: 'QUALITY', label: 'Quality', question: 'What are we learning?' }] : []),
            ...(data.me.roleCodes.includes('RECEPTION')
              ? [{ id: 'CONFIRMATIONS', label: 'Confirmations', question: 'Who has not confirmed?' }] : []),
            ...(['TREATING_DOCTOR','DENTAL_ASSISTANT','SENIOR_ASSISTANT','CLINICAL_DIRECTOR']
              .some((r) => data.me.roleCodes.includes(r))
              ? [{ id: 'GATE', label: 'Gate', question: 'May this procedure start?' }] : []),
            ...(data.overview ? [{ id: 'STANDARDS', label: 'Standards', question: 'What is the standard?' }] : []),
            { id: 'ME', label: 'Me', question: 'My account.' },
          ]}
          go={setChosen}
        />
      )}

      {here === 'TODAY' && (
        <Today
          day={data.day}
          checks={data.checks}
          onOpenTask={(id) => void open(id)}
          onRefresh={reload}
          onOpenHandover={() => void openTheHandover()}
          onChecked={reload}
        />
      )}
      {here === 'CLINIC' && (
        <Clinic
          schedule={data.schedule}
          canAct={CAN_MOVE_VISITS.some((r) => data.me.roleCodes.includes(r))}
          onChanged={reload}
          showOperations={data.overview !== null}
          onOpenPatient={setOpenPatient}
        />
      )}
      {here === 'ATTENTION' && (
        <Attention
          items={data.attention}
          onResolved={reload}
          onOpenTask={(id) => void open(id)}
        />
      )}
      {/* Dashboards render themselves. The shell hands each one a way to
          navigate, reload and open a task, and knows nothing else about it. */}
      {myDashboards.find((d) => d.id === here)?.render?.({
        go: setChosen,
        reload,
        openTask: (id) => void open(id),
      })}
      {here === 'PATIENTS' && <Patients onChanged={reload} onOpenPatient={setOpenPatient} />}
      {here === 'QUALITY' && <Quality onChanged={reload} />}
      {here === 'STANDARDS' && <Standards />}
      {here === 'CONFIRMATIONS' && <ConfirmationsBoard />}
      {here === 'GATE' && <Gate />}
      {here === 'ME' && (
        <MeScreen me={data.me} onSignedOut={() => { setData(null); setChosen(null); }} />
      )}
    </Shell>
    </>
  );
}

/** A dashboard's own label, for the bar above the content. */
function label(id: string, dashboards: ReadonlyArray<{ id: string; label: string }>): string {
  return dashboards.find((d) => d.id === id)?.label ?? id.replace(/_/g, ' ');
}

const roleWord = (role: string) =>
  role.replace(/_/g, ' ').toLowerCase().replace(/^./, (ch) => ch.toUpperCase());

/**
 * More — the places that are not yet on the rail.
 *
 * A list with each screen's own question rather than a grid of names: "Gate"
 * means nothing to somebody who has not used it, and "May this procedure
 * start?" means everything.
 */
function MoreMenu({
  items, go,
}: {
  items: ReadonlyArray<{ id: string; label: string; question: string }>;
  go: (id: string) => void;
}) {
  return (
    <div className="screen">
      <div className="dash-list">
        {items.map((it) => (
          <button key={it.id} className="dash-row more-row" type="button" onClick={() => go(it.id)}>
            <div className="dash-row-body">
              <div className="dash-row-title">{it.label}</div>
              <div className="dash-row-meta">{it.question}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}



/** Who you are, where you are, and the way out. Nothing else belongs here yet. */
function MeScreen({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="screen">
      {/* The role, not the person. Names change; roles do not, and every rule
          in the engine is written against one. */}
      <h1 className="screen-title">{roleWord(me.roleCodes[0] ?? '')}</h1>
      <p className="screen-sub">
        {me.roleCodes.length > 1
          ? `Also ${me.roleCodes.slice(1).map(roleWord).join(', ').toLowerCase()}. `
          : ''}
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
