#!/usr/bin/env bash
# Empty the TEST database before an integration run, then reload global
# reference data.
#
# Every integration run seeds a fresh synthetic organisation, and nothing used
# to remove the previous one. After enough runs kubi_test held 603
# organisations and 644 clinics, at which point the daily-run test -- which
# legitimately iterates EVERY active clinic -- began timing out. Raising that
# timeout would have hidden a number that grows without bound.
#
# TRUNCATE rather than DELETE, and as the schema owner rather than kubi_app:
# the runtime role is deliberately denied both, and the "no delete" rule in the
# working agreement governs application code, not resetting a scratch database
# between runs. The database name is checked rather than taken on trust,
# because the cost of pointing this at the wrong one is total.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck disable=SC1091
if [[ -f .env ]]; then set -a; source .env; set +a; fi

DB_URL="${TEST_DATABASE_URL:?TEST_DATABASE_URL must be set}"
DB="${DB_URL##*/}"
DB="${DB%%\?*}"

if [[ "$DB" != *test* ]]; then
  echo "Refusing to truncate '$DB' — this script only ever touches a test database." >&2
  exit 1
fi

# _prisma_migrations is deliberately excluded: the schema stays migrated.
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<'SQL'
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('TRUNCATE TABLE %I CASCADE', t);
  END LOOP;
END $$;
SQL

# `permissions` is NOT tenant data — it is global reference data managed like a
# migration, and kubi_app holds SELECT-only on it. Truncating it and walking
# away leaves every role seed failing with "references unknown permission".
#
# Reloaded rather than preserved on purpose: reloading exercises the catalogue
# seeder on every integration run, where preserving would let it rot unnoticed
# until some future deploy discovered it.
DATABASE_URL="$DB_URL" ./node_modules/.bin/tsx prisma/seed/seed-permission-catalogue.ts

echo "$DB: reset"
