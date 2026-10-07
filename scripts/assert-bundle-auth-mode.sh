#!/bin/sh
# Usage: assert-bundle-auth-mode.sh <assets-dir> <oidc|legacy>
# Fails unless the built bundle's sign-in mode is the one named. A build with VITE_AUTH_MODE=oidc
# inlines `VITE_AUTH_MODE:`oidc`` in the env object of the auth chunk; a build without it has no
# such entry (src/config/features.ts then leaves OIDC_AUTH_ENABLED false: the legacy /login redirect).
# Exit 0 = the bundle is the named mode, 1 = it is not, 2 = bad arguments or nothing to check.
set -eu
dir="${1:-}"
mode="${2:-}"
case "$mode" in oidc | legacy) ;; *) echo "usage: $0 <assets-dir> <oidc|legacy>" >&2; exit 2 ;; esac
if [ ! -d "$dir" ] || ! ls "$dir"/*.js >/dev/null 2>&1; then
  echo "no JavaScript chunks in '$dir'" >&2
  exit 2
fi
if grep -qF 'VITE_AUTH_MODE:`oidc`' "$dir"/*.js; then found=oidc; else found=legacy; fi
if [ "$found" != "$mode" ]; then
  echo "the bundle in '$dir' is not the $mode build (it is the $found build)" >&2
  exit 1
fi
echo "bundle in '$dir' is the $mode build"
