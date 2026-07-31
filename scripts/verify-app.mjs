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
  await page.waitForSelector('.demo-bar');
  await page.waitForTimeout(700);
  await sideways('Today');
  await shot(page, `${s.name}-01-today`);

  // Switch to the manager, who is the only person who may see the clinic as a
  // whole — an assistant getting an Overview tab would be a permission defect.
  await page.click('.who-button');
  await page.waitForTimeout(250);
  await shot(page, `${s.name}-02-people`);
  await page.click('.who-option:has-text("Rahul")');
  await page.waitForTimeout(900);

  const tabs = await page.$$eval('.tab', (els) => els.map((e) => e.textContent?.trim() ?? ''));
  if (!tabs.some((t) => t.includes('Overview'))) {
    problems.push(`${s.name}: the manager has no Overview tab (tabs: ${tabs.join(', ')})`);
  } else {
    await page.click('.tab:has-text("Overview")');
    await page.waitForTimeout(400);
    await sideways('Overview');
    await shot(page, `${s.name}-03-overview`);

    const bars = await page.$$eval('.bar-slot', (e) => e.length);
    if (bars !== 7) problems.push(`${s.name}: the week chart has ${bars} bars, expected 7`);
    // A shut day must draw as absent. Drawn as a zero-height bar it would read
    // as a failed day, which is a lie about the clinic.
    const hollow = await page.$$eval('.bar-none', (e) => e.length);
    if (hollow !== 1) problems.push(`${s.name}: expected 1 no-data slot in the week, found ${hollow}`);
  }

  for (const [tab, name] of [['Clinic', '04-clinic'], ['Attention', '05-attention']]) {
    await page.click(`.tab:has-text("${tab}")`);
    await page.waitForTimeout(400);
    await sideways(tab);
    await shot(page, `${s.name}-${name}`);
  }

  // The end of the day: the handover only exists once the clinic is closing,
  // so reaching it is the only way to prove the screen renders at all.
  await page.click('.demo-reset:has-text("closing")');
  await page.waitForTimeout(900);
  await page.click('.tab:has-text("Today")');
  await page.waitForTimeout(500);
  const cue = await page.$('.handover-cue');
  if (!cue) {
    problems.push(`${s.name}: no handover appears on Today once the clinic is closing`);
  } else {
    await cue.click();
    await page.waitForTimeout(700);
    await sideways('Handover');
    await shot(page, `${s.name}-06-handover`);
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
