#!/bin/sh
# R-1(b) holding mode, chosen at container start by the HOLDING env var (fc-infra edge/fc-mobile-web.yaml).
#   HOLDING=0 (default)  serve the app
#   HOLDING=1            serve /holding.html for every navigation except under /api and /api/*
# The choice is written to /tmp (the only writable path, an emptyDir in the cluster) as one server-level
# rewrite that default.conf includes. Anything other than 0 or 1 stops the container: a typo must not
# silently serve the app where the holding page was meant, or the other way round.
# FC_MODE_DIR exists for the unit test only; default.conf always reads /tmp/fc-mode.
set -eu
dir="${FC_MODE_DIR:-/tmp/fc-mode}"
mkdir -p "$dir"
rm -f "$dir/holding.conf"
case "${HOLDING:-0}" in
  0) echo "$0: HOLDING=0, serving the app" ;;
  # Navigations and the bare origin get the page; any other request falls through to the app's own
  # rules, so an API-style fetch of an unknown path is still a 404, never HTML, and /api is never
  # touched. $fc_navigation is default.conf's map.
  1) printf '%s\n' 'if ($fc_navigation) { rewrite "^/(?!api(?:/|$))" /holding.html last; }' \
            'rewrite "^/$" /holding.html last;' > "$dir/holding.conf"
     echo "$0: HOLDING=1, serving the holding page" ;;
  *) echo "$0: HOLDING must be 0 or 1, got '${HOLDING}'" >&2; exit 1 ;;
esac
