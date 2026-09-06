# TAPE-1 — Mesa Caza (tape) en producto

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** Cerrado (orquestador 2026-09-06) · smoke chrome Caza|Auditoría OK; filas nocturnas no en portátil (scan US fail)  
**Prioridad:** P1 · producto  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer 2 / GPT-5.6 Terra (multi-archivo UI)  
**Origen:** TAPE-0 proto `docs/prototypes/tape/index.html` (v3) · `docs/analisis-tape-mesa-2026-09-05.md` · `docs/vcp-footprint-notacion.md`  
**Tipo:** superficie de mesa — **no scoring** · no motor VCP

## Problema

La mesa de caza sigue siendo Excel (`CompactResultsTable`). El ritual (Líderes E2 → pasar nombres → abrir) necesita la **cinta** del proto: densidad + teclado, sin perder modo Auditoría.

## Defaults de producto (ya fijados en TAPE-0 / proto)

| # | Decisión |
|---|---|
| 1 | Ventana con scroll (no techo 8–12 del universo) |
| 2 | Sí · % máx. 52s en fila |
| 3 | Spark: preferir semanal ~12M si hay dato; si no, `chartPreview` existente sin inventar OHLCV |
| 4 | Enter = drill-in a `/stock/…` (o flujo ficha ya usado por la mesa) |
| 5 | «Pasar» = solo mueve foco (`j`/`k`); sin marca «visto» de sesión |

## Alcance (hacer)

1. **Palanca Caza | Auditoría** en el chrome de resultados (misma zona que el pager / mesa). Default razonable: **Caza** en fichas de caza del rail; **Auditoría** si el usuario ya estaba en tabla (o persistir preferencia en sesión/`localStorage` acotado — documentar elección).
2. **Modo Auditoría:** `ResultPagerTable` / `CompactResultsTable` intactos (mismo contrato de columnas, sort, pager).
3. **Modo Caza:** lista densa sobre las **mismas filas** ya filtradas/ordenadas (no ranking nuevo). Campos por fila (`docs/vcp-footprint-notacion.md`):
   - ticker (+ mark si ya existe patrón barato)
   - spark
   - etapa · `sem. N` (`weeklyStageWeek` / equivalente vivo)
   - **un** RS canónico (mismo que mesa/READ-G)
   - VCP footprint `XW Y/Z NT` si el row ya expone datos; si no → `–` (**no** reescribir detector)
   - % máx 52s
4. Teclado en Caza (foco en la lista): `j`/`k` (o ↑↓) · Enter · Esc (quitar foco / no romper atajos globales del shell).
5. Tokens / piel LOOK existentes — no inventar tema púrpura; alinear a `--pizarra` / controls.
6. Tests mínimos (render Caza vs Auditoría, teclado o contrato de fila). `./vfc` tocados.
7. Hard-reload / smoke orquestador después (Browser Use).

## Fuera de alcance

- Scoring · umbrales · motor VCP / contracciones  
- Cambiar `MarketMiniTape` (salud de mercado; otro componente)  
- Sustituir el rail de 5 fichas  
- Variante B (lista+chart grande) · cards C  
- Uppercase 3 roles (LOOK-C deuda → ticket siguiente)  
- Commit/push desde el Agent de programación

## Criterios de aceptación

1. Home screener: toggle Caza | Auditoría visible; Auditoría = mesa actual sin regresiones obvias.
2. Caza: filas reales del filtro activo; se lee ticker + etapa/sem + RS + (footprint o –) + máx52s; spark si hay preview.
3. `j`/`k` + Enter abren/navegan como en el proto (drill-in).
4. Móvil: no romper `MobileResultList` — o bien tape usable, o Caza desktop-only documentado en retorno (preferir tape usable ≥760 o reutilizar lista móvil si ya es densa).
5. Sin commit/push; plantilla de retorno.

## Archivos probables

- `app/components/screener/ScreenerShell.jsx`
- `app/components/screener/ResultPagerTable.jsx`
- `lib/screenerTable.jsx` / `lib/screenerColumns.jsx` / nuevo `lib/screenerHuntTape.jsx` (o similar)
- `styles/screener.css` / `styles/components.css`
- Proto referencia: `docs/prototypes/tape/index.html`

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
