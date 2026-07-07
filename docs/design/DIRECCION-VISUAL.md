# StatsEdge — Dirección visual v2: «Pizarra y Tiza»

Spec cerrada para la fase de ejecución (GLM-5.2 / MiniMax M3, pantalla por pantalla).
Tokens: [`styles/tokens-v2.css`](../../styles/tokens-v2.css). Este documento resuelve las
dudas de criterio; los tokens resuelven los valores. Si algo no está aquí ni en los
tokens, la respuesta por defecto es: **tiza sobre pizarra, sin color, sin decoración**.

---

## 1. Concepto

Antes de las pantallas, todas las bolsas del mundo — Madrid, el kabuto-chō de Tokio,
Hong Kong, Toronto — funcionaban sobre tablones de pizarra verde-negra con cotizaciones
escritas a tiza. Es el único objeto visual nativo de los *mercados globales* (el
diferenciador de StatsEdge), no del terminal americano. Y encaja con el método
Weinstein: revisión semanal, deliberada, anotada — media lenta.

**La metáfora gobierna paleta, calma y jerarquía. NO se ejecuta literalmente:**
prohibidas las texturas de tiza, bordes "dibujados a mano", tipografías chalkboard
o cualquier skeuomorfismo. La audacia se gasta entera en la Curva de Etapa (§5).

## 2. Paleta

| Token | Hex | Rol |
|---|---|---|
| `--pizarra` | `#17291F` | Lienzo. Verde-pizarra perceptible como verde, nunca negro neutro. Pozo `--pizarra-0 #101D15`, panel `--pizarra-2 #2C4C39` (~+11 pts), hover/anidada `--pizarra-3 #365A44`. |
| `--tiza` | `#EDE8DA` | Texto principal. Nunca `#fff`. También el CTA sólido invertido (`--cta-bg`). |
| `--humo` | `#7E8B82` | Secundario, bordes (en alpha), todo lo descartado. |
| `--senal` | `#E0A93F` | Ámbar dorado: atención y decisión Vigilar. Nunca como fondo de CTA. |
| `--traza` | `#93B8CE` | Tiza azul: análisis pendiente. Decisión Auditar. |
| `--oxido` | `#C4614C` | Riesgo real (riesgo cola, deterioro). Escaso a propósito. |

### Reglas de color (obligatorias)
1. **El color es convicción.** La UI en reposo es bicolor (pizarra + tiza/humo).
   Fuera de la zona de resultados/veredicto, máximo UN elemento `--senal` por vista.
   El CTA es tiza sólida invertida (`--cta-bg`/`--cta-fg`), no `--senal`: el botón
   más prominente y el color de atención no compiten entre sí.
2. **Descartar no gana color: pierde tinta.** `--humo`, opacidad `.6`, peso 400.
3. **El precio no tiene color por defecto.** Variaciones con signo explícito (`+1,4%`)
   y glifo direccional (`▴`/`▾`) en tiza. Solo movimientos excepcionales (umbral que
   define cada pantalla, p. ej. >2 ATR) ganan `--senal` (fuerza) u `--oxido` (deterioro).
   Motivo de producto: en Tokio/HK la convención rojo/verde se invierte; en un screener
   de 29 mercados el semáforo es ambiguo para su propio público.
4. Fondos de color solo mediante `--senal-dim` / `--traza-dim` / `--oxido-dim`.
   Nunca color sólido de fondo en superficies grandes.
5. `--oxido` se usa como marcador (dot, texto puntual, regla), jamás como relleno grande.
6. **Lo activo es tinta, no matiz** (corrección post-rollout). Estados de UI genéricos
   — pestaña de navegación activa, toggles de mercado, chips de país, selección de
   filtro, foco de teclado — usan `--active-*` / `--focus-ring` (tiza + `--line3` +
   `--pizarra-3`), nunca `--senal`/`--traza`/`--oxido`. Esos tres tonos son vocabulario
   exclusivo del trader (Vigilar / Auditar / riesgo); si la interfaz los usa para
   marcarse a sí misma, dejan de significar nada. `--accent` ahora es tiza.
7. **Alertas de infraestructura** (fallo de proveedor, timeout, snapshot local):
   lenguaje de calidad de dato — franja tiza/humo sobre `--surface` con `--line2` —
   jamás señal ni óxido. La infraestructura no compite con las señales de mercado.
8. **Doctrina de elevación (v2.2): entre campos del mismo matiz, el delta de
   luminosidad no basta — la elevación la da el contorno.** Cinco roles de superficie:
   | Rol | Superficie | Borde | Sombra |
   |---|---|---|---|
   | Lienzo (fondo de página) | `--bg` | no | no |
   | Pozo (tabla densa, zona hundida) | `--surface-inset` | 1px `--line` | no — lo hundido no proyecta |
   | Panel (card, filtros, lectura) | `--surface` | 1px `--line2` **obligatorio** | `--shadow-panel` **obligatoria** |
   | Anidada (chip/celda dentro de panel) | `--surface2` | 1px `--line` | no — lo anidado no proyecta |
   | Flotante (dropdown, popover, modal, sticky) | `--surface` | 1px `--line2` | `--shadow-float` |
   Regla mnemónica: **borde = dónde termino; sombra = a qué altura estoy.** Todo lo
   que no es lienzo lleva borde; solo proyecta sombra lo que está por encima del
   flujo (panel) o fuera de él (flotante). Un panel sin borde+sombra es un bug.
   Tablas densas (p. ej. `compactResultsTable`, hoy en negro puro sin migrar):
   cuerpo sobre `--surface-inset` con filas separadas por `--line`; cabecera de
   tabla en `--surface` con `border-bottom: --line2` y micro-labels — nunca negro.
   Texto secundario sobre `--surface2` usa `--soft`, no `--humo` (contraste).

## 3. Tipografía

| Rol | Fuente (Google Fonts) | Uso | Prohibido |
|---|---|---|---|
| Display | **Archivo** variable, `font-stretch:125%`, 600, `uppercase`, `letter-spacing: var(--track-display)` | Título de pantalla, nombre de preset, cabeceras de sección. **Máx. 3 usos por vista.** | Frases largas, minúsculas, cifras. |
| Cuerpo | **Instrument Sans** | Todo el UI, labels, narrativa de «Lectura operativa» (esta en 400 itálica). | Números tabulares. |
| Datos | **Spline Sans Mono** + `font-variant-numeric: tabular-nums` | **Toda cifra que pueda cambiar**: métricas, conteos, %, tickers, tablas. | Texto corrido. |

Las tres métricas grandes (Universo/Pasan/Score) van en `--font-data` a `--data-xl`
(38px), peso 500 — el dato es el héroe, no el titular. Micro-labels: `--text-xs`,
uppercase, `--track-label`, color `--humo`, en `--font-body`.

## 4. Layout — pantalla de resultados (patrón de referencia)

- **Ticket de ejecución** (cabecera): preset (display) + resumen de mercados + botón
  Ejecutar + estado, colapsados en una franja fina de una fila. No es un hero.
- **Cinta-embudo de métricas**: `29.412 ─▸ 3,2% ─▸ 941 ─▸ score 74` — las métricas
  encadenadas con conectores y tasa de paso anotada, no tres tarjetas flotantes.
- **Raíl de filtros**: mercados agrupados por sesión — `ASIA-PACÍFICO / EUROPA /
  AMÉRICA` como cabeceras (display-s), banderas como toggles compactos dentro de cada
  grupo. Toggle activo: borde `--line2` + texto tiza; inactivo: humo.
- **Zona de resultados**: Vigilar / Auditar / Descartar como secciones con regla
  superior de 2px en su tiza semántica (humo para Descartar) y conteo en mono.
- **Lectura operativa**: columna de anotación al margen — Instrument Sans itálica,
  la frase clave con subrayado de 2px en `--senal` (un solo subrayado por lectura),
  métricas satélite en `--data-s` debajo.
- **Decisiones**: contadores en mono; barras de razón en `--humo`, solo la razón
  dominante gana su tiza semántica.

```
┌──────────────────────────────────────────────────────────────────┐
│ GLOBAL LEADERS · Balanceado · 29 mercados      [ ▷ EJECUTAR ]    │  ticket
├──────────────┬───────────────────────────────────────────────────┤
│ SESIONES     │  29.412 ──▸ 3,2% ──▸ 941 ──▸ score 74             │  cinta-embudo
│ ◦ Asia-Pac   │  ────────·─────╱▔▔▔╲────   constelación (firma)   │
│ ◦ Europa     ├───────────────────────────────┬───────────────────┤
│ ◦ América    │ ━━ VIGILAR 12 · ── AUDITAR 31 │  Lectura operativa│
│ Filtros…     │ ── DESCARTAR 898              │  nota al margen   │
│              │  ⌒● TICKER  rs 94  piv -2,1%  │  + satélites mono │
└──────────────┴───────────────────────────────┴───────────────────┘
```

Resto de pantallas (research desk, market health, review, page principal): mismos
tres patrones — ticket fino arriba, datos encadenados (no tarjetas sueltas),
narrativa como anotación al margen. Ninguna pantalla inventa reglas nuevas.

## 5. Elemento firma: la Curva de Etapa

El diagrama de 4 etapas de Weinstein (base → avance → techo → descenso) como sistema
de iconografía vivo. **Una sola geometría, tres usos.**

### Geometría canónica (SVG)
```svg
<svg viewBox="0 0 120 44">
  <path d="M4,34 L30,34 C40,34 42,10 54,10 L74,10 C84,10 86,34 96,34 L116,34"
        fill="none" stroke="var(--curve-track)"
        stroke-width="var(--curve-stroke)" stroke-linecap="round"/>
</svg>
```
Zonas (en x del viewBox): **Etapa 1** 4–30 · **Etapa 2 (avance)** 30–54 ·
**Etapa 3 (techo)** 54–74 · **Etapa 4 (descenso)** 74–116. Pivot ≈ x=32.

### Uso A — Glifo por valor (`--curve-glyph-w` × `--curve-glyph-h`)
Curva en `--curve-track` + punto (`--curve-dot`) en la posición del valor:
- Vigilar: punto en (38, 22), color `--senal` — rompiendo pivot.
- Auditar: punto en (70, 10), color `--traza` — en techo, a examen.
- Descartar: punto en (96, 32), curva y punto en `--humo` — fuera de ciclo.

### Uso B — Chips de decisión
El chip NO es una píldora de color: es la curva con su **zona iluminada** (segmento
del path en la tiza semántica, resto en `--curve-track`) + label + conteo en mono.
El chip codifica el *porqué* de la decisión, no solo el veredicto.

### Uso C — Constelación de cabecera (`--curve-hero-h`)
La curva a lo ancho de la zona de resultados con la distribución del scan como
puntos a lo largo del ciclo (jitter vertical ±4px para densidad). Sustituye a
cualquier donut/gauge/KPI genérico.

### Estados derivados
- Carga: la curva se dibuja (stroke-dashoffset animado, 900ms, ease-out). Única
  animación permitida en la app junto a los fades existentes.
- Vacío / sin scan: solo el tramo de Etapa 1 (línea plana), texto en humo.

## 6. Migración desde tokens.css v1

Pantalla a pantalla: sustituir el import de `tokens.css` por `tokens-v2.css` cuando
la pantalla se re-ejecute. Los alias `--bg/--surface/--text/--muted/--line/--space-*`
conservan nombre. Mapeo de lo retirado:

| v1 | v2 |
|---|---|
| `--positive` | `--decision-vigilar` |
| `--negative`, `--warning` | `--risk` (revisar caso a caso: la mayoría de warnings pasan a tiza) |
| `--accent` (azul) | `--accent` → ahora `--senal` |
| `--gold`, `--gold2` | `--tiza` |
| `--lime`, `--red`, `--amber` | eliminar |
| Inter | Instrument Sans |
| JetBrains Mono | Spline Sans Mono |

## 7. Lo que esta dirección prohíbe (checklist para revisar cada pantalla ejecutada)

- [ ] ¿Hay más de un elemento `--senal` fuera de resultados? → quitar.
- [ ] ¿Algún número fuera de `--font-data`? → corregir.
- [ ] ¿Chips rojo/verde/ámbar, o rojo y verde enfrentados como veredicto? → curva de etapa.
- [ ] ¿Texturas, glows, sombras difusas, gradientes decorativos? → quitar (la tiza no brilla).
- [ ] ¿Display en minúsculas, en cifras o más de 3 veces? → corregir.
- [ ] ¿Hex, px de espaciado o font-family hardcodeados? → tokens.
