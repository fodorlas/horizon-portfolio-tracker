#!/usr/bin/env bash
# Export settings for the local Supabase instance started from this repository.
# These fixed local development keys must never be used with a hosted project.
set -euo pipefail

status="$(supabase status -o env)"
value() { printf '%s\n' "$status" | sed -nE "s/^$1=\"?([^\"]*)\"?\$/\1/p"; }

for pair in \
  NEXT_PUBLIC_SUPABASE_URL:API_URL \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:PUBLISHABLE_KEY \
  SUPABASE_TEST_SECRET_KEY:SECRET_KEY \
  SUPABASE_TEST_DB_URL:DB_URL; do
  v="$(value "${pair#*:}")"
  if [ -z "$v" ]; then
    echo "supabase status has no ${pair#*:}" >&2
    exit 1
  fi
  echo "${pair%%:*}=$v"
done
