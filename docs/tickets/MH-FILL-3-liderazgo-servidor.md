# MH-FILL-3 — Liderazgo de Mercado desde servidor

**Estado:** prep  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish` (o CA en rama propia si polish ocupado)  
**Modelo:** Composer  
**Origen:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` §3 (G2 / MH-FILL-3) · `docs/methodology/market-leadership-framework.md` §1 / §10  
**Tipo:** market-health · dato en `scan_results` · falta API/UI server  
**Gap informe:** G2 — «Leadership pulse y regiones desde `localStorage`» · clase **falta API** (los datos están en `scan_results`; hace falta un agregado servidor)

## Problema

En `/market-health`, la mitad «dónde está el liderazgo» depende del navegador, no del nocturno compartido.

1. **Leadership pulse** — KPIs (`rsLeaderPct`, `nearHighPct`, `pressurePct`), listas de líderes/deterioro y desglose país/tema salen de `buildScanPulse()` sobre `STORAGE_KEYS.scans` (`app/market-health/page.jsx`: `buildScanPulse` ~123, `refreshScanPulse` ~547-548, bloque UI ~809+). Sin snapshot local en `localStorage`, el panel muestra «Sin datos guardados» aunque el escaneo vigente exista en `scan_results` del servidor.

2. **Tarjetas regionales** — `GlobalRegionsPanel` recibe `scanPulse?.rows` (~804). La **amplitud SMA50** ya viene del servidor (`/api/market-breadth`; comentario ~405-408), pero **RS promedio**, recuento «En snapshot local» y la lista de líderes por región siguen atados al snapshot del navegador. Usuario nuevo, otro dispositivo o sesión sin copia local → regiones vacías o «Sin activos analizados en esta geografía» con datos reales en backend.

3. **Pregunta rectora sin responder** — El framework de producto pide «Which countries/regions lead?» y «Which sectors/themes lead?» (`market-leadership-framework.md` §10, puntos 2–3). Hoy solo se responde si el usuario ya ejecutó el screener en ese navegador.

## Alcance (cuando se programe)

1. **API agregada** sobre el scan vigente (`scan_results` del nocturno publicable; misma fuente que alimenta la mesa): exponer un payload de liderazgo equivalente a lo que hoy calcula `buildScanPulse` + filas regionales (líderes, deterioro, agregados país/tema, metadatos `createdAt` / preset / cobertura).

2. **Extender** `app/api/market-health/route.js` (campo nuevo en la respuesta) **o** ruta dedicada (`/api/market-leadership` u otro nombre acordado) consumida por la página — decisión de implementación, no de producto: el contrato debe ser estable y documentado en tests.

3. **UI Mercado** — `app/market-health/page.jsx` deja de depender de `localStorage` para leadership pulse y filas regionales; consume el payload server. Mantener `/api/market-breadth` para amplitud SMA50 (ya server-side).

4. **Ausencia honesta** — Si no hay scan publicable, universo vacío o campos RS ausentes: mismos mensajes declarativos que hoy (`MissingValue`, «Sin liderazgo claro…»), pero atribuidos al escaneo nocturno / cobertura, no a «snapshot local» inexistente.

5. **Tests** del agregado + consumo UI mínimo · **`./vfc`**.

## Fuera de alcance (NO)

| ID / tema | Motivo |
|---|---|
| **MH-FILL-5** | Régimen regional (índice de referencia por mercado, veredicto multi-región) |
| **STAGE-4** | Volumen de fuga junto al calificador |
| **weeklyStage / scoring de régimen** | No retocar reglas de etapa ni market score |
| **Merge polish / residual caché MH** | **Hecho** `16abe65` (Actualizar→`?refresh=1`); persistencia sigue ops Mini/RPC |
| **Implementación en este PR** | Solo prep de documentación |

## Referencias de código (HEAD verificado)

| Pieza | Archivo | Notas |
|---|---|---|
| Agregación client-side | `app/market-health/page.jsx` | `buildScanPulse` (~123-158), `summarizeGroups`, `GlobalRegionsPanel` (~424-531) |
| Lectura localStorage | `app/market-health/page.jsx` | `refreshScanPulse` → `safeRead(STORAGE_KEYS.scans, [])` (~547-548) |
| UI leadership | `app/market-health/page.jsx` | «Leadership pulse» (~809+), `GlobalRegionsPanel` (~804) |
| API Mercado actual | `app/api/market-health/route.js` | Índices/sectores/régimen US; **sin** agregado de liderazgo sobre `scan_results` |
| Amplitud server (ya OK) | `/api/market-breadth` | Usada en regiones para SMA50; no sustituye filas de liderazgo |
| Persistencia scan | `scan_results` vía `lib/serverScanRunner.js`, `lib/screenerPipeline.js` | Fuente de verdad nocturna |

## Criterios de aceptación (orquestador)

1. **Con `localStorage` vacío** (DevTools → Application → borrar `STORAGE_KEYS.scans` o perfil incógnito con sesión autenticada): hard-reload `/market-health` → leadership pulse y tarjetas regionales muestran datos del nocturno **o** ausencia honesta atribuida al scan server (no «Sin datos guardados» / «En snapshot local» como única explicación).

2. **Con snapshot local presente** (mesa ya cargada en el mismo navegador): la pantalla sigue coherente; preferencia server sobre local o paridad declarada en UI (fecha/preset del escaneo server visible).

3. **Vitest** del agregado + suite tocada OK · **`./vfc`**.

4. **Smoke Browser Use** (`:3000` o `:3300` aislado): evidencia breve — texto del status leadership, al menos una tarjeta regional con líderes o motivo de ausencia, sin depender de haber abierto el screener antes en esa sesión.

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/MH-FILL-3-liderazgo-servidor.md
@docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md
@docs/methodology/market-leadership-framework.md

Rama: codex/statsedge-ui-polish
Modelo: Composer

Ticket MH-FILL-3 — leadership pulse y liderazgo regional desde servidor (no localStorage).

Problema verificado:
- `/market-health` calcula leadership pulse con buildScanPulse() sobre STORAGE_KEYS.scans
  (page.jsx ~123, ~547-548, UI ~809+).
- GlobalRegionsPanel usa scanPulse?.rows para RS promedio, recuento y líderes (~804);
  solo la amplitud SMA50 viene de /api/market-breadth.
- Sin snapshot local la sección queda vacía aunque scan_results tenga el nocturno.

Objetivo:
1. Agregado server sobre scan vigente (scan_results publicable): payload equivalente a
   buildScanPulse + filas por región/país/tema (líderes, deterioro, KPIs rsLeaderPct /
   nearHighPct / pressurePct, metadatos createdAt/preset/cobertura).
2. Exponer en app/api/market-health/route.js (campo nuevo) o ruta dedicada; UI consume
   server; ausencia honesta si no hay scan o RS ausente (no culpar al «snapshot local»).
3. Tests agregado + consumo UI · ./vfc.

Fuera de alcance:
- MH-FILL-5 (régimen regional) · STAGE-4 · weeklyStage/scoring · merge polish ·
  fix caché refresh (PR #18 aparte).

Verificación orquestador:
- Smoke /market-health con localStorage vacío y con snapshot presente.
- Vitest + ./vfc.

Plantilla de retorno. Sin commit ni push.
```

## Retorno esperado (programación)

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
