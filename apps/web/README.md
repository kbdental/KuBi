# KuBi — web

The five VS-01 surfaces: sign in, Today, Do this, Attention, Checks.

## Running it

```bash
docker compose up -d          # postgres
pnpm prisma migrate deploy    # schema + RLS policies
pnpm dev:api                  # http://127.0.0.1:3000
pnpm dev:web                  # http://127.0.0.1:5173
```

The web dev server proxies `/api` to the API. That matters: the session cookie
is `httpOnly` and `SameSite=strict`, so the browser has to see both on one
origin. Proxying keeps that true in development without loosening the cookie.

## What this app does not do

It holds no rules. It does not decide whether a task can be finished, whether a
gate blocks, who may verify someone else's work, or what a person is allowed to
see. Every one of those is the server's, and the screens render the answer they
are given — including the refusals.

That is not a style preference. A rule implemented in a browser is a rule
anyone can skip with `curl`, so the only place a rule can honestly live is
behind the API. Where a screen appears to enforce something (a disabled
button), the server enforces it too, and the server's version is the one that
counts. `tests/integration/vs01-journey.test.ts` proves that by calling the API
directly, with no UI involved.

## Language

Staff never see the engine's vocabulary — no "activity", "instance",
"exception", "gate", "escalation", and never a raw evaluation result like
`NOT_CONFIGURED`. When a requirement cannot be confirmed, the screen says
_"We can't confirm the emergency kit list yet"_.

`tests/ui/language-and-behaviour.test.tsx` renders each screen and reads the
visible text back to enforce this, so jargon written into a component is caught
the same way jargon in an API response is.

## Screens

`docs/screens/` holds captures of each surface, taken from the running app
against synthetic data by `scripts/screenshots.mjs`.
