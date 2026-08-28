# INT-3e-fix — Metadatos HKEX en snapshot

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Dolor:** INT-3e selección OK en tests, pero snapshot vivo strippea board/short-sell → noop en cron.  
**Núcleo:** `normalizeEntry` + `dbSnapshotToApi` preservan `exchangeSubCategory` / `shortSellEligible`.
