/**
 * Package the demo build as an Artifact page.
 *
 *   cd apps/web && npx vite build --config vite.demo.config.ts
 *   node scripts/build-artifact.mjs
 *
 * Same bundle as scripts/build-try-it.mjs, different wrapper. That file writes
 * a complete HTML document for a download; this writes only the *contents* of
 * a body, because the Artifact host supplies the document around it. Emitting
 * a second <!doctype> inside one would produce a page that renders in a
 * browser and not in the host, which is the kind of difference that is
 * invisible until somebody opens the link.
 *
 * Deliberately no styling of its own. KuBi has a design system — ui.tsx and
 * styles.css — and the whole point of the link is to show the owner *the
 * product*. A wrapper with its own palette would be showing them a wrapper.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const DIST = 'apps/web/dist-demo';
const OUT = 'docs/kubi-app-artifact.html';

const assets = readdirSync(`${DIST}/assets`);
const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));
if (!js || !css) throw new Error('Expected one .js and one .css in dist-demo/assets — run the vite build first');

const script = readFileSync(`${DIST}/assets/${js}`, 'utf8');
const style = readFileSync(`${DIST}/assets/${css}`, 'utf8');

// A closing tag inside a string literal would end the <script> element early.
const safe = script.replaceAll('</script>', '<\\/script>');

const page = `<title>KuBi — a clinic operating system</title>
<style>
/* KuBi's own stylesheet, unmodified. */
${style}

/* The host page supplies a light/dark ground of its own. KuBi commits to one
   visual world — a clinic screen read at arm's length in a bright room — so it
   sets its own ground rather than inheriting a theme it was not designed in.
   A deliberate single-theme choice, not an omission. */
#root { min-height: 100vh; background: var(--bg, #fff); }
</style>

<div id="root"></div>

<script type="module">
${safe}
</script>
`;

writeFileSync(OUT, page);
console.log(`${OUT} — ${Math.round(page.length / 1024)} kB`);
