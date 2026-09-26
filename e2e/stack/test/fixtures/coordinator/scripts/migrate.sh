#!/bin/sh
# Stand-in for fc-coordinator scripts/migrate.sh: same interface (dir argument,
# libpq env, "applied=N" on success), none of its guards.
set -eu
n=0
for f in "$1"/*.sql; do
  psql -1 -v ON_ERROR_STOP=1 -q -f "$f"
  n=$((n + 1))
done
echo "migrate: applied=$n skipped=0"
