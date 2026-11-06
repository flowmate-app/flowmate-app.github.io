#!/usr/bin/env bash
# Run one QA task in headless Chrome.
#   bash tests/external_qa/run.sh <task.json>            → results/<task>.json
#   bash tests/external_qa/run.sh <task.json> shot W H   → results/<task>.png (plot tasks)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
TASK="$1"; NAME="$(basename "$TASK" .json)"
mkdir -p "$HERE/results"
URL=$(python -c "import pathlib,sys,urllib.parse; print(pathlib.Path(sys.argv[1]).resolve().as_uri() + '?task=' + urllib.parse.quote(sys.argv[2]))" \
  "$(cygpath -w "$HERE/qa.html" 2>/dev/null || echo "$HERE/qa.html")" "tasks/$NAME.json")
FLAGS=(--headless=new --disable-gpu --no-first-run --allow-file-access-from-files --virtual-time-budget=600000
  --run-all-compositor-stages-before-draw --js-flags=--max-old-space-size=8192)
if [ "${2:-}" = "shot" ]; then
  OUTP="$(cygpath -w "$HERE/results/$NAME.png" 2>/dev/null || echo "$HERE/results/$NAME.png")"
  timeout 900 "$CHROME" "${FLAGS[@]}" --hide-scrollbars --window-size="${3:-1600},${4:-1200}" --screenshot="$OUTP" "$URL" 2>/dev/null
  echo "wrote results/$NAME.png"
  exit 0
fi
timeout 900 "$CHROME" "${FLAGS[@]}" --dump-dom "$URL" 2>/dev/null | python -c "
import sys, re, html, json
dom = sys.stdin.read()
st = re.search(r'<div id=\"status\">(.*?)</div>', dom, re.S)
o = re.search(r'<pre id=\"out\">(.*?)</pre>', dom, re.S)
print('status:', st.group(1) if st else '(no page)')
if o and o.group(1):
    data = json.loads(html.unescape(o.group(1)))
    json.dump(data, open(sys.argv[1], 'w', encoding='utf-8'), indent=1)
    print('wrote', sys.argv[1], 'error:' if 'error' in data else '', data.get('error', '')[:2000])
" "$HERE/results/$NAME.json"
