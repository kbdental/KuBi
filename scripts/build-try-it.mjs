/**
 * Bundles the built demo into ONE html file that opens from a download.
 *
 * Vite emits the script and stylesheet as separate assets; this folds them
 * back in, so there is nothing to serve and nothing to fetch.
 *
 * Usage:
 *   cd apps/web && npx vite build --config vite.demo.config.ts
 *   node scripts/build-try-it.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const DIST = 'apps/web/dist-demo';
const OUT = 'docs/kubi-try-it.html';

const assets = readdirSync(`${DIST}/assets`);
const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));
if (!js || !css) throw new Error('Expected one .js and one .css in dist-demo/assets');

const script = readFileSync(`${DIST}/assets/${js}`, 'utf8');
const style = readFileSync(`${DIST}/assets/${css}`, 'utf8');

// Closing tags inside a string literal would end the <script> element early.
const safe = script.replaceAll('</script>', '<\\/script>');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>KuBi — try it</title>
    <style>${style}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${safe}</script>
  </body>
</html>
`;

writeFileSync(OUT, html);
console.log(`${OUT} — ${(Buffer.byteLength(html) / 1024).toFixed(0)} kB`);
