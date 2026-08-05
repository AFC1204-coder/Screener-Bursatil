# Índice y auditoría cruzada de la sesión del 2026-08-04

Este índice ordena los seis documentos por cronología y separa mediciones,
modelos derivados y extrapolaciones no verificadas. Cuando una cifra local y
una de producción miden cosas distintas, no se elige una por apariencia: se
conserva cada una solo dentro de su alcance metodológico.

## Estado de cada documento

| Orden | Documento | Qué responde | Estado de sus conclusiones |
|---|---|---|---|
| 1 | [`universo-efectivo-2026-08-04.md`](universo-efectivo-2026-08-04.md) | Explica por qué el cron materializa lotes de 12-24, cómo rota el cursor y qué leen UI/leaderboards. | **Parcialmente vigente.** La arquitectura, los límites configurados y los cálculos por mercado siguen en pie. Quedan corregidos el total 8.998, la etiqueta 4,58 s/símbolo y el techo puntual de 26. |
| 2 | [`universo-relevante-2026-08-04.md`](universo-relevante-2026-08-04.md) | Estima cuántos símbolos sobreviven higiene/tendencia y cuánto tardaría un ciclo parcial. | **Parcialmente vigente.** 11.123 es el total correcto y ~880 sigue siendo solo un estimado central de “cientos a ~1.000”. Las noches y la frescura basadas en 26 exactos pasan a rangos. |
| 3 | [`escaneo-github-actions-2026-08-04.md`](escaneo-github-actions-2026-08-04.md) | Comprueba si el pipeline puede ejecutarse fuera de Next/Vercel y bosqueja estrategias de Actions. | **Diseño técnico vigente; dimensionamiento superado.** Imports, variables, cursor e idempotencia siguen siendo útiles. Toda la tabla de minutos de la sección 9 usa 4,58 como coste marginal y no dimensiona producción correctamente. |
| 4 | [`bench-concurrencia-2026-08-04.md`](bench-concurrencia-2026-08-04.md) | Mide descargas de barras Yahoo con concurrencia 2/4/6/8 en ráfagas de 30. | **Benchmark válido solo para descarga breve.** Sus 150 descargas y rendimientos medidos siguen en pie; no siguen en pie 23,1 s/4m52s, la capacidad de 659.405 ni “una corrida basta” como conclusiones del ciclo completo. |
| 5 | [`bench-analyze-2026-08-04.md`](bench-analyze-2026-08-04.md) | Mide localmente `runMaterializedScan` sin caché ni escrituras sobre 30 símbolos US. | **Benchmark local válido; dimensionamiento de producción superado.** 10,50-22,62 símb/s describe ese camino feliz. No demuestra 8m12s, 390.950 símbolos, 270 min/mes ni una sola corrida en producción. |
| 6 | [`limites-cron-2026-08-04.md`](limites-cron-2026-08-04.md) | Cruza 18 corridas terminadas de producción con el bench y separa overhead fijo de coste marginal. | **Referencia metodológica posterior.** Sustenta 2,118 s/símbolo wall-clock y el modelo ≈33,7 s + 0,535 s·N para lotes observados. No valida una extrapolación sostenida a 11.123 ni identifica cuánto pesa cada fase del overhead. |

## Tabla cruzada de cifras repetidas

“Buena” significa la versión mejor sustentada por estos documentos, no una
certeza fuera del alcance medido.

| Magnitud | Documentos y valores | Relación | Versión buena / justificación |
|---|---|---|---|
| Universo elegible total | D1: ≈8.998. D2-D6: 11.123. | **Contradicción directa.** | **11.123 (BUENA).** D2 vuelve a sumar con Python los mismos 23 `universeTotal`; D1 declara 8.998 como suma, pero esa suma es aritméticamente errónea. |
| US+HK | D1: 8.637 de 8.998. D2: 8.637, 77,6% de 11.123. | El absoluto coincide; contradicen el denominador y el porcentaje implícito. | **8.637 y 77,6% (BUENA).** La corrección del total cambia solo la proporción. |
| US+HK+AU | D2: 9.303 y 83,6%; D6 reutiliza 11.123 como universo total y el grupo como dominante, sin corregir esos absolutos. | Compatible. | **9.303 y 83,6%**, dentro del snapshot contado por D2. |
| Candidatos plausibles | D2: central ≈880, rango “cientos a ~1.000”. D3-D6 reutilizan ~880. | Coinciden, pero no son verificaciones independientes. | **Cientos a ~1.000; ≈880 solo estimado central.** Sale de dos pass-rates pequeños y no aleatorios; no existe conteo directo. |
| Tamaño configurado del lote nocturno | D1: 12-24. D2: usa ese contexto. D6: 12-24 y tabla exacta 12/24/21/24/20/24/24. | Coinciden. | **12-24 (BUENA como configuración/observación actual)**, no como capacidad física máxima. |
| Cadencia y rotación | D1-D2: 1 invocación/día, 7 grupos, cada grupo cada 7 días. D3 y D6 parten de la misma configuración. | Coinciden. | **1/día y rotación de 7 días (BUENA para el repo auditado).** |
| `maxDuration` del cron | D1-D3 y D6: 60 s. | Coinciden. | **60 s (BUENA como configuración del endpoint).** La causa exacta de las corridas huérfanas no está confirmada por logs. |
| Concurrencia de producción | D1/D3/D6: default 2, techo del cron 3; endpoint manual techo 4. D4-D5 prueban localmente 2/4/6/8. | No hay contradicción: configuración real y niveles de benchmark son ámbitos distintos. | **2 actual y techo 3 en cron; techo 4 manual.** 6/8 solo están medidos en scripts locales, no en el cron real. |
| “≈4,58 s/símbolo” | D1: promedio de 7 corridas y rango 3,46-8,24. D2 lo hereda al justificar ~26. D3 lo usa como base de costes. D5 intenta contradecirlo con 44 ms. D6 recalcula su fórmula. | **Contradicción de etiqueta/metodología.** | **No es wall-clock por símbolo.** Es `duración × concurrencia ÷ N`, es decir, segundos-trabajador/símbolo. D6 obtiene **2,118 s/símbolo wall-clock** sobre 18 corridas. |
| Modelo temporal de producción | D1-D3 tratan el coste como proporcional. D5 propone ~44 ms/símbolo local. D6: 2,118 s/símbolo promedio simple y regresión ≈33,7 s fijos + 0,535 s·N. | **Contradicción.** | **D6 es la mejor versión para los lotes observados.** La regresión separa overhead fijo y marginal; tiene confianza media y no está validada para miles de símbolos. |
| Símbolos por invocación a concurrencia 2 | D1-D2: ≈26. D6: 22 por promedio ingenuo o 26 por modelo con overhead. | Coinciden en orden de magnitud, no como punto exacto. | **22-26 (BUENA como rango derivado actual).** 26 sobrevivió por cancelación algebraica, no porque 4,58 fuese wall-clock correcto. |
| Noches para ~880 con una invocación dedicada | D2: 34. D6: 34 a 26/noche o 40 a 22/noche. | D2 da una sola cota como si fuera punto. | **34-40 noches**, bajo la simplificación irreal de dedicar cada noche entera a universo nuevo. |
| Frescura de ~880 frente a 5 días | D2: 85,3% del ciclo por encima de 5 días y N≤130 para ciclo ≤5 noches. D6 corrige capacidad a 22-26/noche. | El input de D2 pasa de punto a rango. | **85,3%-87,5%; N≤110-130.** Son cálculos de modelo, no edades observadas. |
| Cobertura de US al ritmo real por mercado | D1: 10.266 noches ≈28,1 años por `perMarket:4`; D2 resume “28 años”. D6: 428-506 noches para 11.123 bajo una invocación global idealizada. | Parecen chocar, pero responden a supuestos distintos. | **No se sustituyen.** 28,1 años aplica al cursor US real que recibe 4 símbolos cada 7 noches; 428-506 aplica a una invocación nocturna hipotéticamente dedicada a cualquier símbolo nuevo. |
| Protocolo de benchmarks locales | D4-D5: 30 símbolos US; concurrencias 2/4/6/8; caché desactivada; máximo 8. | Coinciden. | **BUENO para describir el experimento**, no carga sostenida ni mercados no-US. |
| Volumen de los benchmarks | D4: 5×30 = 150 descargas de barras. D5: 4×30 = 120 ejecuciones de símbolo y declara 270 acumuladas al sumar D4. | La suma aritmética coincide, pero mezcla operaciones distintas. | **150 intentos de chart en D4 y 120 símbolos de pipeline en D5.** “270 peticiones” no debe leerse como 270 solicitudes HTTP homogéneas: D5 también pide perfil por símbolo. |
| Separación entre corridas | D4: espera de 60 s. D5: protocolo de 30 s, pero no pudo ejecutar `sleep`; timestamps 14:19:56→14:20:36→14:20:47→14:20:56 (40/11/9 s entre arranques). | Protocolos distintos; D5 no cumplió una pausa uniforme de 30 s. | **No hay una única cifra buena.** D4 documenta 60 s; D5 documenta intervalos reales desiguales, relevantes al comparar riesgo de rate limit. |
| Descarga a concurrencia 8 | D4: 35,17 y 41,15 símb/s; promedio 38,16. D5 repite 38,16 para comparar. | Coinciden. | **38,16 símb/s (BUENA solo para las dos ráfagas de descarga).** No es rendimiento del escaneo completo. |
| Ciclo local sin escrituras | D5: c2 10,50 símb/s y 0,095 s/N; c8 22,62 símb/s y 0,044 s/N. D6 reutiliza 0,095, 0,044 y el escalado 2,15×. | Coinciden. | **BUENAS como mediciones locales de 30 símbolos US.** No incluyen selección real del universo, persistencia ni carga sostenida. |
| Errores 429 observados | D3: ninguno en muestras previas a c2. D4: 0 en 150 descargas. D5: 0 y total acumulado declarado de 270 análisis/descargas sin incidente. D6 cita 0 hasta c8 en ráfagas. | Coinciden dentro de muestras cortas. | **0 observado**, pero no demuestra una concurrencia segura sostenida ni una cuota de proveedor. |
| Tiempo para ~880 | D3: 33,6 min a c2 usando 4,58. D4: 23,1 s de solo descarga a c8. D5: 38,9 s del ciclo local sin escrituras a c8. D6: 34-40 noches bajo el cron actual. | **No comparables y reutilizados como si dimensionaran el mismo sistema.** | **No hay duración sostenida de producción decidible.** Cada valor conserva solo su escenario; ninguno prueba un job real de 880. |
| Tiempo para 11.123 | D3: 424,5 min a c2. D4: 4m52s de descarga a c8. D5: 8m12s local sin escrituras a c8. D6: no mide una corrida de ese tamaño; da 428-506 noches bajo invocaciones actuales idealizadas. | **Contradicción de alcance/metodología.** | **NO DECIDIBLE para un job sostenido.** D3 extiende overhead fijo como marginal; D4 omite casi todo el ciclo; D5 omite selección, persistencia y sostenimiento. |
| Capacidad en 6 h con 20% de margen | D4: ≈659.405 símbolos (descarga). D5: ≈390.950 (ciclo local sin escrituras). D3: concluye que 11.123 semanales a c2 tardan 7,07 h y no caben. | **Contradicción.** | **NO DECIDIBLE en producción.** Todas son extrapolaciones desde una base incompleta o mal modelada. |
| Minutos/mes | D3 c2: 1.838 semanal completo, 1.008 candidatos diarios, 425 priorizado; c10: 368/202/85. D5: ≈270 para universo completo diario a c8, excluyendo overhead y escrituras. | **Contradicción fuerte**, además con cadencias/concurrencias distintas. | **NO DECIDIBLE.** No existe medición end-to-end de un job de Actions; las cifras no deben presupuestarse. |
| Límites de planificación de Actions | D3-D5: 6 h/job y 2.000 min/mes; D4-D5 aplican margen del 20% (4,8 h). D6 usa 6 h solo como ventana estructural alternativa. | Coinciden como premisas, no como medición del repo. | **Premisas de diseño**, no evidencia de rendimiento ni verificación de la cuenta concreta. |
| Límite del endpoint manual | D1 y D6: default 40, máximo 200, `perMarket` default 10; D3 repite máximo 200 y concurrencia 4. | Coinciden. | **BUENO como lectura del código.** No demuestra que 200 termine dentro de la plataforma. |
| Corridas de cron completadas en la ventana | D2 dice “21 completadas”, pero su tabla suma 19 corridas. D6 enumera 18 completadas para timing y, por separado, 3 huérfanas. | **Contradicción interna y cruzada.** | **NO DECIDIBLE sin volver a consultar la fuente.** Los documentos no permiten saber si difieren por límite/ventana de consulta o por un error de conteo; sí permiten auditar literalmente 19 en la tabla de D2 y 18 filas en la tabla de D6. |

## CONCLUSIONES QUE SIGUEN ABIERTAS

- Duración end-to-end y minutos/mes de un job real de GitHub Actions para
  880 o 11.123 símbolos, incluyendo checkout/arranque, selección del
  universo, perfiles, fallbacks, persistencia y refresco de leaderboards.
- Comportamiento bajo carga sostenida, cuota real de Yahoo y fallbacks, y
  concurrencia segura por encima de 8. Los benchmarks solo cubren ráfagas de
  30 símbolos US.
- Cuántos candidatos hay realmente. ≈880 es una extrapolación desde muestras
  pequeñas, secuenciales y dominadas por mercados no representativos.
- Cuánto de los ≈33,7 s fijos corresponde a reconstrucción de universo,
  lectura de escaneos recientes, arranque en frío u otra fase; también falta
  el coste temporal real de las escrituras a Supabase.
- Si las tres corridas huérfanas fueron timeout de 60 s u otra muerte externa
  del proceso. Sin logs de Vercel no puede cerrarse.
- El número exacto de corridas completadas en la ventana (21 declarado/19
  tabuladas en D2 frente a 18 tabuladas para timing en D6).
- El límite efectivo por defecto del endpoint manual sin `maxDuration`, si
  `maxDuration=300` de la ruta UI se respeta en el plan citado y cuántas
  invocaciones de cron permite realmente esa cuenta.
- Cuánto ahorraría corregir la clave de caché del universo y la lectura de
  recientes; D6 identifica candidatos causales, pero no los instrumenta.
- Estado dinámico real de JP y composición exacta de la ventana de discovery;
  ambos quedaron como inferencias en D1-D2.
- Diseño final de particionado/reanudación en Actions y si conserva el cursor
  actual o usa particiones estáticas.

## QUÉ NO CREERSE

- **“El universo elegible es ≈8.998”.** La suma correcta de los mismos 23
  mercados es 11.123.
- **“4,58 s/símbolo es el tiempo wall-clock real”.** Es
  duración×concurrencia÷símbolos: segundos-trabajador, no wall-clock.
- **“El análisis tarda ~44 ms/símbolo en producción”.** Ese dato pertenece a
  30 símbolos US locales, sin selección real ni escrituras.
- **“11.123 símbolos tardan 4m52s”.** Es una extrapolación de descarga de
  barras, no del ciclo completo.
- **“11.123 símbolos tardan 8m12s y cuestan 270 min/mes”.** Extrapola un
  benchmark local breve y excluye fases reales; no está verificado.
- **“El universo semanal tarda 7,07 h y 1.838 min/mes”.** Trata el promedio
  con overhead fijo como coste marginal y tampoco está verificado a escala.
- **“En 6 h caben 659.405 o 390.950 símbolos”.** Son capacidades lineales de
  benchmarks distintos, no capacidad end-to-end de producción.
- **“Una sola corrida basta”.** Ninguno de los documentos ejecutó de punta a
  punta 880 ni 11.123 símbolos en el entorno objetivo.
- **“26 símbolos/invocación es una medición exacta”.** La evidencia posterior
  solo sostiene un rango derivado de 22-26 a concurrencia 2.
- **“~880 candidatos se cubren exactamente en 34 noches y el 85,3% queda
  viejo”.** Con la capacidad corregida son rangos de 34-40 noches y
  85,3%-87,5%, todavía bajo una simplificación que ignora la rotación real.
- **“Concurrencia 10 es segura”.** D3 la usa solo como hipótesis; nunca se
  midió. Incluso concurrencia 8 solo se probó en ráfagas locales cortas.
- **“Hubo exactamente 21 corridas completadas”.** El propio D2 tabula 19 y D6
  tabula 18 para su muestra; el conteo exacto queda abierto.
