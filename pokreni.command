#!/bin/bash
# Dupli klik u Finderu: pokreće Drummer na http://localhost:8123 i otvara ga u Chrome-u.
cd "$(dirname "$0")"
PORT=8123
if ! lsof -i :$PORT >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
  sleep 1
fi
for app in "Google Chrome" "Microsoft Edge" "Brave Browser"; do
  if open -a "$app" "http://localhost:$PORT" 2>/dev/null; then exit 0; fi
done
echo "Nije nađen Chrome, Edge ni Brave. MIDI radi samo u njima: instaliraj Chrome sa google.com/chrome."
open "http://localhost:$PORT"
