# MOBILE-FIRE-2 — Mesa usable en 390 (copy denso + fold bajo carga)

**Estado:** Cerrado 2026-09-02 (verify orquestador)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Prioridad:** fuego UI · móvil sigue lejos de app usable; MIGRATE mañana  
**Depende de:** MOBILE-FIRE-1 cerrado (`15843af`)

## Evidencia post FIRE-1 (orquestador)

390×844 en `:3310`: `firstInFold: true` con `firstTop≈668`, `bottomNav` 82px.  
Aun así la mesa **no se siente app**: con «Actualizando mesa» abierto el detalle sigue siendo `Cargando datos de la selección (AT+AU+BE+…)` multilínea; la verdad pinta `mesa: AU+CA+CH+…` interminable; el status «Cargando materializados (Estados Unidos + España +…)» ocupa el fold.

## Objetivo

En ≤760 (smoke **390×844**), los avisos/status/verdad de **mercados múltiples** caben en **una línea de peek** (o copy corto con N mercados). La lista sigue en fold **también con el aviso de carga abierto** (o al menos `firstTop` claramente mejor que ~668 bajo la misma sesión multi-mercado).

## Alcance

1. **`buildMarketsLoadingNotice`** (`lib/marketAvailability.js`): si selección > 2–3 mercados → copy tipo `Cargando 28 mercados…` (no volcar `AT+AU+BE+…` en el detail/peek). Expandido (`<details open>`) puede listar códigos en el body, no en el summary.
2. **Línea de verdad en móvil:** variante compacta de segmentos de mercado (p. ej. `28 mercados en mesa` / `selección ≠ mesa`) vía flag o helper en `buildScreenerTruthLine` / `buildScreenerTruthMarketSegments` — **sin mentir** números de analizadas/pasan/lista.
3. **Status bar móvil** (`scanStatusBar--mobileFold`): una línea con ellipsis; no apilar nombres largos de 28 países en el fold.
4. **CSS peek** `.screenerMobileNoticePeek`: `line-clamp: 1` (o equivalente) para que un detail abierto no reventar el layout.
5. Opcional si cabe sin rediseño: **sticky** `.mobileResultListHead` al scrollear la lista.

## Fuera de alcance

- MIGRATE, auth, nocturno, VCP, scoring.
- Rediseño hunt rail / fichas.
- Ficha `/stock` móvil (siguiente oleada si hace falta).
- Cambiar semántica UX-NAC-3 (sigue auto-cargando; solo copy/densidad).

## Aceptación

```text
390×844, sesión multi-mercado (≥10 seleccionados), scrollY≈0:
- detail/peek de «Actualizando mesa» sin cadena join de ≥10 códigos en el summary
- firstInFold true con ese details open (preferible) O firstTop ≤ 520 si el open es inevitable
- overflow-x: no
- desktop ≥760: copy largo puede quedarse; no romper dual-DOM CLEAN-2
```

Tests: unitarios de `buildMarketsLoadingNotice` / truth segments compactos + `screenerViewportMount` si aplica.  
Smoke CDP documentado. Sin commit ni push.
