#!/bin/sh
# Usage: assert-bundle-auth.sh <html-root>
# Fails unless the built app signs in through OIDC only (WK-15): some chunk carries the Authentik
# authorize endpoint (src/auth/config.ts), and no chunk of the boot import graph carries the legacy
# sign-in (fc-shared's /auth/login or /auth/refresh). The boot graph starts at the entry script and
# the modulepreloads index.html names, and takes in every chunk a chunk in it imports, statically or
# dynamically: the shell's lazy chunks that load on every start (OidcSession) included. The one
# exception is a dynamic import of a LAZY chunk (Vite names a chunk <module>-<hash>.js): the legacy
# screens Sync, Export and Notifications, which load when the user opens them, and the legacy client
# itself, which push settings load on a tap. A dynamic import is trusted to be lazy only for those.
# Exit 0 = OIDC only, 1 = not (or a chunk the graph imports is missing), 2 = bad arguments.
set -eu
dir="${1:-}"
if [ -z "$dir" ] || [ ! -f "$dir/index.html" ] || ! ls "$dir"/assets/*.js >/dev/null 2>&1; then
  echo "usage: $0 <html-root with index.html and assets/*.js>" >&2
  exit 2
fi
if ! grep -qlF '/application/o/authorize/' "$dir"/assets/*.js; then
  echo "the bundle in '$dir' has no OIDC sign-in" >&2
  exit 1
fi
LAZY='^(Sync|Export|Notifications|client)-[A-Za-z0-9_-]+\.js$'
Q="[\"'\`]"
NAME="s/.*$Q\.\/([^\"'\`]+)$Q.*/\1/"
queue=$(grep -oE '(src|href)="/assets/[^"]+\.js"' "$dir/index.html" | sed -E 's/^(src|href)="\/assets\/(.*)"$/\2/')
seen=' '
set -f
while [ -n "$(echo $queue)" ]; do
  set -- $queue
  js=$1
  shift
  queue="$*"
  case "$seen" in *" $js "*) continue ;; esac
  seen="$seen$js "
  file="$dir/assets/$js"
  if [ ! -f "$file" ]; then
    echo "a chunk the boot graph imports is missing: $file" >&2
    exit 1
  fi
  if grep -qE '/auth/(login|refresh)' "$file"; then
    echo "the legacy sign-in loads at boot: $file" >&2
    exit 1
  fi
  static=$(grep -oE "(from|import)[[:space:]]*$Q\./[^\"'\`]+\.js$Q" "$file" | sed -E "$NAME" || true)
  dynamic=$(grep -oE "import\([[:space:]]*$Q\./[^\"'\`]+\.js$Q" "$file" | sed -E "$NAME" | grep -vE "$LAZY" || true)
  queue="$queue $static $dynamic"
done
echo "the bundle in '$dir' signs in through OIDC only"
