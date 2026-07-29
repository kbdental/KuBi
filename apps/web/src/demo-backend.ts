/**
 * A stand-in for the KuBi server, running in the browser.
 *
 * This exists so the real app can be handed over as one file that opens and
 * works — no database, no API process, no network. Every screen, component and
 * piece of copy below is the actual product; only the thing answering the
 * requests is different.
 *
 * IMPORTANT, and stated plainly because it matters: the rules reimplemented
 * here are a FAITHFUL COPY, not the enforcement. Real enforcement lives on the
 * server and is what the 127 tests cover. A browser can always be lied to.
 * This file exists to let a person click through a morning, not to be the
 * security model — which is exactly why the real one is not in the browser.
 *
 * The rules copied here, and why each is worth reproducing:
 *   - only the assignee may start or finish a task (record relation)
 *   - a requirement that cannot be confirmed blocks finishing (AP-1)
 *   - releasing that block is management authority, not the assignee's
 *   - a released block is per task, per day
 *   - the verifier may not be the doer, unless the activity allows it
 *   - a visit's status transitions are a fixed table; finished is terminal
 *   - cancelling always records a reason
 */

type Role =
  | 'DENTAL_ASSISTANT' | 'CLINIC_MANAGER' | 'SENIOR_ASSISTANT' | 'RECEPTION';

interface Person {
  key: string;
  email: string;
  employeeId: string;
  displayLabel: string;
  roles: Role[];
}

export const PEOPLE: Person[] = [
  { key: 'priya', email: 'priya@synthetic.test', employeeId: 'e-priya', displayLabel: 'SYNTHETIC Priya S.', roles: ['DENTAL_ASSISTANT'] },
  { key: 'rahul', email: 'rahul@synthetic.test', employeeId: 'e-rahul', displayLabel: 'SYNTHETIC Rahul M.', roles: ['CLINIC_MANAGER'] },
  { key: 'anita', email: 'anita@synthetic.test', employeeId: 'e-anita', displayLabel: 'SYNTHETIC Anita K.', roles: ['SENIOR_ASSISTANT'] },
  { key: 'kavita', email: 'kavita@synthetic.test', employeeId: 'e-kavita', displayLabel: 'SYNTHETIC Kavita R.', roles: ['RECEPTION'] },
];

export const DEMO_PASSWORD = 'SyntheticDemo123!';

/** Who may decide it is safe to finish without a confirmation. */
const MAY_RELEASE: Role[] = ['CLINIC_MANAGER'];
/** Who may move a visit along. */
const MAY_MOVE_VISITS: Role[] = ['RECEPTION', 'CLINIC_MANAGER'];

interface Item { id: string; label: string; requiresValue?: boolean; unit?: string }

interface Task {
  id: string;
  code: string;
  title: string;
  standard: string;
  assignee: string;
  items: Item[];
  selfVerifyAllowed: boolean;
  checkerRoles: Role[];
  /** The plain-language message when the requirement cannot be confirmed. */
  cantConfirm: string | null;
  minutesFromOpening: number;
  status: 'DUE' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED';
  responses: Record<string, { checked: boolean; value: number | null }>;
  blockedBy: string | null;
  releasedAt: number | null;
  completedBy: string | null;
}

interface Attention {
  id: string;
  code: string;
  headline: string;
  severity: 'PATIENT_SAFETY' | 'CRITICAL' | 'IMPORTANT' | 'ROUTINE';
  detail: string | null;
  owner: string;
  dueAt: number | null;
  instanceId: string | null;
  needsAuthorisation: boolean;
  open: boolean;
}

interface Visit {
  id: string;
  patientLabel: string;
  patientUhid: string;
  visitType: string;
  chairLabel: string;
  startsInMinutes: number;
  minutes: number;
  status: 'BOOKED' | 'ARRIVED' | 'IN_CHAIR' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  arrivedAt: number | null;
  cancelReason?: string;
}

const STATUS_LABEL: Record<Visit['status'], string> = {
  BOOKED: 'Expected', ARRIVED: 'Waiting', IN_CHAIR: 'In the chair',
  COMPLETED: 'Finished', CANCELLED: 'Cancelled', NO_SHOW: "Didn't come",
};

const ALLOWED: Record<Visit['status'], Visit['status'][]> = {
  BOOKED: ['ARRIVED', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['IN_CHAIR', 'CANCELLED', 'NO_SHOW'],
  IN_CHAIR: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [], CANCELLED: [], NO_SHOW: [],
};

const PROBLEM_KINDS = [
  { key: 'NOT_WORKING', label: 'Not working' },
  { key: 'MISSING', label: 'Missing' },
  { key: 'NOT_CLEAN', label: 'Not clean' },
  { key: 'OTHER', label: 'Something else' },
];

// ---------------------------------------------------------------------------
// The morning. Times are relative to when the file is opened, so the demo is
// always mid-morning and slightly behind — which is when a clinic actually
// needs this screen.
// ---------------------------------------------------------------------------

const OPENED_AT = Date.now();
/** Opening was due 12 minutes ago: late enough to matter, not a disaster. */
const OPENING_DUE = OPENED_AT - 12 * 60_000;

function freshState() {
  const tasks: Task[] = [
    {
      id: 't-004', code: 'OPN-004', title: 'Set up the clinic environment',
      standard: 'AC 24°C where applicable, diffuser and lights as schedule',
      assignee: 'e-priya', selfVerifyAllowed: true, checkerRoles: [],
      cantConfirm: null, minutesFromOpening: -30, status: 'DUE',
      items: [
        { id: 'i-401', label: 'Air conditioning set', requiresValue: true, unit: '°C' },
        { id: 'i-402', label: 'Lights on as per schedule' },
        { id: 'i-403', label: 'Diffuser on' },
      ],
      responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
    },
    {
      id: 't-005', code: 'OPN-005', title: 'Check the emergency kit',
      standard: 'Emergency equipment and critical items available and accessible',
      assignee: 'e-priya', selfVerifyAllowed: false, checkerRoles: ['CLINIC_MANAGER'],
      cantConfirm: "We can't confirm the emergency kit list yet",
      minutesFromOpening: -30, status: 'DUE',
      items: [
        { id: 'i-501', label: 'Emergency kit present and sealed' },
        { id: 'i-502', label: 'Oxygen cylinder available and pressure adequate' },
        { id: 'i-503', label: 'Adrenaline in date' },
        { id: 'i-504', label: 'Emergency contact list visible' },
      ],
      responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
    },
    {
      id: 't-001', code: 'OPN-001', title: 'Open the clinic',
      standard: 'Required clinic areas opened before first patient',
      assignee: 'e-priya', selfVerifyAllowed: false, checkerRoles: ['CLINIC_MANAGER'],
      cantConfirm: null, minutesFromOpening: -15, status: 'DUE',
      items: [
        { id: 'i-101', label: 'Main entrance and shutters open' },
        { id: 'i-102', label: 'All floors unlocked and lit' },
        { id: 'i-103', label: 'Water supply running' },
        { id: 'i-104', label: 'Power and backup checked' },
        { id: 'i-105', label: 'Waiting area ready for patients' },
      ],
      responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
    },
    {
      // Already done and waiting on Anita, so a second pair of eyes has
      // something real to look at the moment you switch to her.
      id: 't-002', code: 'OPN-002', title: 'Get treatment rooms ready',
      standard: 'All scheduled operatories clean, stocked and functional',
      assignee: 'e-priya', selfVerifyAllowed: false, checkerRoles: ['SENIOR_ASSISTANT'],
      cantConfirm: null, minutesFromOpening: -15, status: 'COMPLETED',
      items: [
        { id: 'i-201', label: 'Every room clean' },
        { id: 'i-202', label: 'Instruments laid out' },
        { id: 'i-203', label: 'Suction working' },
        { id: 'i-204', label: 'Chairs tested' },
      ],
      responses: {
        'i-201': { checked: true, value: null },
        'i-202': { checked: true, value: null },
        'i-203': { checked: true, value: null },
        // Left unticked on purpose: the checker is meant to see it as unticked
        // rather than have it quietly omitted.
        'i-204': { checked: false, value: null },
      },
      blockedBy: null, releasedAt: null, completedBy: 'e-priya',
    },
    {
      id: 't-003', code: 'OPN-003', title: 'Get reception ready',
      standard: 'Reception open, systems on, waiting area presentable',
      assignee: 'e-kavita', selfVerifyAllowed: true, checkerRoles: [],
      cantConfirm: null, minutesFromOpening: -15, status: 'DUE',
      items: [
        { id: 'i-301', label: 'Computers and card machine on' },
        { id: 'i-302', label: 'Appointment list printed' },
        { id: 'i-303', label: 'Waiting area tidy' },
      ],
      responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
    },
    // Already done before anyone opened the app — a real morning has history
    // behind it, and Anita has something genuine waiting to be checked.
    {
      id: 't-006', code: 'OPN-006', title: 'Run the autoclave test cycle',
      standard: 'Daily steriliser test passed and recorded before instruments are used',
      assignee: 'e-anita', selfVerifyAllowed: false, checkerRoles: ['CLINIC_MANAGER'],
      cantConfirm: null, minutesFromOpening: -45, status: 'COMPLETED',
      items: [
        { id: 'i-601', label: 'Test pack loaded' },
        { id: 'i-602', label: 'Cycle completed without fault' },
        { id: 'i-603', label: 'Indicator strip changed correctly' },
        { id: 'i-604', label: 'Result recorded in the log' },
      ],
      responses: {
        'i-601': { checked: true, value: null },
        'i-602': { checked: true, value: null },
        'i-603': { checked: true, value: null },
        'i-604': { checked: false, value: null },
      },
      blockedBy: null, releasedAt: null, completedBy: 'e-anita',
    },
    {
      id: 't-007', code: 'OPN-007', title: 'Check the fridge temperature',
      standard: 'Cold chain intact: 2–8°C, recorded daily',
      assignee: 'e-priya', selfVerifyAllowed: true, checkerRoles: [],
      cantConfirm: null, minutesFromOpening: 45, status: 'DUE',
      items: [
        { id: 'i-701', label: 'Fridge temperature within range', requiresValue: true, unit: '°C' },
        { id: 'i-702', label: 'Nothing stored past its date' },
      ],
      responses: {}, blockedBy: null, releasedAt: null, completedBy: null,
    },
  ];

  const visits: Visit[] = [
    { id: 'v1', patientLabel: 'SYNTHETIC Meera J.', patientUhid: 'SYN-1001', visitType: 'Check-up', chairLabel: 'Chair 1', startsInMinutes: 18, minutes: 30, status: 'BOOKED', arrivedAt: null },
    { id: 'v2', patientLabel: 'SYNTHETIC Arjun P.', patientUhid: 'SYN-1002', visitType: 'Root canal', chairLabel: 'Chair 2', startsInMinutes: 48, minutes: 45, status: 'BOOKED', arrivedAt: null },
    { id: 'v3', patientLabel: 'SYNTHETIC Fatima S.', patientUhid: 'SYN-1003', visitType: 'Scaling', chairLabel: 'Chair 1', startsInMinutes: 48, minutes: 30, status: 'BOOKED', arrivedAt: null },
    { id: 'v4', patientLabel: 'SYNTHETIC Daniel R.', patientUhid: 'SYN-1004', visitType: 'Filling', chairLabel: 'Chair 1', startsInMinutes: 108, minutes: 30, status: 'CANCELLED', arrivedAt: null, cancelReason: 'SYNTHETIC: patient rescheduled to next week' },
    { id: 'v5', patientLabel: 'SYNTHETIC Priyanka N.', patientUhid: 'SYN-1005', visitType: 'Crown fitting', chairLabel: 'Chair 2', startsInMinutes: 138, minutes: 60, status: 'BOOKED', arrivedAt: null },
    { id: 'v6', patientLabel: 'SYNTHETIC Imran Q.', patientUhid: 'SYN-1006', visitType: 'Check-up', chairLabel: 'Chair 1', startsInMinutes: 198, minutes: 30, status: 'BOOKED', arrivedAt: null },
  ];

  // A morning that has already been running: the app is not a blank slate
  // when somebody picks up the tablet at 09:00.
  const attention: Attention[] = [
    {
      id: 'a-seed-1', code: 'OPN.OVERDUE',
      headline: 'Autoclave log line is missing for the test cycle',
      severity: 'CRITICAL',
      detail: 'The cycle passed but the result was not written into the log.',
      owner: 'e-rahul', dueAt: OPENED_AT + 40 * 60_000,
      instanceId: 't-006', needsAuthorisation: false, open: true,
    },
    {
      id: 'a-seed-2', code: 'SCH.SUPPLY',
      headline: 'Gloves down to the last box in Chair 2',
      severity: 'IMPORTANT',
      detail: 'Reported yesterday evening by the closing assistant.',
      owner: 'e-rahul', dueAt: OPENED_AT + 5 * 60 * 60_000,
      instanceId: null, needsAuthorisation: false, open: true,
    },
  ];

  return { tasks, visits, attention, signedIn: null as Person | null };
}

let db = freshState();

/** Start the morning again from the top. */
export function resetDemo() {
  const who = db.signedIn;
  db = freshState();
  db.signedIn = who;
}

export function signInAs(key: string) {
  db.signedIn = PEOPLE.find((p) => p.key === key) ?? null;
}

export function currentPerson(): Person | null {
  return db.signedIn;
}

// ---------------------------------------------------------------------------

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const startOf = (t: Task) => OPENING_DUE + t.minutesFromOpening * 60_000;
const visitStart = (v: Visit) => OPENED_AT + v.startsInMinutes * 60_000;

function raise(a: Omit<Attention, 'id' | 'open'>) {
  // Deduplicated the way the real attention service is: same code, same source,
  // still open, becomes one item rather than fifty.
  const existing = db.attention.find(
    (x) => x.open && x.code === a.code && x.instanceId === a.instanceId,
  );
  if (existing) return existing;
  const item: Attention = { ...a, id: `a-${db.attention.length + 1}`, open: true };
  db.attention.push(item);
  return item;
}

function nextVisit(): Visit | null {
  const upcoming = db.visits
    .filter((v) => ['BOOKED', 'ARRIVED', 'IN_CHAIR'].includes(v.status))
    .sort((a, b) => a.startsInMinutes - b.startsInMinutes);
  return upcoming[0] ?? null;
}

function taskView(t: Task, me: Person) {
  return {
    id: t.id,
    title: t.title,
    standard: t.standard,
    status: t.status,
    dueAt: new Date(startOf(t)).toISOString(),
    isMine: t.assignee === me.employeeId,
    needsSomeoneElseToCheck: !t.selfVerifyAllowed,
    items: t.items.map((i) => ({
      id: i.id,
      label: i.label,
      requiresValue: i.requiresValue ?? false,
      unit: i.unit ?? null,
      checked: t.responses[i.id]?.checked ?? false,
      value: t.responses[i.id]?.value ?? null,
    })),
    cantConfirm: t.cantConfirm,
    canOverrideBlock: t.cantConfirm !== null,
    blockedBy: t.blockedBy,
    problemKinds: PROBLEM_KINDS,
  };
}

function handle(url: string, method: string, body: Record<string, unknown>): Response {
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]!;
  const me = db.signedIn;

  if (path === '/api/v1/auth/login' && method === 'POST') {
    const person = PEOPLE.find((p) => p.email === String(body.email ?? '').trim().toLowerCase());
    if (!person || body.password !== DEMO_PASSWORD) {
      return json({ error: 'Email or password is incorrect.' }, 401);
    }
    db.signedIn = person;
    return json({ displayLabel: person.displayLabel, roleCodes: person.roles });
  }

  if (path === '/api/v1/auth/logout') { db.signedIn = null; return json({ ok: true }); }
  if (!me) return json({ error: 'Not signed in' }, 401);

  if (path === '/api/v1/auth/me') {
    return json({
      displayLabel: me.displayLabel, roleCodes: me.roles,
      clinicIds: ['c-1'], crossClinic: false,
    });
  }

  // ---- TODAY ----
  if (path === '/api/v1/my-day') {
    const now = Date.now();
    const mine = db.tasks
      .filter((t) => t.assignee === me.employeeId && ['DUE', 'IN_PROGRESS'].includes(t.status))
      .sort((a, b) => startOf(a) - startOf(b));

    const buckets: Record<string, unknown[]> = { OVERDUE: [], NOW: [], NEXT: [], LATER: [] };
    for (const t of mine) {
      const mins = (startOf(t) - now) / 60_000;
      const bucket = mins < 0 ? 'OVERDUE' : mins <= 60 ? 'NOW' : mins <= 240 ? 'NEXT' : 'LATER';
      buckets[bucket]!.push({
        id: t.id, title: t.title, standard: t.standard,
        dueAt: new Date(startOf(t)).toISOString(),
        status: mins < 0 ? 'OVERDUE' : t.status,
        started: t.status === 'IN_PROGRESS',
        blockedBy: t.blockedBy,
      });
    }

    const done = db.tasks.filter((t) => ['COMPLETED', 'VERIFIED'].includes(t.status)).length;
    const complete = done === db.tasks.length;
    const inChair = db.visits.some((v) => v.status === 'IN_CHAIR');
    const next = nextVisit();

    return json({
      buckets,
      attentionCount: db.attention.filter((a) => a.open && a.owner === me.employeeId).length,
      clinic: {
        name: 'SYNTHETIC KB Dental Andheri',
        // The viewer's own zone, so a demo opened anywhere reads naturally.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        phase: !complete ? 'OPENING' : inChair ? 'SEEING_PATIENTS' : 'OPEN',
        opening: { total: db.tasks.length, done, complete },
        readyBy: new Date(OPENING_DUE).toISOString(),
        firstPatientAt: next ? new Date(visitStart(next)).toISOString() : null,
      },
      opening: { total: db.tasks.length, done, complete },
    });
  }

  // ---- one task ----
  const taskMatch = /^\/api\/v1\/tasks\/([^/]+)(\/(start|complete|report-problem|authorise))?$/.exec(path);
  if (taskMatch) {
    const t = db.tasks.find((x) => x.id === taskMatch[1]);
    if (!t) return json({ error: 'Not found' }, 404);
    const action = taskMatch[3];

    if (!action) return json(taskView(t, me));

    if (action === 'authorise') {
      if (!me.roles.some((r) => MAY_RELEASE.includes(r))) {
        return json({ error: 'You do not have authority to let this go ahead.' }, 403);
      }
      if (!String(body.reason ?? '').trim()) {
        return json({ error: 'Please say why it is safe to go ahead.' }, 400);
      }
      t.releasedAt = Date.now();
      const ask = db.attention.find((a) => a.instanceId === t.id && a.needsAuthorisation && a.open);
      if (ask) ask.open = false;
      return json({ ok: true });
    }

    // Record relation: only the assignee may act on the work itself.
    if (t.assignee !== me.employeeId) {
      return json({ error: 'This task is assigned to someone else.' }, 403);
    }

    if (action === 'start') { t.status = 'IN_PROGRESS'; return json({ status: t.status }); }

    if (action === 'report-problem') {
      const item = t.items.find((i) => i.id === body.itemId);
      const kind = PROBLEM_KINDS.find((k) => k.key === body.kind)?.label ?? 'Problem';
      const headline = item ? `${item.label} — ${kind.toLowerCase()}` : `${t.title} — ${kind.toLowerCase()}`;
      t.blockedBy = headline;
      const a = raise({
        code: 'OPN.PROBLEM', headline, severity: 'PATIENT_SAFETY',
        detail: (body.note as string) ?? null, owner: 'e-rahul',
        dueAt: Date.now() + 30 * 60_000, instanceId: t.id, needsAuthorisation: false,
      });
      return json({ headline: a.headline, id: a.id });
    }

    if (action === 'complete') {
      for (const r of (body.responses as Array<{ itemId: string; checked: boolean; numericValue?: number }>) ?? []) {
        t.responses[r.itemId] = { checked: r.checked, value: r.numericValue ?? null };
      }

      // AP-1: a requirement that cannot be confirmed must not read as a pass.
      if (t.cantConfirm && !t.releasedAt) {
        if (!me.roles.some((r) => MAY_RELEASE.includes(r))) {
          raise({
            code: 'OPN.GATE.NEEDS_AUTHORISATION',
            headline: `${t.title} needs a manager's go-ahead`,
            severity: 'PATIENT_SAFETY',
            detail: `${t.cantConfirm}. Whoever is doing it cannot finish until someone with the authority says it is safe.`,
            owner: 'e-rahul', dueAt: null, instanceId: t.id, needsAuthorisation: true,
          });
          return json({
            error: `${t.cantConfirm}. A manager has been asked to look at it — you don't need to chase them.`,
            canOverride: false,
          }, 409);
        }
        if (!String(body.overrideReason ?? '').trim()) {
          return json({
            error: `${t.cantConfirm}. Report a problem, or record why it is safe to go ahead.`,
            canOverride: true,
          }, 409);
        }
      }

      t.status = 'COMPLETED';
      t.completedBy = me.employeeId;

      const outOfRange: Array<{ label: string; value: number; unit: string | null }> = [];
      const ac = t.responses['i-401'];
      if (ac?.value != null && (ac.value < 20 || ac.value > 26)) {
        outOfRange.push({ label: 'Air conditioning set', value: ac.value, unit: '°C' });
        raise({
          code: 'OPN.THRESHOLD', headline: `Air conditioning set is outside the normal range (${ac.value}°C)`,
          severity: 'IMPORTANT', detail: null, owner: 'e-rahul',
          dueAt: Date.now() + 120 * 60_000, instanceId: t.id, needsAuthorisation: false,
        });
      }

      if (t.selfVerifyAllowed) {
        t.status = 'VERIFIED';
        return json({ status: 'VERIFIED', selfVerified: true, waitingForCheck: false, outOfRange });
      }
      return json({ status: 'COMPLETED', selfVerified: false, waitingForCheck: true, outOfRange });
    }
  }

  // ---- ATTENTION ----
  if (path === '/api/v1/attention') {
    const order = { PATIENT_SAFETY: 0, CRITICAL: 1, IMPORTANT: 2, ROUTINE: 3 };
    return json(db.attention.filter((a) => a.open)
      .sort((a, b) => order[a.severity] - order[b.severity])
      .map((a) => ({
        id: a.id, headline: a.headline, severity: a.severity, detail: a.detail,
        mine: a.owner === me.employeeId,
        dueAt: a.dueAt ? new Date(a.dueAt).toISOString() : null,
        escalated: false, instanceId: a.instanceId, needsAuthorisation: a.needsAuthorisation,
      })));
  }

  const resolveMatch = /^\/api\/v1\/attention\/([^/]+)\/resolve$/.exec(path);
  if (resolveMatch) {
    if (!me.roles.some((r) => (['CLINIC_MANAGER'] as Role[]).includes(r))) {
      return json({ error: 'You do not have permission to resolve this.' }, 403);
    }
    const a = db.attention.find((x) => x.id === resolveMatch[1]);
    if (a) {
      a.open = false;
      const t = db.tasks.find((x) => x.id === a.instanceId);
      if (t) t.blockedBy = null;   // resolving unblocks the task it was holding
    }
    return json({ ok: true });
  }

  // ---- CHECKS ----
  if (path === '/api/v1/checks') {
    return json(db.tasks
      .filter((t) => t.status === 'COMPLETED'
        && t.completedBy !== me.employeeId
        && t.checkerRoles.some((r) => me.roles.includes(r)))
      .map((t) => ({
        id: t.id, title: t.title, standard: t.standard,
        completedAt: new Date().toISOString(),
      })));
  }

  const checkMatch = /^\/api\/v1\/checks\/([^/]+)$/.exec(path);
  if (checkMatch) {
    const t = db.tasks.find((x) => x.id === checkMatch[1]);
    if (!t) return json({ error: 'Not found' }, 404);
    if (t.completedBy === me.employeeId) {
      return json({ error: 'You cannot confirm your own work on this task.' }, 403);
    }
    if (method === 'GET') {
      return json({
        id: t.id, title: t.title, standard: t.standard,
        completedAt: new Date().toISOString(),
        items: t.items.map((i) => ({
          id: i.id, label: i.label,
          checked: t.responses[i.id]?.checked ?? false,
          value: t.responses[i.id]?.value ?? null,
          unit: i.unit ?? null,
        })),
      });
    }
    if (!t.checkerRoles.some((r) => me.roles.includes(r))) {
      return json({ error: 'You are not one of the people who can check this.' }, 403);
    }
    t.status = body.result === 'PASS' ? 'VERIFIED' : 'IN_PROGRESS';
    if (body.result === 'FAIL') t.completedBy = null;
    return json({ status: t.status });
  }

  // ---- THE DAY ----
  if (path === '/api/v1/schedule') {
    const now = Date.now();
    return json({
      periodKey: new Date().toISOString().slice(0, 10),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      rows: db.visits
        .slice()
        .sort((a, b) => a.startsInMinutes - b.startsInMinutes)
        .map((v) => ({
          id: v.id, patientLabel: v.patientLabel, patientUhid: v.patientUhid,
          visitType: v.visitType, chairLabel: v.chairLabel,
          scheduledStart: new Date(visitStart(v)).toISOString(),
          scheduledEnd: new Date(visitStart(v) + v.minutes * 60_000).toISOString(),
          status: v.status, statusLabel: STATUS_LABEL[v.status],
          waitingMinutes: v.arrivedAt && v.status === 'ARRIVED'
            ? Math.max(0, Math.round((now - v.arrivedAt) / 60_000)) : null,
          arrivedAt: v.arrivedAt ? new Date(v.arrivedAt).toISOString() : null,
        })),
    });
  }

  const visitMatch = /^\/api\/v1\/appointments\/([^/]+)\/status$/.exec(path);
  if (visitMatch) {
    if (!me.roles.some((r) => MAY_MOVE_VISITS.includes(r))) {
      return json({ error: 'You do not have permission to change this visit.' }, 403);
    }
    const v = db.visits.find((x) => x.id === visitMatch[1]);
    if (!v) return json({ error: 'Not found' }, 404);
    const to = body.to as Visit['status'];
    if (!ALLOWED[v.status].includes(to)) {
      return json({
        error: `This visit is already marked "${STATUS_LABEL[v.status]}", so it cannot be changed to "${STATUS_LABEL[to]}".`,
      }, 409);
    }
    if (to === 'CANCELLED' && !String(body.reason ?? '').trim()) {
      return json({ error: 'Please say why this visit is being cancelled.' }, 409);
    }
    v.status = to;
    if (to === 'ARRIVED') {
      // Arrived a little while ago, so "waiting N min" has something to show.
      v.arrivedAt = Date.now() - 16 * 60_000;
    }
    return json({ status: v.status });
  }

  return json({ error: 'Not found' }, 404);
}

/** Replace window.fetch so the real API client talks to the copy above. */
export function installDemoBackend() {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> = {};
    try { body = init?.body ? JSON.parse(String(init.body)) : {}; } catch { /* no body */ }
    // A beat of latency, so buttons show their saving state like the real thing.
    await new Promise((r) => setTimeout(r, 90));
    return handle(url, method, body);
  };
}
