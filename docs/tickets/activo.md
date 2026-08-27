# Ticket activo — INT-1-HK-AU-run (pendiente)

Plan cron **INT-1-HK-AU** cerrado (cohorts `asia-hongkong` / `oceania-australia`).

Estado: **pendiente primera corrida** ≥15 filas en Supabase + smoke chip HK/AU.

Manual (con `CRON_SECRET`):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/scan-refresh?group=asia-hongkong"
```

Análogo: `group=oceania-australia`.
