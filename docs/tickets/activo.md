# Ticket activo — libre

Último cerrado: **MET-1b** (código `060cf08` + pipeline write 2026-08-28).

**Pipeline ejecutado (orquestador):**
- `rs-fx-ingest.mjs --write` → 10/10 divisas OK (GBP 400 barras nuevas)
- `rs-global-private.mjs --write` → snapshot `7c3a1792-d97b-4c6e-8cba-bf0692135235` · W35 · 3224 rankeados + 476 exclusiones
- Cutover activo: lectura usa `statsedge-private-global-rs-usd-v1` (fallback US ya no aplica)

**Smoke:** disclosure columna RS OK en `:3000` («RS global · USD · universo privado curado»). API node: MU=99, AAPL=61, 0005.HK=83 (motor global). Hard-reload dev si la tabla no refresca RS.

**Pendiente:** MET-1c cron · backfill intl opcional (96 símbolos BE/PT/AT/IE sin barras).
