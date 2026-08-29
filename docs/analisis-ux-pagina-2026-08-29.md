# Revisión página — post UX-21 (2026-08-29)

**Rama:** `codex/statsedge-ui-polish`  
**URL:** `http://localhost:3000` (+ `/stock/AAPL`)  
**Método:** Browser Use CDP · desktop ~1633×865  
**Contexto:** oleada P2 UX-18…21 cerrada; P1 UX-10…17 ya hechos en backlog.

---

## Veredicto

La mesa US sigue **usable y honesta** (verdad `3318 analizadas · N pasan · en lista · 50/página`, sort por cabeceras, sin «Ordenar:» desktop). No hay P0 de datos mentirosos en esta pasada.

Lo que más duele ahora **no es P2 copy**, sino **densidad / doble árbol móvil-desktop** y **fricciones residuales de chart + rail**. Conviene una oleada corta de higiene + 1–2 tickets de producto, no otra pasada de 12 hallazgos iguales al 28-ago.

---

## Matriz de zonas

| Zona | Estado | Notas |
|---|---|---|
| Chrome superior | OK / ruido | Nav densa; badge cobertura/ranking presente |
| Rail fichas | **Sospechoso** | 1 cambio a Líderes E2 OK (~64 ms). Cambios posteriores a Deterioro/pivot/IPO/intl **no actualizaron** la verdad en automatización (timeout ~3,4 s). Revalidar a mano o con hard-reload aislado antes de ticketizar. |
| Línea de verdad | OK | Copy UX-20 correcto bajo Deterioro/RS |
| Filter bar | Deuda estética | Solo «Resolución» + «FILTRO» en texto; DOM aún monta selects de vista (país/tema/…) — OK si van en disclosure; vigilar altura/scroll |
| Tabla | OK / ruido | Sort RS por cabecera OK. **7 info-hints «i»** en cabecera → ruido visual |
| Árbol móvil en desktop | Técnico | `.mobileResearchHome` `display:none`; select «Orden movil» 0×0. Correcto visualmente; **doble UI en DOM** (también 3M/6M/12M y resolución duplicados a 0×0) |
| Storage banner | OK | No visible (UX-19) |
| `/stock/AAPL` chart | OK residual | Canvas 1306×572. Chevrons/zoom **enabled**. «Restaurar rango» disabled hasta gesto manual (esperado post CHART-NAV). Rangos 1D/5D/1M disabled (dato). Toolbar muy densa (rango + TF + escala + RS + nav) |
| CSS muerto | Técnico | `.resultSortSelect` aún en `styles/screener.css` tras UX-21 |

---

## Hallazgos nuevos (candidatos)

| ID | P | Área | Evidencia | Ticket tentativo |
|---|---|---|---|---|
| R-01 | — | Rail · cambio ficha | **False positive** en tab limpia: Deterioro→E2→pivot→intl→IPO→Deterioro OK (0,6–2 s). | — |
| R-01b | P1 | Verdad · pasan vs en lista | Tras salto de ficha: `1045 pasan «Deterioro» · 290 en lista` / `290 pasan · 488 en lista` — pass eager vs `useDeferredValue` en lista. | **UX-22** |
| R-02 | P2 | Tabla · info noise | 7× `.infoHint` en `thead`; cada cabecera lleva «i» + tooltip largo | **UX-23** — Info solo en columnas no obvias o popover único |
| R-03 | P3 | CSS hygiene | Reglas `.resultSortSelect` huérfanas | **CLEAN-1** — Purga CSS select orden |
| R-04 | P3 | Dual render | Mobile home + selects pager/period duplicados en DOM desktop | **CLEAN-2** — No montar árbol móvil si `min-width` desktop (o viceversa) |
| R-05 | P2 | Chart · densidad | Fila de controles: rangos + temporalidades + Precio/Log/%/RS + 6 iconos nav; «Auto» disabled | **CHART-UI-1** — Agrupar TF/rango; no es bug funcional |
| R-06 | P2 | Chart · cold hunt | Residual documentado: cambio ficha frío ~1–2 s (warm UX-11 OK) | Medir de nuevo tras confirmar R-01 |

### Cerrado / no reabrir (review 28-ago)

H-01…H-12 / UX-10…21 — tratados en backlog. No re-listar salvo regresión.

---

## LO QUE NO CERRÉ EN ESTA PASADA

- Repro fiable de R-01 con hard-reload limpio y `:3300`.
- Móvil 390 (UX-18 ya smokeado; no re-corrido).
- Mercados stale CTA (UX-14 hecho; no re-probado).
- Revisar toolbar (UX-12); el botón «Revisar» medido estaba a 0×0 (duplicado oculto) — el visible no se clicó con éxito.
- Auth / scoring / nocturno.

---

## Recomendación de cola

1. **UX-22** (verdad pasan/lista en transición hunt) — activo.  
2. Luego CLEAN-1 / UX-23 según prioridad.  
3. No abrir oleada grande hasta cerrar UX-22.
