# F-A4 — investigación de evidencia inconclusa (sesión 2026-07-24)

> Estado: nota de investigación, no ADR ni decisión. No autoriza runs,
> push, deploy ni escrituras en Supabase. Registra lo que se verificó
> y, con la misma explicitud, lo que **no** se pudo confirmar.

## 1. Punto de partida

En el filesystem existen, sin comitear (`?? ` en `git status` a fecha
de esta sesión), dos capturas:

- `docs/evidence-f-a4-2026-07-16-run-failed.png`
- `docs/evidence-f-a4-2026-07-16-run-failed-terminal.png`

El nombre de archivo sugiere un run real de F-A4 (§9/§11 de
[adr-discovery-global-curated.md](adr-discovery-global-curated.md))
ejecutado el 2026-07-16 y fallido. Esta sesión existe para verificar
esa hipótesis contra el contenido real de las capturas y contra el
diff real de los commits que la siguen esa misma noche, en vez de
aceptar el nombre del archivo como prueba.

## 2. Lo que se verificó directamente

- **Contenido de ambas capturas** (leídas con OCR/visión directa, no
  asumido por el nombre): ambas son screenshots de navegador de la
  vista "Global Leaders" de StatsEdge, mismo scan
  (`16/7/2026 13:43:16`, 7 resultados idénticos: AAPL, UNH, BAC, KO,
  JNJ, EOG, GE). La única diferencia entre ambas es el estado del
  panel "Descubrimiento global curado": una muestra
  `"Cargando candidatas curadas..."`, la otra
  `"MUESTRA PARCIAL · 0 CANDIDATAS"` con el texto explícito de la UI
  *"no implica un fallo del sistema"*.
- **Ninguna de las dos capturas contiene** un mensaje de error, código
  HTTP, stack trace, ni el campo `phase`/`error` que devuelve la ruta
  `/api/jobs/scan-refresh` en caso de fallo real. No hay terminal
  visible en ninguna de las dos pese al sufijo `-terminal` en el
  nombre del archivo.
- **Diff real de `d3cac4c`** (`feat(scan): record refresh failure
  phase`, 16/7 22:18): añade tracking de `phase` (`cursor_read` →
  `provider_run_create` → `universe_select` → `materialized_scan` →
  `cursor_write` → `leaderboards_refresh`) al path de error de
  `/api/jobs/scan-refresh`, y test nuevo con errores de ejemplo
  (`"canceling statement due to statement timeout"`,
  `"benchmark cache timeout"`) — verificado que son valores de fixture
  del test nuevo, no errores extraídos de un log real.
- **Diff real de `9d8eb55`** (`fix(leaderboards): bound job refresh
  window`, 17/7 01:56): acota `refreshDefaultLeaderboards` a
  `{ sinceDays: 21, maxRows: 2000 }`, con tests de contrato nuevos.

## 3. Lo que NO se pudo confirmar

Explícito, sin forzar conclusión en ninguna dirección:

- **Las dos capturas NO confirman un run fallido de F-A4.** No
  contienen ningún error, `phase`, código HTTP ni indicio técnico de
  fallo. Muestran una secuencia de carga → estado vacío, que la propia
  UI declara que no equivale a un fallo.
- **Es igual de plausible que ambas capturas sean, en realidad,
  evidencia de F-A3** (disclosure UX del estado vacío, criterio de
  aceptación §10.6 del ADR: *"capturas antes y después del
  hard-reload"* incluyendo la pantalla de estado vacío) **mal
  etiquetada** con el sufijo `f-a4-...-run-failed` en vez de un nombre
  de F-A3. No hay ningún commit, nota o metadato en el repo que
  confirme para qué se tomaron estas capturas específicamente.
- **La relación entre las capturas y los commits `d3cac4c`/`9d8eb55`
  no está confirmada.** Coinciden en la misma noche (capturas ~21:03,
  commits 22:18 y 01:56 del día siguiente), pero coincidencia temporal
  no es evidencia causal. No hay un log de error real, ni una
  referencia cruzada en los mensajes de commit, que conecte estas
  capturas específicas con el trabajo de esos dos commits.
- Por tanto, tampoco se puede confirmar ni descartar que hubiera
  existido algún intento de run de F-A4 el 2026-07-16.

## 4. Lo único que sigue siendo un hecho verificado

Independientemente de todo lo anterior, **F-A4 sigue bloqueado hoy por
una condición estructural explícita del propio ADR**, no por ningún
hallazgo de esta investigación: `adr-discovery-global-curated.md` §9 y
§11 exigen autorización humana explícita, separada y registrada antes
de cualquier run real contra producción. No existe en este repo
ningún documento que registre esa autorización.

## 5. Siguiente paso, si se quiere cerrar la duda

Si en algún momento importa saber con certeza qué pasó el 16-07, haría
falta uno de: (a) un log real de `provider_runs` con `status=failed` y
su `phase`/`error` de esa fecha, o (b) que quien tomó las capturas
confirme su propósito original. Ninguno de los dos existe hoy en el
filesystem del repo.
