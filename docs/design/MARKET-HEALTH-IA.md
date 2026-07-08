# Market Health — Arquitectura de información

Spec cerrada para la fase de ejecución. Sistema visual: «Pizarra y Tiza»
([`DIRECCION-VISUAL.md`](DIRECCION-VISUAL.md), tokens en
[`styles/tokens-v2.css`](../../styles/tokens-v2.css)). Mismo formato que
[`FICHA-TICKER-IA.md`](FICHA-TICKER-IA.md). Componente: `app/market-health/page.jsx`.

---

## 1. Diagnóstico

Dos problemas distintos que se refuerzan:

1. **Un objeto extraño al sistema.** El panel de régimen (~línea 676) y el componente
   `NewsSentimentIndex` (~línea 142) son bloques de estilos inline v1 que la migración
   nunca tocó: gauge semáforo `#ef4444/#f59e0b/#10b981`, aguja azul `#2563eb`, barra
   púrpura `#a855f7`, fondos negros `#0a0a0d/#060608`, JetBrains Mono y blancos puros
   hardcodeados, glows y gradientes. Violan a la vez el no-semáforo, la paleta, la
   tipografía de datos y la doctrina de sombras. **Todo estilo inline de esta página
   se elimina en la ejecución; no hay excepciones.**
2. **Isopeso de secciones + KPIs duplicados.** Tras el régimen, ~10 cards co-iguales
   con 26 KPIs. Duplicaciones literales a eliminar, no reordenar:
   - Market score aparece 2× dentro del propio panel de régimen (gauge + mega-KPI).
   - Los 4 KPIs de «Pulso de noticias» repiten lo que el panel visual de su misma
     card ya muestra (pesimismo en dial + KPI; régimen en h3 + KPI; bajistas/alcistas
     en leyenda + 2 KPIs). Ídem los 4 de «Pulso social». **8 KPIs sobran.**
   - «Amplitud aproximada» repite en absolutos los %SMA50/%SMA200/índices del régimen.
   - Fiabilidad (infraestructura) va como cards co-iguales POR ENCIMA de la Weinstein
     tape (mercado) — inversión directa de la regla 7.

## 2. Pregunta rectora (hipótesis corregida)

«¿Está el mercado para comprar rupturas?» era casi correcta pero binaria. La pregunta
que un trader Weinstein trae aquí es de **exposición, no de permiso**:

> **«¿Qué exposición tolera este mercado hoy — y si tolera alguna, dónde está el
> liderazgo?»**

Es una pregunta en dos tiempos: primero etapa/régimen del conjunto (índices, tape,
amplitud), después dirección del liderazgo (regiones, sectores, valores). Todo lo
demás — sentimiento de titulares/social — es lectura *contraria* de tercer orden que
hoy ocupa el mismo rango visual que la tape. La pantalla actual tiene los datos para
responder ambas partes; lo que no tiene es el orden.

## 3. Jerarquía — 3 niveles + pozo + franja infra

| Nivel | Contenido | Tratamiento | Estado |
|---|---|---|---|
| **Franja infra** (bajo cabecera) | Fiabilidad de cobertura + metodológica + fallos de datos, agregados en UNA línea: `cobertura 5/6 mercados · metodología OK · 2 fallos [+]` | Receta estándar: micro-label humo sobre `--surface`, `--line2`, expandible al detalle (N3). Jamás card | Franja; detalle colapsado |
| **N0 Veredicto de mercado** | Régimen (label + stance) + **constelación de la Curva de Etapa** (ver §4) + 4 KPIs mono `--data-xl`: market score · índices sobre MM30s (x/y) · % sectores Etapa 2 · distribución/acumulación 20d | Única zona con color semántico. Sin gauge, sin barras de gradiente | Siempre visible, sin scroll |
| **N1 Evidencia interna** | Weinstein tape (KPIs restantes: % sectores sobre MM30s, % E4 + paneles sectores-confirmación / divergencias) · Liderazgo por regiones (4 tarjetas compactas) · Leadership pulse (líderes / deterioro + % RS≥80, % cerca máximos, % presión) · Amplitud sectorial (resumen + enlace a Sectores) | Tiza/humo puros, tablas clave-valor y evidence-rows. Sin KPI-cards gigantes: `--data-m` | Visible |
| **N2 Lectura contraria** | UNA card «Sentimiento» que fusiona noticias + social: dos filas del mismo componente compacto (índice pesimismo mono + barra de distribución en humo con marcador) + lectura contraria en una frase. Titulares y posts (las dos rejillas de 12) | Sin los 8 KPIs duplicados. Titulares/posts en `<details>` colapsado dentro de la card | Visible el resumen; feeds colapsados |
| **N3 Auditoría** | Tabla «Índices principales» (14 columnas — **pozo**: `--surface-inset`, receta regla 8) · amplitud aproximada en absolutos · «Método» · detalle de fiabilidad y fallos de datos | Tabla densa sobre pozo; resto clave-valor | **Colapsado por defecto** |

Presupuesto de color: N0 concentra todo el color semántico de la página (el marcador
de régimen, §4). N1–N3 tiza/humo; los paneles de deterioro usan `--risk` solo como
dot/marker (regla 5), nunca fondos.

## 4. Panel de régimen: estreno de la constelación de la Curva de Etapa

El gauge semáforo se sustituye por el elemento firma en su variante hero
(`--curve-hero-h`, geometría canónica de DIRECCION-VISUAL.md §5). **Esta es la
pantalla para la que se diseñó**: la pregunta «¿en qué etapa está el mercado?» se
responde literalmente con la posición en la curva.

```
┌────────────────────────────────────────────────────────────────────┐
│ RÉGIMEN                                    score  MM30s  E2%  D/A  │
│ EXPANSIÓN SELECTIVA          ·SPY              64   5/6   38%  2/6 │
│ "Amplitud estrecha; liderazgo    ╱▔●▔╲                             │
│  concentrado en..."       ──·──╱──────╲──·──                       │
│                        NKY² ·¹        ³· ⁴HSI                      │
└────────────────────────────────────────────────────────────────────┘
```

- **Constelación**: cada índice principal es un punto (`--curve-dot`, tiza) situado
  en la curva según su etapa (Etapa 1 → zona x 4-30, Etapa 2 → 30-54, Etapa 3 →
  54-74, Etapa 4 → 74-116; dentro de cada zona, posición fina por `distanceSma30w`).
  Jitter vertical ±4px. Etiqueta corta del símbolo en `--text-xs` humo junto a cada
  punto (máx. 6 índices; el resto solo punto).
- **Marcador agregado** (el mercado como conjunto): un punto mayor —
  `calc(var(--curve-dot) * 1.5)`, relleno sólido — cuyo color es el único color
  semántico del panel: `--senal` si el régimen es constructivo (atención: hay
  permiso de exposición), `--oxido` si es de riesgo (Etapa 4 / presión), `--humo`
  en transición/neutral. No es un semáforo: nunca hay dos colores simultáneos, y
  son el vocabulario del trader (atención / riesgo / sin tinta), no rojo-verde.
- **Texto**: label del régimen en display (`--display-m`, uppercase); stance en
  cuerpo, 1-2 frases (es la «lectura operativa» de la página — puede llevar UN
  subrayado `--senal` en la frase clave, como en la ficha).
- **KPIs**: los 4 de N0 en mono `--data-xl`, sin barras de progreso de gradiente;
  si la ejecución quiere barra, micro-barra 4px en `--line`/`--humo`.
- **Se elimina**: gauge SVG, aguja, gradientes de fondo, sombras largas, `#0a0a0d`,
  mega-KPIs %SMA50/%SMA200 (bajan a N3 «amplitud aproximada») y el conteo de
  índices (dato de infraestructura → franja).
- Estados derivados (ya especificados): carga = curva dibujándose; sin datos =
  tramo de Etapa 1 plano con texto en humo.

## 5. Sentimiento (N2): un componente, dos filas, cero KPIs duplicados

`NewsSentimentIndex` se re-ejecuta como componente del sistema (sin inline): fila
compacta = índice de pesimismo en mono `--data-l` + barra de distribución
bajista/neutral/alcista en tonos de humo (la dirección la dan los extremos
etiquetados, no el color; el marcador contrario es un dot tiza) + régimen en
micro-label + frase contraria. Noticias y social son dos instancias de la misma
fila dentro de una sola card «Sentimiento». Los feeds (12 titulares, 12 posts) en
`<details>` colapsados. Los `sentimentPill` bajista/alcista de los items usan
tiza/humo + glifo direccional, no color (regla: el precio/sesgo no tiene color por
defecto).

## 6. Triage de los 26 KPIs actuales

| Destino | KPIs |
|---|---|
| **N0 (4)** | Market score · índices sobre MM30s (x/y) · % sectores Etapa 2 · distribución/acumulación 20d |
| **N1 (8)** | % sectores sobre MM30s · % sectores Etapa 4 · % RS≥80 · % cerca máximos 52s · % presión (deterioro 2+) · score medio sectorial · sectores sobre SMA50 (x/y) · mejor/peor 1M (como línea, no 2 KPIs) |
| **N3 (4)** | %SMA50 · %SMA200 · SMA200 subiendo · cerca de máximo 52s (absolutos, en «amplitud aproximada») |
| **Franja infra (1)** | nº índices analizados (+ fallos de datos) |
| **Eliminados (9)** | Los 8 KPIs de noticias/social (duplican su propio panel) · el market score duplicado del gauge. «Acciones snapshot» y «lectura interna» dejan de ser KPI: pasan a la línea de contexto del título de su sección |

## 7. Tokens nuevos: ninguno

Todo se resuelve con lo existente: constelación con `--curve-*`, marcador agregado
con `calc(var(--curve-dot) * 1.5)` y `--senal/--oxido/--humo`, micro-barras con
`--line`, pozo con `--surface-inset` (regla 8), franja infra con la receta de
calidad de dato (`--ghost`/`--line-stale` si hay datos degradados). La página es la
prueba de que el sistema ya tiene vocabulario suficiente; si la ejecución siente que
necesita un token nuevo aquí, casi seguro está reinventando algo que ya existe.

## 8. Checklist de ejecución (además del de DIRECCION-VISUAL.md §7)

- [ ] ¿Queda ALGÚN estilo inline en la página? → eliminar (este archivo era el mayor foco v1).
- [ ] ¿Gauge, dial o conic-gradient? → constelación / micro-barra.
- [ ] ¿Rojo y verde enfrentados en cualquier elemento (barras de sentimiento, gauge)? → tiza/humo + glifo.
- [ ] ¿Fiabilidad/cobertura/método como card? → franja infra.
- [ ] ¿Un KPI muestra lo que otro elemento de la misma card ya muestra? → eliminar el KPI.
- [ ] Tabla de índices: ¿pozo con cabecera `--surface` y filas `--line`? (regla 8).
