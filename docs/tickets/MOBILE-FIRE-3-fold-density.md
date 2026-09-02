# MOBILE-FIRE-3 — Densidad del fold 390 (firstTop ≤520)

**Estado:** Cerrado 2026-09-02 (verify orquestador · firstTop≈463)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Prioridad:** fuego UI · móvil aún no “app” · Mini mañana  
**Depende de:** MOBILE-FIRE-1 `15843af` · MOBILE-FIRE-2 `a7d14df`

## Evidencia post FIRE-2 (orquestador)

390×844 con carga abierta: copy ya corto (`Cargando 28 mercados…`), pero **`firstTop≈660`**. Sigue empujando la lista:

- Peek «Fusión parcial» con lista larga `Falta materializado: Austria · …` (aunque `line-clamp:1`, el bloque sigue ahí).
- Verdad con tres segmentos de mercado (`17 en mesa · 28 en selección · selección ≠ mesa`) + badge ranking.
- `HuntCardModeStrip` + toolbar resultados + periodo debajo del rail.

## Objetivo

En **390×844**, con avisos de fusión/carga en estado típico (fusión colapsada, carga abierta o ambos colapsados), **`firstTop` del primer `/stock/` ≤ 520** y `firstInFold: true`. Sin overflow-x. Dual-DOM desktop intacto.

## Alcance

1. **Fusión parcial / snapshot notices en móvil:** `peekDetail` corto (`Faltan N mercados` / una línea); detalle largo solo en `bodyDetail` al expandir. Donde el notice se construye en `page.jsx` (`mergedNotice`) o al renderizar en `ScreenerShell`, pasar peeks compactos en viewport móvil.
2. **Verdad móvil más corta:** con `compactMarketSegments`, no repetir conteos redundantes (p. ej. si ya hay `selección ≠ mesa`, omitir el segmento «N en selección» o fundir en una sola frase). Mantener analizadas / pasan / en lista.
3. **Chrome opcional ≤480:** ocultar o colapsar `HuntCardModeStrip` en móvil estrecho (el rail de fichas basta); o reducir su altura de forma clara.
4. **CSS:** asegurar peeks/notices no reservan más de ~1–2 líneas cerrados; truth `line-clamp` 2 en ≤480 si hace falta sin cortar números clave en el primer renglón.

## Fuera de alcance

- MIGRATE, VCP, auth, nocturno, `/stock` móvil.
- Rediseño del hunt rail de fichas (solo ModeStrip / densidad).
- Cambiar lógica UX-NAC-3 de auto-carga.

## Aceptación

```text
390×844, scrollY≈0, sesión multi-mercado:
- peek fusión (cerrada) sin enumerar países en summary
- firstTop ≤ 520 (medir CDP)
- firstInFold true
- overflow-x no
- 1280: mobileHome off, tabla OK, bottomNav none
```

Tests: peeks/truth compactos + viewport mount. Smoke CDP `:3310`. Sin commit ni push.
