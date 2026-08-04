/**
 * Patient 360 — and Journey 2, because they are the same thing.
 *
 * A patient record organised by module would be sixteen equal sections and
 * would repeat the mistake the owner named: every page starting at level 2.
 * So this screen leads with one answer, and the journey is its spine.
 *
 *   Mrs Sharma
 *   NOT READY — signed consent, implant components
 *   ────────────────────────────────
 *   Arrival ✓ · Readiness ✗ · Consent ✗ · Treatment · Lab · Payment …
 *
 * Everything below the headline explains why. Everything KuBi does not hold is
 * named as missing rather than omitted, because a record that silently lacks
 * payments looks complete and is not.
 */
import { useEffect, useState } from 'react';
import { api, type Patient360, type JourneyStage } from '../api.js';
import {
  Screen, Answer, Group, Row, Tag, Notice, Empty, More, Journey,
  Loading, Failed, toneOf, type Step,
} from '../ui.js';

export function Patient360({
  patientLabel, onBack,
}: {
  patientLabel: string;
  onBack: () => void;
}) {
  const [p, setP] = useState<Patient360 | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = () => { void api.patient(patientLabel).then(setP).catch(() => setFailed(true)); };
  useEffect(load, [patientLabel]);

  /**
   * Move the journey on, from the journey.
   *
   * The whole point of the domain pass: a patient screen that only describes
   * work is a picture. Moving somebody through a morning used to mean leaving
   * this record for the clinic list and back again.
   */
  async function advance(act: NonNullable<JourneyStage['act']>) {
    setBusy(act.id);
    setProblem(null);
    try {
      if (act.kind === 'VISIT') {
        const [visitId, to] = act.id.split(':');
        await api.setAppointmentStatus(visitId!, to as 'ARRIVED' | 'IN_CHAIR' | 'COMPLETED');
      } else {
        await api.startPatientProcedure(act.id);
      }
      load();
    } catch (e) {
      // The server's refusal, passed through unchanged. It is written for a
      // person to read and is usually more useful than anything invented here.
      setProblem(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  if (failed) return <Failed what="No record for that patient." back={onBack} />;
  if (!p) return <Loading />;

  const verdictTone = p.headline.verdict === 'READY'
    ? 'good' as const
    : p.headline.verdict === 'NOT READY' ? 'stop' as const : 'calm' as const;

  const steps: Step[] = p.journey.map((s) => ({
    key: s.key,
    label: s.label,
    state: s.state as Step['state'],
    detail: s.detail,
    needs: s.needs,
    act: s.act
      ? { label: s.act.label, onClick: () => void advance(s.act!), busy: busy === s.act.id }
      : null,
  }));

  return (
    <Screen wide back={onBack}>
      {/* The answer, first and biggest. Everything below explains why. */}
      <h1 className="screen-title">{p.patientLabel.replace('SYNTHETIC ', '')}</h1>
      <p className="screen-sub">{p.uhid ?? 'No UHID recorded'}</p>

      <Answer verdict={p.headline.verdict} why={p.headline.why} tone={verdictTone} />

      {/* Safety before anything else, never inside a tab and never folded. */}
      {p.alerts.length > 0 && (
        <Notice tone="stop" title="Medical alerts — read before treating">
          {p.alerts.map((a) => <div key={a}>{a}</div>)}
        </Notice>
      )}

      {problem && <Notice tone="stop">{problem}</Notice>}

      {/* Journey 2, as the spine of the record. */}
      <Group title="The journey">
        <Journey steps={steps} />
      </Group>

      {/* Progressive disclosure: detail, never a decision. */}
      <More label="Show the full record" open={showAll} onToggle={() => setShowAll(!showAll)}>
        {/* One continuous log. A timeline explains a day without opening a
            report, which is why owners read them and not dashboards. */}
        <Group title="Timeline">
          {p.timeline.length === 0
            ? <Empty>Nothing has happened yet.</Empty>
            : p.timeline.map((t, i) => (
              <Row
                key={`${t.at}-${i}`}
                title={t.what}
                note={t.at}
                tone={t.tone === 'RED' ? 'stop' : t.tone === 'AMBER' ? 'warn' : 'calm'}
              />
            ))}
        </Group>

        <Group title="Appointments">
          {p.appointments.length === 0
            ? <Empty>Nothing booked.</Empty>
            : p.appointments.map((a) => (
              <Row
                key={a.id}
                title={a.visitType}
                note={`${a.chairLabel} · ${a.status.toLowerCase().replace(/_/g, ' ')}`}
              />
            ))}
        </Group>

        <Group title="Procedures and readiness">
          {p.procedures.length === 0
            ? <Empty>No procedure planned.</Empty>
            : p.procedures.map((pr) => (
              <Row
                key={pr.id}
                title={pr.name}
                note={pr.status.toLowerCase().replace(/_/g, ' ')}
                /* Each requirement carries its own verdict. UNKNOWN is not
                   PASS and must not be allowed to look like it, so the tone
                   comes from the five-valued result, not from a boolean. */
                tags={pr.requirements.map((r) => (
                  <Tag key={r.label} tone={toneOf(r.result)}>
                    {r.label} — {r.result.toLowerCase().replace(/_/g, ' ')}
                  </Tag>
                ))}
              />
            ))}
        </Group>

        <Group title="Laboratory">
          {p.labCases.length === 0
            ? <Empty>No lab work.</Empty>
            /* The gate says why, not merely that it refuses. */
            : p.labCases.map((l) => (
              <Row
                key={l.id}
                title={l.workType}
                note={l.reference}
                {...(l.reason ? { tone: 'stop' as const } : {})}
                {...(l.reason ? { tags: <Tag tone="stop">{l.reason}</Tag> } : {})}
              />
            ))}
        </Group>

        <Group title="Follow-ups">
          {p.followups.length === 0
            ? <Empty>None due.</Empty>
            : p.followups.map((f) => (
              <Row
                key={f.id}
                title={f.procedureName}
                note={`${f.dueLabel} · ${f.outcome.toLowerCase().replace(/_/g, ' ')}`}
                {...(f.redFlagReason ? { tone: 'stop' as const } : {})}
                {...(f.redFlagReason ? { tags: <Tag tone="stop">{f.redFlagReason}</Tag> } : {})}
              />
            ))}
        </Group>

        {/* Principle 3 — say the gap out loud. A record that silently lacks
            payments looks complete and is not. */}
        <Group title="Not held in KuBi yet" note="Named rather than omitted.">
          {p.notHeld.map((m) => <Row key={m.what} title={m.what} note={`needs ${m.needs}`} />)}
        </Group>
      </More>
    </Screen>
  );
}
