# UX-FILTERS — Spec rediseño de presentación y configuración de filtros

**Fecha:** 2026-08-28 · **Fase:** 0 (spec, sin código)
**Ticket:** `docs/tickets/UX-FILTERS-rediseno-presentacion.md`
**Relacionado:** IPO-1 (familia IPO como piloto), UX-15 (subsumido aquí), mesa de vistas (UX-5…9)
**Método:** inventario contra el repo real (rama `codex/statsedge-ui-polish`), sin smoke de navegador en esta fase.

---

## 1. Inventario actual — qué hay y dónde duele

### 1.1 Superficies

| Superficie | Código | Qué hace hoy |
|---|---|---|
| **Rail hunt** (5 fichas) | `app/components/screener/HuntCardRail.jsx` + `lib/screenerHuntCards.js` | Cada ficha aplica un preset interno completo (`balanced`, `nearPivot`, `weakness`, `intl`, `ipo`) + sort por defecto. Auto-switch a `intl` sin US. |
| **Sidebar · capas** | `FilterArchitecturePanel` (`lib/screenerFiltersView.jsx:320`) dentro de «Configuración avanzada» | 13 capas en dos bloques (Núcleo: liquidez, tendencia, momentum, RS, cercanía, volatilidad, scores, cobertura; Adicionales: estructura, volumen+, rent/riesgo, short, IPO) + Régimen. Cada fila = `LayerControl`: toggle ✓/X + InfoHint + botón «Ajustar». |
| **Sidebar · condiciones y ajustes finos** | `ScreenerShell.jsx:457-495` | Controles semanales de etapa, 4 switches (`requireStage2`, `requirePulso`, `requireUpVolume`, `requireRecentIpo`) y «Ajustes finos (N/M)»: los 14 `FILTER_GROUPS` con ~66 campos numéricos con mini-toggle por regla. |
| **Modal de familia** | `FilterFamilyModal` (`lib/screenerFiltersView.jsx:171`) | Cabecera (título + intro fija de `FILTER_FAMILY_PRESETS`), power toggle Activa/Apagada, rail «Exigencia» (3-4 acciones por familia), switches dependientes, «Ajustes finos» de la familia. |
| **Chips de vista** | `ResultFilterChips` + «+ Filtro» en `ResultFilterBar.jsx` | Filtros de vista (país, tema, sector, fuerza sector, IPO categoría, resolución): no recortan el conjunto que pasa, solo lo visible. Chips con impacto −N y «Limpiar vista». |
| **«¿Qué recorta?»** | `buildScreenerFilterBreakdown` + `<details>` bajo la línea de verdad (`ScreenerShell.jsx:540`) | «Ficha X deja N de M» + principal corte + enlace «Ver auditoría» (embudo `FilterDiagnosticsPanel`). |

### 1.2 Modelo de datos subyacente (lo que la presentación tiene que reflejar)

- **Preset** (`SCREENER_FILTER_PRESETS`): ~60 claves de umbral + `setupMode` + `filterStrictness`. Es lo que aplica una ficha hunt de golpe.
- **Capas** (`EXECUTION_LAYERS`, contrato v2): interruptor por familia; apagarla neutraliza sus campos vía `effectiveSettingsFromLayers` y puede degradar `setupMode` (avisos P5 en `layerToggleImpact`).
- **Reglas de campo** (`fieldRules`): mini-toggle por umbral individual; «quitada» conserva el valor.
- **Acciones de familia** (`FILTER_FAMILY_PRESETS[x].actions`): botones que escriben un lote de settings (y a veces `filterLayers` y `setupMode`) de una vez.
- **Vista** (`VIEW_LAYERS` + chips): plano separado que no toca el conjunto que pasa.

### 1.3 Dónde duele

**D1 — Tres taxonomías para la misma cosa.** `EXECUTION_LAYERS` (capas, con label corto: «Volumen+»), `FILTER_GROUPS` (grupos de ajustes finos: «Volumen objetivo»), `FILTER_FAMILY_PRESETS` (familias del modal: «Volumen objetivo» otra vez pero con intro distinta). No mapean 1:1: «Ratings proxy» reparte sus dos campos entre `volumeSurge` y `score`; «Deterioro técnico» vive dentro de `score`; `minRiskScore` pertenece a dos capas a la vez (`proximity` + `score`). El usuario ve tres nombres y tres recuentos para el mismo concepto según dónde mire.

**D2 — Toggle y editor mezclados (UX-15 / H-06).** En `LayerControl` el botón grande es el toggle y «Ajustar» está pegado; en el modal el power toggle preside la toolbar. El gesto de «quiero ver qué hace esta familia» está a un click de «acabo de apagarla» (✓→X «Quitado») sin fricción ni undo.

**D3 — Acciones de exigencia con umbrales invisibles.** «Top RS», «Contracción progresiva», «IPO real»… escriben 5-10 settings que el usuario no ve hasta abrir «Ajustes finos». Algunas además cambian `setupMode` o apagan la capa (`filterLayers: { pattern: false }` en «Sin estructura»). El botón parece un preset de intensidad y en realidad es un mini-preset opaco.

**D4 — El mismo umbral se toca desde tres sitios sin jerarquía.** Modal de familia, «Ajustes finos» del sidebar y acciones/presets escriben las mismas claves. No hay indicación de cuál fue la última mano ni de si el valor actual viene del preset, de una acción o de un ajuste manual (el contador «Avanzado · N cambios» agrega, pero no localiza).

**D5 — Copy por familia hardcodeado y frágil.** La intro de cada familia es un string fijo. RS se corrigió en UX-10; el patrón sigue siendo «un string por familia que se desactualiza en silencio». IPO dice «Nuevos líderes, edad máxima y setup IPO» cuando el dato que filtra (`ipoDate`) está poblado ≈0 filas.

**D6 — Dato ausente no declarado en el punto de decisión.** IPO es el extremo: `requireRecentIpo` + dato vacío = 0 resultados permanentes, y la familia no lo dice (el usuario lo descubre en la tabla vacía). Mismo patrón latente en short interest (proveedor parcial), RS intl («Sin dato» ~47% incluso en US, UX-13) y fundamentales intl. La regla se ofrece como si el dato existiera siempre.

**D7 — La ficha hunt es una caja negra honesta solo a posteriori.** «¿Qué recorta?» y la auditoría explican el resultado, pero antes de pulsar la ficha no hay forma de saber qué puertas aplica ni en qué modo (`filterStrictness` es una clave enterrada del preset: `weakness` es strict, `intl`/`broad` discovery, el resto balanced). Umbral oculto en preset vs regla explícita en modal: dos lenguajes para lo mismo.

**D8 — «Encendida» no significa «recorta».** Una capa activa con valores neutros (999/0) no filtra nada, y una apagada conserva valores agresivos que reaparecen al encenderla. El toggle comunica estado administrativo, no impacto. El único impacto visible por opción está en los chips de vista (−N), no en las familias de ejecución, que son las que de verdad recortan.

---

## 2. Principios

**P1 — Toggle de capa ≠ editor de reglas.** Son dos gestos con costes distintos: apagar una familia cambia el resultado; abrirla para mirar no debe poder cambiarlo. Separación física (el área clicable de «abrir» no contiene el toggle) y semántica (abrir nunca muta estado; todo cambio dentro del editor es explícito). Cierra UX-15 por diseño, no por parche.

**P2 — Ninguna acción escribe umbrales invisibles.** Toda acción de exigencia («Top RS», «IPO temprano»…) muestra las reglas que va a fijar antes o en el momento de aplicarlas: la acción es un atajo hacia reglas visibles, no un sustituto. Corolario: una acción no toca nada fuera de su familia (ni `setupMode` ni otras capas) sin declararlo en el propio control.

**P3 — Discovery vs strict es un modo declarado por ficha, no una clave enterrada.** Cada ficha hunt (y cada familia dentro de ella) declara su postura: *discovery* = puertas mínimas (liquidez de supervivencia + el dato definitorio de la ficha), todo lo demás columna informativa; *strict* = lista enumerada de umbrales, visible antes de aplicar. El preset `ipo` actual viola esto (preset institucional vendido como radar); IPO-1b lo corrige con `ipoDiscovery` bajo este principio.

**P4 — La ausencia de dato se declara donde se decide, no donde se sufre.** Cada familia muestra la cobertura del dato que filtra sobre el lote cargado («ipoDate: 12 de 3321 filas»). Activar una regla cuyo dato falta en la mayoría del lote produce un aviso en la propia familia, con el criterio ya fijado en el producto: regla activa + dato ausente = no pasa, y eso hay que decirlo antes, no después de la tabla vacía.

**P5 — Una taxonomía, una fuente.** Familia = capa = grupo de ajustes finos. Una sola estructura de datos define key, nombre, intro, campos, dato de cobertura y acciones; `EXECUTION_LAYERS`, `FILTER_GROUPS` y `FILTER_FAMILY_PRESETS` derivan de ella o desaparecen. Los casos ambiguos se resuelven de una vez: los ratings proxy y `minRiskScore`/`minVolumeScore` viven en UNA familia (la doble pertenencia de capas es deuda del contrato, no un feature).

**P6 — El impacto N/M acompaña al control.** Igual que los chips de vista muestran −N, cada familia muestra cuánto recorta sobre el lote cargado, en el sidebar y en el editor. «Encendida sin recorte» y «encendida y recorta −812» son estados visualmente distintos (resuelve D8). El desglose «¿Qué recorta?» pasa de ser la única ventana a ser el agregado de lo que cada familia ya dice.

**P7 — No romper lo guardado.** Sesión, plantillas y presets hunt sobreviven al rediseño sin pérdida de intención del usuario (detalle en §4). El precedente del contrato v2 (descartar estado indistinguible) solo se repite si el significado del estado cambia de verdad.

---

## 3. Wire mínimo

### 3.0 Patrón común (tarjeta de familia + editor)

**Tarjeta en sidebar** (sustituye a `LayerControl`):

```
┌────────────────────────────────────────────────┐
│ [⏻] IPO                     recorta −3321 → 0  │   ⏻ = toggle aislado (izda)
│     edad ≤ 60m · IPO real requerida            │   resumen de reglas ACTIVAS, generado
│     ⚠ ipoDate presente en 12/3321 filas        │   aviso de cobertura solo si aplica
│                                    [Abrir ▸]   │   abrir ≠ toggle, área separada
└────────────────────────────────────────────────┘
```

- El resumen de reglas se genera de las reglas activas con valor no neutro (no un string fijo → mata D5).
- «recorta −N» se calcula sobre el lote cargado (mismo mecanismo que impact de chips / breakdown → P6). Si la familia no recorta: «sin recorte» en gris.
- Estado apagado: tarjeta atenuada, resumen conserva los valores («apagada · conserva edad ≤ 60m»).

**Editor de familia** (evoluciona `FilterFamilyModal`):

```
┌──────────────────────────────────────────────────────┐
│ IPO                                        [Cerrar ×] │
│ Cobertura del dato: ipoDate en 12/3321 filas del lote │
│                                                       │
│ Modo:  ( Discovery )  ( Estricto )      [⏻ familia]   │
│                                                       │
│ REGLAS                        valor      impacto      │
│ [✓] Edad IPO máxima           60 m       −3309        │
│ [✓] IPO real requerida        sí         (dato: 12)   │
│ ─ informativas en discovery ─                         │
│ [ ] Perf 3M mínima            10 %       apagada      │
│                                                       │
│ Esta familia deja 0 de 3321 · principal corte: edad   │
└──────────────────────────────────────────────────────┘
```

- **Modo** sustituye al rail «Exigencia»: elegir modo enseña el diff de reglas que va a fijar (P2) y lo aplica solo al confirmar. Las acciones actuales de `FILTER_FAMILY_PRESETS` se convierten en definiciones de modo (2 por familia: discovery/estricto; una tercera «personalizado» aparece sola cuando el usuario toca algo).
- El pie es el «¿Qué recorta?» local de la familia, en vivo.
- El power toggle vive en la esquina, lejos del modo y de las reglas (P1).

### 3.1 Familia IPO (piloto — alineada con IPO-1b/1d)

- **Discovery (default por decisión dueño 2026-08-28):** una sola puerta —edad ≤ 60-84 m— y el resto (perf, cap, cobertura) informativo. Cabecera de cobertura siempre visible mientras `ipoDate` esté infra-poblado.
- **Estricto:** el preset institucional actual, con sus umbrales enumerados como reglas visibles.
- **Empty state con motivo:** si 0 pasan y la causa dominante es dato ausente, el vacío lo dice («0 de 3321: solo 12 filas tienen fecha de salida») + CTA a `/ipo-radar` (vigiladas del dueño). Nunca más el vacío mudo actual.
- **Ficha hunt «Radar IPO»:** al pasar el ratón / en el panel de la ficha, declara «modo discovery · 1 puerta: edad» (P3). IPO-1b la re-apunta a `ipoDiscovery` sin tocar este wire.

### 3.2 Familia RS (densa)

- **Regla primaria:** RS global mínimo (ranking semanal, universo privado curado, USD+FX — copy heredado de UX-10/MET-1b, pero generado desde `rsEngines`/catálogo, no re-escrito a mano).
- **Auxiliares colapsadas:** bench, país, grupo, quality, fuerza grupo bajo un pliegue «Auxiliares (percentiles de lote / rankings parciales)» con su nota de alcance. Evita que 6 reglas del mismo peso visual escondan que solo una es canónica.
- **Cobertura:** «RS con dato en 25/47 del lote» arriba (conecta con UX-13: la sorpresa del 47% Sin dato se declara aquí, no solo en la columna).
- **Modos:** Discovery = RS global 0 (sin corte, columna informativa); Estricto = RS ≥ 75 + auxiliares según el modo actual «Top RS».

### 3.3 Familia Estructura (opcional)

- Representa a las familias «Adicionales» cuyo estado natural es *no recortar*: por defecto activa con valores neutros → la tarjeta muestra «sin recorte» (no «Activa», que hoy sugiere que hace algo — D8).
- **Modos:** Discovery = sin reglas efectivas (equivale al «Sin estructura» actual pero sin apagar la capa: mismo resultado, estado más honesto); Estricto = «Contracción progresiva» con sus 9 umbrales enumerados. «Base en vigilancia» y «Base estrecha» sobreviven como variantes del modo estricto si caben, o se retiran a plantillas.
- Nota de honestidad en cabecera (hereda la actual): «la app mide evidencia; no etiqueta recomendaciones» + límite conocido del detector (memoria contracciones: el detector producto no está calibrado; el copy no debe prometer VCP).

---

## 4. Migración — sesión, localStorage y compatibilidad

Estado persistido afectado (`statsedge.screenerSession.v1`, `SCREENER_SESSION_VERSION = 4`; plantillas `screenerFilterTemplates`; config en nube vía `templateApplication`):

| Dato guardado | Cambia con el rediseño | Estrategia |
|---|---|---|
| `settings` (umbrales) | No cambian de clave ni de semántica | Se conservan tal cual. **No subir `SCREENER_SESSION_VERSION`** por presentación. |
| `filterLayers` + `filterLayersVersion` (contrato v2) | Las claves de capa se conservan (la taxonomía única P5 adopta las 13 keys existentes como canónicas) | `restoreFilterLayers` intacto. Solo si P5 obliga a fusionar/renombrar una capa (p. ej. resolver `minRiskScore` en una sola familia) → contrato **v3 con mapeo explícito** (v2→v3 es derivable: no hay ambigüedad como en v1→v2, así que se migra, no se descarta). |
| `fieldRules` | Sin cambio de claves | Se conservan. |
| **Modo por familia (nuevo)** | Campo nuevo (`familyModes` o equivalente) | **Derivable, no exigible:** al restaurar una sesión sin él, se infiere comparando `settings` contra las definiciones de modo (coincide con discovery → discovery; con estricto → estricto; resto → personalizado). Nunca bloquea el restore. |
| Presets hunt (`HUNT_CARDS` → presetKey) | `ipo` → `ipoDiscovery` en IPO-1b | El rediseño no toca los presetKeys. Sesiones con `presetKey: "ipo"` siguen resolviendo (el preset no se borra); la ficha del rail apunta al nuevo. `resolveActiveHuntCard`/auto-switch intl sin cambios. |
| Plantillas guardadas / nube | Mismo shape | Pasan por el mismo `restoreFilterLayers` + inferencia de modo que la sesión. |
| Presupuesto localStorage | Sin filas nuevas; solo escalares | Sin impacto en `STORAGE_BUDGETS`. |

Reglas duras de la migración:

1. Ninguna sesión v4 válida hoy puede quedar en peor estado tras el rediseño (mismos resultados con los mismos criterios).
2. La inferencia de modo es cosmética: si se infiere mal, el usuario ve «personalizado», nunca un cambio de resultados.
3. Tests de contrato: restore de sesión pre-rediseño → mismos `activeSettings` efectivos; plantilla guardada pre-rediseño → ídem; `scripts/filter-layer-contract-audit.mjs` sigue pasando.

---

## 5. Tickets de implementación sugeridos

Orden pensado para que IPO-1d pueda montarse sobre 1-3 sin esperar al resto.

| ID | Qué | Depende de | Riesgo |
|---|---|---|---|
| **UX-FILTERS-1** | Separar toggle de abrir/editar: nueva tarjeta de familia en sidebar (`LayerControl` → tarjeta P1) y power toggle aislado en el editor. **Absorbe y cierra UX-15.** | — | Bajo (presentación pura) |
| **UX-FILTERS-2** | Taxonomía única de familias: una estructura fuente (key, label, intro-generada, fields, dato de cobertura, modos); `EXECUTION_LAYERS`/`FILTER_GROUPS`/`FILTER_FAMILY_PRESETS` derivan de ella. Resolver dobles pertenencias (`minRiskScore`, ratings proxy, deterioro). | — | Medio; si renombra capas → contrato v3 con mapeo (§4) |
| **UX-FILTERS-3** | Editor de familia con modo Discovery/Estricto y reglas visibles (diff antes de aplicar); resumen de reglas activas generado en la tarjeta. Pilotos: **IPO y RS**. | 1, 2 | Medio |
| **UX-FILTERS-4** | Cobertura de dato por familia («dato en N/M del lote») + aviso al activar regla sobre dato mayoritariamente ausente + empty state con motivo dominante. | 2 | Medio (necesita conteo por métrica en el lote) |
| **UX-FILTERS-5** | Impacto −N por familia (tarjeta y pie del editor), reutilizando el cálculo de impact de chips/breakdown. Vigilar coste: mismo presupuesto <200 ms del gesto (UX-11/P3). | 1, 2 | Medio-alto (perf) |
| **UX-FILTERS-6** | Ficha hunt declara modo y puertas (panel «qué aplica esta ficha» con enlace a sus familias); `filterStrictness` visible como atributo de la ficha. | 3 | Bajo |
| **UX-FILTERS-7** | Migración y compat: inferencia de modo al restaurar, tests de restore sesión/plantillas pre-rediseño, contrato de capas (v3 solo si 2 lo exige). | 2, 3 | Bajo si 2 no renombra; medio si sí |

**Relación con IPO-1:** IPO-1d = aplicar UX-FILTERS-3 + 4 a la familia IPO con los datos de IPO-1a y el preset de IPO-1b. Gate del ticket madre: no ship de la UI final de IPO-1b sin este wire acordado.

**Fuera de alcance (confirmado del ticket):** semántica de scoring/nocturno, indicadores nuevos (VCP track aparte), filtros de vista (mesa de vistas ya cerrada en UX-7/8).

---

## LO QUE NO VERIFIQUÉ (fase 0)

- No hay smoke visual: el inventario es de código, no de píxeles; los textos citados de UI se contrastaron con `docs/analisis-ux-screener-review-2026-08-28.md` (Browser Use del mismo día), no con el navegador ahora.
- El coste real de calcular impacto −N por familia sobre 3321 filas (UX-FILTERS-5) no está medido; el presupuesto <200 ms es una restricción heredada de P3/UX-11, no una medición nueva.
- La población real de `ipoDate` (≈0 filas) viene del diagnóstico de IPO-1, no re-verificada contra Supabase en esta sesión.
