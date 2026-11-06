#!/usr/bin/env bash
# Screenshot a local page with headless Chrome: shot.sh <page-relative-to-flowmate> <out.png> [w] [h] [query]
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
URL=$(python -c "import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve().as_uri() + (sys.argv[2] if len(sys.argv)>2 else ''))" "$(cygpath -w "$HERE/$1")" "${5:-}")
OUT=$(cygpath -w "$2" 2>/dev/null || echo "$2")
timeout 120 "$CHROME" --headless=new --disable-gpu --no-first-run --hide-scrollbars $EXTRA --allow-file-access-from-files \
  --force-device-scale-factor=1 --window-size=${3:-1400},${4:-900} --virtual-time-budget=${VTB:-15000} \
  --screenshot="$OUT" "$URL" 2>/dev/null
ls -la "$2" | awk '{print $5, $9}'
