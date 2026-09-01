# Rúbrica VCP — producto y detector (sep 2026)

Documento de referencia para etiquetado tanda 3, gap mecánico y auditoría VCP-2.
Origen: conversación dueño + `research/contracciones/tanda3-etiquetas.md`.

## 1. Qué buscamos (north star)

Setup de **bajo riesgo**: corrección **estrecha al final** (volatilidad y tiempo
pequeños) dentro de una **tendencia primaria marcada**, seguida de ruptura en la
dirección de la tendencia (alcista o bajista fuerte).

- **Prioridad detector:** detectar la **reconfiguración** (nuevo episodio con pata
  final tight), no el fallo del intento anterior.
- **Producto en directo:** exponer el patrón **al momento presente**; si falla y
  reconfigura, **volver a proponer** al usuario el nuevo episodio.
- **Selectividad:** pocos candidatos de **calidad**; evitar volumen de señales
  fallidas que degraden confianza.

## 2. Contexto de mercado (gates)

| Gate | Preferido | Evitar |
|------|-----------|--------|
| Etapa Weinstein | **Etapa 2** (código MM30s + tendencia operativa) | Etapa 1 y 3 (bases largas, muchas contracciones anidadas) |
| Tendencia | Muy alcista o muy bajista, **marcada** | Lateral prolongado, sierra, etapa 1/3 confusa |
| RS / liderazgo | Alto respecto al universo (cuando aplique) | Rebotes sin liderazgo |
| Duración base | Pausa corta vs tendencia primaria | Meses de compresión múltiple |

## 3. Estructura del patrón (por episodio)

Cada **episodio** se juzga solo:

1. **Contracciones** decrecientes (ideal ≥2).
2. **Última contracción** tight — compresión real, no cheat/ruido intradía.
3. **Volumen** secándose en la pata final (evidencia, no único gate).
4. **Techo** claro para operativa pre-fuga / ruptura.

**Reconfiguración:** tras rotura fallida, nuevo episodio con pata final tight =
**nueva detección válida** (no fusionar con el intento anterior en producto).

## 4. Etiquetado research (retrospectivo)

| Veredicto | Criterio |
|-----------|----------|
| **BASE** | Estructura VCP válida en el periodo marcado (puede incluir fuga dentro del periodo). Dueño puede unir dos episodios (ej. VLO). |
| **POTENCIAL** | Periodo acaba **sin fuga** / base sin ruptura. |
| **NO** | Sierra, lateral perpetuo, falso patrón. |

Preguntas del brief (`chart-brief.mjs`):

- ¿Última contracción cheat / ruido?
- ¿Operable o solo estructura? → **por episodio**
- ¿BASE / NO / POTENCIAL? → **del periodo etiquetado**

**Desenlace** (rompe bien / mal / no rompe) = capa de medición; **no** define si
el setup era de bajo riesgo (ICE = BASE válida que no ganó).

## 5. Implicaciones detector / producto

| Capacidad | Estado deseado |
|-----------|----------------|
| Compresión final tight | Detectar en etapa 2 + tendencia marcada |
| Reconfig post-fallo | Nuevo evento, re-propuesta en mesa |
| Gate etapa 1/3 | No proponer (o penalizar fuerte) |
| Selectividad | Preferir falsos negativos a inundar con falsos positivos |
| Producción (`setupPatterns.js`) | Alinear con v4 research cuando pase gap |

## 6. Referencias

- Corpus: `research/contracciones/corpus-manual.json`
- Detector research: `research/contracciones/detector/v4.mjs`
- Producción: `lib/setupPatterns.js`
- Etiquetas dueño: `research/contracciones/tanda3-etiquetas.md`
- Gap mecánico: `docs/evidence/vcp-gap-mecanico-2026-09-01.md`
