# IPO-NOCT — Parche `ipoDate` en scan US

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Motivo:** perfiles ya tienen `ipoDate` (IPO-1a write); el materializado US del 28-ago tiene 0/3320. Evitar rematerializado completo por disco/coste.

**Éxito:** ~3k filas del scan US con `metrics.ipoDate` tras `--write`; Radar IPO deja de mostrar cobertura 0.
