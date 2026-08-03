# Domain design — Business Growth

Design review 2 of 3. **Not for implementation.** The purpose is to establish
Business Growth as a first-class domain with a defined shape, so the merged
architecture leaves the right space and so nobody later invents its inputs.

Owner-level operational metrics — deliberately *operational*, not financial
reporting. The distinction is in §2.

---

## 1. The question this domain answers

> **"Where is the money the clinic has already earned the right to?"**

Not "what did we bill". Growth is about work that has been *proposed and not
yet closed*: a treatment plan the patient has not accepted, a recall that is
due, a satisfied patient who was never asked for a review, a referral that was
never followed up. Every one of those is revenue the clinic has already paid the
acquisition cost for.

This is what an owner wakes up thinking about, and none of it is in KuBi today.

## 2. Why this is operations, not accounting

An accounts dashboard asks "what is billed, collected, outstanding". A growth
dashboard asks "what should have been proposed, followed up or asked for, and
was not". The second one generates **tasks**; the first generates statements.

That is the test for anything entering this domain: **if it cannot produce work
for somebody tomorrow, it belongs in Business Reports, not in Business Growth.**
Marketing ROI is a number you read. "Four high-value estimates are 14 days old
and nobody has rung" is a job.

## 3. The prerequisite — a relationship layer

None of the six metrics below is computable today, and the reason is a single
missing substrate rather than six missing features.

KuBi holds patients as **clinical** records: a person with procedures, consents,
follow-ups and lab cases. It does not hold them as **relationships**: how they
found the clinic, which segment they belong to, what was proposed to them, what
they said, whether they may be contacted and on which channel.

The relationship layer, at minimum:

| Concept | Why growth needs it |
|---|---|
| **Patient segment** | Premium, family, corporate, referred. Every growth metric is meaningless in aggregate and useful per segment. |
| **Acquisition source** | Which channel, campaign or referrer brought this person in. Without it, marketing return is unattributable. |
| **Treatment plan and estimate** | A proposal with line items, a value and a status. This is the single largest gap: **treatment acceptance cannot be defined without it**, because acceptance is a ratio whose numerator and denominator both live here. |
| **Contact consent and channel** | WhatsApp, phone, email — and permission for each. A recall the patient never agreed to receive is not a recall, it is a complaint. |
| **Interaction history** | What was said, when, by whom, on which channel. Recall effectiveness is attempts against outcomes. |
| **Referral** | Who referred whom, in which direction, and what came of it. |

**Consequence for sequencing:** the relationship layer is a prerequisite domain.
Building growth first would mean inventing its inputs, which principle 2 of the
vision forbids. It is also the honest answer to why the Owner dashboard
currently lists nine metrics as "not yet answerable" — they were never missing
screens, they were missing data.

## 4. The six metrics

For each: what it means, what produces work, what it needs, and what KuBi has
today.

### 4.1 Treatment Acceptance

**Means:** of the treatment proposed, how much was accepted — by count, by
value, by doctor, by segment, and by how long it took.

**Produces work:** a plan presented and not answered after N days becomes a task
for reception. A doctor whose acceptance drops on one procedure type becomes a
conversation, not a scolding.

**Needs:** treatment plan with line items and value; presented/accepted/declined
/deferred status with timestamps; who presented it.

**Today:** nothing. `PatientProcedure` records work that is happening, not work
that was offered. **This is the foundational gap of the whole domain.**

**Trap to avoid:** acceptance measured only by count rewards proposing cheap
work. Value and count must both be shown, and neither alone.

### 4.2 Pending High-Value Cases

**Means:** accepted or presented cases above a value threshold that have not
progressed — the implant plan agreed in April with nothing booked since.

**Produces work:** the single highest-yield task list an owner can have. Each
row is a named patient, a value, an age in days and a next action.

**Needs:** treatment plan value; a case lifecycle beyond the individual
procedure; a configurable threshold per clinic.

**Today:** nothing.

**Trap to avoid:** an aging list that nobody is accountable for becomes
wallpaper within a fortnight. Every row needs an owner and a next action date,
or it does not belong on a dashboard.

### 4.3 Reviews

**Means:** eligible patients asked, asked-to-left conversion, rating
distribution, and response to negative reviews.

**Produces work:** "eleven patients finished treatment this week and were never
asked" is a reception task. A one-star review is an incident, and should raise
one.

**Needs:** review-request tracking, contact consent, and eventually a platform
integration for outcomes.

**Today:** `FUP-005` exists in the frozen matrix as a "Google review request"
activity, and prototype #1 surfaces it on the reception briefing. So the *task*
exists; the *outcome* does not — KuBi can record that we asked, never that they
left one.

**Shared with Patient Experience.** Reviews are the visible surface of
satisfaction. Owned by Patient Experience, consumed here — see §6.

### 4.4 Referrals

**Means:** patients arriving on the recommendation of another patient or a
referring dentist; and referrals the clinic sends out. Both directions.

**Produces work:** a thank-you that never went out; a referring dentist who has
sent nobody in six months; an outbound referral whose outcome was never chased.

**Needs:** a referral record linking two parties with a direction, a source and
an outcome; referrer as a first-class party, since a referring dentist is not a
patient.

**Today:** nothing.

**Trap to avoid:** modelling referrals as a free-text field on the patient.
It has to be a relationship between two parties or none of the questions above
can be asked.

### 4.5 Recall Effectiveness

**Means:** of recalls due, how many were attempted, contacted, booked and
attended — the funnel, not the count. Broken down by channel and segment.

**Produces work:** the due list itself, plus "the WhatsApp channel converts at
half the phone rate" as a decision rather than a hunch.

**Needs:** recall schedule per patient and procedure type; attempt log with
channel and outcome; conversion to a booked appointment.

**Today:** partial and adjacent. `followup.service.ts` generates clinical
follow-ups after procedures and records responses. That is post-operative care,
**not** recall — a different clock, a different purpose, a different owner. They
should not be conflated, and the existing service should not be stretched to
cover both.

### 4.6 Marketing Performance

**Means:** by channel and campaign — enquiries, conversions to first visit,
cost per acquired patient, and value of treatment accepted by those patients.

**Produces work:** stopping a campaign; noticing a channel that produces
enquiries nobody answered.

**Needs:** acquisition source on every patient; campaign spend; enquiry records
for people who never became patients.

**Today:** nothing, and note the second-order requirement — measuring marketing
means recording **non-patients**, which is a new class of record.

**Trap to avoid:** cost per acquisition without acceptance value ranks the
cheapest channel first, which is usually the worst one.

## 5. Shape as a domain

Per the domain contract in the dashboard strategy:

```
domains/business-growth/
  parameters:  none in the frozen matrix today — new control heads required,
               which means Matrix v3.0, not a v2.0 amendment
  kpis:        acceptance % (count), acceptance % (value), high-value pipeline
               age, review request %, review conversion %, referral in/out,
               recall funnel conversion, cost per acquisition, acquired value
  sectionsFor: OWNER_DIRECTOR   → "Needs a decision", "Pipeline ageing"
               CLINIC_HEAD      → "Acceptance by doctor"
               RECEPTION        → "Calls to make" (recalls, reviews, estimates)
               TREATING_DOCTOR  → "Plans presented, not answered"
  attention:   high-value case ageing past threshold; negative review received;
               recall funnel collapse on a channel
  phase:       3
```

Note the last one carefully: this domain contributes sections to **four**
existing dashboards, not only the owner's. A recall to chase is a reception job.
That is exactly why domains contribute sections rather than owning screens.

## 6. Boundary with Patient Experience

> **Amended 3 August.** A **Patient Relationship** domain now sits between
> Patient and Experience, and it takes **recall** and the **referral network**
> out of Growth. Growth keeps the commercial outcome; Relationship owns the
> contact, the consent and the network. So §4.4 and §4.5 above describe
> metrics Growth *consumes* — the records they run on belong to Relationship,
> and Growth must not create them. The table below is superseded by
> `kubi-v3-dashboard-strategy.md` §11.1 where the two disagree; it is kept for
> the asking-versus-getting rule, which still holds.

The two domains overlap on reviews, recalls and referral requests, and the
boundary needs to be explicit before either is built.

| Concept | Owned by | Consumed by | Rule |
|---|---|---|---|
| Review request task | Patient Experience | Growth | Asking is care; conversion is growth |
| Review outcome and rating | Patient Experience | Growth | Rating is a satisfaction signal first |
| Complaint | Patient Experience | Growth (as a leak) | Never owned by growth |
| Waiting time | Patient Experience | — | Experience only |
| Referral request to a patient | Patient Experience | Growth | Asking is care |
| Referral record and outcome | Growth | Patient Experience | The relationship is commercial |
| Recall due | Growth | — | Commercial clock |
| Clinical follow-up | Clinical (exists today) | Patient Experience | **Not** a recall |

**The governing rule:** *asking* a patient for something is Patient Experience;
*what the clinic gets* from it is Business Growth. It keeps the incentive
honest — a clinic optimising the second without the first is one that pesters
people.

## 7. What this domain must never become

Three failure modes, recorded now because they are easy to slide into and hard
to reverse.

1. **A revenue dashboard.** Revenue belongs to Accounts. The moment this screen
   leads with a rupee total it stops generating work and starts generating
   anxiety.
2. **A staff league table.** Acceptance by doctor is a coaching input. Ranked
   publicly it produces over-selling, which is a clinical risk and a complaint
   pipeline.
3. **A reason to contact people who did not agree to be contacted.** Contact
   consent is a hard gate, not a preference. Per vision principle 4.4, a hard
   gate has no override.

## 8. Open decisions

| # | Decision |
|---|---|
| G1 | Is the relationship layer its own domain, or part of an existing patient domain? Proposed: its own, since marketing and experience both depend on it and neither should own it. |
| G2 | High-value threshold — fixed per clinic, or a percentile of that clinic's own plans? |
| G3 | Is a referring dentist a party, an organisation, or both? |
| G4 | Does treatment acceptance count deferred plans as declined, or hold them open? This changes every acceptance figure the clinic will ever quote. |
| G5 | Do non-patient enquiries live in KuBi at all, or in a marketing tool that hands over on conversion? |
