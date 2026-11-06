#!/usr/bin/env bash
# Build FlowMate and run every suite; one summary line per suite. Usage: bash tests/run_all.sh
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE" || exit 1
python build.py > /dev/null || { echo "BUILD FAILED"; exit 1; }
status=0
line() { printf '%-28s %s\n' "$1" "$2"; }
r=$(bash tests/run_tests.sh 2>&1 | tail -1); line "engine + interop" "$r"; [[ "$r" == *"fail=0"* ]] || status=1
for t in ui_selftest.js ui_unmix.js ui_worksheet.js ui_scroll.js ui_resize.js qa_selftest.js qa_layout.js qa_pub.js; do
  r=$(bash tests/run_ui.sh "$t" 2>&1 | tail -1); line "ui $t" "$r"; [[ "$r" == *"fail=0"* ]] || status=1
done
r=$(bash tests/run_ui_live.sh ui_library.js 2>&1 | tail -1); line "ui ui_library.js (live)" "$r"; [[ "$r" == *"fail=0"* ]] || status=1
out=$(bash tests/smoke.sh 2>&1); n=$(echo "$out" | grep -c "^ok"); bad=$(echo "$out" | grep -v "^ok")
line "smoke" "ok=$n${bad:+ FAIL: $bad}"; [ -z "$bad" ] || status=1
exit $status
