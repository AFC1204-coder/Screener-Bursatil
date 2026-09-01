# CLEANUP-shadow-2026-09-01 — Deuda entre Cursor y nube

Auditoría tras VCP-4 + fixes de caché. Prioridad para tickets siguientes.

## Cerrado en este commit

- VCP-4: columna VCP, familia filtros `vcp`, `vcpMinerviniLabel`, proyección ligera `vcpCandidate`
- Caché arranque: TTL 15 min, timeout Supabase 12 s, mensaje stale más claro
- `pullCloudState` alineado con arranque (`rowsLimit`, `hydrateRs`)
- `CORE_LAYER_KEYS` / `OPTIONAL_LAYER_KEYS`: fuente única en `screenerFilterCatalog.js`

## P0 — Usuario ve mal

| ID | Tema | Acción |
|----|------|--------|
| C-01 | VCP en datos del nocturno **anterior** al flag `STATSEDGE_VCP_UNIFIED` | Re-correr nocturno US con flag ON en Vercel; hasta entonces columna/filtro VCP parcial |
| C-02 | Sesión caducada → 401 → copia local sin empujar re-login | **Cerrado** — banner «Sesión caducada» + botón «Vuelve a entrar» (`715575b` + fix C-02) |

## P1 — Datos silenciosamente distintos

| ID | Tema | Acción |
|----|------|--------|
| C-03 | `filterLayersVersion` &lt; 3 resetea capas al restaurar sesión/scan | **Cerrado** — aviso one-shot «Filtros actualizados» al restaurar v1/v2 |
| C-04 | `restoreSnapshot` no restaura `familyIntensity` (solo sesión) | **Cerrado** — `restoreFamilyIntensityState` en scan restore |
| C-05 | `cachedScreenerRows` sin RS país/tema si falta hydrate | Test de contrato + documentar que materialized-cache necesita `hydrateRs=1` |
| C-06 | `proxy.js` no acepta Bearer; `internalAuth` sí | Documentar o alinear perímetro (scripts vs navegador) |
| C-07 | `STATSEDGE_VCP_UNIFIED` no en Vercel env / `.env.example` activo | Añadir a Vercel + ejemplo cuando dueño confirme prod |

## P2 — Limpieza

| ID | Tema | Acción |
|----|------|--------|
| C-08 | `readPersistenceToken` / Bearer legacy sin callers | Eliminar o marcar deprecated |
| C-09 | Tests `pullCloudState` / cloud failure E2E | Ampliar suite (parcial en `cloudSyncClientStartupRequest.test.js`) |
| C-10 | Comentarios «caché 2 min» en docs viejos | Barrido `docs/` + ADR |

## Verificación recomendada (orquestador)

1. Hard-reload screener: ~3690 analizadas, sin «COPIA LOCAL»
2. Columna VCP visible (escritorio: entre Etapa y Rendimiento)
3. Research Desk → importar nube: filas completas con RS país/tema
4. Tras deploy: confirmar `STATSEDGE_VCP_UNIFIED=1` en Vercel si se quiere VCP en próximo nocturno
