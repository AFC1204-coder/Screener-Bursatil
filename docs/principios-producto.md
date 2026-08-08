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
