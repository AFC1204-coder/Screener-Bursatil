# Roadmap estratégico — StatsEdge (Screener-Bursatil)

## Contexto

El propietario es un swing trader de estilo **Minervini (SEPA/VCP) + Weinstein (Stages)** que aspira
a convertir esta web en un **producto público / SaaS** para traders con la misma filosofía. Dispone
de tres recursos de ejecución: **él mismo** (experto en trading, decisiones de producto), **Codex**
(plan ChatGPT Pro ~$100/mes, agente autónomo para implementación de gran volumen) y **Claude Code**
(plan Pro, razonamiento de arquitectura y cambios quirúrgicos).

Este documento (1) prueba la web desde la silla del usuario típico, (2) hace un diagnóstico honesto
del estado actual, (3) fija objetivos priorizados en hitos, y (4) reparte el trabajo entre los tres
recursos.

---

## 1. Veredicto desde la silla del trader

*Simulación: "Soy un swing trader Minervini. Quiero encontrar líderes en Stage 2, cerca de un pivot
VCP, con riesgo controlado, y operarlos."*

| Momento del journey | Qué siente el trader | Estado |
|---|---|---|
| Cargar universo y escanear | Potente, muchos mercados, presets útiles. El embudo de diagnóstico es excelente. | 🟢 Bien |
| Filtrar por Stage 2 / Trend Template | Funciona, pero es un **score 0-100**, no un sí/no con los 8 criterios marcados. No sé *cuáles* criterios cumple. | 🟡 Mejorable |
| Encontrar el pivot / buy point | **No hay punto de compra.** Veo "near pivot" pero no el precio exacto de entrada. | 🔴 Falta |
| Ver el VCP | Lo etiqueta, pero es un proxy de "cerca de máximos + poco extendido". **No veo las contracciones reales.** | 🔴 Falta |
| Definir stop y tamaño de posición | **Nada.** Tengo que ir a una hoja de cálculo. | 🔴 Falta |
| Anotar la tesis y seguir el trade | Puedo marcar favorito con precio, pero **no hay diario ni R-multiples**. | 🔴 Falta |
| Que me avise cuando rompa el pivot | **No hay alertas de señal.** | 🔴 Falta |
| Confiar en los datos | Los precios vienen de Yahoo no oficial; si falla, falla en silencio. Para invertir dinero real, **da inseguridad**. | 🔴 Riesgo |

**Conclusión:** La web es un **screener de descubrimiento de primer nivel**, pero el trader la abandona
justo en el momento de operar. El ciclo se rompe a la mitad:

```
screener → revisión → watchlist → [ FALTA: pivot → stop → tamaño → entrada → gestión → salida → diario ] → análisis
```

---

## 2. Diagnóstico del estado actual

### 2.1 Fidelidad metodológica
- **Weinstein:** Stage 2 detectado con SMA50/150/200 **diario** (el original usa SMA30 **semanal**). No hay
  pendiente independiente de cada media ni confirmación de volumen en la ruptura de stage. *Aproximado.*
- **Minervini:** Trend Template ~70% fiel (10 sub-criterios como score). VCP es un proxy de "near pivot",
  no detecta contracciones sucesivas ni volumen decreciente. Sin pivot buy point. *Parcial.*
- **O'Neil (CANSLIM):** Solo un proxy de EPS growth. Sin earnings trimestrales, sin cup-with-handle,
  sin fuerza institucional. *Esbozado.*
- **Darvas:** Inexistente.

### 2.2 Cierre del ciclo del trader
- **Falta por completo:** pivot/buy point, stop loss sugerido, position sizing, R-multiples, diario de
  trades con P&L real, alertas de precio/señal. El "research desk" sigue performance post-hoc (apreciación
  de precio), no ejecución real.

### 2.3 Robustez de datos y backend (crítico para SaaS)
- **Precios:** Yahoo Finance **no oficial** como fuente principal. Sin licencia comercial → **riesgo legal
  y de ruptura** para un producto de pago. Fallbacks (Stooq, Alpha Vantage) requieren config manual.
- **Fundamentales:** SEC EDGAR (sólido, solo US) + FMP opcional (internacional). Cobertura asimétrica US-céntrica.
- **Escala:** Sin rate-limiting, reintentos, backoff ni circuit breakers. Degradación silenciosa si falta
  una API key. No probado a escala (>500 símbolos = latencia y throttling).
- **Persistencia:** Supabase opcional, multiusuario por `owner_id` pero **sin auth real probada** y con
  ambigüedad local↔nube. RLS presente pero el service key la salta — vigilar exposición.
- **Observabilidad:** Inexistente. No hay logs de fallos, latencias ni frescura de datos.

### 2.4 Experiencia y diseño
- Buena base dark-theme (mejorada en sesiones previas: tokens semánticos, toasts, accesibilidad del modal,
  tabla ordenable, scroll móvil). Falta: gráficos propios con overlays de pivot/stop/base, onboarding,
  glosario de métricas in-app.

---

## 3. Objetivos priorizados (hitos)

> Orden pensado para SaaS: **primero el cimiento legal/técnico, luego el valor diferencial, luego pulido.**
> Cada hito tiene un criterio de "Hecho" verificable.

### H0 — Cimientos para SaaS *(bloqueante, no negociable)*

**Por qué primero:** sin datos legales y fiables, ningún feature importa y no se puede cobrar.

1. **Proveedor de datos con licencia comercial.** Evaluar y elegir entre **Polygon, Tiingo, EOD Historical
   Data, FMP de pago, Intrinio o Nasdaq Data Link**. Migrar `/api/chart`, `/api/universe`, `/api/company-brief`
   a una capa de proveedor abstracta (adapter) para poder cambiar de fuente sin tocar el resto.
2. **Capa de resiliencia:** reintentos con backoff exponencial, timeouts, circuit breaker, caché
   (Supabase o Redis) con TTL por tipo de dato (precio intradía vs fundamentales).
3. **Auth multiusuario real** con Supabase Auth; RLS revisada; service key solo en servidor.
4. **Observabilidad mínima:** logging estructurado de fallos de proveedor, latencia y cobertura de datos.

**Hecho cuando:** un scan de 1.000 símbolos completa con datos licenciados, sin caídas silenciosas,
con usuarios autenticados y aislados, y los fallos quedan registrados.

### H1 — Cerrar el ciclo del trader *(máximo valor diferencial)*

**Por qué:** es lo que separa "otro screener" de "la herramienta que un Minervini/Weinstein usa a diario".

1. **Pivot / buy point** calculado sobre la base (máximo de la consolidación + margen). Mostrarlo en tabla y modal.
2. **Stop loss sugerido** (% bajo pivot o bajo mínimo de la base / SMA relevante) y **% de riesgo**.
3. **Position sizing + R-multiples:** dado el % de riesgo de cuenta y el stop, calcular tamaño y R objetivo.
4. **Diario de trades:** extender el "research desk" actual con entrada/salida/P&L real/R alcanzado y
   estadísticas (win rate, R medio, expectativa). Reutiliza la persistencia de favoritos ya existente.
5. **Alertas:** precio cruza pivot, toca stop, o cambia de stage. Empezar por notificación in-app/navegador
   (ya hay base en IPO Radar) y email.

**Hecho cuando:** el trader puede pasar de "candidato" a "trade con pivot, stop y tamaño definidos",
seguirlo y cerrarlo con su R registrado, sin salir de la app.

### H2 — Fidelidad metodológica *(diferenciación y confianza del experto)*

1. **VCP real (Minervini):** detectar nº de contracciones, % de cada una (decrecientes) y volumen
   menguante. Marcar la base en el gráfico.
2. **Stage analysis semanal (Weinstein):** calcular sobre velas **semanales** (SMA30 semanal) además del
   diario, con confirmación de volumen en la ruptura de Stage 1→2.
3. **Detección de bases / patrones (O'Neil):** cup-with-handle, flat base, double bottom.
4. **Trend Template explícito:** mostrar los 8 criterios como checklist ✓/✗, no solo un score agregado.
5. *(Opcional)* **Darvas boxes.**

**Hecho cuando:** el usuario-experto valida que las señales coinciden con lo que él marcaría a mano.

### H3 — Experiencia, diseño y conversión *(retención y crecimiento)*

1. **Gráficos propios interactivos** con overlays de pivot, stop, base y stages.
2. **Onboarding + glosario** de métricas in-app (qué es RS Quality, A/D proxy, etc.).
3. **Planes/monetización:** free vs pro (límite de scans/alertas), Stripe.
4. **Landing y SEO** para captar traders.

**Hecho cuando:** un usuario nuevo entiende y ejecuta su primer trade guiado en <10 min, y hay un
camino de pago funcionando.

---

## 4. Reparto de trabajo entre los tres recursos

| Recurso | Mejor para | Ejemplos en este roadmap |
|---|---|---|
| **Tú (humano, experto)** | Decisiones de producto, juicio de trading, validación de fidelidad, legal y costes, QA operando de verdad. | Elegir y **pagar el proveedor de datos**; validar que VCP/stages coinciden con tu criterio; decidir planes de precio; priorizar hitos. |
| **Codex (Pro $100/mes, autónomo)** | Implementación de gran volumen, bien especificada y paralelizable; boilerplate; refactors amplios; tareas largas desatendidas que acaban en PR. | Migrar todos los endpoints a la **capa adapter de datos**; generar el CRUD del **diario de trades**; implementar la **capa de resiliencia**; tests. |
| **Claude Code (Pro, interactivo)** | Arquitectura, cambios quirúrgicos con contexto amplio del repo, lógica metodológica delicada, revisión de código y planificación. | Diseñar el **adapter de proveedores**; implementar **VCP real y stage semanal** (lógica fina); revisar PRs de Codex; cálculos de **pivot/stop/sizing**. |

**Flujo sugerido:** Tú decides y validas → Claude Code diseña la arquitectura y la lógica delicada →
Codex ejecuta el volumen siguiendo esa arquitectura → Claude Code revisa → Tú haces QA real operando.

---

## 5. Riesgos y decisiones abiertas (requieren tu input)

- **Datos = el mayor riesgo.** Yahoo no es viable legalmente para SaaS de pago. Hay que presupuestar el
  coste mensual del proveedor (varía mucho: Tiingo es barato, Polygon medio, Nasdaq caro). **Decisión tuya.**
- **Cobertura geográfica:** ¿US primero (mejor cobertura/fundamentales) o mantener los 27 mercados? Afecta
  el proveedor a elegir.
- **Tiempo real vs fin de día:** swing trading suele bastar con EOD + intradía retrasado. Abarata datos.
- **Monetización:** ¿freemium con límite de scans/alertas? ¿precio?
- **Cumplimiento:** disclaimers de no-asesoramiento financiero, términos, GDPR si hay usuarios UE.

---

## 6. Métricas de éxito

- **Producto:** % de usuarios que pasan de scan → trade registrado; trades con pivot+stop definidos; retención semanal.
- **Técnico:** uptime de datos, latencia p95 de scan, tasa de fallos de proveedor, cobertura de datos por símbolo.
- **Trading:** que las señales del screener tengan expectativa positiva en el diario agregado (R medio > 0).

---

## 7. Cómo validar el progreso

- **H0:** lanzar scan global con el nuevo proveedor; matar la red a un endpoint y comprobar reintento/circuit
  breaker y log; crear dos usuarios y verificar aislamiento de datos.
- **H1:** tomar un líder en base, comprobar pivot/stop/tamaño calculados; registrar un trade y ver su R en el diario; disparar una alerta de pivot.
- **H2:** comparar 10 señales VCP/stage del sistema contra tu marcado manual; medir coincidencia.
- **H3:** test de usuario nuevo (alguien sin contexto) completando su primer trade guiado cronometrado.
