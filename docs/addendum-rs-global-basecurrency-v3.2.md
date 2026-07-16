# Addendum de diseño aprobado — `RS global(baseCurrency)` v3.2

- **Versión:** 3.2
- **Fecha:** 2026-07-16
- **Rama de referencia:** `codex/statsedge-ui-polish`
- **Estado:** contrato de diseño aprobado; sin implementación autorizada
- **Alcance:** definición futura de una RS global convertida a moneda base, aislada del snapshot canónico y del scoring

## 1. Propósito y nombre UX

Este addendum registra el contrato de diseño aprobado para una futura métrica analítica denominada conceptualmente:

```text
RS global(baseCurrency)
```

Su nombre visible será uno de los siguientes, según la preferencia activa:

```text
RS global · USD
RS global · EUR
```

USD será la moneda base por defecto. EUR podrá seleccionarse por preferencia de usuario. Solo habrá una columna visible a la vez.

Este documento no implementa la métrica, no modifica el pipeline actual, no autoriza escrituras y no cierra Camino A.

## 2. Métrica nueva y separación de la RS actual

`RS global(baseCurrency)` será una métrica analítica nueva y distinta del `rsGlobalPct` actual.

En consecuencia:

- no es un cambio de nombre de `rsGlobalPct`;
- no es una reinterpretación transparente de sus valores;
- no promete compatibilidad numérica retrospectiva con la RS actual;
- no permite reescribir valores históricos de `rsGlobalPct` para simular la nueva metodología;
- tendrá una identidad metodológica propia y una `methodologyVersion` explícita.

El código actual calcula y expone `rsGlobalPct` dentro del modelo de percentiles existente; esa realidad se documenta en [`lib/relativeStrength.js`](../lib/relativeStrength.js). Este addendum no redefine ese campo.

## 3. RS local

La RS local permanece separada y sin FX. Compara el instrumento frente a su benchmark local utilizando precios en la moneda local.

No depende de:

- `baseCurrency`;
- tipos de cambio;
- cobertura FX;
- forward-fill FX;
- disponibilidad de un proveedor FX.

Los benchmarks locales vigentes y la lógica de comparación se encuentran en [`lib/relativeStrength.js`](../lib/relativeStrength.js). La futura RS global no sustituye ni redefine esa ruta local.

## 4. Aislamiento absoluto del scoring

Ninguna métrica dependiente de FX puede entrar en:

```text
objectiveScore
compositeScore
totalScore
```

La prohibición comprende, entre otras:

- RS global en USD o EUR;
- retornos o momentum convertidos;
- percentiles derivados de series convertidas;
- cobertura, calidad o antigüedad FX.

La métrica será exclusivamente analítica y de lectura. No podrá modificar directamente los scores ni alterar indirectamente sus inputs para introducir una dependencia FX encubierta.

El contrato vigente de coherencia de señales y scoring se documenta en [`docs/audit-score-coherence-contract.md`](./audit-score-coherence-contract.md).

## 5. Snapshot canónico inmutable

El snapshot canónico y sus filas en `scan_results` serán inmutables frente a cualquier preferencia USD/EUR.

La finalización actual persiste atómicamente percentiles, `sectorScore` y scores canónicos. Su comportamiento está documentado e implementado en [`lib/scanPercentileFinalization.js`](../lib/scanPercentileFinalization.js).

La futura vista derivada no podrá escribir ni sobrescribir ningún campo de `scan_results`. La prohibición incluye expresamente:

```text
rsGlobalPct
objectiveScore
compositeScore
totalScore
percentileScope
```

Cambiar USD por EUR, o EUR por USD:

- no ejecutará otro scan canónico;
- no refinalizará resultados;
- no mutará el snapshot;
- no recalculará scores canónicos;
- no modificará la RS local;
- no cambiará `percentileScope`.

## 6. Identidad de la vista derivada

La proyección de lectura se identificará inequívocamente por:

```text
(canonicalScanId, baseCurrency, methodologyVersion)
```

Donde:

- `canonicalScanId` identifica el snapshot y universo canónicos de referencia;
- `baseCurrency` será USD o EUR conforme a la preferencia;
- `methodologyVersion` identifica de forma reproducible la metodología completa.

Cambiar de moneda base seleccionará o calculará otra proyección derivada. No producirá un scan nuevo ni modificará el scan existente.

Cualquier cambio material en fórmula, ventanas, ponderaciones, fuente FX, as-of, cruces, `fxMaxAge`, cobertura, universo o normalización exigirá una nueva `methodologyVersion`.

## 7. Convención FX obligatoria

Sean:

- `C`: moneda local del instrumento;
- `B`: moneda base seleccionada;
- `t`: sesión o instante aplicable.

Se define:

```text
FX[C→B](t)
```

como las unidades de moneda base `B` obtenidas por una unidad de moneda local `C`.

La fórmula canónica obligatoria es:

```text
priceInBase(t) = localPrice(t) × FX[C→B](t)
```

La convención queda cerrada en este contrato. La implementación no podrá decidir entre multiplicar y dividir según el ticker, el proveedor o una convención implícita.

### 7.1 Par directo

Si el proveedor entrega `FX[C→B]`, se usa el valor normalizado en la fórmula canónica.

### 7.2 Par inverso

Si el proveedor entrega `FX[B→C]`, se normaliza primero mediante:

```text
FX[C→B](t) = 1 / FX[B→C](t)
```

Después se aplica la fórmula canónica por multiplicación.

### 7.3 Moneda local igual a moneda base

Si `C = B`:

```text
FX[C→B](t) = 1
priceInBase(t) = localPrice(t)
```

No será necesaria una consulta FX externa, pero la cobertura deberá identificar que no se requirió conversión.

### 7.4 Cruces

Si se usa una moneda intermedia `X`:

```text
FX[C→B](t) = FX[C→X](t) × FX[X→B](t)
```

Cada pierna deberá declarar y conservar:

- moneda origen y destino;
- orientación entregada por el proveedor;
- orientación normalizada;
- inversión aplicada, si existe;
- proveedor e identificador de la serie;
- fecha fuente;
- estado de cobertura;
- `fxObservationDate` y `fxPublishedAt`, cuando existan.

Cada pierna deberá superar por separado las reglas temporales, de antigüedad y cobertura. Si una pierna no es válida o apta, el cruce completo tampoco lo será.

## 8. Anti-lookahead y alineación temporal

Para cada sesión del instrumento solo podrá usarse el último FX que cumpla simultáneamente:

1. haber sido observado en o antes de la sesión; y
2. haber estado públicamente disponible antes o en el cierre/as-of aplicable de esa sesión.

Cuando los metadatos estén disponibles, la elegibilidad deberá satisfacer:

```text
fxObservationDate ≤ sessionDate(t)
fxPublishedAt ≤ asOf(t)
```

La fecha de observación por sí sola no demuestra ausencia de lookahead. Un dato observado en una fecha anterior o igual no será elegible si se publicó o estuvo disponible después del cierre/as-of evaluado.

Quedan prohibidos:

- datos observados después de la sesión;
- datos publicados o disponibles después del cierre/as-of;
- backfill desde una fecha futura;
- interpolación que use observaciones posteriores;
- cualquier otra incorporación de información futura.

La metodología deberá distinguir, cuando el proveedor lo permita:

- `fxObservationDate`: fecha o periodo económico de la observación;
- `fxPublishedAt`: timestamp de publicación o disponibilidad pública;
- `fxSourceDate`: fecha de la observación efectivamente seleccionada.

`fxSourceDate` no sustituye a `fxPublishedAt` como prueba de disponibilidad temporal.

Si el proveedor no permite demostrar cuándo estuvo públicamente disponible el dato, la limitación deberá declararse. La metodología deberá decidir expresamente si el par es apto, si requiere un desfase conservador, si debe sustituirse la fuente o si el resultado debe ser `null`. No podrá presumirse silenciosamente que la fecha de observación equivale a disponibilidad pública.

Esta política evita lookahead sin excluir injustificadamente mercados con festivos, sesiones, cierres o zonas horarias distintos de los de la fuente FX.

## 9. Forward-fill y `fxMaxAge`

No se exige una observación FX exacta en la fecha de cada barra. Se permite usar el último dato elegible anterior mediante forward-fill, pero solo dentro de:

```text
fxMaxAge
```

`fxMaxAge` es un parámetro de política pendiente de decisión humana y deberá formar parte de la metodología versionada.

Cuando se use forward-fill dentro del límite, la proyección deberá exponer al menos:

```text
fxCoverage: "forward-filled"
fxSourceDate
```

Y, cuando existan:

```text
fxObservationDate
fxPublishedAt
```

La métrica devolverá:

```text
value: null
```

con cobertura y causa explícitas cuando:

- no exista una observación previa elegible;
- la última observación supere `fxMaxAge`;
- el dato no hubiera estado públicamente disponible en el as-of;
- no pueda demostrarse su disponibilidad y la política no declare apto el par;
- falte una pierna válida de un cruce;
- la serie o fuente FX no esté disponible.

Nunca se inventará un valor mediante paridad, cero, medias, backfill futuro u otra sustitución no definida. La única paridad automática permitida es el caso contractual `C = B`, donde `FX = 1`.

## 10. Cobertura real y comunicación

La proyección deberá declarar cobertura real tanto por mercado como por FX. No podrá presentarse como cobertura global completa un universo que sea:

- parcial;
- `gap`;
- `deferred`;
- carente de FX apto;
- temporalmente no demostrable;
- insuficiente por datos o metodología.

La cobertura deberá distinguir como mínimo:

- conversión directa elegible;
- conversión inversa normalizada;
- cruce válido;
- `C = B` sin conversión;
- forward-fill dentro de `fxMaxAge`;
- observación demasiado antigua;
- ausencia de observación previa;
- publicación posterior al as-of;
- disponibilidad temporal no demostrable;
- par o fuente no aptos;
- pierna inválida de un cruce;
- mercado parcial, `gap` o `deferred`.

Los resultados `null` no podrán convertirse en cero ni incorporarse silenciosamente al denominador de un percentil. El universo elegible, el tamaño efectivo de muestra y las exclusiones deberán ser visibles y auditables.

El modelo actual de cobertura, sus estados por mercado y la prohibición de interpretar ceros degradados como cobertura completa se encuentran en [`lib/coveragePlan.js`](../lib/coveragePlan.js).

## 11. Persistencia derivada y caché

Si posteriormente se autoriza una caché o materialización, deberá estar fuera de `scan_results`, no tendrá autoridad canónica y usará la clave completa:

```text
(canonicalScanId, baseCurrency, methodologyVersion)
```

Además deberá:

- evitar colisiones entre USD y EUR;
- evitar colisiones entre versiones metodológicas;
- conservar procedencia y cobertura FX;
- ser reproducible e invalidable;
- no participar en la finalización canónica;
- no escribir scores ni percentiles canónicos.

El modelo concreto de cálculo bajo demanda, caché o materialización permanece pendiente de decisión humana.

## 12. Camino A

Camino A tiene:

```text
0 divergencias pendientes
```

y está listo para cierre formal.

No está cerrado automáticamente. El estado auditable actual también consta en [`docs/audit-score-coherence-contract.md`](./audit-score-coherence-contract.md).

Este documento no cierra Camino A y no sustituye la decisión humana formal requerida.

## 13. Puerta de implementación

No se implementará ninguna parte de `RS global(baseCurrency)` hasta que concurran, en orden, ambas condiciones:

1. cierre humano formal de Camino A; y
2. autorización explícita posterior para implementar.

El cierre formal no constituye por sí solo autorización de implementación.

Hasta entonces quedan fuera de alcance:

- cambios de código o esquema;
- migraciones;
- escrituras en `scan_results` o Supabase;
- ingesta o materialización FX;
- cambios de scoring;
- integración UI;
- backfills, scans o despliegues.

## 14. Invariantes y pruebas mínimas futuras

Antes de cualquier activación deberán existir pruebas que demuestren, como mínimo:

1. El nombre UX por defecto es `RS global · USD`.
2. La preferencia EUR muestra `RS global · EUR` y solo una columna a la vez.
3. La nueva métrica es distinta de `rsGlobalPct` y no promete compatibilidad retrospectiva.
4. La RS local sigue separada, sin FX y frente a benchmark local.
5. Cambiar USD/EUR no modifica el snapshot canónico ni `scan_results`.
6. La proyección no escribe ni sobrescribe `rsGlobalPct`, `percentileScope`, `objectiveScore`, `compositeScore` o `totalScore`.
7. Ninguna métrica FX entra directa o indirectamente en el scoring.
8. La proyección se identifica por `(canonicalScanId, baseCurrency, methodologyVersion)`.
9. Un par directo aplica `priceInBase = localPrice × FX[C→B]`.
10. Un par inverso aplica primero `FX[C→B] = 1 / FX[B→C]` y después multiplica.
11. Un cruce declara y valida cada pierna, orientación, fuente y fecha.
12. Cuando `C = B`, se usa `FX = 1` sin consultar una serie externa.
13. No se usa ninguna observación posterior a la sesión.
14. No se usa ningún dato publicado o disponible después del cierre/as-of, aunque su observación sea anterior o igual.
15. No se usa backfill futuro ni interpolación con datos posteriores.
16. Se distinguen `fxObservationDate`, `fxPublishedAt` y `fxSourceDate` cuando el proveedor los permite.
17. La imposibilidad de demostrar disponibilidad temporal se declara y aplica la política de aptitud correspondiente.
18. El forward-fill solo se permite dentro de `fxMaxAge` y expone `fxCoverage: "forward-filled"` y `fxSourceDate`.
19. La falta de cobertura, antigüedad excesiva o falta de aptitud produce `value: null` con causa explícita.
20. Los `null` no se transforman en cero ni en un valor inventado.
21. La cobertura se declara por mercado y por FX; universos parciales, `gap`, `deferred` o sin FX apto no se presentan como globales completos.
22. USD, EUR y distintas `methodologyVersion` no colisionan en una eventual caché.
23. Un fallo FX no invalida ni muta el scan canónico.
24. No se activa nada sin cierre humano formal de Camino A y autorización explícita posterior.

## 15. Decisiones humanas pendientes

1. **`fxMaxAge`**
   - Valor máximo.
   - Unidad: tiempo natural, sesiones FX, sesiones del instrumento u otra convención.

2. **Proveedor y licencia FX**
   - Proveedor o proveedores.
   - Derechos de uso, caché, auditoría y presentación.
   - Series, identificadores, revisiones y metadatos de publicación disponibles.

3. **Cierre/as-of**
   - Timestamp y zona horaria por mercado.
   - Cierres anticipados y sesiones especiales.
   - Política para fuentes sin `fxPublishedAt` demostrable.
   - Posible desfase conservador y criterios de aptitud.

4. **Cruces**
   - Monedas intermedias permitidas.
   - Preferencia entre directo, inverso y cruce.
   - Número máximo de piernas.
   - Sincronización temporal y antigüedad entre piernas.

5. **Metodología cuantitativa**
   - Horizontes, ponderaciones e historia mínima.
   - Universo, elegibilidad, percentil y muestra mínima.
   - Normalización, redondeo, empates y tratamiento de `null`.

6. **Modelo de caché**
   - Cálculo bajo demanda, caché o materialización fuera de `scan_results`.
   - Invalidación, regeneración y concurrencia.

7. **Cobertura**
   - Taxonomía definitiva de `fxCoverage`.
   - Umbrales y reglas para declarar cobertura global, parcial o no apta.
   - Comunicación UX de mercados `gap`, `deferred` o sin FX apto.

8. **Retención y auditoría**
   - Conservación de inputs, orientación, fuentes, piernas, `fxObservationDate`, `fxPublishedAt`, `fxSourceDate`, as-of y versiones.
   - Duración de retención y mecanismo de reproducción.

9. **Autorización de implementación**
   - Cierre humano formal de Camino A.
   - Autorización explícita posterior, independiente y registrada para implementar.

## 16. Referencias del repositorio

- [`lib/relativeStrength.js`](../lib/relativeStrength.js): RS actual, percentiles globales vigentes y benchmarks locales.
- [`lib/scanPercentileFinalization.js`](../lib/scanPercentileFinalization.js): finalización atómica de percentiles, `sectorScore` y scores canónicos.
- [`lib/coveragePlan.js`](../lib/coveragePlan.js): estados, targets y comunicación de cobertura real por mercado.
- [`docs/audit-score-coherence-contract.md`](./audit-score-coherence-contract.md): contrato de coherencia del scoring y estado de Camino A.
