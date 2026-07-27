#!/usr/bin/env bash
# KuBi — Phase 1 Step 13: backup and RESTORE drill.
#
# Phase 0 §19: "An untested backup is a belief, not a control." This script
# takes a dump, restores it into a scratch database, and verifies BOTH the row
# counts AND that the RLS policies survived the round trip — a restore that
# silently loses row-level security would be worse than no restore at all.
set -euo pipefail

DUMP_DIR="${DUMP_DIR:-/var/lib/postgresql/kubi-drill}"
SRC_DB="${SRC_DB:-kubi_dev}"
RESTORE_DB="${RESTORE_DB:-kubi_restore_drill}"
mkdir -p "$DUMP_DIR"
chown postgres:postgres "$DUMP_DIR" 2>/dev/null || true
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="$DUMP_DIR/${SRC_DB}_${STAMP}.dump"

echo "== 1. baseline =="
BASE=$(su postgres -c "psql -d $SRC_DB -tAc \"
  SELECT (SELECT count(*) FROM organizations)||'/'||
         (SELECT count(*) FROM clinics)||'/'||
         (SELECT count(*) FROM patients);\"")
BASE_POL=$(su postgres -c "psql -d $SRC_DB -tAc \"SELECT count(*) FROM pg_policies WHERE schemaname='public';\"")
echo "   source org/clinic/patient = $BASE ; policies = $BASE_POL"

echo "== 2. dump =="
su postgres -c "pg_dump -Fc -d $SRC_DB -f $DUMP"
chmod 644 "$DUMP" 2>/dev/null || true
echo "   wrote $(du -h "$DUMP" | cut -f1) -> $DUMP"

echo "== 3. restore into scratch db =="
su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS $RESTORE_DB;'"
su postgres -c "psql -q -c 'CREATE DATABASE $RESTORE_DB OWNER kubi_migrator;'"
RESTORE_START=$(date -u +%s)
su postgres -c "pg_restore -d $RESTORE_DB --no-owner --role=kubi_migrator $DUMP" 2>&1 | tail -3 || true
RESTORE_SECS=$(( $(date -u +%s) - RESTORE_START ))
echo "   restore completed in ${RESTORE_SECS}s"

echo "== 4. verify data =="
REST=$(su postgres -c "psql -d $RESTORE_DB -tAc \"
  SELECT (SELECT count(*) FROM organizations)||'/'||
         (SELECT count(*) FROM clinics)||'/'||
         (SELECT count(*) FROM patients);\"")
echo "   restored org/clinic/patient = $REST"

echo "== 5. verify RLS survived =="
REST_POL=$(su postgres -c "psql -d $RESTORE_DB -tAc \"SELECT count(*) FROM pg_policies WHERE schemaname='public';\"")
REST_FORCE=$(su postgres -c "psql -d $RESTORE_DB -tAc \"
  SELECT count(*) FROM pg_class WHERE relname IN ('organizations','clinics','patients')
    AND relrowsecurity AND relforcerowsecurity;\"")
echo "   restored policies = $REST_POL ; tables with FORCE RLS = $REST_FORCE"

echo "== 6. verify fail-closed still holds after restore =="
UNSCOPED=$(su postgres -c "psql -d $RESTORE_DB -tAc \"
  SET ROLE kubi_app; SELECT count(*) FROM patients;\"" 2>/dev/null | tail -1 || echo "ERR")
echo "   unscoped read as kubi_app = $UNSCOPED (expected 0)"

echo
if [ "$BASE" = "$REST" ] && [ "$BASE_POL" = "$REST_POL" ] && [ "$REST_FORCE" = "3" ] && [ "$UNSCOPED" = "0" ]; then
  echo "DRILL RESULT: PASS  (data identical, $REST_POL policies intact, FORCE RLS on 3 tables, fail-closed holds)"
  su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS $RESTORE_DB;'"
  exit 0
else
  echo "DRILL RESULT: FAIL"
  echo "  data      $BASE -> $REST"
  echo "  policies  $BASE_POL -> $REST_POL"
  echo "  forceRLS  expected 3, got $REST_FORCE"
  echo "  unscoped  expected 0, got $UNSCOPED"
  exit 1
fi
