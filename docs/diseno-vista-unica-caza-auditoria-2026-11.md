# Vista única de resultados: unir Caza y Auditoría

Estado: **propuesta para aprobar o recortar** (2026-11-11). No hay código escrito.
Origen: el dueño observó que ambos modos se solapan (conversación del 10-nov).

## 1. Qué hay hoy

`ResultPagerTable.jsx` alterna con un interruptor (`HuntTapeModeToggle`, persistido en
`localStorage` con `statsedge.screenerResultViewMode.v1`) entre dos presentaciones **de las mismas
filas ya filtradas y ordenadas**:

| | Cinta (Caza) | Tabla (Auditoría) |
|---|---|---|
| Columnas | Ticker, Tema, Semanal ~12M (minigráfico), Etapa, RS, VCP, Pivote·R, Máx 52s | Ticker, Tema, RS, RS país, Etapa, VCP, Rendimiento (periodo), Dist. máx 52s, Capitaliz. |
| Orden | Hereda el `sort`/`sortAsc` global; **sin cabeceras clicables** | Cabeceras clicables |
| Paginación | No (lista con scroll) | Sí (`RESULT_PAGE_SIZES`) |
| Extras | Teclado, panel lateral (peek), densidad, hidratación de gráficos por ventana visible | Selección de fila, selector de periodo de rendimiento |
| Valor por defecto | Si la ficha es del rail de caza | El resto |

Solapamiento: **6 de 8 columnas** de la cinta están también en la tabla (ticker, tema, etapa, RS,
VCP, máx 52s). Desde el 10-nov la huella VCP de ambas sale de la misma función.

Hecho que simplifica el diseño: el orden ya es estado global de `page.jsx` y la cinta ya pinta la
cola ordenada («Caza pinta `filtered`»). **Lo único que la cinta no hace es dejar al usuario
cambiar ese orden desde la propia lista.**

## 2. Propuesta

Una sola vista, la cinta, con cuatro añadidos y una retirada.

**Se añade a la cinta**
1. **Cabeceras clicables** en `huntTapeHead` (hoy `aria-hidden`): Ticker, Etapa, RS, VCP, Pivote·R,
   Máx 52s. Reutiliza `sort`/`sortAsc`/`onSortColumn` que ya existen. Es lo único de la tabla que
   no tiene sustituto.
2. **Rendimiento** como columna opcional con su selector de periodo (3M por defecto), porque el
   panel lateral ya lo muestra y el móvil también (`Rend. 3M`).
3. **Capitalización** en el panel lateral (ya está en la hoja móvil), no como columna.
4. **RS país**: no se migra. Con el universo mono-US vale lo mismo que el RS global (memoria
   `ficha-descriptiva-franja-2a`). Reaparecerá cuando haya mercados con benchmark propio.

**Se retira**
- `HuntTapeModeToggle` y la clave `statsedge.screenerResultViewMode.v1` (un valor guardado queda
  inerte, igual que se hizo con el modo Diario/Expert en `screenerChromeMode.js`).
- La rama de tabla y la paginación de `ResultPagerTable.jsx`.
- Las bifurcaciones `isCazaResultView(...)` de `app/page.jsx` (≈3 sitios): el plan de hidratación
  pasa a ser siempre el de ventana visible.
- `CompactResultsTable` y sus columnas exclusivas, **si** nada más las usa (comprobar antes:
  `lib/screenerTable.jsx`, Listas, ficha).

**Nombre**: «Ver auditoría» (enlace al panel de laboratorio en `ScreenerShell.jsx`) pasa a
«Ver diagnóstico del filtro» para que «auditoría» deje de significar dos cosas.

## 3. Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| La lista larga sin paginar penaliza el rendimiento | La cinta ya es una lista con ventana (`HUNT_TAPE_DESKTOP_1080_LIST_HEIGHT_PX`) e hidrata gráficos solo para lo visible. Medir con el escaneo de 3.510 filas antes de retirar la tabla. |
| Pérdida de la comparación densa «tipo Excel» | Densidad `compact` de la cinta; si tras uso real se echa en falta, reintroducir columnas opcionales, no un segundo modo. |
| Tests que fijan la tabla | `tests/tableQuiet1.test.js`, `screenerHuntTape.test.js`, `screenerMobileTape.test.js`: se migran, no se borran. Suite completa antes y después. |
| Orden por columnas que la cinta no pinta (p. ej. capitalización) | Cabecera solo para columnas visibles; el resto, desde el selector de orden existente. |
| Usuarios con el modo Auditoría guardado | Clave inerte; entran en la cinta sin error. |

## 4. Plan en pasos (cada uno comiteable y reversible)

1. Cabeceras clicables en la cinta + test (cambio de interfaz visible, aditivo).
2. Columna Rendimiento opcional + selector.
3. Medición de rendimiento con 3.510 filas (sin cambiar nada más).
4. Retirar interruptor, rama de tabla y paginación; migrar tests.
5. Limpieza de `CompactResultsTable` si queda huérfano; renombrar el enlace de diagnóstico.

El paso 1 es independiente y útil aunque se decida no seguir.

## 5. Decisiones que necesita el dueño

- ¿Aprobar el rumbo (cinta única) o prefiere conservar la tabla como vista secundaria?
- ¿Rendimiento como columna visible por defecto o solo bajo demanda?
- ¿Renombrar «Ver auditoría» a «Ver diagnóstico del filtro»?
