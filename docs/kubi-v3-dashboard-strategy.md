# KuBi v3 — Dashboard Strategy

Design review 1 of 3. Nothing here is implemented. The purpose is to fix the
*shape* of the merged architecture so that HR, Marketing, Accounts, Inventory,
Maintenance, Rider and a group-level view can be added later **without touching
the shell** — and to record which roles are real today and which are placeholders
with an honest label on them.

Companion documents: `product-vision.md`, `domains/business-growth.md`,
`domains/patient-experience.md`, `kubi-v3-merge-plan.md`.

---

## 1. Accepted corrections to the merge plan

Five, all from the owner's review. Two change the plan materially.

**1.1 — "Rider cannot be built" was the wrong sentence.** The right one is
**"Rider should not be built now."** The clinic already has riders; the
dashboard will be valuable. What is missing is the domain definition, not the
justification. Rider stays in the architecture as **Phase 4 — pending domain
definition**, with a registered id, a question, and no screen. It is not
removed.

**1.2 — Six dashboards is the wrong target.** Designing for six invites six
hard-coded branches. The target is a **registry with fourteen entries**, six of
them live. See §3 and §4.

**1.3 — Reports is not one menu.** There are three report families with
different audiences, permissions and retention: **Operational**, **Compliance**,
**Business**. Merging them into one nav item would put a marketing ROI chart
next to an autoclave traceability record. See §6.

**1.4 — Parameters are not secondary navigation.** This reverses requirement 7
of the original brief, on the owner's instruction, and the reversal is right:
the published standard is the differentiator, and burying it hides the thing no
competitor has. Parameters become a **primary destination** — *Standards* — with
the spine Parameters → Activities → KPIs → Compliance. See §5.

**1.5 — Patient Experience and the relationship layer were missing entirely.**
Correct, and it was a real omission rather than a scoping decision. Both get
their own review documents. The dependency the owner identified — that growth
metrics are not computable without a relationship layer — is recorded in §7.

## 2. The problem to solve architecturally

Adding HR today would mean: a new branch in `app.tsx`, a new entry in the `Place`
union, a new icon in `TAB_ICON`, a new screen import, a new conditional in the
nav list, plus a new API call and a new response type. Six edits to shared files
for one feature — and every one of those files is edited again by the next
domain. That is the definition of architecting yourself into six.

The merged app must make a new domain **additive**: a folder, a registration, no
edit to anything shared. Three contracts do that.

## 3. Contract 1 — the dashboard registry

A dashboard is **a question, an audience and a set of sections**. It is not a
role, and it is not a filtered list.

```ts
interface Dashboard {
  id: DashboardId;
  /** The ONE question this screen answers. If you cannot write it, it is not a dashboard. */
  question: string;
  /** Roles that land here. Many-to-one on purpose — see §4. */
  roles: RoleCode[];
  /** Ordered section sources. Each is contributed by a domain, never by the shell. */
  sections: SectionRef[];
  phase: 1 | 2 | 3 | 4;
  status: 'LIVE' | 'PLANNED' | 'PENDING_DOMAIN_DEFINITION';
  /** For anything not LIVE: what is missing, shown to the user rather than hidden. */
  blockedBy?: string;
}
```

The shell reads the registry. It contains no role names, no domain names and no
`if (isOwner)`. `Place`, `TAB_ICON` and the nav list are derived, not authored.

**The test for "no redesign":** adding HR is a new folder under `domains/hr/`,
one `registerDashboard(...)` call and one `registerDomain(...)` call. If it
requires editing `app.tsx`, the contract has failed and the contract is what
gets fixed.

## 4. Contract 2 — roles map onto dashboards, many-to-one

Fourteen roles, but not fourteen screens. Several roles ask the same question
and should share an implementation until they demonstrably diverge — that is how
you avoid maintaining nine copies of a briefing.

| Dashboard | The question it answers | Roles | Phase | Status |
|---|---|---|---|---|
| **Owner** | "What needs my attention, and is the business growing?" | OWNER_DIRECTOR | 1 | LIVE |
| **Clinic Command** | "What should I fix today?" | CLINIC_MANAGER, CLINIC_HEAD | 1 | LIVE |
| **Reception** | "Who is next, and who still needs a call?" | RECEPTION | 1 | LIVE |
| **Doctor** | "Which patient needs me?" | TREATING_DOCTOR, CLINICAL_DIRECTOR | 1 | PLANNED |
| **Assistant** | "What do I do now?" | DENTAL_ASSISTANT, SENIOR_ASSISTANT, HOUSEKEEPING | 1 | PLANNED |
| **Lab** | "What is due back, and what is stuck?" | LAB_COORDINATOR | 1 | PLANNED |
| **Inventory** | "What runs out before it is reordered?" | INVENTORY_COORDINATOR | 2 | PLANNED |
| **Maintenance** | "What is broken, due, or out of cover?" | *(new role)* | 2 | PLANNED |
| **Quality** | "What is repeating, and did our fix work?" | QUALITY_COMPLIANCE | 2 | PLANNED |
| **Learning** | "Who is allowed to do this, and for how much longer?" | *(new role)* | 3 | PLANNED |
| **HR** | "Who is short, late, untrained or unavailable?" | *(new role)* | 3 | PENDING_DOMAIN_DEFINITION |
| **Marketing** | "What brings patients in, and where do they leak?" | *(new role)* | 3 | PENDING_DOMAIN_DEFINITION |
| **Accounts** | "What is billed, collected and outstanding?" | *(new role)* | 3 | PENDING_DOMAIN_DEFINITION |
| **Rider** | "What am I carrying, where, and what proves it arrived?" | *(new role)* | 4 | PENDING_DOMAIN_DEFINITION |
| **Group** | "Which clinic needs me?" | *(CEO — new role)* | 4 | PLANNED |

Notes on the ones that need explaining:

- **Clinic Head shares Clinic Command** for now. Both ask "what should I fix
  today". If the head turns out to ask "is my clinic to standard" instead —
  a governance question rather than an operational one — it splits. Sharing
  until divergence is proved is cheaper than guessing at a difference.
- **Group is the CEO dashboard.** It is the one future dashboard the platform
  is already built for: tenancy is two-level (org then clinic) and `Me` already
  carries `crossClinic` and `clinicIds`. It is only meaningless because K.B.
  Dental has one clinic today.
- **Quality is a dashboard, not just a screen.** It exists today as a tab; at
  Phase 2 it gets its own question and its own audience.
- Five roles do not exist in `RoleCode` yet: Maintenance, HR, Marketing,
  Accounts, Rider, CEO. Adding a role code is a migration and a permission
  grant, not a redesign — but it is real work and it is named here so it is not
  discovered later.

## 5. Contract 3 — domains contribute sections

The mechanism that makes the registry work. A **domain** owns tables, rules and
KPIs, and publishes sections that any dashboard may include.

```ts
interface Domain {
  id: DomainId;
  /** Control parameters this domain owns. Generated from the frozen matrix. */
  parameters: ParameterId[];
  kpis: KpiId[];
  /**
   * The briefing sections this domain can contribute, given who is asking.
   * A section carries tone, a hint, and items that are either actionable
   * tasks or read-only facts — prototype #1's model, which is why it was
   * worth keeping.
   */
  sectionsFor(role: RoleCode, ctx: TenantContext): Promise<Section[]>;
  /** What this domain may raise into Attention, with its escalation levels. */
  attentionSources: AttentionSource[];
  phase: 1 | 2 | 3 | 4;
}
```

Two consequences worth stating:

- **A dashboard never queries a table.** It names the sections it wants; domains
  answer. So "add Business Growth to the Owner dashboard" is one line in the
  Owner registration, not a rewrite of the owner screen.
- **A domain appears on several dashboards.** Sterilization contributes to
  Assistant ("three batches unfinished"), to Clinic Command ("one batch awaiting
  release signature") and to Quality ("second failed cycle this month"). One
  implementation, three audiences, no duplication.

## 6. Standards — the spine, promoted to primary

Per correction 1.4, the published standard is a primary destination, not a
settings page. The spine, each level derived from the one above and all of it
generated from the frozen matrix:

```
Clinic Operating Standards
  └─ Parameters        16 control heads, each with scope, owner and roll-up
      └─ Activities    101 frozen + 18 proposed, with standard, trigger,
                       due rule, doer, checker, evidence class, risk, CAPA
          └─ KPIs      what each activity is measured by
              └─ Compliance   live result against that standard
```

Why this is the differentiator, stated plainly so it survives a future
reprioritisation: every other product in this market ships a task list. A task
list answers "was it ticked". This spine answers "against what standard, decided
by whom, measured how, and what happened when it failed" — and it can be shown
to an inspector, a new hire or a prospective partner. It is also the reason the
per-parameter live/off switch matters: a clinic adopts one parameter at a time,
honestly, and the standard shows exactly how far adoption has got.

## 7. Reports — three families, not one menu

Per correction 1.3. Different audiences, different permissions, different
retention rules.

| Family | Question | Audience | Retention | Notes |
|---|---|---|---|---|
| **Operational** | Did the work happen? | Manager, head, supervisors | Working document | By parameter, by person, by day; on-time rate; exception log. Prototype #1's Reports screen is this family. |
| **Compliance** | Was the standard met, and can we prove it? | Quality, head, owner, external auditor | **Evidence — immutable, exportable** | Sterilization traceability, consent compliance, CAPA effectiveness, audit findings, competency currency, equipment calibration. |
| **Business** | Is the practice growing and healthy? | Owner, CEO, accounts | Confidential | Acceptance, high-value pipeline, recall effectiveness, marketing return, referrals, revenue and collection. |

The distinction that matters: **compliance reports are evidence.** They need
immutability, export, and a signature trail. Operational reports are working
documents that can be regenerated freely. Filing them together would let
somebody "correct" a record that exists precisely so it cannot be corrected.

Business reports are additionally permission-fenced: a clinic manager sees
operational and compliance, not business.

## 8. Where the space is left, concretely

What "leaves space" means, feature by feature, so this is checkable rather than
reassuring.

| Future domain | Space left by | Data today | Blocking need |
|---|---|---|---|
| Inventory | Domain contract; `inventory.service.ts` already computes stock, expiry and implant readiness | **Yes** | A dashboard registration only |
| Maintenance | `equipment.service.ts` — checks, breakdowns, PM, return-to-service | **Yes** | Role code + registration |
| Quality | `capa.service.ts` — full loop | **Yes** | Registration + its own question |
| Patient Experience | Domain contract; appointment timestamps exist | **Partial** | Complaints, satisfaction, reviews — see `domains/patient-experience.md` |
| Business Growth | Domain contract; report family 3 | **No** | Relationship layer + treatment plans — see `domains/business-growth.md` |
| HR | Domain contract; `RoleCode`, employees, competency exist | **No** | Attendance / check-in module |
| Accounts | Domain contract; report family 3 | **No** | Billing module — already named as the gap on the Owner dashboard |
| Marketing | Domain contract; report family 3 | **No** | Relationship layer + channel attribution |
| Rider | Registry entry, Phase 4 | **No** | Domain definition — three questions below |
| Group / CEO | Two-level tenancy; `crossClinic`, `clinicIds` on `Me` | **Yes, structurally** | A second clinic |

**The dependency the owner spotted, stated as a rule:** Business Growth,
Marketing and half of Patient Experience are **not computable** without a
relationship layer — who the patient is, which segment they belong to, how they
were reached, what was proposed, what they accepted, and whether they consented
to be contacted. That layer is a prerequisite domain, not a feature of the
dashboards that need it. Building growth metrics first would mean inventing
their inputs, which principle 2 forbids.

## 9. Rider — the three open questions

Registered as Phase 4, PENDING_DOMAIN_DEFINITION. It stays in the architecture
with its question written. What is needed before it becomes a screen:

1. **What does a rider carry?** Lab cases only, or also inventory deliveries,
   equipment going out for service, and documents?
2. **Who is the rider?** An employee with a login and a role code, or a third
   party who receives a one-time link per trip? This decides the entire auth
   model for the domain.
3. **What proves a handover?** Signature, photo, scan, OTP, or a phone
   confirmation from the far end? This decides whether Rider can ship before
   the evidence-storage work package (merge plan C8) is done.

Until these are answered the registry entry renders as a named, dated gap —
visible, not hidden, per principle 3.

## 10. What changes in the merge, and what does not

**Changes** (all additive to the plan already approved):

- The nav is generated from the dashboard registry rather than authored in
  `app.tsx`.
- Standards becomes a primary destination; Parameters and Activities live under
  it.
- Reports splits into three families with separate permissions.
- Six dashboards are built; eight more are registered with honest status.
- Domains expose `sectionsFor()` rather than screens calling services directly.

**Does not change:** the data model, the business rules, the five-valued
evaluation, the enforcement matrix, RLS, the CAPA loop, or any screen's
behaviour. Per requirement 10 of the original brief, this is structure, not
semantics.

## 11. Amendments from the owner's second review, 3 August

### 11.1 Patient Relationship becomes its own domain

The chain was `Patient → Experience → Growth`. It becomes:

```
Patient → Relationship → Experience → Growth
```

This is cleaner and it settles boundary arguments that the earlier split left
open — Recall and the referral network were sitting in Growth, where they
attracted a commercial owner to what is really a contact relationship.

| Domain | Owns |
|---|---|
| **Patient Relationship** *(new)* | Identity, family, preferences, communication, **recall**, consent, **referral network**, loyalty, segmentation |
| **Patient Experience** | Waiting, complaints, reviews, satisfaction |
| **Business Growth** | Acceptance, marketing, revenue pipeline, high-value cases, ROI |

The rule that follows: **Relationship owns who they are and how we may reach
them. Experience owns how it felt. Growth owns what it is worth.** Contact
consent living in Relationship means every domain that wants to message a
patient must pass through a domain whose job is the patient's side of it.

Supersedes: the boundary table in `domains/business-growth.md` §6 and the
ownership rule in `domains/patient-experience.md` §4, both amended in place.

### 11.2 Learning becomes a domain — and it is not HR

Owns competency, training, certification, skills, renewals, mentoring,
assessments.

Worth noting how much substrate already exists: activities `TRN-001`–`TRN-005`
are in the frozen matrix, `CompetencyLevel` is in contracts,
`ROLES_DENIED_CLINICAL_AUTHORITY` is enforced, and the matrix already carries
Role Competency Coverage %, Training Completion %, Competency Gate Compliance %
and Current Competency %. Learning is **closer to buildable than HR**, and
separating them is what makes that visible — folded into HR it would have
waited on an attendance module it does not need.

The distinction that matters: HR asks "is this person here and paid";
Learning asks "is this person **allowed to do this**". The second is a clinical
safety gate, and it is already wired to one.

### 11.3 The Executive layer is a decision layer

The Group dashboard registered in §4 was described as an operational view
across clinics. It is not. Its verbs are **allocate, invest, coach, intervene**
— not fix. It consumes maturity grade and trend, never task lists.

> Which clinic needs me? Which is declining? Which needs investment? Which
> manager needs coaching?

Consequence for the registry: `Group` takes its sections from the Maturity
Model and the Intelligence layer, not from operational domains. A CEO screen
built out of operational sections is a manager's screen with more rows, which
is the mistake this whole architecture exists to avoid.

### 11.4 Three cross-cutting layers now exist

Maturity Model, Intelligence and Knowledge are defined in `product-vision.md`
§6. They are **not domains** — they consume every domain's output and publish
back into any dashboard. Architecturally they need one thing from this
document: the domain contract must expose enough for them to consume, which it
does via `kpis` and `parameters`. No change required, which is the test that
the contract was right.

### 11.5 Revised phase map

Phases now follow the owner's roadmap in `product-vision.md` §7. Phase 4 is
explicitly gated on the pilot, not on engineering readiness.

| Domain / layer | Phase |
|---|---|
| Operations, Clinical, Quality | 1 — build |
| Patient Experience, Inventory, Maintenance | 2 — during pilot |
| Learning | 2–3 |
| Patient Relationship | 4 — after the core proves itself |
| Business Growth, Marketing, Accounts, HR | 4 |
| Maturity Model | 4 — needs sustained real compliance data to grade against |
| Intelligence, Knowledge | 4 |
| Rider, Group / Executive | 4 |

## 12. Open decisions

| # | Decision | Needed by |
|---|---|---|
| D1 | Does Clinic Head share Clinic Command, or is it a governance dashboard? | Phase 2 |
| D2 | Six new role codes (Maintenance, HR, Marketing, Accounts, Rider, CEO) — approve the names before they enter a migration | Phase 2 |
| D3 | Rider's three questions (§9) | Phase 4 |
| D4 | Compliance report immutability — append-only table, or signed export, or both? | Phase 2 |
| D5 | Does a clinic manager see business reports? Proposed: no. | Phase 3 |
