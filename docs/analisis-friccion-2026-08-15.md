# Análisis de fricción de uso — 2026-08-15

Base: `codex/statsedge-ui-polish` @ `c13b8d7` (HEAD tras los fixes de persistencia y ficha).
Solo análisis; ningún cambio de código. No redescubre lo ya diagnosticado (gráfico 14-08,
interfaz 14-08, filtros 15-08, ficha 15-08): cuando un hallazgo previo aparece en el camino,
se cita y se sigue. El objeto es otro: **qué hace incómodo, lento o dudoso el uso repetido**.

## Método

- Instancia aislada: árbol de `c13b8d7` exportado con `git archive` al scratchpad,
  `node_modules` enlazado, servidor propio en **:3500** con `.env.local` filtrado (sin
  `CRON_SECRET`/`STATSEDGE_ACCESS_TOKEN`/`STATSEDGE_SESSION_SECRET` — modo abierto de dev).
  Cero scans ejecutados, cero escrituras en Supabase (solo la caché operativa que el propio
  servidor escribe al navegar, como en uso normal). El servidor (PID 70453) se cerró por PID
  exacto al terminar; la copia de trabajo y ~1,9 GB de copias de sesiones anteriores quedaron
  borradas del scratchpad.
- Recorrido como usuario, con `localStorage` limpio de partida: cuatro sesiones simuladas
  completas (sábado semanal, cinco valores en veinte minutos, guardar criterio, móvil en el
  sofá), midiendo pasos, esperas y estado con la API de rendimiento del navegador y sondas
  DOM. Capturas con la pestaña visible; cuando el panel quedó oculto (deja de repintar), las
  verificaciones sensibles a píxeles se repitieron contra el DOM y las capturas se retomaron
  al volver a ser visible — el mismo protocolo que los análisis previos.
- Móvil verificado a **390×844** con el modo móvil del panel (tap targets, overflow y orden
  medidos por DOM; gestos táctiles reales no emulables — ver LO QUE NO HE VERIFICADO).
- Los tiempos absolutos son de `next dev` local: sirven como cota de forma (dónde espera el
  usuario y qué le dice la pantalla), no como latencia de producción. Se señala en cada caso.

Etiquetas: **[MEDIDO]** cifra tomada en vivo; **[REPRODUCIDO]** visto en el navegador;
**[CÓDIGO]** afirmación con cita; **[INFERIDO]** mecanismo derivado sin traza completa.

---

# PARTE A — Cuatro sesiones, contadas como fueron

## A1. «Es sábado, quiero ver qué ha cambiado esta semana»

**Lo que hice.** Abrir la aplicación en frío. Esperar. Leer la pantalla buscando algo que
respondiera «qué hay de nuevo». No encontrarlo. Ir a Listas. Tampoco. Ir a Research (el
nombre más prometedor). Encontrar una sección que dice «CAMBIOS» y no poder creérmela.

**El arranque.** ~20 segundos mirando «Cargando último snapshot guardado...» (el mismo texto
dos veces: banner de estado y cuerpo de tabla), sin barra de progreso, sin «qué» ni «cuánto
queda» [REPRODUCIDO]. Por debajo pasó algo peor que la espera: la primera petición a
`/api/scans` murió a los **9,5 s** con un 500 («[scans] error del proveedor: The operation
was aborted due to timeout») y un segundo intento la salvó a los **10,8 s** [MEDIDO en red y
log del servidor; el reintento puede ser el doble efecto de StrictMode en dev]. El usuario no
ve nada de esto: ni el fallo, ni el reintento. El día que el segundo intento también falle,
verá el mismo texto de carga sin final. Los ~20 s son de dev local; la estructura (una
petición grande, un timeout interno de ~9 s, sin progreso) es la de producción.
- Nota: cada arranque también dispara `/api/coverage` que aborta con `AbortError`
  [REPRODUCIDO, consola] — coste y ruido silenciosos en cada visita.

**El aterrizaje.** La tabla llega con tres franjas apiladas encima — «ESTADO · Último
snapshot de la nube cargado: 500 de 5838 acciones (parcial)», «SNAPSHOT INCOMPLETO — ...el
resto no se cargó por el límite de tamaño de la restauración», «MUESTRA PARCIAL · PERCENTIL
POR LOTE» — y la primera fila es BANL +2235,5% (el dato roto liderando, ya documentado en
filtros §5.2). Primer minuto del sábado: dos avisos de arquitectura, un desplegable de jerga
y una microcap rota en cabeza.

**La pregunta del sábado no tiene pantalla.** El screener no tiene concepto de «cambio»
(ninguna columna, filtro ni franja de novedades). Listas es el ranking de hoy, sin deltas
[REPRODUCIDO]. Research desk tiene «CAMBIOS DESDE SNAPSHOT ANTERIOR», que anuncia a la vez
«24 eventos visibles · **sin comparativo previo**» y «273 MEJORAS · 162 DETERIOROS · 172
ETAPA 2» — y los «eventos» son estados de hoy, no cambios: «Etapa 2 observada ·
Clasificacion semanal con medias 10W/30W» (sin tilde), «Base constructiva · 2 contracciones
útiles» [REPRODUCIDO]. Es la contradicción ya anotada el 14 (A6.3), pero vista desde el uso
pesa más que como inconsistencia: **el usuario semanal — el usuario objetivo declarado — no
tiene forma de saber qué cambió desde su última visita.** Su alternativa real es releerse
las listas de memoria. `scan_symbol_history` ya guarda los deltas nocturnos; ninguna
superficie los cuenta.

**Cuenta de la sesión**: 3 navegaciones, ~40 s de esperas, 0 respuestas. Donde perdería la
paciencia pagando 30 €/mes: al tercer sábado repitiendo este bucle. No hay nada que romper:
falta el producto para esta pregunta.

## A2. «Tengo veinte minutos, quiero revisar cinco valores concretos»

**Lo que hice.** Buscar NVDA, llegar a su ficha, anotar mi decisión, volver, intentar el
siguiente. El ciclo por valor resultó ser:

1. Clic en el buscador. 2. Escribir «NVDA». 3. **Enter — y Enter no lleva a la ficha**: el
buscador es un formulario cuyo submit ejecuta la búsqueda asistida
([ScreenerShell.jsx:486](app/components/screener/ScreenerShell.jsx:486) `onSubmit={runSearch}`),
que pinta la sugerencia/tarjeta. 4. Clic en la sugerencia «ACCIÓN · NVDA». 5. Se carga una
**tarjeta intermedia** («Vista rápida») con SCORE 69 · COMPOSITE 71 · RS 66 · RS BENCH 56 ·
A/D 66 · EPS PROXY 93 · BENCH SPY — seis métricas con nombres que la tabla de al lado no usa
[REPRODUCIDO]. 6. Localizar dentro el enlace «Ficha» (scroll). 7. Clic → **navegación de
página completa** (~1,4 s solo el documento [MEDIDO], porque el enlace de la tarjeta es un
`<a>` plano, no un Link). Total: **5-6 gestos y dos pantallas intermedias para llegar adonde
el usuario dijo desde el primer carácter que quería ir.** En Deepvue o TradingView, ticker +
Enter = valor abierto; aquí ningún gesto del buscador lleva directo a la ficha.

**En la ficha.** Los botones «Screener» y «Web oficial» existen (fix de hoy, verificado
[REPRODUCIDO]). Marqué «Vigilar»: funciona, persiste, y el chip aparece luego en la tarjeta
de búsqueda [REPRODUCIDO] — la decisión del usuario como memoria del producto es de lo mejor
del flujo. Pero para el **siguiente** valor no hay nada: la ficha no tiene buscador, y el
raíl Anterior/Siguiente no aparece si vienes de búsqueda o de un clic en fila (solo existe
con cola de Revisar [REPRODUCIDO con BANL desde la fila]). Siguiente valor = volver y repetir.

**La vuelta tiene dos velocidades y la visible es la lenta.** El botón «Screener» de la
ficha es `<a href="/">` ([StockClient.jsx:2072](app/stock/[symbol]/StockClient.jsx:2072)):
recarga completa + re-hidratación + «Sesión restaurada» (~2-4 s en dev). El gesto atrás del
navegador, en cambio, es transición SPA instantánea que **conserva el scroll** de la tabla
[MEDIDO: scrollY 200 restaurado] — porque la ida por ticker de fila sí es un Link
([screenerColumns.jsx:133](lib/screenerColumns.jsx:133)). El usuario que confía en el botón
pintado paga recarga; el que descubre el atajo del navegador, no. Las idas desde la tarjeta
rápida, Listas, Sectores, Research y Review son todas `<a>` planos (recarga) [CÓDIGO].

**Detalle que se acumula**: el buscador **conserva el texto anterior** — «NVDA» seguía
escrito al volver, tras recargar, e incluso apareció en el buscador del layout móvil días…
minutos después [REPRODUCIDO]. Cada búsqueda nueva empieza borrando la vieja.

**Cuenta de la sesión**: con el camino óptimo real (buscar → sugerencia → tarjeta → Ficha →
mirar → back), unos **8-9 gestos y ~30-60 s por valor** sin contar la lectura; cinco valores
caben en veinte minutos, pero la mitad del tiempo es transporte, no análisis. Donde perdería
la paciencia: la tercera vez que el Enter no hace nada y la tarjeta intermedia me enseña
seis números que no pedí.

## A3. «Quiero guardar un criterio y volver a él la semana que viene»

**Lo que hice.** Configurar algo sencillo y real: periodo 6M + orden por RS (el selector
global funciona y el orden le sigue ✓). Buscar cómo guardarlo. Guardarlo. Romperlo. Intentar
recuperarlo. Perderlo todo.

**Guardar.** En pantalla hay **cinco botones que dicen «Guardar» con cuatro significados**
[REPRODUCIDO + CÓDIGO]: plantilla local y «Guardar nube» (dentro del disclosure plegado «Mis
plantillas · 0 guardadas» del sidebar), «★ Guardar» (favorito, en la tarjeta de búsqueda), y
dos «Guardar» más (cabeceras de resultados desktop y móvil) que guardan **otra cosa**: el
snapshot de datos para Research desk. El que corresponde al criterio está plegado y guarda
sin pedir nombre — quedó «Mi filtro 1» — y sin más confirmación que el contador «1
guardadas». La plantilla en sí es completa [CÓDIGO: 44 KB con `sort`, `viewLayers`, filtros
de vista y hasta `scanMode`/`batchStart`].

**Volver a él.** Elegí «Mi filtro 1» en el desplegable de plantillas. Resultado
[REPRODUCIDO]:

> «Plantilla aplicada: Mi filtro 1. **Pulsa Ejecutar.**» — y la tabla que tenía delante
> desapareció: «Ejecuta un scan para ver resultados». El periodo volvió solo a 3M.

**Aplicar el criterio guardado vació la pantalla y me pidió ejecutar un escaneo** (el gesto
que en vivo tarda ~6,5 min según el análisis de filtros §5.2-6) — cuando las 282 filas del
snapshot seguían en memoria y el mismo filtro aplicado a mano se recalcula al instante
(`filterAnalyzedRows`). Y al recargar para intentar recuperar lo que tenía, la caída fue
completa: la sesión persistida ya era la del estado vacío post-plantilla, así que la app
volvió a la restauración de nube (~15 s) **con todos los criterios en el defecto** — orden
«Rendimiento 3M», periodo 3M, BANL arriba [REPRODUCIDO]. El ciclo completo «guardé mi
criterio → lo apliqué» me costó el criterio, la tabla y la sesión.

Para aislar la causa: el estado normal SÍ persiste — puse 6M sin plantillas de por medio,
recargué, y 6M seguía activo [REPRODUCIDO]. Lo que rompe el flujo es específicamente la
ruta de aplicación de plantillas, que atraviesa el pipeline de ejecución en lugar de
re-filtrar lo restaurado [INFERIDO del comportamiento + arquitectura documentada en filtros
§0; no tracé la función de aplicación].

**Cuenta de la sesión**: guardar = 4 gestos + adivinar el botón correcto; recuperar = una
pantalla vacía y la orden de escanear. Donde perdería la paciencia: aquí. Este es el flujo
por el que un usuario semanal paga — su criterio como activo permanente — y hoy es una
trampa. Es, con A1, la fricción más cara del producto.

## A4. «Estoy en el móvil en el sofá, quiero mirar por encima» — resumen

(El detalle está en la PARTE C.) La primera pantalla a 390 px son los tres avisos de
arquitectura + el buscador con el «NVDA» heredado del escritorio + la tarjeta de vista
rápida restaurada con su jerga; los valores empiezan ~1.500 px más abajo [REPRODUCIDO]. Las
tarjetas de valores son legibles y con miniatura (~4 por pantalla), pero **tocar la tarjeta
no abre la ficha**: abre el modal de revisión ([screenerMobile.jsx:54](lib/screenerMobile.jsx:54)
`onClick → onReview`), y la ficha solo se alcanza acertando en el ticker de **36×23 px**
[MEDIDO]. En la ficha, el gráfico — la cosa nº 1 del MVP — empieza en el píxel 2.458, tras
pantalla y media de mesa de observación [MEDIDO]. Mirar por encima se puede; disfrutar, no.

---

# PARTE B — Lo que rompe el ritmo

## B4. Esperas sin explicación

| Dónde | Qué se ve | Qué pasa de verdad |
|---|---|---|
| Arranque en frío | «Cargando último snapshot guardado...» ~20 s, sin progreso | Petición de 9,5 s muerta por timeout + reintento de 10,8 s, ambos invisibles [MEDIDO] |
| Vuelta ficha→screener por el botón | Pantalla en blanco + «Sesión restaurada» | Recarga completa por `<a href="/">` cuando existe una vuelta SPA instantánea [CÓDIGO+MEDIDO] |
| Buscador → ficha | Tarjeta intermedia que hay que esperar y leer | La vista rápida carga red propia; la ficha, otra navegación completa [REPRODUCIDO] |
| Modal Revisar, «Siguiente» | ~0,7 s por valor sin indicador [MEDIDO: 655 ms BANL→QMCO] | Fetch del brief del siguiente; aceptable, pero sin señal de actividad |
| /lists | «FUENTE — Cargando» en los KPI | Cada pantalla carga su propia fuente (ya anotado el 14, A1.5) |

La regla que falta es una sola: **toda espera > 1 s dice qué está pasando y cuánto va**
(«Descargando datos de anoche · 500 filas...»), y todo fallo interno reintentado se hace
visible si el reintento también falla.

## B5. Estado: lo que se conserva y lo que se pierde

Con la persistencia arreglada, lo conservado es sólido [REPRODUCIDO en todos los casos]:
sesión completa (filtros, periodo, orden, resultados — 71 KB), favoritos, resoluciones del
usuario, cola de revisión (2,4 MB con miniaturas), scroll de la tabla al volver con el gesto
atrás. El presupuesto por clave funciona (scans 4,26 MB < 4,5 MB). Lo que aún se pierde o
se conserva mal:

1. **La posición en la cola de revisión.** Avancé a QMCO 2/282, cerré, reabrí: **BANL
   1/282** [REPRODUCIDO]. La cola persiste; el cursor no. Un barrido de 282 en varias
   sentadas — el caso real — vuelve a empezar cada vez.
2. **Todo el estado, al aplicar una plantilla** (A3): tabla, periodo, orden y, tras
   recargar, la sesión entera.
3. **El texto del buscador se conserva de más**: sobrevive a recargas y cambios de layout, y
   cada búsqueda nueva empieza limpiando la anterior [REPRODUCIDO].
4. **La tarjeta de vista rápida también se restaura** con la sesión: al abrir el móvil al
   día siguiente, la primera pantalla es la tarjeta de NVDA de ayer [REPRODUCIDO].
5. Los preexistentes conocidos, que siguen: el snapshot truncado a 500 en cada arranque
   (filtros B2) y el aviso del commit de hoy — en Safari los 6,6 MB rozan la cuota de 5 MB
   (no probado aquí).

## B6. Caminos sin salida

1. **Plantilla aplicada** → pantalla vacía cuyo único CTA es «Ejecutar» (minutos). No hay
   «volver a lo que tenía» — y lo que tenía ya se sobrescribió (A3). Es el único sitio del
   producto donde un gesto legítimo destruye el estado sin salida barata.
2. **Modal de revisión en móvil**: resolver está dos pantallas de scroll abajo
   (Candidata/Vigilar/Descartar en y≈1767) y «Siguiente» arriba (y≈212) [MEDIDO]: cada
   valor es bajar-resolver-subir. No es un callejón, pero obliga a desandar en cada paso.
3. **La ficha por URL directa** sigue sin clasificación de usuario (sin origin no hay mesa
   ni resoluciones — ficha B2 del 15, no re-verificado hoy): el camino «me pasaron un link»
   termina en una ficha donde no puedo anotar nada.

## B7. Repeticiones (configurar lo mismo cada vez)

- Las **tres franjas de aviso del arranque** («SNAPSHOT INCOMPLETO», «MUESTRA PARCIAL·
  PERCENTIL POR LOTE») reaparecen íntegras cada día mientras exista el truncado a 500: el
  usuario aprende a ignorar avisos — el peor hábito que un producto de datos puede enseñar.
- **Reabrir la cola desde 1/282** cada vez (B5.1).
- **Borrar la búsqueda anterior** antes de cada búsqueda (B5.3).
- El periodo y el orden, en cambio, **no** hay que reconfigurarlos: persisten ✓ (B5).

---

# PARTE C — El móvil a 390 px

## C8. El recorrido entero

**Screener.** Sin overflow horizontal ✓. La tabla se sustituye por tarjetas
(`mobileResultList`) de 368×190: ticker + bandera + nombre + miniatura + TEMA/RS/ETAPA/
REND/DIST/CAP en pares etiqueta-valor [REPRODUCIDO, captura]. Legible y honesto (RS «–» con
su icono). Coste: ~4 valores por pantalla y paginación de 50 (282 = 6 páginas); «mirar por
encima» la lista entera son ~60 pantallas de scroll + 5 taps de página. La primera pantalla,
antes de cualquier valor: franjas de aviso + buscador (con texto heredado) + «Limpiar/Buscar»
como botones gigantes + tarjeta de vista rápida restaurada [REPRODUCIDO, captura].

**El tap con dos destinos.** El cuerpo de la tarjeta abre el **modal de revisión**
([screenerMobile.jsx:54](lib/screenerMobile.jsx:54)); la **ficha** solo se abre en el ticker
(36×23 px, muy por debajo del mínimo táctil de ~44 px) [MEDIDO+REPRODUCIDO]. Nada visual
distingue ambas zonas. El usuario del sofá que toca «la tarjeta de QMCO» esperando la ficha
recibe la superficie de auditoría con «96 Datos bloqueados · 224 Pruebas bloqueadas · 54
Auditar...». Es la fricción móvil número uno y es un cambio de una línea de intención
(tarjeta → ficha; «Revisar» como control explícito).

**Ficha.** La cabecera móvil está bien resuelta (identidad, precio es-ES grande, chip de
etapa con glifo, franja de calidad, botones nuevos ✓ [REPRODUCIDO, captura]). Pero la página
mide **10.506 px** (~12,5 pantallas) y el orden es el de escritorio: la mesa de observación
ocupa 691→1978 y **el canvas del gráfico empieza en 2.458** [MEDIDO] — tres pantallas para
llegar a la cosa nº 1 del MVP. El gráfico en sí funciona bien en móvil: velas y RS line
legibles, botonera táctil de 56 px, y el raíl de ventana ya publica estado real («ZOOM 05
sep 2025 - 14 ago 2026 · BARRAS 236») [REPRODUCIDO, captura] — el fix del contrato de
ventana, funcionando. Menores: «SIN VALIDAR» truncado en el borde y el «256.2%» con punto.

**Salud de mercado.** Dos roturas reales [MEDIDO]:
- Las filas clave-valor de la auditoría miden 1.345 px dentro de un contenedor de 370 con
  `overflow: hidden`: la etiqueta termina en x=561 y el valor en x=1340 — **el usuario móvil
  ve «Índices analiza…» cortado y el valor es invisible e inalcanzable** (sin scroll posible).
- El KPI «3.8/3.1 DIST/ACC 20D» se corta por la derecha [captura]. Además, los cinco rótulos
  de índices (GSPC/IXIC/RUT/DJI/ACWI) se apilan sobre el pico de la curva de régimen —
  en 390 px, el estado normal del mercado es ilegible (ya anotado en desktop el 14; en móvil
  es peor).

**Listas.** **51.687 px de alto** (~61 pantallas) [MEDIDO]: seis listas × veinte filas en
formato clave-valor apilado, precedidas por el bloque de sistema (Fiabilidad discovery,
Auditoría cobertura, Trazabilidad Review...). En el sofá es sencillamente innavegable.

**Modal de revisión.** Ocupa bien la pantalla (390×796), pero ver C/B6.2: resolver exige
el sube-baja por valor.

**BottomNav.** Correcto: 5 destinos de 68×52, Link SPA, estado activo [MEDIDO]. Dos peros:
en la ficha sigue marcando «Screener» como página actual, y el cuarto destino del producto
móvil es «Research» — la herramienta interna (interfaz C2 del 14).

## C9. Qué es imposible y qué es desagradable

- **Imposible**: leer los valores de la auditoría de Salud de mercado (cortados con
  `overflow: hidden`); acertar cómodamente el ticker de 36×23 px al primer tap.
- **Desagradable pero posible**: llegar a los valores del screener (1.500 px de preámbulo);
  llegar al gráfico de una ficha (3 pantallas); barrer Listas (61 pantallas); resolver en el
  modal (sube-baja); saber si un tap te llevará a la ficha o al modal.
- **Bien resuelto y defendible**: las tarjetas de valores con miniatura, la cabecera de la
  ficha, el gráfico táctil con su raíl de ventana, el BottomNav.

## C10. La idea del gesto: deslizar para cambiar de valor

**Tiene sentido, pero no como está la ficha hoy.** El inventario de conflictos reales de la
ficha móvil [MEDIDO]: el canvas del gráfico (pan horizontal y pinch propios de
lightweight-charts), dos botoneras `chartSegmented` con scroll horizontal, y dos tablas
anchas con scroll (`tableWrap` 1.086 px, `statementMatrix` 1.275 px). Un swipe horizontal
global sobre la página colisionaría con cuatro zonas — y en iOS el swipe desde el borde ya
es «atrás» del navegador. Además, la estructura actual no tiene a quién preguntarle «¿cuál
es el siguiente?»: el raíl solo existe con cola de Revisar, y el contexto de origen no lleva
la lista de símbolos visible (ficha C9 del 15, pendiente B3).

**Cómo sí encaja**, en orden de dependencia:
1. Primero el raíl universal: el contexto de origen incluye la lista ordenada de símbolos
   visibles y la ficha navega esa lista (la propuesta B3 de la ficha, que este análisis
   confirma como prerrequisito del gesto).
2. El gesto se acepta **solo en la cabecera** (identidad/precio/chip — la única franja sin
   scroll horizontal propio) y como atajo, nunca como único camino: botones
   Anterior/Siguiente fijos (p. ej. junto al BottomNav) para el resto de la página.
3. Transición discreta (swipe = siguiente, con animación corta), **no carrusel continuo**:
   el carrusel exige montar dos fichas vivas a la vez — dos charts, dos tandas de fetches —
   y pelearse con el pan del gráfico. Coste alto, beneficio marginal sobre el gesto discreto.
4. Con Link + prefetch de Next para que el siguiente ya esté tibio al deslizar.

---

# PARTE D — Lo que ata y lo que expulsa

## D11. Qué haría quedarse a alguien aunque la competencia tenga más funciones

Concreto, en orden de fuerza:

1. **Que el sábado tenga respuesta.** Una franja de inicio con los deltas desde tu última
   visita, calculados del histórico nocturno que ya existe (`scan_symbol_history`): «Desde
   el sábado pasado: 12 entradas nuevas en Etapa 2 · 8 salidas · 2 de tus vigilados
   cambiaron de etapa», cada una clicable a su lista filtrada. Es LA función del usuario
   semanal, no existe en Deepvue ni MarketSurge como resumen de ausencia, y convierte la
   visita semanal en un hábito con recompensa inmediata. (La infraestructura está; es
   superficie.)
2. **El criterio del usuario como activo instantáneo.** Plantilla/vista que se aplica en
   frío sobre el snapshot en <1 s, con nombre, visible como raíl de vistas (la maqueta A ya
   aprobada). El día que el usuario tiene «Mi lunes» y «Semis en base» como pestañas que
   abren al instante, cambiar de herramienta significa reconstruirlas: eso retiene.
3. **Sus decisiones como memoria del producto.** Ya persisten (Candidata/Vigilar/Descartar
   + notas); falta enseñarlas donde se decide: chip de resolución en la fila/tarjeta y un
   «tus vigilados» en el inicio. El historial de decisiones propias es el coste de cambio
   más honesto que existe.
4. **El ciclo de cinco valores sin transporte**: Enter → ficha, raíl siempre presente,
   vuelta instantánea. Veinte minutos de análisis que son análisis.
5. **El móvil que la competencia no tiene**: tap → ficha, gráfico en la primera pantalla,
   swipe entre valores (C10). MarketSurge en móvil es mediocre y Deepvue es escritorio; es
   la diferencia declarada y el listón está bajo.

## D12. Qué haría irse a alguien después de pagar dos meses

1. **El sábado sin respuesta** (A1): si cada visita exige releerlo todo para saber qué
   cambió, la suscripción se siente como trabajo. Se va al tercer mes.
2. **La trampa de las plantillas** (A3): guardar tu flujo y que aplicarlo vacíe la pantalla
   y pida minutos de scan. Un usuario que pierde su tabla dos veces no guarda una tercera.
3. **Los avisos permanentes de sistema roto**: «SNAPSHOT INCOMPLETO» cada mañana + el
   +2235% liderando (filtros B2/B4). Transmite beta perpetua; a 30 €/mes eso es devolución.
4. **El tap traicionado en móvil** (C8): tocar un valor y caer en «96 Datos bloqueados»
   convence al usuario de sofá de que el móvil «no está hecho».
5. **La jerga en el camino crítico**: percentil por lote, snapshot, restauración,
   congelada, COMPOSITE, EPS PROXY — cada palabra de taller en una superficie de pago cobra
   un pequeño peaje de confianza, y se pagan decenas por sesión.

---

# Propuesta priorizada (por impacto en el uso repetido, no por dificultad)

### Inmediato — deshace las trampas

| # | Qué | Fricción que mata |
|---|---|---|
| F1 | **Aplicar plantilla = re-filtrar el snapshot en cliente** (la ruta de `filterAnalyzedRows`), nunca vaciar ni pedir Ejecutar; si el criterio exige re-scan, decirlo antes de tocar nada | A3 entera: el flujo semanal deja de ser una trampa |
| F2 | **Enter (y sugerencia única) → ficha directa**; la tarjeta rápida como opción secundaria («Vista previa»), no como peaje; limpiar el término al ejecutar la búsqueda | A2: el ciclo por valor baja de 6 gestos a 2 |
| F3 | **Tap en tarjeta móvil → ficha**; «Revisar» como botón explícito en la tarjeta | C8: el gesto más frecuente del móvil deja de traicionar |
| F4 | **Vuelta de la ficha por historial** (router.back con fallback a `/`), y los `<a>` de tarjeta/listas/review a Link | A2/B4: la vuelta visible se vuelve instantánea |
| F5 | **Recordar el cursor de la cola** («Continuar en QMCO · 2/282» al reabrir) | B5.1/B7: los barridos largos dejan de reiniciarse |
| F6 | **Resoluciones ancladas (sticky) en el modal móvil** | B6.2: barrido sin sube-baja |
| F7 | Arreglar los dos cortes de /market-health móvil (KV con `overflow hidden` y KPI) | C9: lo único hoy imposible de leer |

### Estructural — construye la retención

| # | Qué | Por qué |
|---|---|---|
| F8 | **La franja «desde tu última visita»** sobre los deltas nocturnos, en el inicio | D11.1 — la respuesta del sábado; la pieza de retención más barata en relación a su efecto |
| F9 | **Raíl Anterior/Siguiente universal** por lista visible (símbolos en el contexto de origen) — absorbe la B3 de la ficha | Prerrequisito del swipe (C10) y de la cosa nº 4 del MVP |
| F10 | **Ficha móvil reordenada**: gráfico en la primera pantalla; la mesa detrás del gráfico o plegada | C8: «mirar por encima» un valor = abrir y ver |
| F11 | **Presupuesto de espera del arranque**: progreso con palabras de producto («Cargando los datos de anoche · 500 valores»), fallo visible si el reintento falla; retirar «snapshot/restauración» de la superficie | A1/B4 — primera impresión diaria |
| F12 | **Swipe discreto en cabecera** + botones fijos, tras F9 | C10 — la diferencia móvil declarada |
| F13 | Un solo «Guardar» por semántica: «Guardar vista» (nombre pedido al vuelo), «Guardar snapshot» solo tras flag interno | A3/B5.1 del 14 — cuatro «Guardar» son tres de más |

Los preexistentes que este análisis vuelve a tocar sin re-proponer (siguen vigentes):
`rowsLimit=500` y sus tres franjas (filtros B2), el orden liderado por datos no fiables
(filtros B4), Research/Review tras flag interno (interfaz C2), «qué hace el buscador»
(interfaz A1.7).

---

# CONFIANZA

| Afirmación | Confianza | Base |
|---|---|---|
| Arranque frío ~20 s con 500 por timeout + reintento silencioso | Alta el hecho; los segundos son de dev local | Red + log del servidor [MEDIDO]; forma extrapolable, cifra no |
| «Qué cambió esta semana» sin superficie; «CAMBIOS» contradictorio | Alta | Recorrido A1 + pantallas [REPRODUCIDO] |
| Enter no navega; tarjeta intermedia obligatoria; 5-6 gestos por valor | Alta | Flujo reproducido + `ScreenerShell.jsx:486` |
| Vuelta dura por el botón vs SPA por back con scroll conservado | Alta | `StockClient.jsx:2072` + `screenerColumns.jsx:133` + scroll medido |
| Aplicar plantilla vacía la tabla, resetea periodo y pide Ejecutar | Alta | Reproducido dos veces (aplicación y recarga posterior) |
| Tras plantilla + recarga se pierde la sesión (cae a nube con defectos) | Alta el hecho; Media el mecanismo exacto (sesión sobrescrita) | Reproducido; mecanismo [INFERIDO] |
| Estado normal (periodo/orden/filtros/resoluciones) persiste | Alta | Reproducido con recarga limpia |
| Cola persiste, cursor no (siempre 1/282) | Alta | Reproducido (avance a 2/282, cierre, reapertura) |
| «Siguiente» ≈ 655 ms/valor; cola en orden de tabla (ya no reordena) | Alta | [MEDIDO] + apertura BANL 1/282 coincidente con la tabla |
| Tap tarjeta móvil → modal; ficha solo en ticker 36×23 | Alta | `screenerMobile.jsx:54` + dispatch verificado (dialog abierto) |
| Ficha móvil 10.506 px, chart en 2.458; Listas móvil 51.687 px | Alta | [MEDIDO] por DOM en 390×844 |
| Cortes de /market-health móvil (KV oculto, KPI truncado) | Alta | [MEDIDO] posiciones + captura |
| Conflictos de gesto (canvas, 2 segmented, 2 tablas) | Alta el inventario; el veredicto C10 es diseño | [MEDIDO] overflow por DOM |
| Cinco «Guardar», cuatro semánticas | Alta | DOM + contenedores citados |
| localStorage post-fix: 4,26 MB scans + 71 KB sesión + review presente | Alta | [MEDIDO] en vivo |

# LO QUE NO HE VERIFICADO

- **«Ejecutar» y el scan en vivo** (prohibidos): las esperas del refresco, PendingResultsBar
  y el auto-commit no se cronometraron; siguen afirmados por el análisis de filtros.
- **Latencias de producción**: todos los tiempos son de `next dev` local con webpack. El
  timeout de 9,5 s es del proveedor (Supabase), no del build, pero la cifra de arranque en
  Vercel no está medida.
- **Safari y su cuota de ~5 MB** (declarado «SIN RESOLVER» en el commit de hoy): no probado.
- **Gestos táctiles reales**: el panel no emula swipes con inercia; los conflictos de C10
  salen del inventario de zonas con scroll/pan [MEDIDO], no de deslizar con el dedo. El
  arrastre real del chart en móvil quedó sin probar (misma limitación que el análisis del
  gráfico dejó anotada).
- **El cierre de la tarjeta de vista rápida**: no probé si tiene forma de descartarla; sí
  que se restaura con la sesión.
- **La restauración de scroll con scrolls largos** (mi caso medido fue 200 px).
- **La procedencia de las peticiones `^BVSP`/`^MXX`** vistas al abrir la ficha (¿mini-tape
  global?): anotadas en red, sin trazar el componente.
- **El flujo de cola con resoluciones mixtas** (filtros «248 Esperar» etc.) y si el cursor
  salta los resueltos: bloqueado por el propio hallazgo del cursor.
- **Accesibilidad** (lector de pantalla, foco del modal): fuera de alcance de esta sesión.
- **La sugerencia del buscador con símbolos fuera del snapshot** (¿qué pasa buscando un
  ticker no cargado?): no probado; mis búsquedas fueron sobre símbolos presentes.
