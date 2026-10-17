#!/usr/bin/env bash
set -euo pipefail
exercise_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_dir="$exercise_dir/../app"
compose() { docker compose --project-directory "$app_dir" "$@"; }
cleanup() {
  local status=$?
  trap - EXIT
  if ! compose --profile e2e down; then
    echo 'E2E cleanup failed' >&2
    if [ "$status" -eq 0 ]; then status=1; fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Always start with a fresh tmpfs database. Health checks replace guessed sleeps.
compose --profile e2e down
compose up -d --force-recreate --wait db-e2e
(cd "$app_dir" && npm run db:migrate:e2e-exercise)
compose up -d --build --force-recreate --wait app
(cd "$exercise_dir" && npm test -- "$@")
