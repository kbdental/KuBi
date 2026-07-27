# KuBi

Clinic operating system. Modular monolith, TypeScript end to end.

**Phase 1 (repository initialization) complete. Phase 2 not started.**

## Quick start

```bash
pnpm install
docker compose up -d            # see docs/operations/phase-1-deviations.md
cp .env.example .env
pnpm exec prisma migrate deploy
pnpm exec prisma generate
pnpm test                       # unit + generated suites
pnpm test:integration           # RLS regression suite (needs a database)
pnpm exec tsx scripts/rls-spike.ts   # the Phase 1 Step 6 architecture gate
./scripts/backup-restore-drill.sh    # restore drill
```

## Documents

- `CLAUDE.md` — non-negotiables and architectural constraints
- `docs/adr/` — architecture decision records
- `docs/domain/reserved-contexts.md` — what is out of MVP but in the architecture
- `docs/operations/phase-1-deviations.md` — deviations from the approved plan
