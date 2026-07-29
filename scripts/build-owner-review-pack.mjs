/**
 * Builds the VS-02 Owner Review Pack from the captured screens.
 *
 * Generated, so it can be rebuilt after any recapture: the screenshots are the
 * source of truth and this only frames them.
 *
 * Usage:  node scripts/build-owner-review-pack.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = 'docs/screens';
const OUT = 'docs/vs-02-owner-review-pack.html';

const img = (f) => `data:image/png;base64,${readFileSync(`${DIR}/${f}.png`).toString('base64')}`;

/** §3 — the walkthrough, in the order the morning actually happens. */
const WALKTHROUGH = [
  {
    id: 'arrive',
    time: '08:55',
    who: 'Priya, dental assistant',
    title: 'She opens KuBi and knows where the clinic is',
    body: 'Before anything about her own jobs: which clinic, what time, what phase, how many areas are ready, how long until she has to be. Underneath, the thing being done right now is already open — no tap to get into it. <strong>First patient 09:30</strong> is read from the day\'s schedule, not assumed.',
    shots: [['03-today', 'Today']],
  },
  {
    id: 'blocked',
    time: '09:05',
    who: 'Priya',
    title: 'The emergency kit cannot be confirmed, and it is not her call',
    body: 'The requirement has no backing module, so the system genuinely does not know — and says so in those words. Finishing anyway is a management judgement, so she is not offered it. She is told a manager has been asked, and does not have to go and find one.',
    shots: [
      ['08-cant-confirm', 'The warning, before she starts'],
      ['11-cannot-finish-not-your-call', 'Refused, and handed on'],
    ],
  },
  {
    id: 'manager',
    time: '09:07',
    who: 'Rahul, clinic manager',
    title: 'The ask reaches him, and opens the task rather than a form',
    body: 'It arrives on Attention without anybody phoning him. Tapping it goes straight to the task — not to a "what did you do?" box, which would be a dead end for something that is a decision, not a note. His reason is the record; Priya is never asked to justify a judgement that was not hers.',
    shots: [
      ['23-manager-asked', 'Attention'],
      ['24-manager-releases-it', 'Letting it go ahead'],
    ],
  },
  {
    id: 'work',
    time: '09:10',
    who: 'Priya',
    title: 'She finishes the morning',
    body: 'Progress is visible on both the task and the clinic. Reporting a problem stays one press away throughout, and never reads as failing.',
    shots: [
      ['05-do-this-ticked', 'A checklist mid-way'],
      ['09-report-a-problem', 'Reporting, if she needs to'],
    ],
  },
  {
    id: 'ready',
    time: '09:26',
    who: 'Anyone',
    title: 'The clinic is open — a state it could not previously reach',
    body: 'Five of five, and the header turns green. This is genuinely new: before VS-02 the emergency-kit check was finishable by nobody, so the clinic never read as ready.',
    shots: [['19-today-empty', 'Opening complete']],
  },
  {
    id: 'day',
    time: '09:30',
    who: 'Kavita, reception',
    title: 'The day, as people rather than jobs',
    body: 'Who is here, who is next, who has been waiting too long. One press moves a visit along, and it is always the press that visit realistically needs next. A cancellation keeps its reason — the database refuses one without.',
    shots: [
      ['20-clinic-the-day', 'The day'],
      ['21-clinic-waiting', 'Somebody arrives'],
      ['22-clinic-in-chair', 'Taken through'],
    ],
  },
];

/** §4 */
const AUTONOMOUS = [
  ['Schedule only — no clinical record', 'Appointments carry patient, time, chair and visit type. No treatment, no billing, no notes. KuBi needs to know where the day is; it does not need to know what was done to a tooth. Keeps the PHI surface as small as the job allows.'],
  ['A list, not a calendar grid', 'A grid is right for booking and wrong for running a morning. At 09:40 nobody needs to see 4pm — they need to know who is standing in reception.'],
  ['Cancelling always records a reason', 'Enforced by database trigger, not just a form. "Never booked" and "cancelled" are different facts and a clinic has to be able to tell them apart afterwards.'],
  ['Terminal states are terminal', 'Finished and cancelled visits cannot be reopened. Reopening a finished visit is a new appointment, not a status change.'],
  ['Who sees the patient list', 'Reception, clinical and management roles. Housekeeping, inventory and lab get nothing: a patient list they have no use for is a list they should not see.'],
  ['Authorisation is per task, per day', 'A manager releasing today\'s emergency-kit check says nothing about tomorrow\'s. A standing exemption would be a policy decision, not a button.'],
  ['Kept the explicit Finish button', 'You asked whether 7 taps could become 5. It is now 6 — the tap to open a task is gone. The last one would mean committing on the final tick, which changes what that tick means and wants an undo window. Held, and offered below.'],
];

/** §5 */
const NEEDS_OWNER = [
  ['Six taps, or five?',
   'Removing the Finish button means the last tick both confirms the item and completes the task. That is a real change in meaning, and I would want a short undo window with it — which is a state reversal rather than a UI change. Small piece of work either way. Your call, because it is about how much ceremony a clinical record deserves.',
   'business'],
  ['How long is "waiting too long"?',
   'Reception sees a warning at 15 minutes. That number is currently mine, not yours, and it is the sort of thing a clinic has an opinion about. It is configuration, so changing it is a value, not a rebuild.',
   'business'],
  ['Should a late first patient escalate on its own?',
   'Today the clinic being unready 30 minutes before the first patient raises it to the clinic manager. It does not yet escalate further, or notify anyone outside the app. Whether an unready clinic with a patient already waiting should reach you directly is a business policy, not a technical one.',
   'business'],
  ['Booking is not built',
   'VS-02 integrates the schedule; it does not create it. Appointments are seeded. Whether KuBi books appointments itself, or reads them from whatever you use today, is the single biggest question for the next capability — and it is a business decision about where the schedule lives.',
   'scope'],
];

/** §6 */
const DEFECTS = [
  ['The manager was never told', 'The attention item was raised inside the transaction that then refused the task — so it rolled back with the refusal. It looked right in the code and told nobody. Now raised in a transaction of its own, after the refusal.'],
  ['No way to find the blocked task', 'Today returns only your own work, so a manager had no route to somebody else\'s blocked task. The ask now arrives on Attention and opens the task directly.'],
  ['The visit card collapsed on a phone', 'The action button overlapped the patient\'s name and a status pill wrapped into a circle. Rebuilt as a stacked card.'],
  ['A clinic seeing patients still read "opening"', 'The header ignored the new phase, so a clinic with someone in the chair showed "Clinic opening" at 5 of 5.'],
  ['A late patient rendered as unremarkable', 'The clinic\'s own lateness was red; a patient already past their appointment was neutral grey. The most serious number on the screen was the least visible.'],
  ['Times in the wrong timezone', 'Everything rendered in the viewer\'s browser zone, so a 09:00 opening displayed as 03:30. Now formatted in the clinic\'s own zone throughout.'],
];

/** §7 */
const LIMITS = [
  ['No booking', 'Appointments are seeded, not created in the app. Nothing reschedules, and nothing talks to an outside diary yet.'],
  ['No provider view', 'A visit can carry a treating doctor, but nothing yet asks "what is MY list today". The field is there for when it does.'],
  ['Chairs are labels', 'Rooms are named, not modelled. Nothing prevents double-booking a chair — that needs rooms to be real, which needs a reason.'],
  ['No-show is manual', 'Somebody marks it. Nothing decides it on its own after a delay, because how long to wait is a clinic\'s judgement.'],
  ['PostgreSQL 17 gate still unrun', 'Carried since VS-01. This machine has 16.13 and the network policy blocks obtaining 17, so all isolation evidence is from 16.13. Must be run before production.'],
  ['No offline handling', 'A tablet on poor wifi shows an error rather than degrading gracefully. Real for a clinic, and not yet addressed.'],
];

const shot = ([f, cap]) => `
        <figure class="shot">
          <img src="${img(f)}" alt="${cap}" loading="lazy" width="920" height="1880" />
          <figcaption>${cap}</figcaption>
        </figure>`;

const step = (s) => `
    <section class="step" id="${s.id}">
      <div class="step-meta">
        <span class="step-time">${s.time}</span>
        <span class="step-who">${s.who}</span>
      </div>
      <h3>${s.title}</h3>
      <p class="body">${s.body}</p>
      <div class="strip">${s.shots.map(shot).join('')}
      </div>
    </section>`;

const html = `<title>KuBi VS-02 — Owner Review Pack</title>
<style>
  :root {
    --ground: #fbfbfc; --panel: #ffffff; --ink: #10161d; --muted: #5f6b79;
    --rule: #e1e6ec; --accent: #0f5c4a; --accent-tint: #eef5f2;
    --ask: #a8321f; --ask-tint: #fdf2ef;
    --shadow: 0 1px 2px rgba(16,22,29,.05), 0 10px 28px rgba(16,22,29,.07);
    --display: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    --body: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #0d1114; --panel: #141a1f; --ink: #e6ebf0; --muted: #94a1af;
      --rule: #222b33; --accent: #62c3a8; --accent-tint: #10201c;
      --ask: #ff9b83; --ask-tint: #241512;
      --shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 30px rgba(0,0,0,.45);
    }
  }
  :root[data-theme="dark"] {
    --ground: #0d1114; --panel: #141a1f; --ink: #e6ebf0; --muted: #94a1af;
    --rule: #222b33; --accent: #62c3a8; --accent-tint: #10201c;
    --ask: #ff9b83; --ask-tint: #241512;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 30px rgba(0,0,0,.45);
  }
  :root[data-theme="light"] {
    --ground: #fbfbfc; --panel: #ffffff; --ink: #10161d; --muted: #5f6b79;
    --rule: #e1e6ec; --accent: #0f5c4a; --accent-tint: #eef5f2;
    --ask: #a8321f; --ask-tint: #fdf2ef;
    --shadow: 0 1px 2px rgba(16,22,29,.05), 0 10px 28px rgba(16,22,29,.07);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font-family: var(--body); font-size: 17px; line-height: 1.6;
    -webkit-text-size-adjust: 100%;
  }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px 110px; }
  .col { max-width: 66ch; }

  h1 {
    font-family: var(--display); font-weight: 400;
    font-size: clamp(34px, 5vw, 54px); line-height: 1.08; letter-spacing: -.015em;
    margin: 0 0 20px; text-wrap: balance;
  }
  h2 {
    font-family: var(--display); font-weight: 400;
    font-size: clamp(25px, 3.2vw, 34px); line-height: 1.2; letter-spacing: -.01em;
    margin: 0 0 8px; text-wrap: balance;
  }
  h3 {
    font-family: var(--body); font-weight: 650; font-size: 20px;
    letter-spacing: -.005em; margin: 0 0 8px; text-wrap: balance;
  }
  p { margin: 0 0 16px; }
  .body, .lead { color: var(--muted); max-width: 66ch; }

  .eyebrow {
    font-family: var(--mono); font-size: 12px; letter-spacing: .13em;
    text-transform: uppercase; color: var(--muted); margin: 0 0 18px;
  }

  /* ---- masthead ---- */
  header.top { padding: 76px 0 40px; border-bottom: 1px solid var(--rule); }
  .standfirst { font-size: 19.5px; color: var(--muted); margin: 0 0 30px; max-width: 62ch; }
  .facts { display: flex; flex-wrap: wrap; gap: 10px; padding: 0; margin: 0; list-style: none; }
  .facts li {
    font-family: var(--mono); font-size: 12.5px;
    border: 1px solid var(--rule); border-radius: 999px; padding: 5px 12px;
    color: var(--muted); background: var(--panel);
  }
  .facts b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }

  /* ---- numbered sections: this pack has a fixed running order ---- */
  section.part { padding: 56px 0; border-bottom: 1px solid var(--rule); }
  .part-no {
    font-family: var(--mono); font-size: 12px; letter-spacing: .13em;
    text-transform: uppercase; color: var(--accent); margin: 0 0 10px;
  }

  /* ---- what was built ---- */
  .built { display: grid; gap: 16px; margin-top: 26px; }
  @media (min-width: 780px) { .built { grid-template-columns: 1fr 1fr; gap: 18px; } }
  .built-item {
    background: var(--panel); border: 1px solid var(--rule); border-radius: 12px;
    padding: 18px 20px;
  }
  .built-item h3 { font-size: 17px; margin-bottom: 5px; }
  .built-item p { margin: 0; color: var(--muted); font-size: 15.5px; }

  /* ---- walkthrough ---- */
  .step { padding: 40px 0 12px; border-top: 1px solid var(--rule); }
  .step:first-of-type { border-top: 0; }
  .step-meta { display: flex; align-items: baseline; gap: 14px; margin-bottom: 10px; }
  .step-time {
    font-family: var(--mono); font-size: 15px; font-weight: 600;
    color: var(--accent); font-variant-numeric: tabular-nums;
  }
  .step-who {
    font-family: var(--mono); font-size: 12px; letter-spacing: .08em;
    text-transform: uppercase; color: var(--muted);
  }
  .strip { display: flex; gap: 20px; overflow-x: auto; padding: 22px 4px 8px; }
  .shot { margin: 0; flex: 0 0 auto; }
  .shot img {
    display: block; width: 262px; height: auto; border-radius: 14px;
    border: 1px solid var(--rule); box-shadow: var(--shadow); background: #fff;
  }
  .shot figcaption {
    font-family: var(--mono); font-size: 12px; color: var(--muted); margin-top: 10px;
  }

  /* ---- lists ---- */
  ol.plain, ul.plain { margin: 26px 0 0; padding: 0; list-style: none; display: grid; gap: 0; }
  ol.plain li, ul.plain li {
    padding: 16px 0; border-top: 1px solid var(--rule); display: grid; gap: 5px;
  }
  ol.plain li p, ul.plain li p { margin: 0; color: var(--muted); font-size: 15.5px; }

  /* ---- decisions needing the owner ---- */
  .asks { display: grid; gap: 14px; margin-top: 26px; }
  .ask {
    background: var(--ask-tint); border: 1px solid var(--rule);
    border-left: 3px solid var(--ask); border-radius: 0 12px 12px 0; padding: 18px 20px;
  }
  .ask h3 { font-size: 18px; }
  .ask p { margin: 0; color: var(--muted); font-size: 15.5px; }
  .ask .kind {
    font-family: var(--mono); font-size: 11px; letter-spacing: .1em;
    text-transform: uppercase; color: var(--ask); display: block; margin-bottom: 7px;
  }

  /* ---- recommendation ---- */
  .rec {
    background: var(--accent-tint); border: 1px solid var(--rule);
    border-radius: 14px; padding: 26px 28px; margin-top: 26px;
  }
  .rec h3 { font-family: var(--display); font-weight: 400; font-size: 25px; }
  .rec p { color: var(--muted); }
  .rec p:last-child { margin-bottom: 0; }
  .rec strong { color: var(--ink); }

  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 3px; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">
  <header class="top">
    <p class="eyebrow">KuBi · Vertical Slice 02 · Owner Review Pack</p>
    <h1>The clinic knows where its day is</h1>
    <p class="standfirst">
      VS-02 integrates the schedule, so “are we ready?” finally means something:
      ready <em>for whom</em>, and <em>by when</em>. Built, tested, used, and the
      defects found by using it are fixed. Everything below is captured from the
      running system against synthetic data.
    </p>
    <ul class="facts">
      <li><b>127</b> tests passing</li>
      <li><b>63</b> integration</li>
      <li><b>37</b> UI</li>
      <li><b>27</b> unit</li>
      <li><b>6</b> defects found &amp; fixed</li>
      <li><b>4</b> decisions for you</li>
    </ul>
  </header>

  <section class="part">
    <p class="part-no">One · What was built</p>
    <h2>Appointments, and what the clinic does with them</h2>
    <p class="lead">
      The point was never to render a diary. It is that a clinic’s readiness is
      meaningless in the abstract and obvious once you know who is arriving.
    </p>
    <div class="built">
      <div class="built-item">
        <h3>The day, as people</h3>
        <p>A new Clinic tab: who is here, who is next, who has been waiting too long. One press moves a visit along, and it is always the press that visit realistically needs next.</p>
      </div>
      <div class="built-item">
        <h3>A real first patient</h3>
        <p>The header’s first-patient time comes from the schedule instead of being absent. It is the next patient still to come — not simply the earliest row, which would keep pointing at someone already seen.</p>
      </div>
      <div class="built-item">
        <h3>Readiness against arrivals</h3>
        <p>The sweep that marks tasks late now also asks whether the first patient is nearly here while opening is outstanding, and tells the clinic manager. Nobody has to remember to check.</p>
      </div>
      <div class="built-item">
        <h3>Phases that mean something</h3>
        <p>Opening → Open → Seeing patients, driven by the actual state of both the checklist and the chairs.</p>
      </div>
      <div class="built-item">
        <h3>Isolation, from the first row</h3>
        <p>Appointments are the first table tying a patient to a time and a place. Two-level row-level security from the start; a person scoped to another clinic cannot see these exist.</p>
      </div>
      <div class="built-item">
        <h3>The Q2 hand-off</h3>
        <p>Your last decision left the emergency-kit check finishable by nobody. A manager now releases one task for one day; the assignee finishes it. Neither can do the other’s part.</p>
      </div>
    </div>
  </section>

  <section class="part">
    <p class="part-no">Two &amp; Three · The morning, screen by screen</p>
    <h2>09:00 to 09:30, as it actually runs</h2>
    <p class="lead">
      One continuous morning rather than a feature tour — the same clinic, three
      people, in order.
    </p>
${WALKTHROUGH.map(step).join('\n')}
  </section>

  <section class="part col">
    <p class="part-no">Four · Decisions I made</p>
    <h2>Made without asking</h2>
    <p class="lead">
      All cheap to reverse. Listed so nothing is a surprise, not because any of
      them needs signing off.
    </p>
    <ul class="plain">
${AUTONOMOUS.map(([t, d]) => `      <li><h3>${t}</h3><p>${d}</p></li>`).join('\n')}
    </ul>
  </section>

  <section class="part">
    <p class="part-no">Five · Decisions that need you</p>
    <h2>Genuinely yours</h2>
    <p class="lead">
      Expensive or clinically significant to reverse, or a business policy I
      should not be setting.
    </p>
    <div class="asks">
${NEEDS_OWNER.map(([t, d, kind]) => `      <div class="ask"><span class="kind">${kind === 'scope' ? 'Scope' : 'Business policy'}</span><h3>${t}</h3><p>${d}</p></div>`).join('\n')}
    </div>
  </section>

  <section class="part col">
    <p class="part-no">Six · Defects</p>
    <h2>Found and fixed</h2>
    <p class="lead">
      All six were found by building and using it, not by testing it. The first
      is the one worth reading.
    </p>
    <ol class="plain">
${DEFECTS.map(([t, d]) => `      <li><h3>${t}</h3><p>${d}</p></li>`).join('\n')}
    </ol>
  </section>

  <section class="part col">
    <p class="part-no">Seven · Limitations</p>
    <h2>What this does not do</h2>
    <ul class="plain">
${LIMITS.map(([t, d]) => `      <li><h3>${t}</h3><p>${d}</p></li>`).join('\n')}
    </ul>
  </section>

  <section class="part col" style="border-bottom:0">
    <p class="part-no">Eight · Next</p>
    <h2>Recommendation</h2>
    <div class="rec">
      <h3>VS-03 — Closing &amp; Handover</h3>
      <p>
        KuBi now opens a clinic and runs its day. It has nothing to say about
        the end of one. Closing is the natural other half of opening: the same
        engine, the same screens, no new architecture — and it is where the
        day’s loose ends actually surface. Who is still waiting at 18:00. What
        was left unfinished. What tomorrow inherits.
      </p>
      <p>
        It is also the capability that makes the audit story real. Right now
        KuBi can prove a morning happened; it cannot yet prove a day was closed
        properly, which is the thing an inspector asks about.
      </p>
      <p>
        <strong>The alternative is booking</strong> — letting KuBi create
        appointments rather than read them. That is a bigger, more valuable
        capability, but it needs your answer on where the schedule lives first
        (see Five). Closing does not, so it can start immediately.
      </p>
    </div>
  </section>
</div>
`;

writeFileSync(OUT, html);
console.log(`${OUT} — ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB`);
