# UX-2 — Línea de verdad única + banner de mercados accionable

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer · **Medium**  
**Origen:** `docs/analisis-ux-filtros-ia-2026-08-27.md` · orden: UX-4 → UX-3 (hechos) → **UX-2**  
**Principio:** una sola frase responde *analizadas / pasan / visibles / orden / fecha del scan*; la desalineación mercados↔datos tiene **un** aviso y **un** CTA.

## Problema

Hoy la cáscara reparte la verdad en tres sitios (subtítulo «N resultados», KPI 3 celdas con «–», «N pasan · N analizadas») y, cuando la selección de mercados no coincide con el scan cargado, muestra **dos banners naranjas** sin botón de resolución [DOC UX-1 / REPRODUCIDO].

## Objetivo

1. **Una línea de verdad** (bajo buscador o cabecera de resultados), p. ej.  
   `3321 analizadas · 47 pasan «Balanceado» · 47 visibles · orden: Rend. 6M ↓ · scan 27 ago 16:07`  
   Números = `analyzedRows.length` / `rows.length` / `filtered.length` (o equivalentes ya cableados). El nombre del criterio puede ser el preset actual hasta UX-5 (fichas).
2. **Desalineación de mercados** ⇒ exactamente **1** banner con **1** CTA que la resuelve (p. ej. «Cargar datos de la selección» → `setMarketsAndInvalidate` / reload del materializado de la selección actual, o «Ajustar selección al scan» → poner mercados = `scannedMarkets`). Elegir **una** acción clara; documentarla en el retorno.
3. Desaparecen el KPI vacío («–») y los contadores duplicados que digan lo mismo que la línea.
4. Copy menor del mismo bloque si sale gratis: «1 mercado» singular (no bloquear el ticket si complica).

## Alcance

### Dentro

1. `app/components/screener/ScreenerShell.jsx` (y componentes de status/KPI/banner que alimente).  
2. Lógica de `marketsStale` / avisos de cobertura / snapshot notice: consolidar a un solo camino con CTA.  
3. Tests unitarios del texto de la línea y/o de «un solo banner» si hay harness; si no, tests del helper que construye la línea.  
4. Sin commit ni push.

### Fuera

- UX-5 rail de fichas (el nombre en la línea puede seguir siendo el preset).  
- UX-8 desglose al clic en «pasan».  
- Rediseño completo del sidebar / capas.  
- Cambiar motor de filtrado.

## Archivos probables

- `app/components/screener/ScreenerShell.jsx`
- Helpers de status / freshness / market stale (buscar `marketsStale`, `snapshotNotice`, `announceCoverage`)
- `app/page.jsx` si el CTA dispara carga
- `styles/screener.css` (mínimo)
- tests nuevos o existentes de shell/status

## Verificación (orquestador)

1. Tests en verde.  
2. Browser Use: una sola línea con analizadas/pasan/visibles/orden coherentes; provocar desalineación mercados (p. ej. chip CA sin recargar) ⇒ **1** banner + CTA que al pulsar deja de estar desalineado.

## Plantilla de retorno

```
## Resumen
(1–4 bullets)

## Archivos
(lista real)

## Tests
(comando + resultado)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```
