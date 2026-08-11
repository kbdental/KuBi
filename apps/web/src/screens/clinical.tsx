import { useState } from 'react';
import { api, type ClinicalScreenView, type PreTreatmentRowView } from '../api.js';
import {
  Screen, Title, Answer, Group, Fact, Facts, Notice, Switch,
  useLoad, Loading, Failed, type Tone,
} from '../ui.js';

/**
 * PRE-TREATMENT — CLN-001 to CLN-010.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why this is not part of patient events
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Patient events answers *what work does this treatment create*. This answers
 * *may this patient be treated at all*. Two different questions, asked by two
 * different people at two different moments — the assistant working through a
 * list before the chair, and the doctor deciding whether to pick up a
 * handpiece.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CLN-009, and the number that is not on this screen
 * ─────────────────────────────────────────────────────────────────────────
 *
 * *"For CLN-009 the target is simply 100%. No averaging away consent
 * failures."*
 *
 * There is no consent percentage anywhere below, and that is not restraint on
 * this file's part — the engine does not compute one, so the screen has none
 * to draw. 49 of 50 is 98%, which reads like an A and means one person was
 * treated without agreeing to it. What is drawn instead is a count of people,
 * each with a name and a minute.
 */

const hhmm = (m: number | null | undefined): string =>
  m === null || m === undefined
    ? '—'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/* Spelled out rather than built, so the library test can see every name. */
const VERDICT_CLASS: Record<string, string> = {
  MET: 'cln is-done',
  MISSING: 'cln is-bad',
  UNKNOWN: 'cln is-warn',
  NOT_APPLICABLE: 'cln is-dim',
  ADVISORY: 'cln is-quiet',
};

const VERDICT_WORD: Record<string, string> = {
  MET: 'Met',
  MISSING: 'Missing',
  UNKNOWN: 'Not asked',
  NOT_APPLICABLE: 'Not required',
  ADVISORY: 'Advisory',
};

const CONSENT_CLASS: Record<PreTreatmentRowView['consent'], string> = {
  MET: 'pt-consent is-done',
  MISSING: 'pt-consent is-bad',
  BREACHED: 'pt-consent is-bad',
  NOT_APPLICABLE: 'pt-consent is-dim',
};

const CONSENT_WORD: Record<PreTreatmentRowView['consent'], string> = {
  MET: 'Consent signed',
  MISSING: 'Consent not signed',
  BREACHED: 'TREATED WITHOUT CONSENT',
  NOT_APPLICABLE: 'No consent required',
};

/**
 * One patient, and every control that decides whether they may be treated.
 *
 * All ten shown, including the ones that are met. A list that only shows
 * failures cannot be used as the pre-treatment check itself — the assistant
 * working down it before the chair needs to see what she has already done.
 */
function Patient({ r }: { r: PreTreatmentRowView }) {
  return (
    <div className={r.ready ? 'pt' : 'pt is-bad'}>
      <div className="pt-head">
        <span className="pt-time">{hhmm(r.at)}</span>
        <span className="pt-who">
          <b className="pt-name">{r.patientLabel}</b>
          <span className="pt-what">{r.treatmentName}</span>
        </span>
        <span className={r.ready ? 'pt-state is-done' : 'pt-state is-bad'}>
          {r.delivered ? 'Delivered' : r.ready ? 'May start' : 'Not ready'}
        </span>
      </div>

      {/* Consent on its own line, above the rest. It is the one control with a
          100% target and the one whose failure cannot be undone. */}
      <div className={CONSENT_CLASS[r.consent]}>{CONSENT_WORD[r.consent]}</div>

      <div className="cln-list">
        {r.controls.map((c) => (
          <div key={c.id} className={VERDICT_CLASS[c.verdict] ?? 'cln'}>
            <span className="cln-id">{c.id}</span>
            <span className="cln-what">{c.activity}</span>
            <span className="cln-verdict">{VERDICT_WORD[c.verdict] ?? c.verdict}</span>
            <span className="cln-why">{c.because}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The traceability table — where each control actually lives. */
function Register({ v }: { v: ClinicalScreenView }) {
  return (
    <Group
      title="Where each control lives"
      note="Most of this matrix was already built. Three were not, and were."
    >
      <div className="cln-list">
        {v.controls.map((c) => (
          <div key={c.id} className="cln">
            <span className="cln-id">{c.id}</span>
            <span className="cln-what">
              {c.activity}
              <span className="cln-std">{c.standard}</span>
            </span>
            <span className="cln-verdict">{c.priority}</span>
            <span className="cln-why">
              <b>{c.covers}</b> — {c.why}
            </span>
          </div>
        ))}
      </div>
    </Group>
  );
}

export function Clinical() {
  const { data: v, failed, reload } = useLoad<ClinicalScreenView>(
    () => api.clinical(), []);
  const [tab, setTab] = useState<'TODAY' | 'CONTROLS'>('TODAY');

  if (failed) return <Failed what="Could not read the pre-treatment controls." back={reload} />;
  if (!v) return <Loading />;

  const tone: Tone = !v.consent.met ? 'stop'
    : v.notReady > 0 ? 'warn' : 'good';

  return (
    <Screen wide>
      <Title question="May this patient be treated?">Pre-treatment</Title>

      <Answer
        verdict={!v.consent.met ? 'CONSENT FAILURE'
          : v.notReady > 0 ? 'NOT EVERYONE IS READY' : 'ALL CLEAR'}
        why={v.headline}
        tone={tone}
      />

      {/* CLN-009. A count of people, and deliberately no percentage — 49 of 50
          is 98%, which reads like an A and means somebody was treated without
          agreeing to it. The engine does not produce a rate, so this cannot
          show one. */}
      <Facts>
        <Fact
          value={`${v.consent.withConsent}/${v.consent.delivered}`}
          label="Treated with consent in place"
          tone={v.consent.met ? 'good' : 'stop'}
        />
        <Fact
          value={v.consent.failures.length}
          label="Treated without consent"
          tone={v.consent.failures.length > 0 ? 'stop' : 'good'}
        />
        <Fact value={v.notReady} label="Not ready for the chair"
          tone={v.notReady > 0 ? 'warn' : 'good'} />
      </Facts>

      {!v.consent.met && (
        <Notice tone="stop" title="CLN-009 — the target is 100%, and it has not been met">
          {v.consent.failures.map((f) => (
            <div key={f.patientLabel + f.label} className="pt-fail">
              <b>{f.patientLabel}</b> — {f.treatmentName}. {f.because}
            </div>
          ))}
          <p className="screen-sub">
            No percentage is shown here and none is computed. A rate would let
            this average away — two of these in a month of two hundred is
            99 per cent, and it is still two people.
          </p>
        </Notice>
      )}

      <Switch
        value={tab}
        onChange={setTab}
        options={[
          { value: 'TODAY', label: `Today’s patients · ${v.rows.length}` },
          { value: 'CONTROLS', label: 'The ten controls' },
        ]}
      />

      {tab === 'TODAY' && (
        <>
          {v.failing.length > 0 && (
            <Group title="Failing across the day" count={v.failing.length}>
              <div className="cln-list">
                {v.failing.map((f) => (
                  <div key={f.id} className={f.priority === 'PS' ? 'cln is-bad' : 'cln is-warn'}>
                    <span className="cln-id">{f.id}</span>
                    <span className="cln-what">{f.activity}</span>
                    <span className="cln-verdict">{f.priority}</span>
                    <span className="cln-why">
                      {f.count} patient{f.count === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
            </Group>
          )}

          <Group title="Today" count={v.rows.length}>
            <div className="pt-list">
              {v.rows.map((r) => <Patient r={r} key={r.bookingId} />)}
            </div>
          </Group>
        </>
      )}

      {tab === 'CONTROLS' && <Register v={v} />}

      {v.openQuestions.length > 0 && (
        <div className="clash">
          <div className="clash-title">
            {v.openQuestions.length} things this matrix does not settle
          </div>
          {v.openQuestions.map((q) => (
            <div key={q} className="clash-row">{q}</div>
          ))}
          <div className="clash-note">
            Each changes what the engine reports, and each has more than one
            defensible answer.
          </div>
        </div>
      )}
    </Screen>
  );
}
