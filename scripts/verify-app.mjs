/**
 * Open the built app in a real browser and look for the defects that only
 * appear at a real width.
 *
 * Every failure this catches has actually happened during VS-01–VS-03: a visit
 * card that collapsed on a phone, a heading truncated to one letter, a control
 * too small to hit with a thumb, a page that scrolled sideways. A screenshot
 * pass alone does not catch them, because a screenshot has to be looked at;
 * these are assertions, so a regression fails the run.
 *
 *   node scripts/verify-app.mjs [--shots <dir>]
 *
 * Requires the one-file build to exist: pnpm --filter @kubi/web build:demo &&
 * node scripts/build-try-it.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'docs/kubi-try-it.html');

const shotArg = process.argv.indexOf('--shots');
const SHOTS = shotArg > -1 ? process.argv[shotArg + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

if (!existsSync(FILE)) {
  console.error(`Missing ${FILE}. Build it first.`);
  process.exit(1);
}

/** A phone in a pocket, a tablet on reception, a laptop in the office. */
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'laptop', width: 1440, height: 900 },
];

/** Chromium is pre-installed in this environment; do not download another. */
const EXECUTABLE = '/opt/pw-browsers/chromium';

const browser = await chromium.launch(
  existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {},
);
const problems = [];
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

for (const s of SIZES) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  page.on('pageerror', (e) => problems.push(`${s.name}: page error — ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${s.name}: console error — ${m.text()}`);
  });

  const sideways = async (where) => {
    const px = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    // A page that scrolls sideways is the single most common phone defect, and
    // the one a person notices first.
    if (px > 1) problems.push(`${s.name}: ${where} scrolls sideways by ${px}px`);
  };

  await page.goto(pathToFileURL(FILE).href);

  // The app opens on the front door: clinic status and one button. No role
  // picking -- a cockpit does not ask whether you are the captain.
  await page.waitForSelector('.gate');
  await sideways('the front door');
  const enterBox = await page.$eval('.gate-enter', (e) => e.getBoundingClientRect().height);
  if (enterBox < 44) problems.push(`${s.name}: the enter button is ${enterBox}px tall`);
  // The front door must answer its one question before anything else.
  const gateAsks = await page.$eval('.gate', (el) => el.textContent ?? '');
  if (/choose your role|select role/i.test(gateAsks)) {
    problems.push(`${s.name}: the front door still asks who you are`);
  }

  await page.click('.gate-enter');
  await page.waitForSelector('.demo-bar');
  await page.waitForTimeout(400);
  // Then become the assistant, which is where every check below starts.
  await page.click('.who-button');
  await page.waitForTimeout(250);
  // Roles, not names — the menu switches between roles now, because names
  // change and roles do not.
  await page.click('.who-option:has-text("Dental assistant")');
  await page.waitForSelector('.demo-bar');
  await page.waitForTimeout(700);

  // Nothing may spill out of the top bar. A bar that clips its own contents
  // does not scroll sideways, so the page-width check below cannot see it —
  // the person menu once burst out of it at 390px and looked broken.
  const spill = await page.$$eval('.demo-bar > *', (els) => {
    const bar = els[0].parentElement.getBoundingClientRect();
    return els
      .map((e) => ({ what: (e.className || e.tagName).toString(), box: e.getBoundingClientRect() }))
      .filter((x) => x.box.height > 0
        && (x.box.top < bar.top - 1 || x.box.bottom > bar.bottom + 1 || x.box.right > bar.right + 1))
      .map((x) => x.what);
  });
  for (const w of spill) problems.push(`${s.name}: "${w}" spills out of the top bar`);

  await sideways('Today');
  await shot(page, `${s.name}-01-today`);

  // Switch to the manager, who is the only person who may see the clinic as a
  // whole — an assistant getting an Overview tab would be a permission defect.
  await page.click('.who-button');
  await page.waitForTimeout(250);
  await shot(page, `${s.name}-02-people`);
  await page.click('.who-option:has-text("Clinic manager")');
  await page.waitForTimeout(900);

  // The rail replaced the tab row. The three named places are always there;
  // everything role-specific — including the manager's command centre — is
  // reached through More, so that is where the clinic-wide check now looks.
  const rail = await page.$$eval('.rail-item', (els) => els.map((e) => e.textContent?.trim() ?? ''));
  for (const want of ['Dashboard', 'Clinic readiness', 'Patient events', 'Mandatory', 'Equipment', 'Clinic closing']) {
    if (!rail.some((t) => t.includes(want))) {
      problems.push(`${s.name}: the rail has no "${want}" (rail: ${rail.join(', ')})`);
    }
  }

  await page.click('.rail-item:has-text("More")');
  await page.waitForTimeout(400);
  const more = await page.$$eval('.dash-row-title', (els) => els.map((e) => e.textContent?.trim() ?? ''));
  // The manager's clinic-wide view is the command centre now, not "Overview".
  // What is being checked has not changed: an assistant must not get it.
  if (!more.some((t) => t.includes('Command'))) {
    problems.push(`${s.name}: the manager has no clinic-wide view (More: ${more.join(', ')})`);
  } else {
    await page.click('.more-row:has(.dash-row-title:text-is("Command"))');
    await page.waitForTimeout(400);
    await sideways('the command centre');
    await shot(page, `${s.name}-03-command`);

    // The command centre answers six questions and shows nothing else. These
    // check the constraints the owner set, not the styling:
    //
    //   the readiness verdict is present and is the largest thing on it;
    //   at most five attention cards, because a sixth makes it a list;
    //   no sparkline, bar chart or trend line anywhere.
    const verdict = await page.$('.cc-verdict');
    if (!verdict) problems.push(`${s.name}: the command centre has no readiness verdict`);

    const cards = await page.$$eval('.cc-card', (e) => e.length);
    if (cards > 5) problems.push(`${s.name}: ${cards} attention cards, more than the five allowed`);

    const charts = await page.$$eval('.spark, .bars, .bar-slot, .chart', (e) => e.length);
    if (charts > 0) {
      problems.push(`${s.name}: ${charts} chart elements on the command centre — it should have none`);
    }

    // Every light is a light, never a percentage.
    const lights = await page.$$eval('.lt', (e) => e.length);
    if (lights < 6) problems.push(`${s.name}: expected at least 6 status lights, found ${lights}`);
  }

  // The two named places on the rail, plus one screen still under More.
  for (const [item, name] of [
    ['Clinic readiness', '04-readiness'], ['Patient events', '05-patient-events'],
    ['Mandatory', '06-mandatory'], ['Equipment', '07-equipment'],
    ['Clinic closing', '08-closing'],
  ]) {
    await page.click(`.rail-item:has-text("${item}")`);
    await page.waitForTimeout(500);
    await sideways(item);
    await shot(page, `${s.name}-${name}`);
  }
  await page.click('.rail-item:has-text("More")');
  await page.waitForTimeout(300);
  await page.click('.more-row:has(.dash-row-title:text-is("Attention"))');
  await page.waitForTimeout(400);
  await sideways('Attention');
  await shot(page, `${s.name}-06-attention`);

  // The end of the day: the handover only exists once the clinic is closing,
  // so reaching it is the only way to prove the screen renders at all.
  await page.click('.demo-reset:has-text("closing")');
  await page.waitForTimeout(900);
  // The personal task list is labelled "Today" for staff and "My tasks" for
  // roles that have their own command centre. Matched on either, so renaming
  // a tab for one role does not silently stop verifying the handover.
  await page.click('.rail-item:has-text("More")');
  await page.waitForTimeout(300);
  // Matched on the row's TITLE, not on its text: every row also carries the
  // screen's question, and "Is the clinic ready today?" made a loose
  // :has-text("Today") open the command centre instead.
  await page.click(
    '.more-row:has(.dash-row-title:text-is("Today")), '
    + '.more-row:has(.dash-row-title:text-is("My tasks"))',
  );
  await page.waitForTimeout(500);
  // Matched by its title, not by a class. The cue was `.handover-cue` before
  // today.tsx moved onto the shared library and became a `<Row>`; this check
  // had been looking for a class that no longer existed.
  const cue = await page.$('.row:has(.row-title:text-is("Read the handover"))');
  if (!cue) {
    problems.push(`${s.name}: no handover appears on Today once the clinic is closing`);
  } else {
    await cue.click();
    await page.waitForTimeout(700);
    await sideways('Handover');
    await shot(page, `${s.name}-07-handover`);
    const sections = await page.$$eval('.hand-section', (e) => e.length);
    // The demo's day deliberately ends untidy — a handover with nothing on it
    // would mean the screen was never actually exercised.
    if (sections === 0) problems.push(`${s.name}: the handover rendered with no sections`);
    const named = await page.$$eval('.hand-line-title', (e) => e.map((x) => x.textContent ?? ''));
    // Q6: no reporter or completer names on operational screens, ever.
    for (const t of named) {
      if (/SYNTHETIC/.test(t)) problems.push(`${s.name}: handover names a person — "${t}"`);
    }
  }

  // A severity pill with no background is a pill whose class matched no rule —
  // which once made PATIENT_SAFETY, the most serious level in the system,
  // render as plain text. Silent, and exactly backwards.
  const flat = await page.$$eval('.pill', (els) =>
    els.filter((e) => {
      const bg = getComputedStyle(e).backgroundColor;
      return bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
    }).map((e) => `${e.textContent?.trim()} (${e.className})`));
  for (const p of flat) problems.push(`${s.name}: severity pill has no styling — ${p}`);

  // Anything you tap must be big enough to tap. 36px is the floor; the design
  // target is 44px, and --tap enforces it on the primary controls.
  const small = await page.$$eval('button, a[href], input, select', (els) =>
    els.filter((e) => e.offsetParent !== null)
      .map((e) => ({
        what: (e.textContent || e.getAttribute('aria-label') || e.className || e.tagName).trim().slice(0, 44),
        height: Math.round(e.getBoundingClientRect().height),
      }))
      .filter((x) => x.height > 0 && x.height < 36));
  for (const x of small) problems.push(`${s.name}: "${x.what}" is only ${x.height}px tall`);

  await page.close();
}

await browser.close();

if (problems.length === 0) {
  console.log(`Checked ${SIZES.map((s) => `${s.width}px`).join(', ')} — no problems found.`);
} else {
  console.log(`${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
