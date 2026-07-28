/**
 * Drives the real app in a real browser and captures each VS-01 surface.
 *
 * This is a demo aid, not a test: it proves the screens render against a live
 * API, and gives the owner something to look at without setting anything up.
 * Synthetic data only.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const OUT = process.env.SHOT_DIR ?? 'docs/screens';
const SUFFIX = process.env.DEMO_SUFFIX ?? 'demo02';
const PASSWORD = 'SyntheticDemo123!';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 460, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(WEB, { waitUntil: 'networkidle' });
  return { ctx, page, email };
}

async function signIn(page, email) {
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('.tabs', { timeout: 15_000 });
}

async function shot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${OUT}/${name}.png`);
}

// ---- Priya: sign in, Today, a task sheet -----------------------------------
{
  const { ctx, page } = await session();
  await page.waitForSelector('#email');
  await shot(page, '1-sign-in');

  await signIn(page, `priya_${SUFFIX}@synthetic.test`);
  await shot(page, '2-today');

  await page.getByText('Open the clinic').first().click();
  await page.waitForSelector('.tick');
  await shot(page, '3-do-this');

  // The gate, as a person actually meets it: back to Today, open the one
  // activity whose requirement has no backing module yet.
  await page.getByRole('button', { name: '‹ Today' }).click();
  await page.waitForSelector('.row');
  await page.getByText('Check the emergency kit').first().click();
  await page.waitForSelector('.notice-warn');
  await shot(page, '4-cant-confirm');

  await ctx.close();
}

// ---- Rahul: the manager's view ---------------------------------------------
{
  const { ctx, page } = await session();
  await page.waitForSelector('#email');
  await signIn(page, `rahul_${SUFFIX}@synthetic.test`);
  await page.getByRole('button', { name: /Attention/ }).click();
  await shot(page, '5-attention');
  await ctx.close();
}

// ---- Anita: checking someone else's work -----------------------------------
{
  const { ctx, page } = await session();
  await page.waitForSelector('#email');
  await signIn(page, `anita_${SUFFIX}@synthetic.test`);
  const checks = page.getByRole('button', { name: /Checks/ });
  if (await checks.count()) {
    await checks.click();
    await shot(page, '6-checks');
  } else {
    console.log('  (no checks waiting for Anita — tab correctly hidden)');
  }
  await ctx.close();
}

await browser.close();
