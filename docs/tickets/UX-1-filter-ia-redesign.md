# UX-1-filter-ia-redesign — Encargo: rediseño de filtros / IA del screener

**Rama:** `codex/statsedge-ui-polish`  
**Modelo requerido:** **Fable 5** o **Opus thinking high** (juicio arquitectónico / producto). **No** Composer.  
**Tipo:** solo análisis y propuesta. **Sin código de producción. Sin commit ni push.**

## Por qué este encargo

El track internacional (INT-1) ya permite cargar y filtrar US + HK/CA/Europa/JP. El dueño —trader de stage analysis (Weinstein / Minervini / O’Neil)— considera que **lo que se muestra para filtrar no es intuitivo ni serio**: demasiada maquinaria (presets, capas, umbrales, vistas) y poca claridad sobre *qué está cazando* cada mañana.

Este encargo pide una **crítica dura + arquitectura de información + maqueta en texto + backlog**, anclada en evidencia del repo. No un rediseño genérico de “dashboard SaaS”.

## Rol

Product designer + stage-analysis trader. Vocabulario del producto: etapa 1–4, RS, pivot, deterioro, liquidez, fuerza de grupo. No inventes jerga de growth SaaS.

## Misión

1. Diagnosticar por qué la UI de filtrado (y la cáscara que la rodea) no se siente seria ni usable en una rutina matinal.  
2. Proponer una **IA de filtrado** que un trader usaría sin aprender ~70 umbrales.  
3. Entregar **5–8 tickets implementables** (P0–P2) con criterios de aceptación verificables.

## Alcance

### Dentro (fase 1)

- Presets de filtro, capas, «Más filtros», plantillas, modos de setup / exigencia.  
- Cáscara: barra de mercados / presets de mercado (`EE. UU.`, `Core intl`), status, KPIs de población, barra de resultados / filtros de vista, columnas de tabla que **contradicen** o confunden el filtro.  
- Relación con el preset `intl` y el flujo US `balanced` (no ensuciar el default US).

### Fuera (fase 1)

- Rediseño profundo de ficha `/stock/[symbol]`.  
- Auth, tenancy, licencia Twelve Data / H0.  
- Meter VCP / contracciones en producto (puedes **recomendar** si encaja en la IA; no especificar implementación).  
- Ampliar mercados INT-1 (IL/CN/BR/MX, etc.).  
- Código JSX/CSS de producción.

## Evidencia obligatoria (leer antes de opinar)

**No reinventes** el mapa de poblaciones ni la auditoría del motor. Cita.

| Fuente | Qué aporta |
|---|---|
| `docs/analisis-filtros-2026-08-15.md` | Tres poblaciones (`analyzedRows` / `rows` / `filtered`) y dos sistemas (filtro de ejecución vs filtro de vista) |
| `docs/auditoria-filtros-2026-08-13.md` | Catálogo / motor / capas / pipeline; hallazgos de consistencia |
| `docs/contradicciones-ui-2026-08-08.md` | Columna «Grp» vs filtro «Fuerza de grupo» (`rsSectorPct` vs `sectorScore`) |
| `docs/analisis-screener-uso-real-2026-08-23.md` | Fricción de uso real (frescura, gestos, deterioro) — contexto de rutina |
| Memoria / propuesta 2026-08-12 | **A «mesa de vistas»** vs **B «parte de la mañana»** (pendiente decisión dueño); principio «lo que no está en las fichas no filtra» |

**Código a inspeccionar (mínimo):**

- `app/components/screener/ScreenerShell.jsx` — layout, presets, mercados, status  
- `lib/screenerFiltersView.jsx` — UI de filtros avanzados  
- `lib/screenerFilterCatalog.js` — presets, umbrales, `intl`, auto-switch  
- `lib/screenerFilterLayers.js` — capas y degradación de `setupMode`  
- `app/components/screener/ResultFilterBar.jsx` — filtros de vista sobre la tabla  
- `lib/screenerResultView.js` — aplicación de vista  
- `lib/screenerColumns.jsx` / tabla — qué ve el usuario en columnas  

**Browser Use (opcional):** si hay Chrome con debug en `http://localhost:3000`, hard-reload y anota fricción real (presets, capas, «Más filtros», Core intl vs EE. UU.). Si no conecta, dilo en «LO QUE NO VERIFIQUÉ» y sigue con código + docs.

## Preguntas que debes responder

1. ¿Qué conceptos de stage analysis están **ocultos**, **mal nombrados** o **duplicados** en la UI?  
2. ¿Qué debería ser **vista** (rail/fichas) vs **criterio de caza** (preset) vs **ajuste experto**?  
3. ¿Cómo debería verse el **estado activo** del filtro (“lo que no está en las fichas no filtra” — propuesta A)?  
4. ¿Qué hacer con **capas**, `setupMode`, scores US-céntricos e **`intl`** sin ensuciar el flujo US?  
5. Contraste con TradingView / Finviz / MarketSurge: qué robar, qué no (y por qué).  
6. Priorizar **5–8 tickets** implementables (P0–P2) con aceptación verificable (orquestador + Browser Use).

## Calidad exigida

- Afirmaciones con **evidencia** (`[CÓDIGO]`, `[DOC]`, `[REPRODUCIDO]`). Sin crítica genérica de “demasiados filtros”.  
- Distinguir **bug / contradicción** vs **deuda de IA** vs **gusto visual**.  
- No proponer “otro panel con más toggles”. Preferir **menos superficie visible** y estados honestos.  
- Respetar decisión de producto: versión **privada multi-mercado**; US = base con Balanceado; Intl no debe contaminar el nocturno US.  
- Español claro; no inglés estructural nuevo en copy de producto salvo términos ya canónicos (RS, SMA, etc.).

## Plantilla de retorno

```
## Veredicto (10–15 líneas)

## Mapa mental del usuario vs mapa real del sistema

## Problemas (gravedad + evidencia)
(P0 / P1 / P2; cada uno con fuente)

## Propuesta de IA (principios + estructura de UI)

## Maqueta (estados clave en texto)
(al menos: arranque US Balanceado; caza pivot/leader; deterioro; Core intl / sin US; “qué está filtrando ahora”)

## Backlog priorizado (tickets)
(id tentativo, título, P0–P2, aceptación en 1–3 bullets)

## LO QUE NO VERIFIQUÉ

Sin commit ni push.
```

## Verificación (orquestador, después)

1. El retorno cita docs/código reales (no plantilla vacía).  
2. Los tickets son implementables sin reabrir INT-1 ni H0.  
3. Dueño elige fase 1 de implementación; orquestador escribe el siguiente ticket de código.
