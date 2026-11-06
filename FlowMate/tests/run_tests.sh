#!/usr/bin/env bash
# Run the FlowMate test suite in headless Chrome and print the results.
# Usage: bash tests/run_tests.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
URL=$(python -c "import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve().as_uri())" "$(cygpath -w "$HERE/harness.html" 2>/dev/null || echo "$HERE/harness.html")")
OUT=$(timeout 180 "$CHROME" --headless=new --disable-gpu --no-first-run --allow-file-access-from-files \
  --virtual-time-budget=120000 --run-all-compositor-stages-before-draw --dump-dom "$URL" 2>/dev/null)
python - "$OUT" <<'PY'
import sys, html, re
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
dom = sys.argv[1]
summ = re.search(r'<div id="summary"[^>]*>(.*?)</div>', dom, re.S)
log = re.search(r'<pre id="log">(.*?)</pre>', dom, re.S)
print(html.unescape(log.group(1)) if log else '(no log)')
print(html.unescape(summ.group(1)) if summ else 'NO SUMMARY — page did not finish')
sys.exit(0 if summ and 'fail=0' in summ.group(1) else 1)
PY
