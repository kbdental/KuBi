/**
 * The compliance gate — engine D.
 *
 * The distinction the whole product turns on, and prototype B rendered it
 * better than anything in A: **this is not a checklist.** A checklist can be
 * ticked while the thing is wrong, and a missing item quietly disappears when
 * somebody scrolls past it. A gate produces a verdict, and the verdict is the
 * screen.
 *
 *   ⚠ PROCEDURE NOT READY — 2 mandatory requirements outstanding.
 *   ✓ READY FOR SURGERY
 *
 * Toggling a requirement re-renders the verdict immediately, because the point
 * is that the verdict is *derived* — nobody declares a procedure ready.
 *
 * The verdict used to sit under the list, which meant this screen also opened
 * at level 2: you read eight requirements before finding out whether they
 * added up. It leads now, like every other screen.
 */
import { useEffect, useState } from 'react';
import { api, type GateView } from '../api.js';
import { Screen, Title, Answer, Group, Row, Tag, Loading, Failed } from '../ui.js';

export function Gate() {
  const [g, setG] = useState<GateView | null>(null);
  // Failure and "not yet arrived" are different states, and collapsing them
  // was a real bug: against the server this screen showed "Loading…" for ever,
  // because the gate endpoint does not exist there yet. A spinner that never
  // resolves is the software telling a person it is working when it is not.
  const [failed, setFailed] = useState(false);
  const load = () => {
    void api.gate().then((v) => { setG(v); setFailed(false); }).catch(() => setFailed(true));
  };
  useEffect(load, []);
  if (failed) {
    return (
      <Failed what={'Procedure readiness is not available on this server yet. '
        + 'The gate model is built and tested; the endpoint that serves it is not.'} />
    );
  }
  if (!g) return <Loading />;

  async function toggle(id: string) {
    await api.toggleGateCheck(id);
    load();
  }

  return (
    <Screen>
      <Title question={g.procedure}>Procedure readiness</Title>

      {/* The verdict IS the screen. Derived, never declared. */}
      <Answer
        verdict={g.ready ? 'READY FOR SURGERY' : 'PROCEDURE NOT READY'}
        why={g.ready
          ? 'Every mandatory requirement is met.'
          : `${g.missingCount} mandatory requirement${g.missingCount === 1 ? '' : 's'} outstanding. `
            + 'The procedure cannot be started, and the requirement does not disappear.'}
        tone={g.ready ? 'good' : 'stop'}
      />

      <Group title="Requirements" note="A gate refuses, and says which requirement is refusing.">
        {g.checks.map((c) => (
          <Row
            key={c.id}
            title={c.label}
            tone={c.met ? 'good' : 'stop'}
            right={<Tag tone={c.met ? 'good' : 'stop'}>{c.met ? 'met' : 'missing'}</Tag>}
            onOpen={() => void toggle(c.id)}
          />
        ))}
      </Group>
    </Screen>
  );
}
