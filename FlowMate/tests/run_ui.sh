#!/usr/bin/env bash
# Scripted UI test against the unbundled app. Usage: bash tests/run_ui.sh
HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
sed "s#<!--SELFTEST-->#<script src=\"${1:-ui_selftest.js}\"></script>#" "$HERE/app_dev.html" > "$HERE/ui.html"
URL=$(python -c "import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve().as_uri())" "$(cygpath -w "$HERE/ui.html")")
DOM=$(timeout 240 "$CHROME" --headless=new --disable-gpu --no-first-run --window-size=1440,900 --allow-file-access-from-files \
  --virtual-time-budget=60000 --dump-dom "$URL" 2>/dev/null)
echo "$DOM" | python -c "
import sys, re, html
d = sys.stdin.read()
log = re.search(r'<pre id=\"uitest\">(.*?)</pre>', d, re.S)
st = re.search(r'data-uitest=\"([^\"]*)\"', d)
err = re.search(r'data-errors=\"([^\"]*)\"', d)
print(html.unescape(log.group(1)) if log else '(no log)')
if err: print('UNCAUGHT:', html.unescape(err.group(1)))
print(html.unescape(st.group(1)) if st else 'NOT FINISHED')
sys.exit(0 if st and 'fail=0' in st.group(1) else 1)
"
