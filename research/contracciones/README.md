# Contracciones — prototipo y corpus

Trabajo de investigación del detector de contracciones de volatilidad, agosto de
2026. **Nada de esto es código de producto**: el detector que corre en el
producto sigue siendo `lib/setupPatterns.js`, sin tocar.

Vive aquí, y no en el scratchpad de una sesión, porque el scratchpad se pierde
al cerrar la sesión y los documentos cuentan los resultados pero no permiten
reproducirlos.

## Qué hay

```
detector/
  v4.mjs              prototipo principal — el que mejor reproduce las lecturas del dueño
  v5.mjs              v4 + zona de salida de v3. 14/21 frente a 15/21, pero el
                      único caso que cambia (IP) lo rechaza por la razón correcta
  v6.mjs              v4 + monotonía relajada (R5). Mismo 15/21 y las mismas
                      fechas; en el universo marca 8 más, y esos 8 rinden 8 pts
                      por debajo del universo. Implementada y APAGADA
  v7.mjs              v4 + episodios (cierre por fallo de ruptura / reexpansión +
                      re-ancla post-fallo). Arnés sep-2026: 11/13 recall primary,
                      VLO vcp2 match; misma especificidad NO que v4 (6/10)

arneses/
  v4-test.mjs         v4 contra los 9 casos de la tanda 1
  v5-test.mjs         v4 y v5 contra los 21 casos, solo el sí/no
  medicion-corpus.mjs v4/v5 contra los 21 comparando también LAS FECHAS   <- el principal
  reglas-simulacion.mjs   qué cambiaría cada regla candidata, sobre lo ya detectado
  reglas-universo.mjs     qué cortarían esas reglas sobre los 37 marcados del universo
  estabilidad-ventana.mjs ¿cambia la lectura al mover el lookback? (respuesta: casi nunca)
  inspect.mjs         resumen semanal de un símbolo, para mirar los datos crudos
  monotonia-test.mjs      v4 frente a v6 sobre los 21, comparando también fechas
  monotonia-universo.mjs  v4 frente a v6 sobre los 400: qué añade y qué quita
  monotonia-adelante.mjs  prueba hacia delante: ¿vale algo lo que v6 añade?
  corpus-test.mjs     v4/v5 contra el corpus antiguo (docs/methodology/vcp-corpus.json)
  v4-universo.mjs     corrida sobre la muestra aleatoria de 400 valores
  fractal.mjs         ¿cambia lo detectado al mover la ventana? (respuesta: casi nada)
  fractal2.mjs        ¿y al escalar TODOS los parámetros? (respuesta: sí)
  peso-escala.mjs     prueba hacia delante por escala, con horizonte proporcional
  classify.mjs        clasificador con el detector de PRODUCCIÓN, por puertas
  build-charts.mjs    páginas de etiquetado (log por defecto, ventana v4, lectura breve)
  chart-brief.mjs     texto colaborativo por símbolo (stageDisplay + Pre-fuga/Con fuga, pullbacks)
  etapa-codigo-vs-candidato.mjs  VCP-0: weeklyStage vs techo/ruptura/HH-HL (read-only)
  rubric-gap.mjs      VCP-2/3: gap mecánico corpus + tanda3 vs v4/v5/v7/prod + etapa
  aapl-check.mjs      demuestra que la base de AAPL es una barra corrupta

resultados/
  muestra400.txt      la muestra aleatoria (semilla 'seed2026'), para reproducir
  universo-v4.json    veredicto de v4 sobre los 400
  fractal.json        experimento de ventanas
  fractal2.json       experimento de escalas
  medicion-v4-corpus.json  la medición con fechas, caso por caso (medicion-corpus.mjs)
  rubric-gap-YYYY-MM-DD.json  gap mecánico v4/v5/v7/prod + etapa (rubric-gap.mjs)

tanda3-gap-casos.json   HPE/VLO para rubric-gap (hasta cierre de tanda 3)
  monotonia-universo.json  v4 frente a v6 sobre los 400

corpus-manual.json    LOS 21 CASOS ETIQUETADOS A MANO, con fechas y profundidades
                      verificadas contra daily_bars. Es el activo real de todo esto.
```

## Cómo ejecutar

Desde la raíz del repo (el loader resuelve `@/` contra `process.cwd()`):

```bash
node --env-file=.env.local --loader ./scripts/loader.mjs \
  research/contracciones/arneses/v5-test.mjs

node --env-file=.env.local --loader ./scripts/loader.mjs \
  research/contracciones/arneses/rubric-gap.mjs
```

Todos los arneses son de **solo lectura** sobre `daily_bars`. Ninguno escribe en
Supabase ni ejecuta escaneos.

## Estado, a 2026-08-21

| | |
|---|---|
| Casos etiquetados a mano | **21** (9 + 12, los 12 a ciegas) |
| v4 contra esos 21, sí/no | **15/21** · 4 falsos positivos · 2 falsos negativos |
| v4 contra esos 21, **sí/no y estructura** | **7/21** — ocho aciertos son de veredicto pero con las fechas en otro sitio |
| Precisión sobre lo que enseñaría | **5 de 8 (62,5%)** en la corrida ciega |
| Cobertura | **9,3%** del universo líquido |

**No está listo para el producto.** A esa precisión, una de cada tres que se
mostrara no sería base.

## Lo que sí está resuelto y no depende de ajuste fino

1. **El filtro de contexto** — media de 30 semanas con pendiente > 0. Separa los
   dos únicos casos que perdieron dinero (ICE, ORCL) de todo lo demás. Viene de
   Weinstein, no de ajustar sobre la muestra.
2. **El ancla es el máximo más alto**, no el primero que pasa el umbral. Sin eso
   el detector anclaba dos meses antes que el dueño.
3. **La primera contracción se mide en ATR**, no en porcentaje. Lo decidió KO.
4. **Dos contracciones bastan** — la taza con asa las tiene por definición.
5. **La puerta del volumen sobra**: activarla quitaba tres positivos y ningún
   negativo.
6. **Quitar `lower_low_drift` cuesta cero falsos positivos** sobre el corpus
   antiguo, una vez los datos están limpios.

## Lo que falta, y por qué no se ha implementado

Seis reglas del dueño que son **conceptos, no umbrales**, con uno o dos ejemplos
cada una. Están enumeradas en `corpus-manual.json` → `reglasPendientes`:
lateral perpetuo, jerarquía/anidamiento, calidad del trazo, el *cheat* como
patrón, tolerancia a la no-monotonía, y la reconfiguración.

De ellas, la única lista para implementar es **R2 (anidamiento)**: sale de dos
casos etiquetados, está escrita como regla y **reduce** falsos positivos en vez
de multiplicarlos.

A esas seis, la medición con fechas del 21 de agosto añade dos que sí tienen
evidencia y no dependen de un umbral fino —**R7**, la primera contracción tiene
que ser un proceso y no un desplome de una sesión, y **R8**, la base no puede
saltarse su propio suelo— y deja constancia de que **R1 y R3 siguen sin medida
después de probar siete candidatas**. Está todo en
`docs/medicion-detector-v4-corpus-2026-08-21.md`.

## Documentos relacionados

- `docs/medicion-detector-v4-corpus-2026-08-21.md` — la medición con fechas, las
  reglas candidatas y las etiquetas que hay que revisar
- `docs/diseno-contracciones-v4-2026-08-18.md` — dónde termina la base, y la
  revisión del corpus antiguo
- `docs/temporalidad-contracciones-2026-08-21.md` — fractalidad, escalas y peso
- `docs/diseno-contracciones-v3-2026-08-18.md` — de dónde vienen la zona de
  salida y la regla profundidad-tiempo
- `~/Desktop/etiquetado-bases/` — gráficos, plantillas y `hallazgos.md` (el
  cuaderno narrado de las dos tandas)

## Aviso sobre los datos

Quedan **8 barras mensuales residuales** en AAPL, JPM, MSFT, TXN y WELL, por
debajo del umbral de la limpieza del 20 de agosto. `aapl-check.mjs` demuestra
que producen bases falsas: la de AAPL@2026-06-01 desaparece al quitar una sola
barra. Cualquier medición sobre esos cinco símbolos es sospechosa mientras
sigan ahí.

También hay barras en días de mercado cerrado (festivos de EE.UU.) en ~27-29
símbolos; PLTR tenía tres.
