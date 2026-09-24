#!/usr/bin/env bash
# HSS launcher + supervisor.
#
#  - restores node_modules if the environment wiped them
#  - frees the port if an orphaned server is still holding it (this is what
#    caused the silent EADDRINUSE crash-restart loop)
#  - refreshes cache-busting asset hashes
#  - restarts on genuine crashes, but REFUSES to loop on a fatal config error
cd "$(dirname "$0")"
PORT="${PORT:-3000}"

if [ ! -d node_modules/express ]; then
  echo "[hss] dependencies missing — installing..."
  npm install --no-audit --no-fund >/dev/null 2>&1
fi

# Make sure nobody else is holding our port (orphan from a previous run).
free_port() {
  local pids
  pids=$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
  if [ -n "$pids" ]; then
    for pid in $pids; do
      if [ "$pid" != "$$" ]; then
        echo "[hss] port $PORT held by pid $pid — terminating it"
        kill -9 "$pid" 2>/dev/null
      fi
    done
    sleep 1
  fi
}
free_port

node stamp.js

fails=0
while true; do
  node server.js
  code=$?

  if [ "$code" -eq 0 ]; then
    echo "[hss] server stopped cleanly — exiting supervisor"
    exit 0
  fi

  fails=$((fails + 1))
  if [ "$fails" -ge 5 ]; then
    echo "[hss] server failed $fails times in a row — stopping so the error is visible."
    exit 1
  fi

  echo "[hss] server exited (code $code) — restart $fails/5 in 1s"
  sleep 1
  free_port
  if [ ! -d node_modules/express ]; then
    echo "[hss] dependencies missing — reinstalling..."
    npm install --no-audit --no-fund >/dev/null 2>&1
  fi
done
