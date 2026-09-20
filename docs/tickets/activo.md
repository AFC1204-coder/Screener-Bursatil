# Ticket activo — REVIEW-RS-COPY-1

**Estado:** activo · programación en Agent chat aparte  
**Rama:** `codex/statsedge-ui-polish` @ `96bce7c`  
**Modelo:** Composer 2.5 High (o Terra)  
**Origen:** plan datos #4 · smoke-review-chart-paint · `docs/ux-errores-datos` #6 (store)  
**Nota:** Chart Review ya pinta; la ficha sigue mostrando `–` mudo en RS / RS país / RS tema. El motivo ya viaja en `title` vía `canonicalRs` / `countryRs` / `themeRs` — falta copy visible honesto.

## Prompt para Agent chat (copiar tal cual)

```
@docs/tickets/activo.md

Eres programación StatsEdge (NO orquestador). Rama: codex/statsedge-ui-polish @ 96bce7c.
Modelo: Composer 2.5 High (o Terra). SIN commit ni push.

Ticket REVIEW-RS-COPY-1 — copy honesto de RS en ficha Review (no guiones mudos).

Alcance:
1) En /review, métricas RS / RS país / RS tema: sustituir el `–`/`-` silencioso
   por copy que distinga al menos: cargando / sin ranking semanal /
   sin histórico RS / error (usar reasons de rsCanonical/countryRs/themeRs;
   no inventar motor nuevo).
2) Alinear tono con avisos ya honestos del chart («Sin línea RS: …»).
   Solo ficha Review (`app/review/page.jsx` + helpers de display si hace falta).
3) Tests focalizados de copy/ausencia; `./vfc` o vitest del ticket en verde.

No tocar: hydrate RS engine, Astra brief, scoring, auth, nocturno, mesa/Caza
(TABLE-QUIET-1 en tabla se queda), Europa.

Plantilla Resumen / Archivos / Tests / LO QUE NO VERIFIQUÉ. Sin commit ni push.
```

## Objetivo

En la ficha Review, cuando no hay número de RS (global / país / tema), el usuario debe **leer** por qué falta el dato — no un guion mudo que parece bug mientras el chart sí pinta.

## Contexto técnico

- `app/review/page.jsx` → `metricRows()`: si `!*.available` pinta `"-"` y mete `*.reason` solo en `title` (tooltip).
- Misma pantalla: cola lateral usa `"-"` en `<i>` para RS de fila.
- Lectores: `lib/rsCanonical.js` (`RS_NOT_RANKED_REASON`, `RS_NOT_HYDRATED_REASON`), `lib/countryRs.js`, `lib/themeRs.js`.
- Chart/ficha ya muestran avisos tipo «Sin línea RS: este valor no tiene histórico del ranking semanal» (smoke PASS chart paint @ store `internal/smoke-review-chart-paint.md`).
- Store UX: `docs/ux-errores-datos.md` #6 — «Chart OK; RS PAÍS / RS TEMA = –».
- **No confundir** con TABLE-QUIET-1 (guion quieto en *mesa* para ausencias esperadas VCP/RS tema): aquí es **Review ficha**, journey de decisión.

## Fuera de alcance

- Reconstruir hydrate RS / `themeRsHydrate` / nocturno  
- Astra brief / company-brief  
- Cambiar semántica de ranking o columnas de la mesa  
- Commit / push

## Done when

1. En Review, ausencia de RS muestra texto corto legible (no solo `–`/`-`), diferenciando loading vs sin ranking / sin histórico vs error cuando el reason lo permita.  
2. Con valor disponible, sigue el número (sin regresión visual grave).  
3. Tests del ticket + `./vfc` (o vitest focalizado) OK.  
4. Retorno con plantilla; **sin commit ni push**.

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
