# ADR-015: React + Vite for the web client, with no rules in it

Status: Accepted (VS-01)

## Context

Phase 0 through Phase 2 fixed the server architecture but never chose a
frontend stack — no ADR, and `apps/web/` sat empty. VS-01 needs five surfaces
(sign in, Today, Do this, Attention, Checks) on a clinic tablet, and the owner
gate is a demo: something a person can be handed.

## Decision

React 19 with Vite, TypeScript, plain CSS. No router, no state library, no
component framework, no CSS framework.

The omissions are the decision. Five screens do not need a router; a URL scheme
would be a promise about navigation we have not designed. Server state is
fetched and re-fetched on change, so there is no client state worth a library.
Hand-written CSS is ~200 lines and encodes the one thing that actually matters
here — fingertip-sized targets, real contrast, one obvious action per screen.

**The client holds no rules.** It does not decide whether a task may be
finished, whether a gate blocks, who may verify, or what anyone may see. It
asks and renders, including refusals.

## Consequences

Good: small dependency surface; a 65 kB gzipped bundle; nothing to relearn;
every rule stays in one testable place.

Costs, accepted: no deep-linking, and no server-side rendering. Neither matters
for a tablet app used by signed-in staff on a clinic network. Adding a router
later is mechanical.

## The part that is not negotiable

A rule implemented in a browser is a rule anyone can skip with `curl`. So where
a screen appears to enforce something, the server must enforce it too, and the
server's version is the one that counts.

This was not hypothetical. `evaluateGate` was written during VS-01 and its
result rendered as `cantConfirm`, but `completeTask` never called it — the
block existed only on screen, and a direct POST finished a task whose gate said
the clinic was not ready. Under AP-1 a `NOT_CONFIGURED` requirement must never
read as PASS, and it was reading as PASS to anyone not using the UI.

The fix was to enforce it server-side and let the screen carry the refusal.
Hence the rule for every surface built from here: if a screen greys out a
button, name the server-side check that makes it real. If there isn't one, the
control does not exist yet.
