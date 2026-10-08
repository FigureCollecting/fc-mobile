#!/bin/sh
# Usage: assert-bundle-auth.sh <html-root>
# Fails unless the built app signs in through OIDC only (WK-15): some chunk carries the Authentik
# authorize endpoint (src/auth/config.ts), and no file loaded at boot (the entry script and the
# modulepreloads index.html names) carries the legacy sign-in (fc-shared's /auth/login or
# /auth/refresh). The legacy client may remain as a lazy chunk the legacy screens load.
# Exit 0 = OIDC only, 1 = not, 2 = bad arguments or nothing to check.
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
for js in $(grep -oE '(src|href)="/assets/[^"]+\.js"' "$dir/index.html" | sed -E 's/^(src|href)="\/(.*)"$/\2/'); do
  if grep -qE '/auth/(login|refresh)' "$dir/$js"; then
    echo "the legacy sign-in loads at boot: $dir/$js" >&2
    exit 1
  fi
done
echo "the bundle in '$dir' signs in through OIDC only"
