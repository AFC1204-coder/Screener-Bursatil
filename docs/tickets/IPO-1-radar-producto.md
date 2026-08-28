# IPO-1 — Radar IPO con salidas reales (producto + datos)

**Estado:** Aceptado (decisiones dueño 2026-08-28) · **Origen:** ficha Radar IPO vacía  
**Relacionado:** `app/ipo-radar/page.jsx` · preset `ipo` · **UX-FILTERS** (rediseño presentación filtros)

## Decisiones dueño (2026-08-28)

| Tema | Decisión |
|---|---|
| **Mercados** | **Todos** los mercados del producto (US, Core intl, HK, EU, etc.) — no US-only. |
| **Pre-IPO / fuente** | Ver §Fuente recomendada (orquestador) — híbrido sin feed de pago en v1. |
| **Preset / filtros IPO** | **Modo discovery abierto** en la ficha (no umbrales institucionales actuales). |
| **Presentación filtros** | **Rediseño de raíz** de cómo se presentan y configuran filtros (alineado al resto del screener post mesa-de-vistas) — **no** parche solo en familia IPO. Ticket hermano: **UX-FILTERS**. |

## Diagnóstico (repo verificado)

### Por qué la ficha «Radar IPO» sale vacía

1. Preset **`ipo`**: `requireRecentIpo`, `maxIpoAgeMonths: 60`, umbrales altos (cap 300M, perf3m≥10…).
2. Filtro exige **`ipoDate` / `ipoAgeMonths`** (`lib/screenerFilters.js`).
3. Nocturno: **`ipoDate` poblado ≈ 0 filas** (`lib/scoringEngine.js`) — no alimenta edad IPO en materializado.
4. Resultado: **0 pasan** — ausencia de dato + preset estricto (UX-11 solo arregló la latencia del empty state).

### Qué ya existe (desconectado)

| Pieza | Dónde | Estado |
|---|---|---|
| **IPO Radar** | `/ipo-radar` | CRUD local pre-IPO; no en nav principal |
| Universo | `ipoRadarUniverseRows()` | Solo búsqueda; no materializado scan |
| Lista IPO | `lib/listRationale.js` | Señal existe; datos vacíos |

## Fuente recomendada (orquestador — dueño delega)

**v1 privado, sin API IPO de pago** (Twelve Data / Nasdaq feeds aplazados como resto de licencias):

1. **Cotizando reciente (todas las regiones):** backfill **`ipoDate`** en pipeline nocturno/materializado — Yahoo `firstTradeDate` (`lib/yahoo.js`), fallback FMP profile, persistir en `researchRow` / scan light projection. Job puntual + guard en nocturno.
2. **Pre-IPO / próximas:** mantener **`/ipo-radar`** como curado del dueño (watch/filed/priced) + import automático desde scan cuando exista `ipoDate`. Sin scraper de calendario IPO en v1.
3. **Unión en producto:** ficha Radar muestra **scan recientes ∪ vigiladas local**; al listar ticker, enriquecer con fila de scan si existe.

## Propuesta por fases

### IPO-1a — Datos multi-mercado (P0)

- `ipoDate` + `ipoAgeMonths` en filas analizadas **US + intl** donde el proveedor devuelva fecha.
- Motivo explícito si ausente («sin fecha de salida verificable»).
- Éxito: ficha Radar ≥15 filas en snapshot típico **o** empty state con vigiladas local >0.

### IPO-1b — Preset discovery + ficha hunt

- Nuevo preset hunt **`ipoDiscovery`** (o sustituir `ipo` en rail): `setupMode: ipoRecent`, edad ≤60–84m, **umbrales discovery** (cap/liquidez/perf relajados; intl tolera cobertura parcial con aviso).
- Rail **Radar IPO** → ese preset; empty state con CTA a `/ipo-radar`.
- Merge filas vigiladas sin scan (símbolo opcional, estado pre-IPO).

### IPO-1c — Superficie e interacción

- Nav → `/ipo-radar`; banda «próximas 14 días»; Revisar / listas / ficha.
- Mercados: respeta selección global; no forzar US.

### IPO-1d — Presentación filtros (depende UX-FILTERS)

- Familia **IPO** como piloto del rediseño: reglas visibles, toggle ≠ expandir, copy honesto (edad vs pre-IPO vs listado).
- **No** ship 1b UI final sin al menos wire de UX-FILTERS acordado.

## Fuera de v1

- Feed IPO premium contratado.
- Push/email server-side.
- `ipoScore` en composite hasta dato estable.

## Verificación

- Browser multi-mercado: Radar IPO con filas o vigiladas.
- `./vfc` + tests materializado/filtro IPO.
- Smoke intl: al menos un `.HK`/`.L` con edad IPO si proveedor lo da.

## Modelo

- **IPO-1a:** Fable 5 o Opus (datos + contrato multi-mercado)
- **IPO-1b–1c:** MiniMax M3 / Composer HIGH
- **UX-FILTERS:** spec primero (Fable/Gemini brief), luego código

Sin commit programación desde agente hasta spec UX-FILTERS + 1a acordados.
