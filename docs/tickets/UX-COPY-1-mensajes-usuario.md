# UX-COPY-1 — Mensajes de producto (no de desarrollador)

**Prioridad:** P0 usuario  
**Rama:** `codex/statsedge-ui-polish`  
**Relacionado:** `tests/detallesInternosFuera.test.js`, `lib/serviceErrors.js`, `lib/snapshotFreshness.js`

## Problema

Tras la oleada CLEANUP-shadow, los banners y `setStatus` siguen sonando a **notas para quien mantiene el código**: contratos de versión, proyecciones, materialización, presets, restauración, etc. El usuario de trading no debería leer jerga de implementación ni explicaciones largas tipo IA.

**Regla:** si un mensaje explica *cómo está hecho* el sistema, no va en pantalla. Solo *qué le pasa a sus datos* y *qué puede hacer*.

## Alcance (sí)

1. **Banners** (`snapshotNotice` → `ScreenerShell`): textos en `lib/snapshotFreshness.js`, `lib/screenerFilterLayers.js` (`buildFilterLayersUpgradeNotice`), avisos de auth (`buildCloudAuthRequiredNotice`).
2. **Barra de estado** (`setStatus` en `app/page.jsx`): frases que mencionen «capas del preset», «copia en la nube», «filtros guardados en la nube», etc. — acortar y orientar a acción.
3. **Panel cobertura global** (`GlobalCoveragePanel.jsx`): etiquetas tipo «Inventario sin materializar», «Proveedor parcial» → lenguaje de mesa de trabajo.
4. **Tests:** ampliar `tests/detallesInternosFuera.test.js` con lista de **palabras prohibidas en UI** (no solo Supabase): p. ej. `contrato`, `v3`, `proyección`, `materializar`, `hydrate`, `preset` (en mensajes al usuario; los nombres de preset en chips «Líderes estrictos» están bien), `localStorage`, `restauración`, `audítalas`.
5. Actualizar expectativas en tests que asserten copy literal (`snapshotFreshness.test.js`, `screenerFilterLayers.test.js` si aplica).

## Fuera de alcance (no)

- Renombrar presets de producto («Balanceado», «Líderes estrictos»).
- Comentarios de código ni `docs/` (salvo este ticket).
- Cambiar lógica de caché, auth o filtros — solo strings visibles.
- Traducir inglés estructural del chart/ficha (otro ticket).

## Inventario inicial (corregir o sustituir)

| Ubicación | Actual (resumen) | Dirección |
|-----------|------------------|-----------|
| `screenerFilterLayers.js` | «contrato de capas antiguo (antes de v3)» | «Esta sesión guardó un formato antiguo de filtros. Revisa «Más filtros».» |
| `snapshotFreshness.js` | «Datos cacheados» | «Datos de ayer» o «Sin actualizar hoy» |
| `snapshotFreshness.js` | «proyección de decisión parcial; audítalas» | «Algunas filas tienen datos incompletos; revísalas antes de decidir.» |
| `snapshotFreshness.js` | «límite de tamaño de la restauración» | «solo se cargó parte del universo en este dispositivo» |
| `snapshotFreshness.js` | «actualización en segundo plano» | «la última sincronización» |
| `page.jsx` | «Capas del preset aplicadas» | «Filtros del modo aplicados» o eliminar si redundante |
| `page.jsx` | «copia en la nube no está activada» | «sincronización con tu cuenta no está disponible» |
| `GlobalCoveragePanel.jsx` | «Inventario sin materializar» | «Datos de este mercado aún no están listos» |

## Criterios de aceptación

1. `./vfc` o al menos `npm test -- tests/detallesInternosFuera.test.js tests/snapshotFreshness.test.js` en verde.
2. Nuevo test (o bloque en `detallesInternosFuera`) que falle si reaparecen cadenas de la lista prohibida en `app/` + `lib/` (mismo patrón que test Supabase; exentar comentarios y `console.*`).
3. Copy en **español**, frases cortas (banner ≤ 2 oraciones), tono informativo no alarmista salvo auth/sesión caducada.
4. Sin commit ni push (orquestador verifica y comitea).

## Verificación (agente programación)

- Leer banners en código; no hace falta Browser Use si los tests cubren los strings.
- Opcional: una captura mental de arranque con sesión vieja (aviso filtros) y stale cache.

## Plantilla de retorno

```
## Resumen
(bullets)

## Archivos
(lista)

## Tests
(comando + resultado)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```
