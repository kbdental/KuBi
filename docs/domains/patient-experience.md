# Domain design — Patient Experience

Design review 3 of 3. **Not for implementation.** The purpose is to make patient
experience a first-class domain rather than a set of fields scattered across
other screens, and to leave the architecture the right space for it.

---

## 1. The question this domain answers

> **"What was it actually like to be a patient here today?"**

Everything KuBi measures today is about whether the *clinic* performed. Nothing
measures whether the *patient* had a decent time. Those diverge more often than
is comfortable: a day where every task was ticked, every cycle passed and every
note was written can still be a day where four people waited forty minutes and
one of them will never come back.

The omission was real. It was not scoped out; it was not noticed.

## 2. Why first-class, and not a report

Three reasons, and the third is the one that matters.

1. **It generates work.** A patient waiting past their slot is an intervention
   available for the next eleven minutes, not a statistic available next month.
2. **It is a leading indicator.** Waiting time and complaint resolution move
   before reviews, referrals and revenue do. A domain that only shows up in a
   monthly report is a domain that reports the damage.
3. **It is the counterweight.** Every other parameter in KuBi pushes towards
   throughput and compliance. Without a domain whose job is the patient's
   experience, "efficient" and "good" quietly become the same word — and they
   are not. A clinic can hit every operational target by rushing people.

## 3. The six concepts

### 3.1 Waiting Time

**Means:** appointment time → arrival → seated → treatment start → departure.
Four intervals, not one number. The useful one is *seated later than promised*,
because that is the one the patient experiences as being ignored.

**Produces work:** live — "Mr Shah has been waiting 31 minutes" on the reception
and manager boards, with an expected wait so somebody can go and say so. That
sentence, said at minute twelve, prevents most complaints.

**Needs:** the four timestamps and a promised time.

**Today:** **the closest to buildable of all six.** `clinic.tsx` and the
schedule already move appointments through ARRIVED → IN_CHAIR → COMPLETED, and
prototype #1's reception briefing already displays "waited 31m". What is missing
is that the transitions are not durably timestamped for measurement, and there
is no promised-versus-actual comparison. That is a small migration, not a
module.

**Trap:** measuring average wait. The average is fine on a day when one person
waited an hour. Distribution and worst case, or it tells you nothing.

### 3.2 Complaints

**Means:** a patient says something is wrong — at the desk, on the phone, in a
review, or to the assistant while the doctor is out of the room. Captured,
acknowledged, resolved, closed, with time limits on each.

**Produces work:** acknowledgement is a timed task. Unresolved complaints
escalate. A complaint about a clinical matter must reach a clinician, not a
receptionist.

**Needs:** a complaint record with source, category, severity, acknowledgement,
resolution and closure; escalation rules; and a link to CAPA.

**Today:** nothing — and this is the sharpest gap in the domain, because the
frozen matrix already carries the KPIs for it. `QUALITY_CAPA` lists Complaint
Capture %, Complaint Acknowledgement Time, Complaint Resolution Time and
Complaint Closure %. **The standard exists; the object it measures does not.**
Prototype #1 shows complaints on the reception and manager briefings, from
fixtures.

**The important design decision:** a complaint is not a lesser incident. It
should raise an **Incident** and run the existing CAPA loop — containment, root
cause, corrective and preventive action, effectiveness check, closure. KuBi
already has that loop built and tested. A complaint that gets a sympathetic
phone call and no root cause is how the same complaint arrives again in March.

### 3.3 Satisfaction

**Means:** asked directly — a short post-visit question, and a periodic NPS.
Segmented by doctor, procedure type, visit type and wait experienced.

**Produces work:** a low score is a callback task within a defined window. A
detractor is a complaint that has not been made yet.

**Needs:** a survey mechanism, a delivery channel, contact consent, and response
storage. Depends on the relationship layer for the channel and the consent.

**Today:** nothing.

**Trap:** surveying everybody after every visit trains people to ignore it.
Sample deliberately, and always survey after the visits most likely to have gone
badly — long waits, first implant appointments, remakes.

### 3.4 Reviews

**Means:** public reviews — requested, left, rated, and responded to.

**Produces work:** the request itself; and a response to every negative review
inside a defined window.

**Needs:** request tracking (partly exists as activity `FUP-005`), and a
platform integration for outcomes.

**Today:** the *task* exists in the frozen matrix and on prototype #1's
reception briefing. The *outcome* does not — KuBi can record that we asked,
never what came back.

**Owned here, consumed by Business Growth.** A review is a satisfaction signal
before it is a marketing asset. Owning it in Growth would make the incentive to
ask stronger than the incentive to deserve it.

### 3.5 Follow-up Completion

**Means:** post-operative follow-ups generated, attempted, completed, and the
clinical response to red flags — with time-to-response measured, not just
completion.

**Produces work:** overdue follow-ups; and any red-flag response that has not
reached a clinician.

**Today:** **built.** `followup.service.ts` generates follow-ups after
procedures, records pain / swelling / bleeding / medication responses and
detects red flags; the frozen matrix carries Follow-up Generation %, Surgery
Follow-up Compliance %, Clinical Alert Response Time and Follow-up Compliance %.
This is the one concept in the domain that is complete.

**Note:** clinical follow-up is **not** recall. Different clock, different
purpose, different owner. Recall belongs to Business Growth. Conflating them
would put a commercial trigger inside a clinical safety net, which is the wrong
place for it in both directions.

### 3.6 Referral Requests

**Means:** asking a satisfied patient to recommend the clinic — who was asked,
when, and whether asking was appropriate.

**Produces work:** the request, on eligible patients only.

**Needs:** eligibility rules, request tracking, and contact consent.

**Today:** nothing.

**Owned here, outcome owned by Growth**, per the rule below.

## 4. The boundary rule with Business Growth

> **Asking a patient for something is Patient Experience. What the clinic gets
> from it is Business Growth.**

Requesting a review, requesting a referral, and asking for satisfaction all sit
here. Conversion, referral outcomes and attributable value sit in Growth. This
keeps the incentive honest: a clinic that optimises the second without the first
is one that pesters people, and the architecture should make that harder rather
than easier.

## 5. Relationship to existing parameters

Unlike Business Growth, this domain is **already partly in the frozen matrix** —
which is the strongest argument that it was an oversight in the merge plan
rather than a new idea.

| Existing parameter | Contributes |
|---|---|
| `APPOINTMENT_CONTROL` | Average Waiting Time; No-Show Recovery % |
| `FOLLOWUP_EXPERIENCE` | Follow-up Compliance %, Review Request %, Complaint Capture / Acknowledgement / Resolution / Closure, Satisfaction |
| `QUALITY_CAPA` | The complaint → incident → CAPA path |
| `PATIENT_JOURNEY` | Arrival → exit, the spine the timestamps hang on |

So Patient Experience is largely a **regrouping and completion** of control
heads that already exist, plus two new objects: **Complaint** and
**Satisfaction response**. That is a materially smaller build than Business
Growth, and it is why it should come first.

## 6. Shape as a domain

```
domains/patient-experience/
  parameters:  APPOINTMENT_CONTROL (shared), FOLLOWUP_EXPERIENCE,
               PATIENT_JOURNEY (shared), QUALITY_CAPA (complaint path)
  kpis:        seated-late %, wait distribution p50/p90/worst, complaint
               capture / acknowledgement / resolution / closure, satisfaction,
               NPS, review request %, follow-up completion %, clinical alert
               response time
  sectionsFor: RECEPTION       → "Kept waiting", "Calls to make", "Complaints open"
               CLINIC_MANAGER  → "Patients waiting", "Complaints", "Experience today"
               TREATING_DOCTOR → "Follow-ups needing me", "Complaints about my care"
               OWNER_DIRECTOR  → "Experience this week"
               QUALITY         → "Repeat complaints", "CAPA from complaints"
  attention:   patient waiting past threshold; complaint unacknowledged past SLA;
               red-flag follow-up response overdue; negative review received
  phase:       2   (before Business Growth — see §7)
```

## 7. Why this comes before Business Growth

Four reasons, in order of weight:

1. **The data is closer.** Waiting time is a timestamp migration; follow-up
   completion is done; complaints reuse the CAPA loop that already exists.
   Business Growth needs an entire relationship layer first.
2. **The parameters already exist** in the frozen matrix, with KPIs defined.
   Growth needs new control heads, which means Matrix v3.0.
3. **It is the leading indicator** for most of what Growth wants to measure.
   Reviews and referrals are downstream of experience; building the downstream
   metric first measures an effect whose cause is not instrumented.
4. **It is the counterweight** from §2. If Growth ships first, KuBi spends a
   release optimising for acceptance and recall with nothing in the product
   arguing for the patient.

## 8. Open decisions

| # | Decision |
|---|---|
| P1 | Does every complaint raise an Incident and run full CAPA, or only those above a severity? Proposed: all of them raise one; severity sets the escalation level, not whether it is recorded. |
| P2 | Waiting-time target — a single clinic-wide threshold, or per visit type? A crown delivery and an implant review are not the same promise. |
| P3 | Satisfaction: post-visit micro-survey, periodic NPS, or both? |
| P4 | Which channel carries surveys and review requests — and does that force the relationship layer earlier than Phase 3? |
| P5 | Are complaints visible to the staff member complained about, and when? A real decision with real consequences either way. |
