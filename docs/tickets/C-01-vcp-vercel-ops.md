# C-01 — VCP en nocturno (ops dueño)

**Tipo:** operaciones — **no** ticket de programación  
**Guía completa Vercel + GitHub:** `docs/tickets/CONNECT-vercel-github-ops.md`

## Qué falta

La columna y filtro **VCP** en UI ya están (VCP-4). Muchas filas vacías porque el **último nocturno US** se generó sin `STATSEDGE_VCP_UNIFIED=1`.

## Checklist dueño

1. **GitHub Actions** (nocturno US): variable `STATSEDGE_VCP_UNIFIED=1` — **ya creada** en el repo. Tras merge del cambio en `scan-universe.yml`, el próximo nocturno escribe VCP.
2. **Vercel** (solo si usas deploy/crons): misma variable + `SUPABASE_*` — ver `CONNECT-vercel-github-ops.md`.
3. Disparar manualmente **Actions → Scan universe (US, nightly) → Run workflow** si no quieres esperar a las 03:00 UTC.
4. Hard-reload screener → columna VCP con etiquetas en filas US.

## Verificación orquestador (post-scan)

- ~3300 analizadas US, VCP no mayoritariamente vacío en líderes conocidos.
- Filtro familia VCP → preset Minervini reduce universo de forma coherente.

## Programación pendiente relacionada

- **C-07:** documentar flag en `.env.example` cuando dueño confirme prod (ticket aparte, bajo).
