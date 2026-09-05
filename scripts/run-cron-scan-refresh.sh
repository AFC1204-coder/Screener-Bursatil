#!/bin/bash
# launchd-friendly cron: scan-refresh against local Next (MIGRATE-4).
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
GROUP="${STATSEDGE_SCAN_GROUP:-}"
QUERY="group=${GROUP}"
if [ -z "$GROUP" ]; then
  QUERY=""
fi
URL="${STATSEDGE_CRON_URL:-http://127.0.0.1:3000/api/cron/scan-refresh}"
if [ -n "$QUERY" ]; then
  URL="${URL}?${QUERY}"
fi
code="$(curl -sS -m 300 -o "$ROOT/logs/cron-scan-refresh.body.json" -w '%{http_code}' \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  "$URL")"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) http=$code url=$URL" >> "$ROOT/logs/cron-scan-refresh.log"
python3 - <<PY
import json,sys
from pathlib import Path
p=Path('logs/cron-scan-refresh.body.json')
try:
  d=json.loads(p.read_text())
except Exception as e:
  print('body_parse_error', e); sys.exit(1)
ok=bool(d.get('ok'))
scan=d.get('scan') or {}
saved=d.get('savedScan') or {}
print('ok=', ok, 'localId=', scan.get('localId') or saved.get('localId'), 'rows=', saved.get('rows'), 'error=', d.get('error'))
sys.exit(0 if ok else 1)
PY
