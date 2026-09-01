# ADR — VCP: reconfiguración, selectividad y producto en directo

**Estado:** aceptado (dueño OK «apliquémoslo», 2026-09-01). Auditoría Grok 4.6 High.  
**Rama:** `codex/statsedge-ui-polish`  
**Sin código.** Entradas fijas: rúbrica sep-2026, arnés `rubric-gap.mjs` (JSON verificado), anclas dueño **HPE · VLO · MSI**.

---

## 0. Decisión (una página)

1. **Unidad de producto = episodio con pata final tight**, no el bloque multi-mes que el dueño puede unir en research. VLO unido (mar–jul) es etiqueta retrospectiva; la mesa propone VCP1 y, si falla y reconfigura, **VCP2 como evento nuevo**.
2. **Gap #1 = reconfig, no geometría del primer intento.** `VLO-tanda3::vcp1` @ 2026-05-15 ya es **v4 BASE**. `VLO-tanda3::vcp2` @ 2026-07-08 es **v4/v5 `reexpansion`**. Eso no se arregla relajando monotonía (v6) ni con la zona de salida de v5.
3. **Selectividad > recall bruto.** Preferir FN a inundar. Publicar v4 tal cual (4 FP en NO) es el camino a «producto cutre».
4. **Producción no hereda v4.** `setupPatternForBars.vcpCandidate` está en **0/13** BASE y **10/10** especificidad NO: silencio, no calidad. El puente es gates + episodios + cap de mesa, no copiar el prototipo.
5. **Desenlace (stop, win/loss, P&L) fuera de alcance** de producto. `VLO-tanda3::vcp1-fallo` es contexto, no objetivo del detector ni de la hunt card.

---

## 1. Evidencia numérica (arnés)

Fuente: `research/contracciones/resultados/rubric-gap-2026-09-01.json`  
`nCasos` **24** (21 corpus + MSI + HPE + VLO primario) · `nEvaluaciones` **27** (incluye 3 episodios VLO).  
Métricas de recall/especificidad = **solo filas `primary`** (los episodios no entran al 10/13).

| Detector | Recall BASE primary | Especificidad NO | FP | FN primary |
|----------|---------------------|------------------|----|------------|
| **v4** | **10/13 (77%)** | **6/10 (60%)** | NDAQ-2025-11, BEKE-2026-08, ELV-2026-08, MSGS-2026-08 | ICE-2026-01, DECK-2026-02, **VLO-tanda3** |
| **v5** | **9/13 (69%)** | **6/10 (60%)** | los mismos 4 | los 3 de v4 **+ IP-2026-02** (`fuera_de_rango`) |
| **prod** | **0/13 (0%)** | **10/10 (100%)** | ninguno | los 13 BASE (HPE aparece como `null` en `falseNegatives` porque el caso tanda3 **no tiene `id`**) |

**Recall de producto (rúbrica: etapa 2).** De los 13 BASE primary, el arnés marca etapa:

| Subconjunto | n | v4 hits | Lectura |
|-----------|---|---------|---------|
| BASE + `stage2` | 8 | **7/8** | Único miss: **VLO-tanda3** (bloque unido) |
| BASE + E1 (ICE, IP) | 2 | 1 (IP) | No son terreno de hunt VCP |
| BASE + E3 (DECK, FLG, HPE) | 3 | 2 (FLG, HPE) | Acierto geométrico, contexto incorrecto |

Episodios VLO (no primary; no mueven el 10/13):

| id | asOf | etapa | v4 | v5 | prod | motivo v4 |
|----|------|-------|----|----|------|-----------|
| VLO-tanda3 (primary) | 2026-07-08 | stage2 | no | no | no | `reexpansion` |
| **VLO-tanda3::vcp1** | **2026-05-15** | stage2 | **BASE** | BASE | no | `ok` |
| VLO-tanda3::vcp1-fallo | 2026-05-26 | stage2 | BASE | BASE | no | `ok` (contexto; desenlace fuera) |
| **VLO-tanda3::vcp2** | **2026-07-08** | stage2 | **no** | no | no | **`reexpansion`** |

MSI (`POTENCIAL`) es `n/a` en match: v4/v5 `reexpansion`, prod no. No cuenta como FN ni FP.

---

## 2. Pregunta 1 — Qué falta para detectar reconfig (VLO)

### 2.1 Qué ya funciona

El primer episodio **sí se ve en pre-ruptura**, que es el momento de producto. Dueño: ruptura 2026-05-18; detectar **antes**. Arnés: `::vcp1` @ 2026-05-15 → v4/v5 BASE, etapa 2 confirmada.

Optimizar el bloque unido `VLO-tanda3` @ 2026-07-08 es el **criterio equivocado**: el dueño puede unir episodios en research; el detector y la mesa no.

### 2.2 Causa mecánica (v4.mjs, no hipótesis suelta)

v4 hace tres cosas incompatibles con un segundo episodio:

1. **Un ancla por ventana de 140 barras:** elige el máximo más alto entre las primeras contracciones ≥ 3,5× ATR. Tras el fallo de VCP1, ese techo sigue siendo el de VCP1.
2. **`reexpansion` aborta la ventana entera** (no cierra un episodio y sigue). Tras el stop ~26-may, un tramo más profundo que la última pata tight de VCP1 dispara `return rejL("reexpansion")`. Por eso vcp1 y vcp1-fallo siguen BASE (la secuencia VCP1 aún decrece) y vcp2 no.
3. **Lookback único, sin origen post-fallo.** No hay `episodeId`, ni recorte de pivotes posteriores al cierre de episodio, ni re-techo.

Esto es **R6** del corpus (`reglasPendientes.R6_reconfiguracion`): «falla la ruptura y se rehace… el detector lo ve como reexpansion». NDSN ya no es el ejemplo limpio (v4 match @ 2026-08-19). **VLO vcp2 sí lo es.**

### 2.3 Qué no es la solución

| Prototipo | Por qué no cierra VLO vcp2 |
|-----------|----------------------------|
| **v5** | La zona de salida corre **después** de construir `seq`. Si `seq` ya murió en `reexpansion`, la banda no se evalúa. Si sobreviviera, una salida sostenida hace >10 sesiones da `fuera_de_rango` (IP) — **no arranca un episodio nuevo**. Arnés: vcp2 sigue `reexpansion`. |
| **v6** | Relaja monotonía para **fusionar** un repunte intermedio en **una** secuencia. Eso es lo contrario de reconfig: mezclaría VCP1+VCP2. README: en universo añade 8 nombres que rinden peor. **Prohibido como parche de reconfig.** |
| **prod `failedBreakout`** | Ya existe (`setupPatterns.js`: high sobre pivote 65d en 10 barras + close bajo + volumen ≥1,1×). Pinta `patternFamily = failed_breakout` y **bloquea** el camino a `vcpCandidate`; **no** re-ancla ni re-propone. |

### 2.4 Qué hay que construir (research, VCP-3-reconfig)

Contrato de aceptación **medido en el arnés**, no en el bloque unido:

1. **Cerrar episodio N** cuando el precio sale del techo del episodio y **cierra de vuelta debajo** en ≤ X sesiones (VLO: 18-may → fallo ~26-may). X se calibra; no congelar aquí.
2. **Invalidar el ancla N.** El lookback de N+1 empieza en el máximo post-fallo (nuevo techo), no en el máximo de 140 barras.
3. **Si aparece `reexpansion` a mitad de `seq`:** no abortar el símbolo. Cerrar N si ya tenía ≥2 contracciones y última pata ≤ `lastContractionMaxAtr` (3× ATR hoy); reintentar ancla entre las patas **posteriores**.
4. **Exigir pata final tight en N+1** (misma puerta v4: última ≤ 3× ATR del ATR del ancla nuevo). Sin esa pata, no hay propuesta — da igual que VCP1 existiera.
5. **Gates.** VLO vcp2 ya es `stage2` en el arnés; G1 no es el bloqueo. El miss es estructural.

**Aceptación:** `VLO-tanda3::vcp2` → match; `::vcp1` sigue match; primary unido puede quedar miss/`n/a` (unidad incorrecta). Prod puede seguir en no hasta el puente (§5).

---

## 3. Pregunta 2 — Gates etapa 2 + tendencia vs FP y anclas

### 3.1 G1 etapa: `weeklyStage` solo no basta; usar STAGE-1

v4 ya exige MM30s (150d) con pendiente > 0 (`contexto_no_etapa2`). Aun así:

| Caso | `weeklyStage` arnés | v4 | Qué hace G1 |
|------|---------------------|----|-------------|
| **BEKE** NO | **stage1** | BASE (FP) | G1 `stage2` lo mata |
| **ICE** BASE research | stage1 | no | FN research; **OK producto** (E1 no es hunt) |
| **IP** BASE research | stage1 | BASE | G1 lo saca de mesa (v5 ya lo saca por `fuera_de_rango`) |
| **DECK** BASE research | stage3 | no | OK producto |
| **FLG** BASE research | stage3 | BASE | G1 lo saca |
| **HPE** BASE dueño | **stage3 confirmada** | BASE | **Suprimir en producto** |
| **NDAQ, ELV, MSGS** NO | **stage2** | BASE (FP) | G1 **no** los mata |
| **MSI** POTENCIAL | **stage2 confirmada** | no | G1 MM30s **no** basta |

Conflicto documentado: `tanda3-etiquetas.md` dice HPE «Código: Etapa 2 (MM30s)»; el arnés @ 2026-04-17 dice **Etapa 3 confirmada**. **Manda el JSON.** Producto no propone VCP en E3 aunque v4 vea forma (~5 contracciones, lateral previo).

**MSI** es el ancla de selectividad: etapa 2 de código + Pre-fuga (~−1,7% al techo) **y** base larga ~11 meses, ~3 patas, **sin** tendencia marcada + tight. STAGE-1 ya clasifica el patrón MSI-like como `E2_ma_only` (tests `weeklyStageStructure.test.js`). **G1 de producto = `weeklyStage === stage2` AND `weeklyStageStructure !== E2_ma_only` para caza VCP de calidad** — o, en positivo, exigir tendencia marcada (G2) de modo que `E2_ma_only` / caja larga no entre.

No tocar `weeklyStage.js`. Reutilizar el campo paralelo STAGE-1 (`lib/weeklyStageStructure.js`).

### 3.2 G2 tendencia marcada + G3 pata tight (los 3 FP que sobreviven G1)

Tras G1, los FP restantes son **NDAQ, ELV, MSGS** (todos stage2, v4 `ok`). Especificidad subiría de 6/10 a **7/10**; sigue siendo insuficiente para mesa.

| FP | Por qué el dueño dijo NO | Qué no lo caza hoy |
|----|---------------------------|--------------------|
| **NDAQ** | Primera contracción **2,7× ATR**; geometría limpia no basta (`corpus-manual`) | v4 exige 3,5× y **aun así** marca BASE: o ancla otra pata del lookback 140, o el ATR del ancla no es el del dueño. `displacementMaxRatio` 0,6 se documentó contra NDAQ (+1,23) y **no dispara** (motivo `ok`). |
| **ELV / MSGS** | R3: gráfico errático, no liquidez | Ni etapa ni ATR ni lateralidad v4 |

**HPE:** G1 E3 basta para mesa. No hace falta un gate extra «lateral» si E3 ya corta; sí hace falta no tratar el match v4 como luz verde.

**MSI:** v4 ya rechaza (`reexpansion`). El riesgo de producto es **promover por Pre-fuga / etapa 2 de código** sin VCP tight. G1 estructural + «no cazar `E2_ma_only` como VCP calidad» es la regla MSI.

**G2 / G3 a calibrar en VCP-3-gates (no congelar umbrales aquí):**

- G2: pausa **corta** vs tendencia primaria (duración de episodio, no 65d de prod). MSI falla; VLO vcp1/vcp2 pasan. Cerca de extremo 52s **como evidencia**, no como copia ciega del 88% de v3 (dejaba pasar ICE).
- G3: primera contracción en ATR **del ancla del episodio** (arreglar fuga NDAQ) + última pata ≤ 3× ATR + (opcional) volumen seco **dentro** de la última pata, como en v4 (`volDryMax` 1,5 es cordura, no discriminante; prod 0,85 es demasiado estricto y **no** discrimina, ver `medicionesClave.volumen`).
- Limpieza de trazo (R3, ELV/MSGS): **no inventar métrica en este ADR**. Si G2+G3 no los cortan, **se quedan fuera de mesa por cap + score**, no se bajan umbrales para recuperarlos.

**Aceptación de gates (arnés, primary + episodios):**

- HPE: no propuesta producto (E3).
- MSI: no propuesta calidad (aunque stage2).
- BEKE: no propuesta (E1).
- NDAQ + ELV + MSGS: 0 propuestas (o ≤1 si el dueño relaja un caso con evidencia nueva).
- No sacrificar los 7 BASE stage2 que v4 ya acierta (GOOGL, PNC, KO, MPC-asc, FCX, NDSN, QRVO) ni `VLO::vcp1`.

---

## 4. Pregunta 3 — Selectividad de producto

North star de la rúbrica: **pocos setups de calidad**; corrección estrecha al final en tendencia marcada; **re-propuesta** si reconfigura; **desenlace fuera**.

| Superficie | Comportamiento |
|------------|----------------|
| **Mesa / hunt card VCP** | AND de G1–G3 **en el momento presente** (episodio activo, pata tight, aún no resuelto). Ordenar por RS + tightness. **Cap duro** (calibrar en uso; orden de magnitud decenas, no cientos de bases v4). |
| **Tras fallo + reconfig** | Retirar la propuesta del episodio N (dejó de ser el setup vigente). Si N+1 cumple gates, **volver a listar** con `episodeId` nuevo. No mostrar «falló el 26-may». |
| **MSI-like** | Suprimir del hunt calidad aunque Pre-fuga. Detectar un episodio tight **si aparece después**; este bloque no es candidato. |
| **HPE-like** | Fuera (E3 / topping). Research puede seguir etiquetando BASE. |
| **UI de ficha** | Puede seguir el diagnóstico actual (`setupPatterns`) como laboratorio. **No** es la lista cazable. |
| **Desenlace** | Ni stop automático, ni win rate, ni ICE-como-aviso. Capa de medición futura, no mesa. |

`NO` del etiquetado es el único veredicto duro. BASE vs POTENCIAL es retrospectivo (¿había roto al cierre del periodo?). En directo ambos son «pre-fuga» si el patrón está vivo; MSI se suprime por **calidad/contexto**, no porque el veredicto se llame POTENCIAL.

Tanda 3-alcista (RS alto) permanece **pausada**.

---

## 5. Pregunta 4 — Prod 0/13 vs v4: migración sin inundar

### 5.1 Por qué prod está en cero (y eso no es un bug de calibración menor)

`vcpCandidate` exige **todas** estas puertas (`lib/setupPatterns.js`):

- `patternEligible` + `consolidationCandidate` (ventana **65** sesiones, no 140)
- **≥3** contracciones decrecientes (v4: ≥2; GOOGL es taza de 2 — R4)
- `volumeDryUpRatio ≤ 0,85` (media 10/50, **no** volumen dentro de la última pata; corpus: 0,85 quitaba positivos y ningún negativo)
- `base.depthPct ≤ 35`
- `structuralContractions` aún tiene **`lower_low_drift`** y **`ceiling_break`** (+4% sobre techo) — v4 los quitó a propósito

Además `failedBreakout` se come la familia y no reconfigura. El arnés solo cuenta `vcpCandidate === true`, no `pivot_squeeze` ni `tight_base`. **0/13 es el diseño actual**, no un fallo del JSON.

v4 10/13 con 4 FP es el otro extremo: recall de laboratorio, no lista.

### 5.2 Camino (no copiar v4 a `setupPatterns`)

| Fase | Dónde | Qué | Gate de salida |
|------|-------|-----|----------------|
| **0** | Prod | Dejar `vcpCandidate` como está. 0/13 esperado. No encender hunt VCP sobre ese flag. | — |
| **1** | Research | Detector de **episodios** (v4 + cierre/re-ancla). Arnés: match `::vcp2` + `::vcp1`. **No v6.** | `VLO-tanda3::vcp2` match; primary unido irrelevante |
| **2** | Shadow | Flag research + G1 STAGE-1 + G2/G3. Columna/diagnóstico, **no** filtra la mesa. Medir N candidatos / scan. | FP NDAQ/BEKE/ELV/MSGS = 0 en shadow; HPE/MSI fuera |
| **3** | Mesa | Hunt calidad = shadow AND cap. Re-propuesta = nuevo `episodeId`. | Dueño: «pocos y creíbles» en uso real |
| **4** | Prod | Sustituir o envolver `vcpCandidate` **solo** con el detector que pasó 1–3. Hasta entonces, recall 0 en prod es correcto. | No antes de VLO vcp2 + FP controlados |

**Prohibido:** `vcpCandidate = detectV4()` en el scan. Inundaría con NDAQ/ELV/MSGS/BEKE/HPE.

---

## 6. Modelo de episodios

```
G1 etapa 2 operativa (no E2_ma_only / E1 / E3)
  + G2 tendencia marcada, pausa corta
    → Episodio N: ≥2 contracciones, última tight (G3)
        → Mesa: propuesta pre-fuga
        → [fallo / stop — no UI]
    → Cerrar N; re-techo; lookback desde post-fallo
    → Episodio N+1: misma geometría tight
        → Mesa: nueva propuesta (otro episodeId)
```

- Persistir `episodeId` + ventana en research (`tanda3-gap-casos.json` ya tiene el patrón).
- **No** fusionar VLO1+VLO2 en una caja de producto.
- Métricas del arnés: hoy `summarizeDetector` ignora `primary: false`. VCP-3 debe reportar **recall por episodio reconfig** además del 10/13 primary.

Higiene: asignar `id: "HPE-tanda3"` (hoy `falseNegatives` prod incluye `null`).

---

## 7. Fuera de alcance (explícito)

- P&L, stops, win rate, «falló antes» en UI.
- Etapa 1 / 3 como terreno principal del hunt VCP (ICE, DECK, FLG, HPE, IP).
- Migrar v4/v5/v6 a producción sin fases 1–3.
- Usar v6 (monotonía relajada) como reconfig.
- Usar v5 `fuera_de_rango` como cierre de episodio.
- Tanda 3-alcista (pausada).
- Recodificar `weeklyStage.js`.
- Bajar `firstContractionMinAtr` o `volDryMax` para subir recall.
- Tratar el bloque unido VLO @ 07-08 como aceptación del detector.

---

## 8. Próximos tickets (VCP-3)

| # | Ticket | P | Alcance |
|---|--------|---|---------|
| 1 | **VCP-3-reconfig** | **P0** | Research: cierre de episodio + re-ancla. Aceptación `VLO-tanda3::vcp2` match y `::vcp1` intacto. Sin prod. |
| 2 | **VCP-3-gates** | **P0** | G1 STAGE-1 + G2/G3 medidos contra NDAQ/ELV/MSGS/BEKE/HPE/MSI. Dump `primeraEnAtr` / `dispRatio` en el JSON del arnés. |
| 3 | **VCP-3-arnes-episodios** | P1 | Recall episodio en `summarizeDetector`; `id` HPE; no contar bloque unido como único FN de VLO. |
| 4 | **VCP-3-prod-bridge** | P2 | Solo tras 1+2. Shadow → hunt con cap. No `vcpCandidate = v4`. |

Cola operativa ya anotada en backlog: VCP-3-reconfig → VCP-3-gates → (bridge más tarde). No mezclar con nocturno Pre-fuga ni carga/premium.

---

## 9. Refutaciones al borrador orquestador

| Borrador | Este ADR |
|----------|----------|
| Estado «aceptado (borrador dueño)» | **Propuesto** hasta OK dueño de esta pasada |
| «v5/v6, sin implementar» como dirección de reconfig | **v5 no re-ancla; v6 fusiona.** Dirección = episodio nuevo sobre v4 |
| G1 «penalizar E1/E3» y MSI «falla E1-like» en la misma tabla | MSI es **stage2 confirmada** en el arnés; se corta con STAGE-1 `E2_ma_only` + G2, no con `weeklyStage` |
| Recall 10/13 como norte | Norte = **7/8 stage2 + vcp2**; los 3 BASE E1/E3 que v4 acierta no deben ir a mesa |
| Cap 20–40 como número | Orden de magnitud; **calibrar en fase 3** |
| G1 «pendiente MM30s (v4 ya filtra slope)» | Esa puerta **ya está** y deja 3 FP stage2 + HPE E3 |

---

## 10. Referencias

- `docs/rubrica-vcp-producto-2026-09-01.md`
- `docs/evidence/vcp-gap-mecanico-2026-09-01.md`
- `research/contracciones/resultados/rubric-gap-2026-09-01.json`
- `research/contracciones/tanda3-etiquetas.md`
- `research/contracciones/tanda3-gap-casos.json`
- `research/contracciones/detector/v4.mjs` (ancla + `reexpansion`)
- `research/contracciones/detector/v5.mjs` / `v6.mjs` (no son el parche)
- `lib/setupPatterns.js` (`vcpCandidate`, `failedBreakout`)
- `lib/weeklyStageStructure.js` (STAGE-1, MSI)
- `docs/auditoria-etapa1-etapa2-2026-09-01.md`
- `research/contracciones/corpus-manual.json` → `R6_reconfiguracion`, R3, NDAQ
