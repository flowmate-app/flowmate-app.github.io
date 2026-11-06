#!/usr/bin/env bash
# Load the built app headlessly in several states and report uncaught errors.
# Usage: bash tests/smoke.sh
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
BASE=$(python -c "import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve().as_uri())" "$(cygpath -w "$HERE/dist/FlowMate.html")")
fail=0
for state in "" "?demo=1#load" "?demo=1#workspace" "?demo=1&preset=1#workspace" "?demo=1&preset=1#tables" "?demo=1#comp" "#comp" "?demo=1#plate" "?demo=1#gate" "?demo=1&preset=1#plate" "?demo=1&preset=1#gate" "?demo=1&preset=1#measure" "?demo=1&preset=1#results" "?demo=1&preset=1#layout" "#layout" "#planner" "?demo=1#planner"; do
  DOM=$(timeout 90 "$CHROME" --headless=new --disable-gpu --no-first-run --window-size=1440,900 --virtual-time-budget=8000 --dump-dom "$BASE$state" 2>/dev/null)
  ERR=$(echo "$DOM" | python -c "import sys,re,html; d=sys.stdin.read(); m=re.search(r'data-errors=\"([^\"]*)\"', d); print(html.unescape(m.group(1)) if m else '')")
  VIEW=$(echo "$DOM" | grep -o 'class="view view-[a-z]*"' | head -1)
  if [ -n "$ERR" ]; then echo "FAIL ${state:-<empty>}  [$VIEW]  $ERR"; fail=1; else echo "ok   ${state:-<empty>}  [$VIEW]"; fi
done
exit $fail
