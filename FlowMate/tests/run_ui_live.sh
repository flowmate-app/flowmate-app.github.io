#!/usr/bin/env bash
# Scripted UI test against the unbundled app, in real time (tests that use browser storage).
# Usage: bash tests/run_ui_live.sh ui_library.js
HERE="$(cd "$(dirname "$0")" && pwd)"
sed "s#<!--SELFTEST-->#<script src=\"${1:-ui_library.js}\"></script>#" "$HERE/app_dev.html" > "$HERE/ui.html"
node "$HERE/../../shared/run_live.mjs" "$(cygpath -w "$HERE/ui.html" 2>/dev/null || echo "$HERE/ui.html")" 240
