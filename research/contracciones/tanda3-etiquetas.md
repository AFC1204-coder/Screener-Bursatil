# Tanda 3 — etiquetas del dueño (borrador)

No entra en `corpus-manual.json` hasta cierre de tanda. Formato libre; una línea por símbolo.

## Convención BASE / POTENCIAL / NO (solo research, a posteriori)

- **Producto en vivo:** si el usuario ve un patrón detectado, aún **no ha roto** — ahí POTENCIAL vs BASE importa poco; el contexto ya es «pre-fuga».
- **Etiquetado tanda 3 (mirando atrás):** conviene **no mezclar** casos que ya rompieron con los que siguen dentro de la caja:
  - **POTENCIAL** — periodo acaba **sin fuga** / base larga sin ruptura (ej. MSI).
  - **BASE** — base VCP válida como estructura; puede incluir **fuga ya ocurrida** dentro del periodo (ej. HPE oct→abr + breakout).
  - **NO** — no es base / sierra / falso patrón.

`NO` sigue siendo el único veredicto duro. Entre BASE y POTENCIAL, en retrospectiva, manda **¿había roto al cierre del periodo que etiquetas?**

## Dos niveles de juicio (dueño, sep 2026)

| Pregunta | Qué responde | Cuándo |
|----------|--------------|--------|
| **¿BASE / NO / POTENCIAL?** | ¿La **estructura** que marcas es una base VCP válida? | Etiquetado retrospectivo del periodo |
| **¿Operable o solo estructura?** | ¿En el **momento del patrón** había setup operable (contracción + contexto)? | Por **cada** VCP, no solo al cerrar el bloque |
| **¿Última contracción cheat / ruido?** | ¿La pata final es compresión real o ruido intradía/lateral? | Por patrón; una pata <3 % puede ser operable **o** cheat según volumen y techo |

**Producto (objetivo detector):** lo que importa no es registrar el **fallo** del intento anterior, sino detectar la **reconfiguración** — el patrón que sigue con **corrección estrecha al final** (setup de **bajo riesgo**). Da igual si antes falló o no; sin esa compresión final no es lo que buscamos. El **desenlace** (rompe bien / mal / stop) es capa aparte para medición futura; **de momento el producto no entra** en si la operación va bien o mal — solo detectar el setup antes de la ruptura.

En retrospectiva el dueño puede unir episodios en un BASE (ej. VLO); el detector marca **cada** compresión operable por separado. Caso limpio: un solo patrón estrecho y rompe — una detección basta.

**Producto en directo (sep 2026):** en los gráficos que analizamos el patrón **a menudo ya se ha dado** — la mesa debe **exponer** esa lectura al momento presente (no solo retrospectiva de research). Si el setup falla y el precio **reconfigura** con otra corrección estrecha, la herramienta **vuelve a proponer** al usuario el nuevo episodio; no se queda anclada al intento anterior ni al desenlace pasado.

**Selectividad (sep 2026):** pocos patrones pero **de calidad** — mejor escasez creíble que muchos fallidos que den sensación de producto cutre. Enfocar a **tendencias muy marcadas** (alcistas o bajistas fuertes): ahí la base suele ser corrección **pequeña en volatilidad y tiempo** respecto a la tendencia primaria, y luego rompe en su dirección. **Evitar etapa 1 y etapa 3** — bases más duraderas, muchas contracciones dentro del mismo bloque, lectura confusa; no es el terreno donde este patrón opera mejor.

## HPE

```
HPE · BASE · PERIODO: 2025-10-13→2026-04-17 · ~5 contracciones decrecientes · vol secándose · fuga reciente · base decente tanda 3
```

- **Código:** Etapa 2 (MM30s)
- **Operativo:** Con fuga (post-base VCP)
- **Nota:** brief automático = dudoso (pivotes diarios no ven monotonía; rng26 mecánico alto). Lectura manual con líneas de contracción (captura 2026-09-01).

## VLO

```
VLO · BASE · PERIODO: 2026-03-31→2026-07-08 · VCP1 falló en rotura · VCP2 = reconfiguración · fuga final ~jul
```

- **Código:** Etapa 2 (MM30s)
- **Operativo:** Con fuga (coincide brief mecánico +12,5%)
- **VCP1:** ruptura al alza **2026-05-18** · stop / patrón roto operativamente **~2026-05-26** (mañana). Producto: detectar **antes** de la ruptura; desenlace (stop, reconfig) **fuera de alcance** por ahora.
- **VCP2:** reconfig → fuga final dentro del bloque **2026-03-31→2026-07-08**.
- **Detector (meta):** prioridad = **reconfiguración** con corrección final estrecha (setup bajo riesgo), no el fallo previo. Debe marcar cada episodio así válido por separado; el fallo del VCP1 es contexto, no el objetivo.
- **Operabilidad:** VCP1 pudo ser operable en su rotura aunque fallara; VCP2 es la segunda oportunidad. «Solo estructura» vs «operable» se juzga **por patrón**, no solo al final del bloque.
- **Nota:** patrón didáctico «fallo + reconfig». Captura: `tanda3-capturas/VLO-2026-03-31_2026-07-07.png`

## MSI

```
MSI · POTENCIAL · PERIODO: 2025-09-11→2026-08-31 · ~3 contracciones visibles · base larga · sin fuga al cierre · ancla selectividad
```

- **Código:** Etapa 2 (MM30s)
- **Operativo:** Pre-fuga (~−1,7% techo) pero **periodo acaba sin ruptura clara** del bloque etiquetado → **POTENCIAL** retrospectivo.
- **Dueño:** tres líneas de contracción (sep-25, mar–jul-26, ago-26); contexto **no** tendencia alcista marcada + base tight — contraste «no promover» en producto.
- **Producto:** detectar episodios tight si aparecen; este bloque = ejemplo de **mucho ruido / E1-like** vs etapa 2 operable.
- **Nota:** brief = profundidades no decrecientes, RS 60. Captura: `tanda3-capturas/MSI-2025-09-11_2026-08-31.png`

## Tanda 3-alcista (pausada 2026-09-01)

Propuesta RS alto + base estrecha; dueño: «ninguna muy clara» — **no es el foco ahora**. Seguimos tanda original / reconfig (HPE, VLO, pendientes congelados si retoman).
