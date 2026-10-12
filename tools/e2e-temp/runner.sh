#!/usr/bin/env bash
set -euo pipefail
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
node tools/e2e-temp/seed.mjs
npm run start -- --host 127.0.0.1 --port 4200 > /tmp/bem-feito-e2e-angular.log 2>&1 &
APP_PID=$!
cleanup(){ kill "$APP_PID" 2>/dev/null || true; }
trap cleanup EXIT
READY=0
for attempt in $(seq 1 100); do
  if curl -fsS http://127.0.0.1:4200/login >/dev/null 2>&1; then READY=1;break;fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then break; fi
  sleep 2
done
if [ "$READY" != "1" ]; then
  tail -120 /tmp/bem-feito-e2e-angular.log
  exit 1
fi
node tools/e2e-temp/test-ui.mjs || { tail -120 /tmp/bem-feito-e2e-angular.log; exit 1; }
