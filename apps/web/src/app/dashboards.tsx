/**
 * The fourteen dashboards.
 *
 * Six live, eight registered with an honest status and the reason they are
 * not built. This is the whole of KuBi's dashboard surface — the shell knows
 * none of it, and a fifteenth is added here without touching anything else.
 *
 * Ordering is nav ordering. Roles are `RoleCode` values from
 * packages/contracts.
 *
 * See docs/kubi-v3-dashboard-strategy.md §4.
 */
import { CommandCentre } from '../screens/command-centre.js';
import { OwnerBusiness } from '../screens/owner-business.js';
import { ReceptionBoard } from '../screens/reception-board.js';
import { BriefingScreen } from '../screens/briefing.js';
import { Retention as RetentionScreen } from '../screens/retention.js';
import { Now as NowScreen } from '../screens/now.js';
import { registerDashboard, DashboardStatus } from './registry.js';

export function registerAllDashboards(): void {
  // ── Phase 1 · live ────────────────────────────────────────────────────

  registerDashboard({
    id: 'OWNER',
    question: 'What needs my attention, and is the business growing?',
    label: 'Business',
    roles: ['OWNER_DIRECTOR'],
    phase: 1,
    status: DashboardStatus.LIVE,
    home: true,
    render: (ctx) => <OwnerBusiness onOpenQuality={() => ctx.go('QUALITY')} />,
  });

  registerDashboard({
    id: 'COMMAND',
    question: 'What should I fix today?',
    label: 'Command',
    // Clinic Head shares this until divergence is proved rather than guessed.
    // If the head turns out to ask "is my clinic to standard" — governance
    // rather than operations — it splits. Cheaper than inventing a difference.
    roles: ['CLINIC_MANAGER', 'CLINIC_HEAD'],
    phase: 1,
    status: DashboardStatus.LIVE,
    home: true,
    render: (ctx) => (
      <CommandCentre
        onOpenAttention={() => ctx.go('ATTENTION')}
        onOpenClinic={() => ctx.go('CLINIC')}
        onOpenOperations={() => ctx.go('OPERATIONS')}
      />
    ),
  });

  registerDashboard({
    id: 'DESK',
    question: 'Who is next, and who still needs a call?',
    label: 'The desk',
    roles: ['RECEPTION'],
    phase: 1,
    status: DashboardStatus.LIVE,
    home: true,
    render: (ctx) => <ReceptionBoard onOpenClinic={() => ctx.go('CLINIC')} />,
  });

  // All four render the same BriefingScreen. Only the sections differ, which
  // is the domain contract doing its job — a dashboard names what it wants and
  // does not own a layout.

  registerDashboard({
    id: 'DOCTOR',
    question: 'Which patient needs me?',
    label: 'My patients',
    roles: ['TREATING_DOCTOR', 'CLINICAL_DIRECTOR'],
    phase: 1,
    status: DashboardStatus.LIVE,
    home: true,
    render: (ctx) => <BriefingScreen onOpenTask={ctx.openTask} onRefresh={ctx.reload} />,
  });

  /**
   * The clinic, for everybody.
   *
   * One entry rather than eight, because the screen is the same code for
   * every role — the engine returns a different world to each of them. That
   * is §12.4: "same database, different operating systems", and it is why
   * there is no reception dashboard, doctor dashboard and so on to keep in
   * step with one another.
   */
  registerDashboard({
    id: 'CLINIC_NOW',
    question: 'What does the clinic need from me now?',
    label: 'Now',
    roles: [
      'RECEPTION', 'TREATING_DOCTOR', 'CLINICAL_DIRECTOR', 'DENTAL_ASSISTANT',
      'SENIOR_ASSISTANT', 'STERILIZATION_TECHNICIAN', 'LAB_COORDINATOR',
      'INVENTORY_COORDINATOR', 'CLINIC_MANAGER', 'CLINIC_HEAD', 'OWNER_DIRECTOR',
    ],
    phase: 1,
    status: DashboardStatus.LIVE,
    render: () => <NowScreen />,
  });

  registerDashboard({
    id: 'RETENTION',
    question: 'Who has stopped coming?',
    label: 'Follow up',
    // The owner named the doctor for this work, and the permission follows:
    // patient:retention_followup is CLINICAL and is granted to the treating
    // doctor alone. Reception can see nothing here, which is deliberate — the
    // first sentence of the call can turn clinical.
    roles: ['TREATING_DOCTOR', 'CLINICAL_DIRECTOR'],
    phase: 1,
    status: DashboardStatus.LIVE,
    render: () => <RetentionScreen />,
  });

  registerDashboard({
    id: 'ASSISTANT',
    question: 'What do I do now?',
    label: 'My work',
    roles: ['DENTAL_ASSISTANT', 'SENIOR_ASSISTANT'],
    phase: 1,
    status: DashboardStatus.LIVE,
    home: true,
    render: (ctx) => <BriefingScreen onOpenTask={ctx.openTask} onRefresh={ctx.reload} />,
  });

  registerDashboard({
    id: 'LAB',
    question: 'What is due back, and what is stuck?',
    label: 'Lab',
    roles: ['LAB_COORDINATOR'],
    phase: 1,
    status: DashboardStatus.LIVE,
    home: true,
    render: (ctx) => <BriefingScreen onOpenTask={ctx.openTask} onRefresh={ctx.reload} />,
  });

  registerDashboard({
    id: 'STERILIZATION',
    question: 'What is in the loop, and what is stuck?',
    label: 'Sterilisation',
    // A role of its own even where one person also assists, because "an
    // operator may not release their own batch" is a separation-of-duties gate
    // and it needs a role to hang on rather than a name.
    roles: ['STERILIZATION_TECHNICIAN'],
    phase: 1,
    status: DashboardStatus.LIVE,
    home: true,
    render: (ctx) => <BriefingScreen onOpenTask={ctx.openTask} onRefresh={ctx.reload} />,
  });

  registerDashboard({
    id: 'HOUSEKEEPING',
    question: 'What needs cleaning, and when?',
    label: 'My rounds',
    roles: ['HOUSEKEEPING'],
    phase: 1,
    status: DashboardStatus.LIVE,
    home: true,
    render: (ctx) => <BriefingScreen onOpenTask={ctx.openTask} onRefresh={ctx.reload} />,
  });

  // ── Phase 2 · during the pilot ────────────────────────────────────────

  registerDashboard({
    id: 'INVENTORY',
    question: 'What runs out before it is reordered?',
    label: 'Stock',
    roles: ['INVENTORY_COORDINATOR'],
    phase: 2,
    status: DashboardStatus.PLANNED,
    blockedBy: 'Stock levels, expiry and implant readiness are built. Needs a '
      + 'dashboard registration only.',
  });

  registerDashboard({
    id: 'QUALITY_DASH',
    question: 'What is repeating, and did our fix work?',
    label: 'Quality',
    roles: ['QUALITY_COMPLIANCE'],
    phase: 2,
    status: DashboardStatus.PLANNED,
    blockedBy: 'The CAPA loop exists as a screen. Needs its own question and '
      + 'repeat-failure detection.',
  });

  registerDashboard({
    id: 'MAINTENANCE',
    question: 'What is broken, due, or out of cover?',
    label: 'Maintenance',
    roles: [],
    phase: 2,
    status: DashboardStatus.PLANNED,
    blockedBy: 'Equipment checks, breakdowns, PM and return-to-service are '
      + 'built. Needs a MAINTENANCE role code.',
  });

  // ── Phase 2–3 · Learning ──────────────────────────────────────────────

  registerDashboard({
    id: 'LEARNING',
    question: 'Who is allowed to do this, and for how much longer?',
    label: 'Learning',
    roles: [],
    phase: 3,
    status: DashboardStatus.PLANNED,
    // Not HR. HR asks whether somebody is here and paid; Learning asks
    // whether they are *permitted*, which is already a clinical safety gate.
    blockedBy: 'Closer than it looks: TRN-001..005 are in the frozen matrix, '
      + 'CompetencyLevel is in contracts, and the competency gate is enforced. '
      + 'Needs a role code and a renewals clock.',
  });

  // ── Phase 4 · after the core proves itself ────────────────────────────

  registerDashboard({
    id: 'HR',
    question: 'Who is short, late, untrained or unavailable?',
    label: 'People',
    roles: [],
    phase: 4,
    status: DashboardStatus.PENDING_DOMAIN_DEFINITION,
    blockedBy: 'No attendance or check-in module. This is why every team light '
      + 'on the command centre is amber rather than green.',
  });

  registerDashboard({
    id: 'ACCOUNTS',
    question: 'What is billed, collected and outstanding?',
    label: 'Accounts',
    roles: [],
    phase: 4,
    status: DashboardStatus.PENDING_DOMAIN_DEFINITION,
    blockedBy: 'No billing module. This is the gap named against nine metrics '
      + 'on the owner dashboard.',
  });

  registerDashboard({
    id: 'MARKETING',
    question: 'What brings patients in, and where do they leak?',
    label: 'Marketing',
    roles: [],
    phase: 4,
    status: DashboardStatus.PENDING_DOMAIN_DEFINITION,
    blockedBy: 'Needs the Patient Relationship domain — acquisition source, '
      + 'segment, consent and channel — plus records for people who never '
      + 'became patients.',
  });

  registerDashboard({
    id: 'RIDER',
    question: 'What am I carrying, where, and what proves it arrived?',
    label: 'Rider',
    roles: [],
    phase: 4,
    status: DashboardStatus.PENDING_DOMAIN_DEFINITION,
    // Registered, not removed. The clinic has riders; the dashboard will be
    // valuable. What is missing is the domain definition, not the case for it.
    blockedBy: 'Three open questions: what a rider carries; whether they are an '
      + 'employee with a login or a third party with a per-trip link; and what '
      + 'proves a handover.',
  });

  registerDashboard({
    id: 'GROUP',
    question: 'Which clinic needs me?',
    label: 'Group',
    roles: [],
    phase: 4,
    status: DashboardStatus.PLANNED,
    // An executive decision layer, not an operational view across clinics.
    // Its verbs are allocate, invest, coach, intervene — never fix. It reads
    // maturity grade and trend, never task lists: a CEO screen built from
    // operational sections is just a manager's screen with more rows.
    blockedBy: 'Structurally ready — tenancy is two-level and Me already '
      + 'carries crossClinic. Needs a second clinic, a CEO role code, and the '
      + 'maturity model to grade against.',
  });
}
