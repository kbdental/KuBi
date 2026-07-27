#!/usr/bin/env bash
# Apply migrations to the TEST database. Kept separate from dev so the
# integration suite never runs against developer data (owner control 12).
set -euo pipefail
export DATABASE_URL="${TEST_DATABASE_URL:?TEST_DATABASE_URL must be set}"
exec ./node_modules/.bin/prisma migrate deploy
