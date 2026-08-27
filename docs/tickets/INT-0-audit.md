# INT-0 — Auditoría multi-mercado (read-only)

**Fecha:** 2026-08-27  
**Proyecto Supabase:** `screener` · `dzovggfbcoymjgikkbno` · org `cuentasecundariawq@gmail.com`  
**Alineación:** `.env.local` y MCP apuntan al mismo proyecto (verificado).

## Objetivo

Cruzar configuración del repo con datos persistidos para saber **qué mercados promete la UI**, **qué escanea el pipeline nocturno** y **qué filas existen hoy** — sin pedir lista al dueño.

---

## 1. Tres “universos” distintos (causa raíz de confusión)

| Capa | Fuente | Alcance real |
|---|---|---|
| **UI / sesión** | `DEFAULT_MARKETS` (`lib/screenerConfig.js`) | **29 mercados**: US + 15 EU + CA + 8 Asia + AU + ZA + BR + MX |
| **Scan materializado por defecto** | `DEFAULT_SCAN_MARKETS` (`lib/markets.js`) | **14 mercados**: US, HK, AU + EU priority (GB, DE, FR, NL, CH, SE, IT, ES) |
| **Cron scan-refresh** | `SCAN_CRON_GROUPS` (`lib/cronPlan.js`) | **Lotes rotativos pequeños** (12–24 símbolos/grupo/noche), no universo completo |
| **Universo US completo** | `scripts/scan-universe.mjs` (GitHub Actions 03:00 UTC) | **~3319 filas** US/noche |
| **Inventario universo** | `universe_snapshots` (último) | US 7085 · HK 2770 · AU 684 · … (referencia, no tabla del screener) |

**Conclusión:** la UI dice “universo por defecto: EEUU + Europa + Asia/…” pero el **arranque y la sesión restaurada anclan al nocturno US** (`pickNightlyUsRestorableScan`, `lib/nightlyUsScan.js`). Cambiar el selector de mercados **no repuebla** la tabla hasta un scan nuevo (`marketsStale` en `app/page.jsx`).

---

## 2. Materializado por mercado (Supabase, último scan por grupo)

| Mercados | Filas | Día | Notas |
|---|---:|---|---|
| US | 3319 | 2026-08-26 | Fuente del arranque; coherente con smoke |
| CA | 22 | 2026-08-26 | Curado ~100+ símbolos en repo; scan parcial |
| JP | 24 | 2026-08-24 | ~24/slot cron; no universo J-Quants completo |
| FI,DK,NO,SE | 13 | 2026-08-26 | Shadow nordics |
| DK,NO,FI,BE,PT,AT,IE | 19 | 2026-08-23 | EU secondary |
| IT,ES | 7 | 2026-08-24 | Shadow south |
| DE,FR,NL | 4 | 2026-08-23 | Shadow west |
| GB | 3 | 2026-08-25 | FCA fuera de rotación FIRDS diaria |
| GB,DE,FR,NL,CH,SE,IT,ES | 24 | 2026-08-22 | Grupo combinado legacy |
| SG,ZA | 15 | 2026-08-20 | |
| US,HK,AU | 2 | 2026-08-21 | **Core cron roto/inútil** (debería ser miles) |
| TW | **0** | 2026-08-25 | **`status: failed`**, `total: 0` |

**HK y AU:** inventario 2770 / 684 símbolos en `universe_snapshot_symbols`, pero **no hay scan materializado reciente dedicado** (solo el grupo US,HK,AU con 2 filas). Los miles de filas HK en `scan_results` histórico **no entran solas** al screener al abrir.

---

## 3. Mercados en UI sin pipeline nocturno

Presentes en `DEFAULT_MARKETS` + listas `CURATED`/`EXTRA` en `lib/universes.js`, pero **ausentes** de `CRON_UNIVERSE_MARKETS` y `SCAN_CRON_GROUPS`:

| Mercado | Listas curadas en repo | Scan cron | Riesgo producto |
|---|---|---|---|
| **KR** | Sí (~10) | No | Selector activo → 0 filas hasta scan manual |
| **IN** | Sí (~70+) | No | Idem |
| **IL** | Sí (~25) | No | Idem |
| **CN** | Sí (~14) | No | Idem |
| **BR** | Sí (~10) | No | Idem |
| **MX** | Sí (~8) | No | Idem |

Europa secundaria (DK, NO, FI, BE, PT, AT, IE) **sí** tiene cohortes shadow/cron, pero con decenas de filas, no el universo curado completo.

---

## 4. RS y scoring

| Señal | US | Internacional |
|---|---|---|
| **RS canónico** (`rs_weekly_items`, 154 646 filas) | Hidratado en filas US | **No aplica** (solo universo US) — UI debe mostrar «–» + motivo (`lib/rsCanonical.js`) |
| **`rs_rating` en scan_results** (percentil del lote) | 100% en scan US 3319 | **0–10%** en muchos scans EU pequeños (GB 3, IT-ES 7, nordics 13…) |
| **RS Quality en tabla** | Coherente con ADR en US | Puede mostrar número calculado sobre percentil de lote mientras RS canónico es «–» |

**No es bug** que intl no tenga RS global US; **sí es deuda UX** si el usuario espera el mismo badge numérico que en US.

---

## 5. Capas por síntoma (qué “falla” hoy)

### A. Arranque siempre US
- **Síntoma:** 3319 analizadas aunque el copy diga multi-mercado.
- **Causa:** diseño explícito post-incidente IT-ES (2026-08-16) en `lib/nightlyUsScan.js` + `pickNightlyUsRestorableScan`.
- **INT-1 candidato:** modo “último scan del mercado seleccionado” o fusión multi-scan con aviso de mezcla.

### B. Selector de mercados vs datos cargados
- **Síntoma:** usuario marca solo CA/EU → tabla sigue siendo US hasta re-scan.
- **Causa:** `marketsStale` / `scannedMarkets` en sesión; snapshot local es del scan US.
- **INT-1 candidato:** banner claro + CTA «Escanear estos mercados»; o auto-cargar último materializado por mercado desde Supabase.

### C. HK / AU infrautilizados
- **Síntoma:** universo grande en DB, screener vacío para HK/AU.
- **Causa:** cron `core-us-hk-au` limit=12, perMarket=4; último materializado 2 filas; US nocturno separado no incluye HK/AU.
- **INT-1 candidato:** cohorte HK y AU propia con límites realistas o scan completo curado.

### D. Europa fragmentada
- **Síntoma:** 3–24 filas por mercado vs listas curadas de 15–50+.
- **Causa:** shadow + scan-refresh por rotación; FIRDS no inline en cron (maxDuration 60s).
- **INT-1 candidato:** expectativa honesta en UI («muestra rotativa») o ampliar cohortes.

### E. TW roto
- **Síntoma:** scan 0 filas, `failed`.
- **Causa:** `materialized:TW:2026-08-25` progress `total: 0`.
- **INT-1 candidato:** diagnosticar `getUniverse(TW)` / TWSE provider en job log.

### F. Chart / vista rápida (post-B2)
- **Estado:** preview línea + fetch OK en US (smoke 2026-08-27).
- **Pendiente intl:** no smoke con símbolo `.HK` / `.TO` / `.T`; asumir mismo pipeline si `/api/chart` resuelve símbolo.

### G. Fundamentales / ficha
- EDGAR US-only (documentado). Intl limitado — OK en privado con aviso.

### H. «Qué cambió» / nocturno
- `weekly-changes` acotado a MIC US — intl sin franja comparable (backlog ya lo dice).

---

## 6. Matriz repo ↔ Supabase (resumen)

| Mercado | En DEFAULT_MARKETS | En DEFAULT_SCAN_MARKETS | En cron scan | Último materializado | Símbolos inventario |
|---|---|---|---|---:|---:|
| US | ✓ | ✓ | ✓ (completo) | 3319 | 7085 |
| HK | ✓ | ✓ | ✓ (lote) | ~0 útil | 2770 |
| AU | ✓ | ✓ | ✓ (lote) | ~0 útil | 684 |
| CA | ✓ | ✗ | ✓ | 22 | — |
| JP | ✓ | ✗ | ✓ | 24 | — |
| TW | ✓ | ✗ | ✓ | **0 failed** | — |
| GB…ES (EU) | ✓ | parcial | shadow+cron | 3–24 | decenas–cientos |
| SG, ZA | ✓ | ✗ | ✓ | 15 | — |
| KR, IN, IL, CN, BR, MX | ✓ | ✗ | **✗** | — | solo curado repo |

---

## 7. Prioridad sugerida INT-1+

1. **P0 — Expectativa UI:** copy + banner cuando `markets` ≠ `scannedMarkets`; no prometer 29 mercados “listos” al abrir.
2. **P0 — TW failed:** arreglar universo/provider o excluir del selector hasta que funcione.
3. **P1 — Cargar último scan por mercado** desde Supabase (sin re-scan) al cambiar mercados.
4. **P1 — HK/AU:** materializado usable (>N filas) o quitar del default hasta tenerlo.
5. **P2 — RS intl:** benchmark por mercado o mantener «–» con copy unificado en tabla/modal/review.
6. **P2 — KR/IN/IL/CN/BR/MX:** cron mínimo curado o ocultar en selector hasta pipeline.

---

## 8. LO QUE NO VERIFIQUÉ

- Smoke Browser Use con mercado ≠ US (filtro país, fila `.HK`, chart intl).
- Logs Vercel del cron TW / core-us-hk-au del 2026-08-25.
- `/api/coverage` en vivo con sesión.
- Mezcla multi-mercado en percentiles de scoring (decisión producto).

---

## Plantilla de cierre

Estado: **INT-0 cerrado (informe)** · siguiente: elegir ítems INT-1 del §7.
