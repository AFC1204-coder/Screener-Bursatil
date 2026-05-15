# StatsEdge V1 functional consolidation plan

Fecha: 2026-05-15

Este documento separa responsabilidades funcionales para que StatsEdge avance sin duplicar pantallas, textos ni cálculos. La premisa es mantener el rediseño visual en Antigravity y reservar Codex para datos, lógica, arquitectura y verificación.

## Objetivo

StatsEdge debe sentirse como una herramienta de research global, no como una colección de pantallas independientes. El flujo principal debe ser:

1. Crear o cargar un universo.
2. Ejecutar screener.
3. Guardar snapshot.
4. Revisar acciones rápidamente.
5. Agrupar por país, sector, industria y temática.
6. Abrir ficha profunda.
7. Guardar favoritos.
8. Seguir evolución contra mercado/benchmark.

La app no debe dar consejos directos. Debe mostrar evidencia objetiva: precio, tendencia, fuerza relativa, volumen, amplitud, cobertura de datos, crecimiento, deterioro y contexto de mercado.

## Rol de cada pantalla

### `/`

Rol: motor de generación de candidatos.

Debe hacer:

- Selección de universo global.
- Presets y filtros.
- Ejecución del screener.
- Ranking principal.
- Guardar snapshot.
- Favorito rápido.
- Búsqueda amplia por ticker, empresa, país, sector e industria.

No debe hacer:

- Seguimiento detallado de favoritos.
- Análisis profundo de ficha.
- Exceso de explicación metodológica.

### `/review`

Rol: revisión rápida tipo lista/carrusel.

Debe hacer:

- Scroll o navegación ágil entre acciones.
- Ver gráfico, datos clave y contexto mínimo.
- Favorito rápido.
- Salto a ficha.

No debe duplicar:

- Todas las tablas del screener.
- Todos los filtros del screener.

### `/lists`

Rol: listas derivadas del último snapshot/favoritos.

Debe hacer:

- Leaders por score.
- RS leaders.
- Near pivot.
- Pullback SMA50.
- Extended strong.
- IPO/new leaders.
- Deterioro/weakness como lista objetiva.

No debe hacer:

- Recalcular toda la lógica del screener.
- Crear nuevos criterios incompatibles con `/`.

### `/sectors`

Rol: mapa de liderazgo por temática, sector, industria y país.

Debe hacer:

- Agrupar snapshot/favoritos.
- Filtrar por país.
- Mostrar fuerza media, RS, momentum y líderes por grupo.
- Saltar a listas o fichas.

No debe hacer:

- Ser otra página de Market Health.
- Mostrar noticias generales.

### `/market-health`

Rol: contexto superior de mercado.

Debe hacer:

- Índices principales.
- Weinstein tape: MM30 semanas, etapas, distribución/acumulación.
- Sector tape USA por ETFs.
- Sector por país desde snapshot.
- Noticias/sentimiento general.
- Pulso social cuando exista token.

No debe hacer:

- Recomendar operaciones.
- Mostrar fichas de empresa profundas.

### `/stock/[symbol]`

Rol: ficha profunda de una acción.

Debe hacer:

- Identidad empresa.
- Gráfico TradingView o fallback externo.
- RS actual e histórico.
- Fundamentales actuales e históricos si hay datos.
- Noticias de empresa.
- Peers/similares.
- Enlaces externos.
- Favorito/seguimiento.

No debe hacer:

- Repetir textos genéricos de metodología.
- Saturar con métricas sin dato si se pueden agrupar o colapsar.

### `/research-desk`

Rol: persistencia, favoritos, notas y seguimiento.

Debe hacer:

- Watchlist.
- Rendimiento desde añadido.
- Comparativa benchmark.
- Alpha.
- Notas.
- Export/import.
- Sincronización Supabase.

No debe hacer:

- Ser un segundo screener.
- Duplicar listas derivadas si `/lists` ya lo cubre.

### `/ipo-radar`

Rol: pipeline de IPOs.

Debe hacer:

- IPOs recientes reales.
- IPOs próximas o manuales.
- Estado: rumoreada, prevista, cotizada, importada.
- Importar desde snapshot si fecha IPO reciente.

No debe hacer:

- Mezclar empresas antiguas como IPO por falta de fecha.

## Duplicidades detectadas

### Estado local

Repetido en varias pantallas:

- `statsedge.scans.v1`
- `statsedge.favorites.v1`
- `statsedge.review.v1`
- `statsedge.ipoRadar.v1`
- `safeRead`
- `safeWrite`

Acción recomendada:

- Crear `lib/localState.js` con claves, lectura, escritura, merge y normalización.

### Formato visual/datos

Repetido:

- `pct`
- `num`
- `marketFlag`
- nombres de país
- lectura de `row.snapshot`

Acción iniciada:

- `marketFlag` y `countryName` se centralizaron en `lib/symbols.js`.

Siguiente acción:

- Crear `lib/formatters.js` para `pct`, `num`, `money`, `cap`, `ratioLabel`.

### Modelo de fila

Repetido:

- `rowScore`
- `rowRs`
- `weaknessScore`
- `rowCountry`
- `rowSector`
- `favoriteFromRow`
- `snapshotForFavorite`
- `shortBusiness`

Acción recomendada:

- Crear `lib/stockRows.js` con:
  - `normalizeStockRow(row)`
  - `metricValue(row, key)`
  - `rowScore(row)`
  - `rowRs(row)`
  - `rowWeakness(row)`
  - `rowCountry(row)`
  - `rowSector(row)`
  - `snapshotForFavorite(row)`
  - `favoriteFromRow(row, marketHealth)`

### Agrupaciones

Repetido o divergente:

- sectores en `/sectors`
- country sector tape en `/market-health`
- ranking por país en `/`
- listas por score en `/lists`

Acción recomendada:

- Crear `lib/grouping.js` con:
  - `groupRows(rows, dimension)`
  - `buildCountryRank(rows)`
  - `buildCountrySectorTape(rows)`
  - `buildQuickLists(rows)`

### Scoring

Concentrado sobre todo en `/`, pero algunas páginas reconstruyen versiones simplificadas.

Acción recomendada:

- Extraer progresivamente de `app/page.jsx` hacia `lib/scoring/`:
  - `technical.js`
  - `relativeStrength.js`
  - `volume.js`
  - `riskReward.js`
  - `composite.js`
  - `ipo.js`

Esto debe hacerse por fases, con build/test tras cada extracción.

## Orden de consolidación recomendado

### Fase A: utilidades seguras

1. `lib/symbols.js`: flags, país, bolsa, TradingView.
2. `lib/formatters.js`: porcentajes, números, dinero, ratios.
3. `lib/localState.js`: localStorage y claves.

Riesgo: bajo.

Estado 2026-05-15:

- `marketFlag` y `countryName` viven en `lib/symbols.js`.
- `STORAGE_KEYS`, `safeRead` y `safeWrite` viven en `lib/localState.js`.
- `pct`, `pctShare`, `num`, `ratio`, `cap`, `money` y `clamp` viven en `lib/formatters.js`.
- Pantallas migradas a la capa común: `/`, `/review`, `/lists`, `/sectors`, `/market-health`, `/research-desk`, `/ipo-radar`.
- La ficha `/stock/[symbol]` conserva formateadores locales porque usa fallback textual `Sin dato` específico de ficha.

### Fase B: contrato de datos

1. `lib/stockRows.js`.
2. Normalizar filas de snapshot/favorite/search.
3. Unificar `favoriteFromRow`.

Riesgo: medio, porque toca favoritos y snapshots.

### Fase C: listas y agrupaciones

1. `lib/grouping.js`.
2. Reutilizarlo en `/lists`, `/sectors`, `/market-health` y `/`.

Riesgo: medio.

### Fase D: scoring

1. Extraer funciones de scoring desde `/`.
2. Mantener nombres de campos actuales para no romper Supabase ni CSV.
3. Añadir tests de smoke de scoring sobre 2-3 filas mock.

Riesgo: medio/alto.

### Fase E: navegación producto

1. Asegurar que cada fila tiene acciones coherentes:
   - ficha
   - review
   - favorito
   - sector/lista
   - TradingView externo
2. Eliminar rutas solapadas o renombrar si el rol no queda claro.

Riesgo: bajo/medio.

## Funcionalidades que conviene unir

### `/lists` y `/sectors`

No deben fusionarse, pero sí compartir motor:

- `/lists` responde: qué acciones mirar por tipo de setup.
- `/sectors` responde: dónde está concentrado el liderazgo.

### `/review` y `/stock`

No deben fusionarse:

- `/review` es velocidad.
- `/stock` es profundidad.

Sí deben compartir:

- acciones similares
- gráfico/TradingView fallback
- favorito
- resumen objetivo

### `/market-health` y `/sectors`

No deben fusionarse:

- `/market-health` es contexto macro/tape.
- `/sectors` es explotación del snapshot.

Sí deben compartir:

- country sector tape
- agrupación por país/sector
- métricas de liderazgo/deterioro

## Siguientes mejoras de datos

1. Amplitud global por país:
   - % acciones sobre SMA50/SMA200/MM30s por país.
   - % cerca de máximos 52 semanas.
   - % Etapa 2 probable.
   - % deterioro.

2. RS histórico guardado:
   - guardar RS line/rating en snapshots.
   - graficar evolución de RS por acción.
   - comparar contra benchmark local.

3. Fundamentos históricos:
   - anual y trimestral.
   - ventas, EPS, márgenes, ROE, deuda.
   - mostrar cobertura y fuente.

4. Calidad de datos por mercado:
   - panel de cobertura por país.
   - campos disponibles/faltantes.
   - símbolo alternativo si Yahoo/TradingView falla.

5. Alertas V1:
   - favoritos rompen máximo 20/50d.
   - recuperan SMA50.
   - pierden SMA50/SMA200.
   - RS mejora/empeora desde último snapshot.

## Checklist para no crear duplicidades nuevas

Antes de añadir una función:

- ¿Pertenece al screener, review, listas, sectores, mercado, ficha, research desk o IPO?
- ¿Ya existe el dato en snapshot/favorite/company brief?
- ¿Hay una utilidad compartida que deba usarse?
- ¿La pantalla está mostrando evidencia o consejo?
- ¿El dato aplica globalmente o solo a USA?
- ¿Qué ocurre si el proveedor no devuelve datos?

## Recomendación de trabajo con Antigravity

Antigravity puede tocar:

- layout
- jerarquía visual
- CSS
- densidad
- navegación
- responsive
- limpieza de cards

Codex debe tocar:

- datos
- scoring
- endpoints
- persistencia
- normalización
- tests
- documentación funcional

Evitar que ambos editen la misma zona a la vez, especialmente:

- `app/globals.css`
- layouts grandes de `app/page.jsx`
- estructura de cards en páginas principales
