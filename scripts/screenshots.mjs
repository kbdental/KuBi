/**
 * Captures every VS-01 surface and state from the running app, for owner
 * usability review.
 *
 * A demo and review aid, not a test. It drives the real client against the
 * real API with synthetic data, so what the owner reviews is what a person
 * would actually see — not a mockup, and not a description of one.
 *
 * Usage:  DEMO_SUFFIX=ux01 node scripts/screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const API = process.env.API_URL ?? 'http://127.0.0.1:3000';
const OUT = process.env.SHOT_DIR ?? 'docs/screens';
const S = process.env.DEMO_SUFFIX ?? 'ux01';
const PASSWORD = 'SyntheticDemo123!';

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 940 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(WEB, { waitUntil: 'networkidle' });
  await page.waitForSelector('#email');
  return { ctx, page };
}

async function signIn(page, who) {
  await page.fill('#email', `${who}_${S}@synthetic.test`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('.tabs', { timeout: 15_000 });
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
}

const openTask = async (page, title) => {
  await page.getByText(title).first().click();
  await page.waitForSelector('.tick, .notice-warn');
};

/**
 * Completes an activity straight through the API, to set up a state the
 * screenshots need (someone else's finished work waiting to be checked).
 * Deliberately not done through the UI: this is stage-setting, not a capture.
 */
async function completeViaApi(who, title) {
  const jar = [];
  const keep = (res) => {
    const c = res.headers.getSetCookie?.() ?? [];
    for (const s of c) jar.push(s.split(';')[0]);
  };
  const cookie = () => jar.join('; ');

  const login = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${who}_${S}@synthetic.test`, password: PASSWORD }),
  });
  keep(login);

  const day = await (await fetch(`${API}/api/v1/my-day`, { headers: { cookie: cookie() } })).json();
  const all = Object.values(day.buckets).flat();
  const task = all.find((t) => t.title === title);
  if (!task) return;

  const sheet = await (await fetch(`${API}/api/v1/tasks/${task.id}`, { headers: { cookie: cookie() } })).json();
  await fetch(`${API}/api/v1/tasks/${task.id}/start`, { method: 'POST', headers: { cookie: cookie() } });
  await fetch(`${API}/api/v1/tasks/${task.id}/complete`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie() },
    body: JSON.stringify({ responses: sheet.items.map((i) => ({ itemId: i.id, checked: true })) }),
  });
}

// --------------------------------------------------------------------------
console.log('capturing:');

// 01 sign in, and the refusal a person meets when they mistype.
{
  const { ctx, page } = await fresh();
  await shot(page, '01-sign-in');
  await page.fill('#email', `priya_${S}@synthetic.test`);
  await page.fill('#password', 'wrong-on-purpose');
  await page.click('button[type=submit]');
  await page.waitForSelector('.notice-stop');
  await shot(page, '02-sign-in-refused');
  await ctx.close();
}

// 03-08 Priya: the day, a task, finishing it.
{
  const { ctx, page } = await fresh();
  await signIn(page, 'priya');
  await shot(page, '03-today');

  await openTask(page, 'Open the clinic');
  await shot(page, '04-do-this');

  for (const t of await page.locator('.tick').all()) await t.click();
  await shot(page, '05-do-this-ticked');

  await page.getByRole('button', { name: 'Finish' }).click();
  await page.waitForSelector('.empty-big');
  await shot(page, '06-finished');

  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.waitForSelector('.row');
  await shot(page, '07-today-after');
  await ctx.close();
}

// 08-11 the gate, and the two honest ways forward.
{
  const { ctx, page } = await fresh();
  await signIn(page, 'priya');
  await openTask(page, 'Check the emergency kit');
  await shot(page, '08-cant-confirm');

  await page.getByRole('button', { name: 'Report a problem' }).click();
  await page.waitForSelector('.screen-title');
  await shot(page, '09-report-a-problem');

  await page.getByRole('button', { name: 'Not working' }).click();
  await page.getByRole('button', { name: /Oxygen cylinder/ }).click();
  await shot(page, '10-report-a-problem-chosen');

  // Back out, and meet the server's refusal instead. Since usability review
  // Q2 an assistant is not offered the override at all, so the refusal lands
  // on the checklist itself and points at the path she does have.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForSelector('.tick');
  for (const t of await page.locator('.tick').all()) await t.click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.waitForSelector('.notice-stop');
  await shot(page, '11-cannot-finish-not-your-call');
  await ctx.close();
}

// 12 a task on hold after a problem is reported.
{
  const { ctx, page } = await fresh();
  await signIn(page, 'priya');
  await openTask(page, 'Check the emergency kit');
  await page.getByRole('button', { name: 'Report a problem' }).click();
  await page.getByRole('button', { name: 'Not working' }).click();
  await page.getByRole('button', { name: /Oxygen cylinder/ }).click();
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForSelector('.row');
  await shot(page, '12-today-with-problem');
  await ctx.close();
}

// 13-14 Rahul, the manager.
{
  const { ctx, page } = await fresh();
  await signIn(page, 'rahul');
  await page.getByRole('button', { name: /Attention/ }).click();
  await page.waitForSelector('.row, .empty-big');
  await shot(page, '13-attention');

  const first = page.locator('.row').first();
  if (await first.count()) {
    await first.click();
    await page.waitForSelector('textarea');
    await shot(page, '14-attention-resolve');
  }
  await ctx.close();
}

// 15-17 Anita checks someone else's finished work.
await completeViaApi('priya', 'Get treatment rooms ready');
{
  const { ctx, page } = await fresh();
  await signIn(page, 'anita');
  const tab = page.getByRole('button', { name: /Checks/ });
  if (await tab.count()) {
    await tab.click();
    await page.waitForSelector('.row, .empty-big');
    await shot(page, '15-checks');
    const first = page.locator('.row').first();
    if (await first.count()) {
      await first.click();
      // Q5: wait for the recorded items, which is the point of this screen.
      await page.waitForSelector('.recorded');
      await shot(page, '16-check-one');
      await page.getByRole('button', { name: 'Not right' }).click();
      await page.waitForSelector('textarea');
      await shot(page, '17-check-send-back');
    }
  } else {
    console.log('  (Checks tab hidden — nobody’s checker)');
  }
  await ctx.close();
}

// 18-19 Me, and an empty day.
{
  const { ctx, page } = await fresh();
  await signIn(page, 'rahul');
  await page.getByRole('button', { name: 'Me' }).click();
  await page.waitForSelector('.screen-title');
  await shot(page, '18-me');

  await page.getByRole('button', { name: 'Today' }).first().click();
  await page.waitForSelector('.screen-title');
  await shot(page, '19-today-empty');
  await ctx.close();
}

await browser.close();
console.log(`\nwritten to ${OUT}/`);
