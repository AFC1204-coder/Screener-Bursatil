#!/bin/bash
# launchd-friendly cron: universe-refresh against local Next (MIGRATE-3).
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
CRON_SECRET="$(python3 - <<'PY'
from pathlib import Path
p = Path('.env.local')
if not p.exists():
    raise SystemExit('missing .env.local')
for line in p.read_text().splitlines():
    if line.startswith('CRON_SECRET='):
        print(line.split('=', 1)[1].strip().strip('"').strip("'"))
        break
else:
    raise SystemExit('CRON_SECRET missing')
PY
)"
URL="${STATSEDGE_CRON_URL:-http://127.0.0.1:3000/api/cron/universe-refresh}"
code="$(curl -sS -m 120 -o "$ROOT/logs/cron-universe-refresh.body.json" -w '%{http_code}' \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  "$URL")"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) http=$code url=$URL" >> "$ROOT/logs/cron-universe-refresh.log"
python3 - <<PY
import json,sys
from pathlib import Path
p=Path('logs/cron-universe-refresh.body.json')
try:
  d=json.loads(p.read_text())
except Exception as e:
  print('body_parse_error', e); sys.exit(1)
ok=bool(d.get('ok'))
print('ok=', ok, 'count=', d.get('count'), 'error=', d.get('error'))
sys.exit(0 if ok else 1)
PY
