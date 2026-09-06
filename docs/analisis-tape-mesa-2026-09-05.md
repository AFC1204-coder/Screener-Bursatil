# TAPE-0 — Retorno Grok: maqueta mesa tipo tape · 2026-09-05

Fuente: brief `docs/tickets/TAPE-0-maqueta-mesa-tape.md`.  
Modelo: Grok. Sin código.

**Estado orquestador:** prototipo A en `docs/prototypes/tape/index.html` · defaults Grok aplicados · dueño prueba.

### Defaults del prototipo (sin esperar las 5 respuestas)

| # | Elección |
|---|---|
| 1 | Ventana con scroll |
| 2 | Sí · Máx 52s en fila |
| 3 | Spark semanal ~12M (mock) |
| 4 | Enter = drill-in (A) |
| 5 | Pasar = solo foco |

---

## Veredicto

La idea encaja con el **pase de caza**, no con el de auditoría: el gesto real es cola + foco, no cruzar 12 columnas. Recorta ruido y obliga a un veredicto por nombre (abrir gráfico o pasar).

Falla si se finge que ticker + spark + etapa + un RS bastan para **pasar**. En Weinstein/Minervini el pase rápido casi siempre usa un quinto dato de extensión (dist. a máximos) y un spark que se lea como base, no como adorno. Un spark diario de 3M miente en etapa 2 cansada; uno semanal de ~12M es el que permite saltar sin abrir.

Otro fallo: tratar 8–12 como techo del universo. Si la ficha «Líderes E2» tiene 23 nombres, la cinta es una **ventana ordenada**, no una lista distinta. Si recortas de verdad, el ranking pasa a ser la decisión de producto — y no lo vamos a tocar aquí.

No es un Time & Sales. Es una cola de candidatos con una fila activa.

---

## 3 variantes

El aside de filtros se queda. El scoring se queda. Lo que cambia es el **lienzo de caza**. El rail de fichas (Líderes E2 / Cerca de pivot / …) vive **arriba del lienzo**, no en el aside.

### A — Cinta vertical densa (recomendada para prototipo)

Lista densa: ticker · spark · etapa · un RS. Foco `j/k`. Enter → ficha. Palanca Caza | Auditoría.  
**Pro:** barato; prueba el gesto. **Contra:** spark pequeño; sin extensión abres de más.

### B — Lista + gráfico grande

El gráfico *es* el spark. ↑↓ cambia nombre y chart.  
**Pro:** pase Weinstein real. **Contra:** más caro; no falsifica la hipótesis de la cinta sola.

### C — Cards en rejilla

Spark más grande; peor teclado; tira a mosaico. Solo si A illegible con ratón.

---

## Recomendación Grok

**Variante A** primero. Si casi nunca pasas sin abrir → entonces B. C no es el primer test.

---

## 5 preguntas (dueño)

1. ¿Cinta **corta** a 8–12 o es **ventana** con scroll al resto?  
2. ¿Dato de extensión en la fila (p. ej. % a máx. 52s), sí/no?  
3. ¿Spark **semanal ~12M** o diario ~3M?  
4. ¿Enter = drill-in (sustituye cinta) o split lista+chart (B)?  
5. ¿«Pasar» solo mueve foco, o marca **visto** en la sesión?

---

## Lo que no haría (Grok)

Aside/scoring · veredictos de compra · Excel disfrazado · Time & Sales · cards SaaS · esconder modo Auditoría.
