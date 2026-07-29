/**
 * Builds the VS-01 usability review page from the captured screens.
 *
 * Generated rather than hand-written so it can be rebuilt after any recapture:
 * the screenshots are the source of truth, and this only frames them.
 *
 * Usage:  node scripts/build-usability-review.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = 'docs/screens';
const OUT = 'docs/vs-01-usability-review.html';

const img = (file) =>
  `data:image/png;base64,${readFileSync(`${DIR}/${file}.png`).toString('base64')}`;

/** Stages of the journey, in the order a person lives them. */
const STAGES = [
  {
    id: 'signing-in',
    title: 'Signing in',
    lead: 'Two fields and one button. The refusal is deliberately the same whether the address is unknown or the password is wrong — telling someone which half they got right tells an attacker the same thing.',
    shots: [
      ['01-sign-in', 'Sign in'],
      ['02-sign-in-refused', 'Wrong password'],
    ],
  },
  {
    id: 'the-day',
    title: 'The day',
    lead: 'Priya signs in and the work is simply there — no menu, no search, no choosing. Sections are named the way someone would say them out loud. Tabs appear only when they have something behind them, so an assistant who checks nobody’s work never sees a Checks tab.',
    shots: [
      ['03-today', 'Today, with work waiting'],
      ['07-today-after', 'After finishing one'],
      ['19-today-empty', 'Nothing waiting'],
    ],
  },
  {
    id: 'doing-a-task',
    title: 'Doing a task',
    lead: 'Seven taps: open, five ticks, finish. The screen says someone else will confirm the work <em>before</em> it starts, not after — being told at the end that another person has to look is how people learn to resent a checklist.',
    shots: [
      ['04-do-this', 'Opened'],
      ['05-do-this-ticked', 'All five ticked'],
      ['06-finished', 'Done'],
    ],
    question: {
      n: 1,
      ask: 'Finish stays greyed out until every item is ticked. Is that right for your clinic, or should someone be able to finish with an item unticked and a note explaining why?',
      why: 'Today the honest path for an unticked item is “Report a problem”, which puts it on the manager. That is deliberate — but it means a small, already-handled exception still becomes the manager’s to close.',
    },
  },
  {
    id: 'cannot-confirm',
    title: 'When something can’t be confirmed',
    lead: 'The emergency-kit requirement has no backing module yet, so the system genuinely does not know. It says so, in those words, and it will not let the task be finished quietly. This is the AP-1 rule you set — an unknown must never read as a pass — reaching an actual screen.',
    shots: [
      ['08-cant-confirm', 'The task, with the warning'],
      ['11-before-you-finish', 'The server’s refusal'],
    ],
    question: {
      n: 2,
      ask: 'Anyone assigned the task can go ahead by recording how they checked. Should that stay open to an assistant, or should going ahead require a manager?',
      why: 'The reason is audited and raised to the clinic manager either way, so nothing is hidden. The question is whether the decision itself belongs to whoever is standing there at 8:45am.',
    },
  },
  {
    id: 'reporting',
    title: 'Reporting a problem',
    lead: 'One press away at all times, and never framed as failing. The task goes <strong>on hold</strong> rather than failing, so the person who found the fault is not left holding something they cannot finish. That is on purpose: the cheapest path has to be the honest one.',
    shots: [
      ['09-report-a-problem', 'What’s wrong?'],
      ['10-report-a-problem-chosen', 'Reason and item chosen'],
      ['12-today-with-problem', 'The task, now on hold'],
    ],
    question: {
      n: 3,
      ask: 'Four reasons: Not working, Missing, Not clean, Something else. Are those the right four for your clinic?',
      why: 'Adding a fifth is cheap now and expensive once staff have learned the list.',
    },
  },
  {
    id: 'manager',
    title: 'The manager',
    lead: 'Rahul did not have to be told. Every row answers the five questions a person actually has: what happened, how serious, is it mine, what do I do, by when. Closing something requires saying what was done — that sentence is the record.',
    shots: [
      ['13-attention', 'Attention, worst first'],
      ['14-attention-resolve', 'Closing it'],
    ],
    question: {
      n: 4,
      ask: 'The four severities read as Patient safety, Urgent, Important, Routine. Are those the words you would use in front of staff?',
      why: 'These are the labels people will argue with at 9am. They are display-only and cost nothing to change now.',
    },
  },
  {
    id: 'second-pair-of-eyes',
    title: 'The second pair of eyes',
    lead: 'Anita is the routed checker for room readiness. She never has to find the work — it is waiting. Saying “Not right” is exactly as easy to reach as “Looks right”, and sending work back requires saying what was wrong. A confirmation easier to give than to withhold is not a check.',
    shots: [
      ['15-checks', 'Waiting to be confirmed'],
      ['16-check-one', 'The one she is checking'],
      ['17-check-send-back', 'Sending it back'],
    ],
    question: {
      n: 5,
      ask: 'This screen shows the task and the standard, but <strong>not the five items Priya actually ticked</strong>. Should the checker see them?',
      why: 'This is the most substantive thing the review turned up. Right now Anita confirms work without seeing what was claimed, which weakens the check. Fixing it needs a new field on the API, so it is expansion under the freeze rather than something to slip in — it needs your call.',
      weight: 'high',
    },
  },
  {
    id: 'you',
    title: 'You',
    lead: 'Deliberately almost empty. Who you are, where you work, and the way out — nothing else has earned a place here yet.',
    shots: [['18-me', 'Me']],
    question: {
      n: 6,
      ask: 'No screen shows who reported a problem or who completed a task. That is deliberate — it keeps the tone blame-free. Is that what you want for the pilot?',
      why: 'It is all recorded in the audit trail either way. This is only about what appears on a staff-facing screen.',
    },
  },
];

const FIXED = [
  ['Gate enforced only on screen', 'A blocked task could be finished by calling the API directly. The rule now lives on the server; the screen carries the refusal.'],
  ['Ungrammatical alert headline', 'Read “was finished before the emergency kit list yet”. Rebuilt as a sentence.'],
  ['Greeting by first name', 'Split the display name on a space, which is wrong for a great many people and rendered as “SYNTHETIC”. Removed rather than patched.'],
  ['Monospace form fields', 'Placeholders and typed notes rendered in the browser’s terminal font. Form controls now inherit the page font.'],
  ['Severity pill overlapped the back button', 'The back control was inline, so the pill landed on top of it.'],
  ['Empty day said the same thing twice', '“Nothing waiting.” above “You’re all clear”.'],
];

const shotHtml = ([file, caption]) => `
        <figure class="shot">
          <img src="${img(file)}" alt="${caption}" loading="lazy" width="920" height="1880" />
          <figcaption>${caption}</figcaption>
        </figure>`;

const questionHtml = (q) =>
  !q ? '' : `
      <aside class="ask${q.weight === 'high' ? ' ask-high' : ''}">
        <p class="ask-n">Question ${q.n}${q.weight === 'high' ? ' · needs a decision' : ''}</p>
        <p class="ask-q">${q.ask}</p>
        <p class="ask-why">${q.why}</p>
      </aside>`;

const stageHtml = (s) => `
    <section class="stage" id="${s.id}">
      <h2>${s.title}</h2>
      <p class="lead">${s.lead}</p>
      <div class="strip">${s.shots.map(shotHtml).join('')}
      </div>${questionHtml(s.question)}
    </section>`;

const html = `<title>KuBi VS-01 — Usability Review</title>
<style>
  :root {
    --ground: #fcfcfd;
    --panel: #ffffff;
    --ink: #10161d;
    --muted: #616d7c;
    --rule: #e2e7ed;
    --ask: #b4232b;
    --ask-tint: #fdf2f2;
    --done: #1c6b3f;
    --done-tint: #eef5f0;
    --shadow: 0 1px 2px rgba(16,22,29,.06), 0 8px 24px rgba(16,22,29,.07);
    --display: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    --body: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #0e1216; --panel: #151b22; --ink: #e7ecf2; --muted: #96a3b2;
      --rule: #242e39; --ask: #ff8f92; --ask-tint: #251618; --done: #7fc79b;
      --done-tint: #14201a;
      --shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 28px rgba(0,0,0,.45);
    }
  }
  :root[data-theme="dark"] {
    --ground: #0e1216; --panel: #151b22; --ink: #e7ecf2; --muted: #96a3b2;
    --rule: #242e39; --ask: #ff8f92; --ask-tint: #251618; --done: #7fc79b;
    --done-tint: #14201a;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 28px rgba(0,0,0,.45);
  }
  :root[data-theme="light"] {
    --ground: #fcfcfd; --panel: #ffffff; --ink: #10161d; --muted: #616d7c;
    --rule: #e2e7ed; --ask: #b4232b; --ask-tint: #fdf2f2; --done: #1c6b3f;
    --done-tint: #eef5f0;
    --shadow: 0 1px 2px rgba(16,22,29,.06), 0 8px 24px rgba(16,22,29,.07);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font-family: var(--body); font-size: 17px; line-height: 1.6;
    -webkit-text-size-adjust: 100%;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px 96px; }
  .col { max-width: 64ch; }

  /* ---- masthead ---- */
  .masthead { padding: 72px 0 40px; border-bottom: 1px solid var(--rule); margin-bottom: 8px; }
  .eyebrow {
    font-family: var(--mono); font-size: 12px; letter-spacing: .12em;
    text-transform: uppercase; color: var(--muted); margin: 0 0 18px;
  }
  h1 {
    font-family: var(--display); font-weight: 400; font-size: clamp(34px, 5vw, 52px);
    line-height: 1.1; letter-spacing: -.015em; margin: 0 0 20px; text-wrap: balance;
  }
  .standfirst { font-size: 19px; color: var(--muted); margin: 0 0 28px; max-width: 62ch; }

  .facts { display: flex; flex-wrap: wrap; gap: 10px; padding: 0; margin: 0; list-style: none; }
  .facts li {
    font-family: var(--mono); font-size: 12.5px; letter-spacing: .02em;
    border: 1px solid var(--rule); border-radius: 999px; padding: 5px 12px;
    color: var(--muted); background: var(--panel);
  }
  .facts b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }

  /* ---- how to read ---- */
  .howto { padding: 40px 0; border-bottom: 1px solid var(--rule); }
  h2 {
    font-family: var(--display); font-weight: 400; font-size: clamp(25px, 3.2vw, 33px);
    line-height: 1.2; letter-spacing: -.01em; margin: 0 0 14px; text-wrap: balance;
  }
  h3 {
    font-family: var(--body); font-weight: 650; font-size: 15px; letter-spacing: .01em;
    margin: 0 0 6px;
  }
  p { margin: 0 0 16px; }
  .lead { color: var(--muted); max-width: 64ch; }

  .rule-split { display: grid; gap: 20px; margin-top: 24px; }
  @media (min-width: 720px) { .rule-split { grid-template-columns: 1fr 1fr; gap: 28px; } }
  .rule-card {
    background: var(--panel); border: 1px solid var(--rule); border-radius: 10px;
    padding: 18px 20px;
  }
  .rule-card p { margin: 0; color: var(--muted); font-size: 15.5px; }
  .rule-card .tag {
    font-family: var(--mono); font-size: 11.5px; letter-spacing: .1em;
    text-transform: uppercase; display: block; margin-bottom: 8px;
  }
  .rule-now .tag { color: var(--done); }
  .rule-later .tag { color: var(--ask); }

  /* ---- stages ---- */
  .stage { padding: 56px 0; border-bottom: 1px solid var(--rule); }
  .strip {
    display: flex; gap: 20px; overflow-x: auto; padding: 26px 4px 10px;
    scroll-snap-type: x proximity;
  }
  .shot { margin: 0; flex: 0 0 auto; scroll-snap-align: start; }
  .shot img {
    display: block; width: 268px; height: auto; border-radius: 14px;
    border: 1px solid var(--rule); box-shadow: var(--shadow); background: #fff;
  }
  .shot figcaption {
    font-family: var(--mono); font-size: 12px; color: var(--muted);
    margin-top: 10px; letter-spacing: .02em;
  }

  /* ---- questions ---- */
  .ask {
    margin-top: 26px; max-width: 64ch;
    border-left: 3px solid var(--rule); padding: 2px 0 2px 20px;
  }
  .ask-high { border-left-color: var(--ask); background: var(--ask-tint);
    padding: 18px 20px; border-radius: 0 10px 10px 0; }
  .ask-n {
    font-family: var(--mono); font-size: 11.5px; letter-spacing: .1em;
    text-transform: uppercase; color: var(--ask); margin: 0 0 8px;
  }
  .ask-q { font-size: 18px; margin: 0 0 10px; }
  .ask-why { color: var(--muted); font-size: 15.5px; margin: 0; }

  /* ---- fixed list ---- */
  .fixed { padding: 56px 0; border-bottom: 1px solid var(--rule); }
  .fixed ol { margin: 24px 0 0; padding: 0; list-style: none; display: grid; gap: 2px; }
  .fixed li {
    display: grid; gap: 4px; padding: 14px 0; border-top: 1px solid var(--rule);
  }
  .fixed li p { margin: 0; color: var(--muted); font-size: 15.5px; }

  /* ---- closing ---- */
  .closing { padding: 56px 0 0; }
  .open { display: grid; gap: 14px; margin: 24px 0 0; padding: 0; list-style: none; }
  .open li {
    background: var(--panel); border: 1px solid var(--rule); border-radius: 10px;
    padding: 16px 18px;
  }
  .open .n {
    font-family: var(--mono); font-size: 11.5px; letter-spacing: .1em;
    text-transform: uppercase; color: var(--ask); display: block; margin-bottom: 6px;
  }
  .open p { margin: 0; font-size: 16px; }

  a { color: inherit; text-underline-offset: 3px; }
  :focus-visible { outline: 2px solid var(--ask); outline-offset: 3px; border-radius: 3px; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">KuBi · Vertical Slice 01 · Clinic Opening</p>
    <h1>What the clinic actually sees</h1>
    <p class="standfirst">
      Nineteen screens, captured from the running system against synthetic data —
      not mockups. This is for your usability review: look at what a person meets,
      and answer the six questions marked along the way.
    </p>
    <ul class="facts">
      <li><b>19</b> screens</li>
      <li><b>7</b> taps to open the clinic</li>
      <li><b>24</b> taps, whole journey, 3 people</li>
      <li><b>86</b> tests passing</li>
      <li><b>6</b> questions for you</li>
    </ul>
  </header>

  <section class="howto col">
    <h2>How to give feedback</h2>
    <p class="lead">
      VS-01 is frozen except for defect fixes, so it helps to know which bucket a
      comment lands in. The test is one question: does the change alter what a
      person can <em>accomplish</em>, or only how easily?
    </p>
    <div class="rule-split">
      <div class="rule-card rule-now">
        <span class="tag">Fixed now</span>
        <p>
          Wording, layout, ordering, emphasis, what is shown first. “Finish should
          be higher up.” “Call it Something’s wrong.” These change how easily, and
          they are done inside the frozen API.
        </p>
      </div>
      <div class="rule-card rule-later">
        <span class="tag">Carried forward</span>
        <p>
          New screens, new fields, new abilities. “Let me add a photo.” “Show me
          yesterday.” “Let me reassign this.” These change what someone can
          accomplish, so they belong to the next capability, not this one.
        </p>
      </div>
    </div>
    <p class="lead" style="margin-top:24px">
      Say it however is easiest — screen name and what bothered you is plenty.
      Anything ambiguous comes back to you rather than being decided quietly.
    </p>
  </section>

${STAGES.map(stageHtml).join('\n')}

  <section class="fixed col">
    <h2>Already fixed during this review</h2>
    <p class="lead">
      Found while capturing these screens. Listed so you know they were caught
      rather than missed — the first one is the one that mattered.
    </p>
    <ol>
${FIXED.map(([t, d]) => `      <li><h3>${t}</h3><p>${d}</p></li>`).join('\n')}
    </ol>
  </section>

  <section class="closing col">
    <h2>Still open</h2>
    <p class="lead">
      Neither is discharged by acceptance, and both are carried deliberately.
    </p>
    <ul class="open">
      <li>
        <span class="n">Blocked, not skipped</span>
        <p>
          The PostgreSQL 17 tenancy-isolation gate has not been run. This machine
          has PostgreSQL 16.13 and the network policy blocks obtaining 17, so all
          isolation evidence is from 16.13. It must be run before production.
        </p>
      </li>
      <li>
        <span class="n">Next capability</span>
        <p>
          Appointment integration — a hard requirement you set — is not in this
          slice. It is expansion, and belongs to the cycle after this review.
        </p>
      </li>
    </ul>
  </section>
</div>
`;

writeFileSync(OUT, html);
console.log(`${OUT} — ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB`);
