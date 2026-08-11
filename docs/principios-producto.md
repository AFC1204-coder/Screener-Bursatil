# Principios de producto — StatsEdge

Fecha: 2026-08-08

## 1. La herramienta clasifica, no recomienda

StatsEdge no emite señales de compra ni de venta, ni afirmaciones que
puedan leerse como recomendación de inversión, por indirectas que sean.

Razón metodológica: Weinstein y Minervini no dan señales, dan criterios
de clasificación. Una etapa 2 no es una compra — es un contexto donde
ciertas entradas tienen sentido. El operador decide cuál, cuándo y con
qué tamaño. Una herramienta que dijera "compra" fingiría una certeza que
la metodología no tiene.

Razón de producto: el usuario objetivo ya sigue esta metodología. Lo que
necesita es no revisar mil gráficos a mano, no que alguien decida por él.

Razón legal: en España, recomendar inversiones concretas es asesoramiento
financiero y está regulado.

### Qué significa en la práctica

- El vocabulario describe el estado del valor, no la acción a tomar.
  Correcto: "Etapa 2 confirmada", "RS 87", "base de 11 semanas".
  Incorrecto: "Comprar", "Oportunidad", "Objetivo 45€", "Entrada aquí".
- Evitar nombres de campo o columna que sugieran precio objetivo,
  rentabilidad esperada o acción. REVISAR: la columna "Objetivo" de la
  tabla de resultados muestra una puntuación técnica, pero su nombre
  puede leerse como precio objetivo.
- Los ETFs siguen la misma regla. La tentación de escribir "exposición a
  Alemania" en vez de "este valor está en etapa 2" es mayor, y cruza la
  línea.
- Un número sin contexto no es neutral: si se ordena por él y se destaca
  el primero, el producto está señalando. La ordenación debe ser
  elegible y su criterio, explícito.

## 2. Menos superficie, más claridad

La interfaz creció por acumulación y arrastra sobrecarga. Cada elemento
debe justificar su sitio: si un inversor no puede leer la tabla de un
vistazo, sobra información.

Problemas conocidos, detectados en prueba real (2026-08-08):
- La columna con el veredicto queda fuera de pantalla sin barra de
  desplazamiento visible: el aviso más importante no llega al usuario.
- Tres valores de RS por fila (G, GRP, Q) sin leyenda visible.
- Porcentajes truncados con puntos suspensivos, ilegibles.
- Vocabulario interno sin traducir en las fichas: "Contrato largo
  degradado", "Auditabilidad 13%", "Snapshot íntegro".

Las dos limpiezas —simplificar y despersuadir— se hacen juntas: casi
todo lo que sobra por ruido sobra también por lenguaje.

## 3. Nada que el sistema no pueda demostrar

Un dato ausente se muestra como ausente, no como cero ni como valor por
defecto. Una métrica calculada sobre muestra insuficiente se marca como
tal. Ver docs/inventario-dato-ausente-2026-08-01.md.

## 4. Las cinco cosas (2026-08-08)

Definición de producto para el MVP. Un operador de tendencia mira estas
cinco cosas a diario; todo lo demás es profundizar en un valor concreto
y vive en la ficha, no en la tabla:

1. **Gráfico de precio y volumen** limpio, con medias móviles e
   indicadores superponibles.
2. **RS**, tanto para filtrar como para analizar en el gráfico.
3. **Filtros rápidos e intuitivos.** Simples y efectivos, no
   exhaustivos.
4. **Navegación fluida entre valores.** Entrar en una acción y pasar a
   la siguiente sin volver atrás (el botón de flecha que ya existe).
5. **Ficha de resumen compartible**: estado de la tendencia más un
   resumen de la empresa, en un formato visualmente atractivo que dé
   buena imagen al compartirse.

### Sobre la ficha compartible

No es una función más: es distribución. Cada imagen compartida en redes
o grupos es un anuncio con la marca dentro. Es de las pocas vías de
captación que no dependen de presupuesto.

### La ineficiencia que explotamos

MarketSmith ha ido llenando su cuadro de resumen de empresa hasta
hacerlo denso y poco atractivo. Es lo que le pasa a un producto maduro
que añade sin quitar. No competimos en cantidad de datos: competimos en
que se entienda de un vistazo.

Posición de mercado: no somos un MarketSmith barato con funciones
recortadas. Somos un producto diseñado para hacer bien cinco cosas, como
un móvil de gama media bien resuelto frente a uno de gama alta. Los
recortes son decisiones, no ausencias.

### Consecuencia para el rediseño

La tabla actual tiene quince columnas, tres valores de RS por fila y
paneles de auditoría. Eso no es gama media bien resuelta: es gama alta a
medio construir. El rediseño no consiste en limpiar lo que hay, sino en
decidir qué se queda en la tabla y mover el resto a la ficha.

## 5. La metodología vive en un solo sitio (2026-08-09)

Todo lo que haya que explicar al usuario sobre CÓMO se calcula algo va
en una página de metodología, no repartido por la interfaz.

Qué va ahí: cómo se calcula el RS y sobre qué población, qué significa
cada etapa, qué mide el score compuesto y con qué pesos, de dónde salen
los datos y con qué retraso, y qué criterios excluyen un valor del
cálculo.

Qué NO va en la interfaz: definiciones, fórmulas, tamaños de muestra
repetidos por fila, ni avisos que digan lo mismo en varios sitios.

### La excepción

Un dato AUSENTE sí se explica en el sitio donde falta, porque es
información sobre ese valor concreto y no sobre el método. Ejemplo:
"sin RS: serie discontinua (salto de 25x el 6 de marzo)". Eso es
específico de ese símbolo y el usuario lo necesita ahí.

La diferencia: explicar el método es redundante repetirlo; explicar por
qué falta un dato concreto no lo es.

### Por qué importa

La transparencia no debe costar espacio en pantalla. Publicar el
criterio en un sitio da al usuario más información que la competencia
—MarketSmith excluye valores de su universo y no publica el criterio—
sin llenar la tabla.

## 7. Las columnas de la tabla (2026-08-11)

De quince columnas a siete. Todas descriptivas: ninguna sugiere qué
hacer.

1. **Ticker con miniatura.** El nombre y la forma. La miniatura ya
   adelanta medio análisis: si sube ordenado o en dientes de sierra.
2. **Tema.** Ojo con el nombre: lo que hoy se muestra como "sector" es
   en realidad el grupo temático (`theme`), que agrupa varios sectores
   estándar — "Inmobiliario / REIT" reúne cinco. Llamarlo por su
   nombre.
3. **RS.** Un solo número, el semanal sobre el universo. Los de país y
   grupo van a la ficha.
4. **Etapa.** Weinstein en una palabra. Es clasificación técnica
   objetiva, no opinión: describe dónde está el precio respecto a sus
   medias.
5. **Rendimiento con selector de periodo.** Sustituye a las tres
   columnas fijas de 3M, 6M y 12M. Selector GLOBAL, no por fila: si
   fuera por fila se perdería la comparación entre valores, que es para
   lo que sirve un screener. Y el orden puede seguir al selector.
6. **Distancia al máximo de 52 semanas.** Dice si llegas tarde. Un
   valor a un 2% de máximos está en zona útil; a un 25%, no.
7. **Capitalización.** No por sí misma, sino porque un valor de 200
   millones y uno de 200.000 no se operan igual.

### Lo que se elimina

El VEREDICTO y toda la maquinaria de fiabilidad de la fila — "Revisar
datos", "Vigilancia", "Auditar". Es exactamente lo que el principio 1
prohíbe: el usuario debe tener las herramientas para decidir por sí
mismo, por metodología y por lo legal.

Y también: Minervini y Weinstein como puntuaciones numéricas separadas
(la etapa ya lo resume), RS Quality, deterioro, SMA50, los tres valores
de RS por separado, y las insignias de auditoría. Todo eso a la ficha,
donde hay espacio y contexto.

### Cómo se muestra un dato no fiable

Sin etiquetas de estado en la fila. El dato afectado se muestra como
ausente —un guion— con el icono de información del principio 6. Que el
RS de un valor no sea fiable porque sus barras están rotas es calidad de
dato, no opinión, y el usuario debe poder saberlo sin que le ocupe
espacio.

### Aplazado hasta poder calcularlo bien

**Distancia al pivote** y **semanas de base** serían de lo más útil, y
Minervini las mira antes que casi nada. Pero hoy el pivote parece ser
una línea sobre máximos históricos, y el pivote real es el máximo de la
contracción final de la base, que suele estar por debajo. Un número
falso con aspecto de preciso es peor que no tenerlo.

La información está en las barras: detectar una base es identificar
dónde el precio deja de avanzar y se mueve en rango; detectar
contracciones es medir si cada retroceso es menor que el anterior. Es
cálculo, no juicio. Hace falta un criterio explícito y verificable.

Cuando estén, entran — pero algo sale a cambio. Siete columnas caben
cómodas; nueve aprietan, sobre todo en móvil. Añadir sin quitar es cómo
se llega a quince.

### Nota para la implementación

Las columnas deben estar definidas en UN sitio, no repartidas por el
código. Si están incrustadas en el diseño, cada cambio futuro es una
obra; si están en una lista, añadir o quitar es trivial.
