#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/control_center"
LOG_DIR="$ROOT/tmp"
LOG_FILE="$LOG_DIR/control-center.log"

mkdir -p "$LOG_DIR"
cd "$ROOT"

if [ ! -d node_modules ]; then
  npm install
fi

npm run build

if lsof -ti tcp:8787 >/dev/null 2>&1; then
  echo "Restarting existing ApplyPilot Control Center on http://127.0.0.1:8787"
  kill "$(lsof -ti tcp:8787)"
  sleep 1
fi

nohup node server/index.mjs > "$LOG_FILE" 2>&1 &

for _ in {1..20}; do
  if curl -fsS "http://127.0.0.1:8787/api/state" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

open "http://127.0.0.1:8787"
echo "Opened ApplyPilot Control Center."
