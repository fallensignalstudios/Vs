#!/usr/bin/env bash
# Typecheck the whole project but print only errors under the given path prefixes (your own files).
#   tools/tc.sh src/vfx sandbox/vfx
# With no arguments prints everything. Exit code 1 if any matching error.
cd "$(dirname "$0")/.."
out=$(npx tsc --noEmit 2>&1)
if [ $# -eq 0 ]; then echo "$out"; [ -z "$out" ] && echo "typecheck clean"; [ -z "$out" ]; exit $?; fi
pat=$(printf '%s|' "$@"); pat="^(${pat%|})"
mine=$(echo "$out" | grep -E "$pat" -A2 || true)
total=$(echo "$out" | grep -c "error TS" || true)
if [ -n "$mine" ]; then echo "$mine"; echo "--- errors in your paths above (project total: $total)"; exit 1; fi
echo "typecheck clean for: $* (project total errors elsewhere: $total)"
