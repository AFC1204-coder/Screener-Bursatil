# CHART-QR-1b — Review/cola: se queda en línea + «Ampliando histórico…»

**Estado:** Hecho (orquestador · smoke Review AVAH + IFP.TO velas)  
**Prioridad:** P1 (uso real dueño · 2026-09-07)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer (thinking si controller/fetch no cuadra)  
**Origen:** feedback dueño — cargar acción desde filtro → cola Review: gráfico en **línea** con estilo **Velas**, banner «Ampliando histórico…», sensación de carga larga. Evidencia: `VWS.CO` en `/` Review (COLA).  
**Relacionado:** CHART-QR-1 (`docs/tickets/CHART-QR-1-preview-to-candles.md`, marcado Hecho) · B2-chart · `resolveRenderConfig` / `history-expanding`

## Problema

Tras CHART-QR-1, en **Review / cola** (abrir desde mesa/filtro) sigue ocurriendo:

1. Preview close-only se pinta como **línea** (OK al instante).
2. UI dice **Velas** y muestra «Ampliando histórico para este rango…».
3. La transición a **velas OHLC** no llega (o tarda tanto que parece rota), sobre todo en **intl** (ej. `VWS.CO`).

Hipótesis a verificar (no asumir):

- `/api/chart` lento/timeout en intl → `requestState` nunca `settled` → `resolveRenderConfig` mantiene línea.
- Settled con OHLC pero `preferredStyle` / re-attach no reaplica candlestick.
- Notice `history-expanding` se queda aunque el request ya falló (falta `history-expansion-failed`).

## Alcance

1. Reproducir: mesa → Revisar / cola → símbolo con Velas (idealmente intl como `VWS.CO` y uno US de control).
2. Instrumentar o leer estados: `requestState`, `availability`, payload OHLC grade, `resolveRenderConfig` / estilo efectivo.
3. Fix mínimo:
   - si OHLC llega → pasar a velas en ≤ criterio razonable;
   - si falla/timeout → aviso **history-expansion-failed** (o copy existente), **no** banner infinito; línea + aviso OK.
4. Tests de `resolveRenderConfig` / data model loading→settled|error. `./vfc` tocados.
5. Sin commit/push. Sin refactor chart-controller rama aparte.

## Fuera

- IPO-UX-F · LOOK · scoring  
- Cambiar defaults RS (QR-2)  
- Ampliar proveedor de datos / licencia  

## Criterios

1. Con `/api/chart` OK y estilo Velas: preview línea → **velas** visibles tras settle (evidencia orquestador).
2. Con fetch lento/fallo: no «Ampliando…» eterno; mensaje de fallo o histórico limitado honesto.
3. US y al menos un intl de cola no se comportan peor que hoy en el happy path.
4. Vitest afectados verdes.
