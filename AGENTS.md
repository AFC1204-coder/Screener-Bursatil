# StatsEdge — Contexto para Claude Code

Este archivo se carga automáticamente en cada sesión de Claude Code sobre
este repo. Complementa (no sustituye) `AGENTS.md`, que Codex lee para
gobernanza técnica y restricciones de diseño. Este archivo cubre el
*proceso* de verificación y delegación — la disciplina que ha demostrado
evitar pérdidas de trabajo y aceptación de reportes fabricados.

## Regla dura #1 — Nunca aceptar un autorreporte sin evidencia cruda

Antes de dar por bueno CUALQUIER entregable (tuyo o de un modelo
delegado vía ZCode: GLM-5.2, MiniMax, etc.), verifica tú mismo contra el
filesystem/git real:

- `git diff <archivo>` — no la descripción del diff, el diff real.
- `ls`/`cat` del archivo de test/código que se dice haber creado.
- Ejecución real de la suite de tests, no el resumen de otro modelo.

Motivo documentado: GLM-5.2 ha mostrado dos modos de fallo reales en
este proyecto — (1) pérdida de trabajo propio no comiteado por ejecutar
`git stash pop`/`git rm` sin verificar origen, (2) fabricación completa
de un reporte de auditoría (diff + test + confirmación de cumplimiento)
que no existía en el filesystem real, con el mismo formato usado para
verificar honestidad. Ambos casos solo se detectaron pidiendo `git diff`
real, nunca aceptando el texto del reporte.

## Regla dura #2 — Verificación visual real antes de comitear cambios estructurales

Cambios estructurales o de alto riesgo visual (JSX nuevo, componentes
nuevos, lógica de posicionamiento/interacción del chart) requieren
verificación con hard-reload en navegador real antes de commit. "Los
tests pasan" no es suficiente — el historial de este proyecto tiene
múltiples casos de bugs de runtime invisibles a Vitest (loops
infinitos, APIs inválidas de librerías, builds cacheados) que solo
aparecieron con verificación real.

En Cursor esa verificación la hace el **agente** (orquestador o
programación bajo su gate), preferiblemente en instancia aislada
(`:3300` / scratchpad; ver memoria Claude
`verificacion-navegador-aislada`). No bloquear al dueño para un smoke
de UI. Detalle del ciclo de tickets, commits y backlog:
`.cursor/rules/orquestacion-statsedge.mdc` y `docs/backlog-activo.md`.

## Política de commits

- Cambios estructurales/alto riesgo: verificar y comitear uno por uno.
- Cambios mecánicos/bajo riesgo (tokens CSS, rename, limpieza): agrupar
  en un commit con una única verificación final.
- Checkpoint = seguridad: comitear antes de encadenar más cambios sobre
  el mismo archivo.

## Fricciones de terminal conocidas (zsh/git)

- `git config --global core.pager cat` — evita que `git log`/`git diff`
  con output largo bloqueen la terminal esperando `q`.
- Rutas con corchetes (`app/stock/[symbol]/...`) necesitan comillas en
  zsh o se interpretan como glob.

## Jerarquía de modelos para delegación (vía ZCode/API externa)

Estos modelos NO son subagentes nativos de Claude Code — se invocan
manualmente vía ZCode (GLM, MiniMax) o Codex/API (GPT-5.6, Fable). No
existe (todavía, a confirmar con soporte de ZCode) una vía sancionada
para invocarlos de forma headless/programática desde aquí sin salir del
Coding Plan.

| Rol | Modelo primario | Fallback |
|---|---|---|
| Mecánico puro, sin decisiones | MiniMax M2.7 High Speed | GPT-5.6 Luna |
| Ejecución con decisión menor | GLM-5.2 | GPT-5.6 Terra |
| Contexto amplio / multi-archivo | MiniMax M3 | GPT-5.6 Terra (cautela) |
| Juicio arquitectónico real | Fable 5 (o Opus 4.8) | GPT-5.6 Sol |
| Reward-hacking vigilance / agéntico terminal | GPT-5.6 Sol | — |

Sol tiene la tasa de reward-hacking más alta detectada en benchmarks
públicos (METR). GLM-5.2 ha mostrado en este proyecto un patrón similar
(ver Regla dura #1). Escrutinio extra para ambos.

## Estado conocido de fragmentación de ramas (revisar antes de fusionar cualquier refactor grande)

A fecha de la última sesión de verificación:
- `codex/statsedge-ui-polish` — rama de trabajo principal.
- `codex/scan-integrity-result-sets` — worktree temporal para Hito
  1B-1/1B-3 (scan integrity), en `/private/tmp/`.
- `refactor/chart-controller-extraction` / `review/chart-controller-step7-colorfix`
  — refactor de 10 pasos del chart, verificado con E2E real, pero SIN
  FUSIONAR a la rama principal desde `661aab5`. Diverge en ambas
  direcciones (~16 commits solo ahí, ~15 solo en la rama principal).
  Antes de fusionar: confirmar que el guard de `dataQuality`/`estimated`
  (renombrado a `localQuality` en esa rama) sigue intacto, y reaplicar
  cualquier fix de integridad de datos hecho en la rama principal
  después de la bifurcación (ej. el fix de `mergeChartHistory` del
  23-24 jul 2026, commit `b8b73f3`, que esa rama NO tiene).

Antes de tocar cualquiera de estas ramas, corre:
```
git --no-pager log --oneline <rama_A>..<rama_B> | wc -l
git --no-pager log --oneline <rama_B>..<rama_A> | wc -l
```
para confirmar el tamaño real de la divergencia antes de asumir que un
merge es trivial.

## Entorno PostgreSQL efímero para tests de integración

Suite: `npm run test:integration:ephemeral` (worktree
`codex/scan-integrity-result-sets`, harness
`tests/integration/_ephemeralPostgresHarness.mjs`). El harness solo valida
variables de entorno — nunca crea, limpia ni provisiona bases de datos.

- Variables obligatorias:
  - `STATSEDGE_EPHEMERAL_POSTGRES=1`
  - `STATSEDGE_EPHEMERAL_POSTGRES_URL="postgresql://127.0.0.1:5432/statsedge_ephemeral_{suite}"`
    — el token `{suite}` va **literal**, con llaves, en el nombre de la
    base; el harness lo sustituye por el slug de cada test suite.
- El host debe ser `127.0.0.1`, `::1`, o un socket local explícito.
  `localhost` **no vale** (SAFETY ABORT).
- El harness aborta si la base destino no está vacía, y no la limpia al
  terminar. Por eso una segunda corrida consecutiva siempre falla si las
  bases no se recrean vacías antes.
- Son exactamente 11 bases físicas, una por test suite (inventario en
  `EPHEMERAL_DATABASE_INVENTORY` dentro del harness).
- Para recrearlas vacías antes de cada corrida:
  `bash scripts/reset-ephemeral-db.sh` (dropdb/createdb con guardrail: solo
  toca bases con prefijo `statsedge_ephemeral_`), o directamente
  `npm run test:integration:ephemeral:reset`, que encadena el reset y la
  suite.

## Contexto de negocio (resumen)

StatsEdge — screener de stage analysis (Weinstein/Minervini/O'Neil)
para mercados US/Europa/Japón/Hong Kong/Canadá/Australia. SaaS de
nicho, solo developer, pre-monetización. Stack: Next.js, Supabase Pro,
lightweight-charts v5, Vercel. Repo:
`github.com/AFC1204-coder/Screener-Bursatil`.

Hub de contexto extendido (decisiones de negocio, fiscal, distribución):
Notion, página `39e715ed-d69c-8117-8aa1-e41a4381b47b`.

## Gobernanza de este archivo

- AGENTS.md es la fuente única. Cualquier regla nueva va aquí, nunca en
  CLAUDE.md.
- AGENTS.md debe estar siempre trackeado y comiteado. Estuvo sin versionar
  y se perdió sin dejar rastro en el historial de git.
- Si algún día conviene separar lo específico de Claude Code (permisos,
  hooks, idioma), hacerlo de forma explícita y documentarlo aquí, no por
  acumulación silenciosa.

## Definición del universo de mercado

El universo se construye a partir de NasdaqTrader, HKEX, TWSE, J-Quants,
ASIC y ESMA/FIRDS, más listas curadas fijas (`lib/universes.js`),
orquestado por `lib/universeEngine.js`.

Existe un diseño alternativo basado en el catálogo de Twelve Data
(definición por `mic_code`, exclusión de OTC, lista blanca de mercados),
analizado el 27 de julio de 2026 y **aplazado**: el proveedor no está
contratado y no se contratará hasta que el producto esté próximo al
lanzamiento. Ver `docs/adr-universo-twelve-data.md`.

No asumas que ese diseño está implementado: no lo está.
