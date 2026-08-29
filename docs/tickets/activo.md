# UX-FILTERS-5 — Impacto −N por familia (tarjeta + pie editor)

## Prompt para Agent chat / Cloud Agent (copiar tal cual)

```
@docs/tickets/activo.md

Rama base: codex/statsedge-ui-polish.
Modelo: Composer 2.5 · MED–HIGH.
Entorno: Cloud Agent OK (rama propia). No Browser Use (smoke = orquestador al volver).

UX-FILTERS-5: impacto −N / «sin recorte» por familia en LayerControl (tarjeta) y pie de FilterFamilyModal.
Pilotos: IPO + RS (mismo alcance que FILTERS-3/4). Reutilizar lógica de impact de chips/breakdown (lib/screenerFilterBreakdown.js u homólogo).
Presupuesto: no romper gesto <200 ms (P3/UX-11); preferir un pase O(n) cacheado/useMemo sobre analyzedRows, no recalcular por tecla.
Copy: «recorta −N» o «sin recorte»; apagada no inventa impacto falso.

Spec: docs/analisis-ux-filters-presentacion-2026-08-28.md §2 P6, §3.0, §5 FILTERS-5.
Copia: docs/tickets/UX-FILTERS-5-impacto-familia.md.
Tests + ./vfc con rutas reales. Plantilla de retorno.
Cloud: commit solo en la rama del agent; no merge a statsedge-ui-polish. Sin push a main.
```

---

**Rama base:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 · MED–HIGH  
**Prioridad:** P1 presentación filtros · **Tras:** FILTERS-4 (`48faa89`) · IPO-1c cerrado  
**Spec:** `docs/analisis-ux-filters-presentacion-2026-08-28.md` §2 P6, §3.0, §5  
**Cloud:** sí — sin smoke local; el orquestador verifica al volver

Copia: `docs/tickets/UX-FILTERS-5-impacto-familia.md`

## Problema

Las familias de ejecución no muestran cuánto recortan. Solo los chips de vista y «¿Qué recorta?» dan impacto. Una capa «encendida» con umbrales neutros parece igual que una que corta −800 (D8 / P6).

## Objetivo (pilotos IPO + RS)

1. **Tarjeta** (`LayerControl`): si la familia está activa y recorta → `recorta −N` (o `−N → M` si el diseño del wire §3.0 cabe sin ensuciar). Si activa y no recorta → `sin recorte` (gris). Si apagada → no fingir impacto de corte actual (p.ej. `apagada` / sin −N).
2. **Editor** (`FilterFamilyModal`): pie con el mismo impacto de la familia (agregado local), no solo el breakdown global.
3. **Cálculo:** reutilizar / extraer helper del breakdown de impacto existente; conteo sobre **lote cargado** (`analyzedRows` / filas del scan en vista), no universo teórico.
4. **Perf:** un memo por cambio de settings/capas/lote; objetivo no añadir longtasks al gesto de toggle/intensidad. Si el cálculo completo por familia es caro, calcular **solo pilotos IPO+RS** en este ticket.
5. Tests del helper (filas sintéticas: recorta / no recorta / capa off).

## Fuera

- FILTERS-6/7. Resto de familias. Cambiar semántica de filtros/scoring.
- Browser Use (orquestador). Supabase / nocturno.

## Verificación

```bash
npm test -- filterFamilyImpact screenerFilterBreakdown screenerFiltersView filterFamily
./vfc 'filterFamily|LayerControl|FilterFamilyModal|breakdown|impact'
```

## Retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin merge a codex/statsedge-ui-polish (cloud: solo rama del agent).
```
