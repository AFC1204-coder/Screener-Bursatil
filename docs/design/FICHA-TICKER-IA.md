# Ficha de ticker — Arquitectura de información

Spec cerrada para la fase de ejecución. Sistema visual: «Pizarra y Tiza»
([`DIRECCION-VISUAL.md`](DIRECCION-VISUAL.md), tokens en
[`styles/tokens-v2.css`](../../styles/tokens-v2.css)). Esto no es identidad nueva:
es el mismo sistema aplicado con disciplina jerárquica a la pantalla más densa.

---

## 1. Diagnóstico

El problema de la ficha actual no es densidad, es **isopeso**: ~40 elementos con el
mismo tratamiento (píldora con borde, mismo tono) → jerarquía cero. Tres fallos raíz:

1. **La píldora como formato universal.** Una píldora es para estado escaneable en
   listas. Usada para pares label-valor fuerza compresión horizontal → truncamiento
   («Indus…», «Empl…») y hace que un fundamental terciario pese lo mismo que el freno
   de la decisión.
2. **«Sin dato» tratado como dato.** La ausencia ocupa el mismo formato y tinta que
   la presencia; el ojo no puede descartarla sin leerla.
3. **Sin pregunta rectora.** La ficha existe para responder, en este orden:
   ① *¿merece mi atención ahora?* (veredicto + freno) → ② *¿dónde está en el ciclo y
   qué tan fuerte es?* (técnica) → ③ *¿me creo el setup?* (narrativa + fundamentales
   clave) → ④ *¿de dónde sale el score y qué falta?* (auditoría). El trader
   Weinstein/Minervini triaje en segundos con ①-②; ③-④ es consulta posterior.
   La pantalla actual muestra ④ con el mismo peso que ①.

**Regla estructural nº1: las píldoras desaparecen de la ficha.** Los únicos elementos
con forma de chip son el chip-curva de decisión (firma) y nada más. Todo par
label-valor se vuelve fila de tabla clave-valor.

## 2. Jerarquía — 4 niveles

| Nivel | Contenido | Tratamiento | Estado |
|---|---|---|---|
| **N0 Veredicto** | Ticker, nombre, sector, precio+var+cierre · curva de etapa grande · acción recomendada + confianza · **freno** · score · prioridad · resumen setup («3/5 condiciones») | Única zona con color semántico. Score en `--data-l`, precio en `--data-m`. Freno en cuerpo, una frase | Siempre visible, sin scroll |
| **N1 Lectura técnica** | RS, RS Quality, etapa, MA50/200 (dist. %), dist. al máximo de 52 semanas | Tabla clave-valor: label `--text-xs` uppercase humo, valor mono `--data-m` tiza. Máx. 8 filas. Sin color | Visible |
| **N2 Contexto** | Narrativa (tesis / riesgo / siguiente paso) · fundamentales operativos (ventas YoY, EPS YoY, cap.) · checklist de setup completa | Narrativa como anotación al margen (itálica, un subrayado `--senal` máx.). Fundamentales: misma tabla clave-valor, `--data-s` | Visible, subordinado (bajo el pliegue está bien) |
| **N3 Auditoría** | Desglose del score (componentes ±) · fundamentales de contexto (empleados, IPO, subsector, descripción negocio) · detalle de calidad de datos | Barras de razón estilo Decisiones (humo, solo la dominante con tinta); resto tabla clave-valor | **Colapsado por defecto** (`<details>` o equivalente) |

**Fuera de N1 desde el 2026-08-15** — `BASE` («13.0 sem») y `PIVOT`: no son medidas
del valor sino de la ventana del detector (`lib/setupPatterns.js` mide sobre las
últimas ~65 sesiones y toma su máximo como «pivote»). Salían constantes o idénticas
a la distancia al máximo de 52 semanas. Vuelven cuando existan un criterio de base y
un pivote calculados de verdad (principio 7 de `docs/principios-producto.md`).
`ATH` pasó a `MÁX 52S`: era el máximo de 52 semanas, no el histórico.

Presupuesto de color de la ficha: N0 concentra todo el color semántico (chip-curva +
freno si es `--risk`). N1–N3 son tiza/humo puros. Si un elemento de N1–N3 pide color,
está en el nivel equivocado.

## 3. Wireframe de zonas

```
┌────────────────────────────────────────────────────────────────────┐
│ TSLA  Tesla Inc · Automóvil            187,42  ▾ -1,3%   cierre 04·07│ N0
│ ─ datos 7/9 · precio 3 sesiones · RS sin snapshot ─────────── [+]  │ ← franja calidad (solo si degradada)
│                                                                    │
│   ──────·─────╱▔▔●▔╲────      AUDITAR · confianza media            │
│   Etapa 3 · 6 semanas          score 61 · prioridad 2/5            │
│   Freno: extensión 14% sobre MA50 con volumen decreciente          │
│   Setup 3/5 condiciones · falta: contracción, cierre > pivot       │
├──────────────────────────────┬─────────────────────────────────────┤
│ RS               94          │  Tesis                              │ N1 · N2
│ RS QUALITY       A-          │  «Líder de grupo con RS…»           │
│ MA50 / MA200     +14% / +32% │  Riesgo                             │
│ MÁX 52S          -11%        │  «Base tardía en mercado…»          │
│                              │  Siguiente paso                     │
│                              │  «Esperar contracción de…»          │
├──────────────────────────────┴─────────────────────────────────────┤
│ VENTAS YOY  +19%   EPS YOY  +34%   CAP.  598B                      │ N2
│ ▸ Auditoría del score (7 componentes)                              │ N3 colapsado
│ ▸ Empresa (subsector, empleados, IPO, descripción)                 │ N3 colapsado
│ ▸ Calidad de datos (detalle por fuente)                            │ N3 colapsado
└────────────────────────────────────────────────────────────────────┘
```

## 4. Lenguaje de «calidad de dato» (ausente / estimado / degradado)

Principio: **la calidad de dato es infraestructura, no señal de mercado.** Jamás usa
`--senal` ni `--oxido` — esos colores significan «atención de mercado» y «riesgo de
mercado»; si la fontanería los usa, se devalúan. Lo ausente **pierde tinta**:

| Estado | Tratamiento | Token |
|---|---|---|
| **Ausente** | El valor es `—` (em dash) en `--ghost`. El label queda en humo. Sin píldora, sin texto «Sin dato» repetido: el guion ES el estándar y el ojo lo salta gratis | `--ghost` |
| **Estimado / viejo** | El valor se muestra (en `--soft`, no tiza) con subrayado punteado + sufijo corto en humo `--text-xs`: `RS 91 ᵉˢᵗ`, `187,42 ³ˢ` (3 sesiones) | `--line-stale` |
| **Ficha degradada** | UNA franja bajo la cabecera (nunca avisos por dato): micro-label humo sobre `--surface`, expandible al detalle de N3: `datos 7/9 · precio 3 sesiones · RS sin snapshot` | existentes |

`--ghost` ≠ `humo·.6` a propósito: humo·.6 ya significa «descartado por el sistema»
(regla 4 del sistema); mezclar «descartado» con «ausente» rompería el vocabulario.

## 5. Truncamiento: resuelto por formato, no por ellipsis

1. Todo par label-valor va en **tabla clave-valor de 2 columnas**: label a la
   izquierda (`--text-xs` uppercase, `--track-label`, humo), valor a la derecha
   (mono, alineado a la derecha). La fila crece; nada compite en horizontal.
2. **Vocabulario cerrado de labels** (cortos por diseño, jerga que la audiencia
   domina): `RS`, `RS QUALITY`, `ETAPA`, `MA50`, `MA200`, `MÁX 52S`,
   `VENTAS YOY`, `EPS YOY`, `CAP.`, `SECTOR`, `EMPLEADOS`, `IPO`. Si un label nuevo
   no cabe en ~12 caracteres, se acorta el label, no se trunca el render.
3. **Prohibido `text-overflow: ellipsis` en labels y valores numéricos.** Solo se
   permite en texto narrativo largo (descripción del negocio), que además vive
   colapsado en N3.

## 6. Colapsado por defecto

- **Expandido siempre**: N0, N1, narrativa de N2 (tesis/riesgo/siguiente paso son
  cortos por contrato: 1-2 frases cada uno) y la fila de fundamentales operativos.
- **Resumen visible + detalle colapsado**: checklist de setup (resumen `3/5` + qué
  falta en N0; lista completa expandible en N2) y calidad de datos (franja en N0;
  detalle en N3).
- **Colapsado**: auditoría del score, bloque empresa (subsector, empleados, IPO,
  descripción), detalle de calidad de datos. Estado de expansión no persistente:
  cada ficha abre igual — el default ES la opinión de diseño.

## 7. Tokens nuevos (2) y por qué

| Token | Valor | Justificación |
|---|---|---|
| `--ghost` | `rgba(237,232,218,.35)` | «Ausente» necesita tinta propia: menos presencia que `--muted` (que es contenido secundario válido) y distinta de `humo·.6` (que significa «descartado»). Sin él, los ejecutores reutilizarían humo y los tres significados colisionarían. |
| `--line-stale` | `1px dotted rgba(126,139,130,.55)` | El dato estimado/viejo debe distinguirse *dentro del valor* sin color semántico; el punteado es el único afordance de borde nuevo y queda tokenizado para que no proliferen variantes. |

Nada más: la jerarquía completa se resuelve con las escalas tipográficas, superficies
y espaciados ya existentes. Ritmo vertical entre niveles: `--space-7`; dentro de un
nivel: `--space-3`/`--space-4`.
