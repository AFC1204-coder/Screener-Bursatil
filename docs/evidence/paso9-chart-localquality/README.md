# Paso 9 — verificación visual ligera (capturas reales)

Esta carpeta contiene las capturas reales del paso 9 del ADR
`chart-controller-extraction`: cierre de la migración de calidad
`chartEstimated` → `localQuality`.

## Capturas

| Archivo | Símbolo | Estado | Aviso P0 visible |
|---|---|---|---|
| `01-review-estimado.png` | `ESTIMADO` (sembrado con `chartEstimated=true`, `chartProvider="estimado"`) | Bloqueado | Sí — `"Datos estimados — no aptos para decisión"` |
| `02-review-real.png` | `ALPHA` (sembrado con `chartEstimated=false`, `chartProvider="Yahoo Finance"`) | Ready | No (correcto: calidad real pasa el guard P0) |

## Cómo se generó

```bash
# 1) Build de producción:
npm run build

# 2) Server con token en .env.local:
PORT=3100 nohup npm run start > /tmp/statsedge-paso9.log 2>&1 &

# 3) Verificación visual con Playwright (script incluido en
#    scripts/e2e/chartStep9VisualLight.mjs):
PORT=3100 node scripts/e2e/chartStep9VisualLight.mjs
```

## Cobertura del ADR §4.5

> *"un símbolo con datos estimados y uno con datos reales, en
> /stock/[symbol] Y en /review. Confirma con captura real
> (hard-reload)"*

Las dos capturas representan el flujo `/review` con un símbolo estimado
y otro real, navegando desde cero (no es render estático) y haciendo
click explícito en el ítem correspondiente de la cola. La verificación
del DOM confirma que la fila con `chartEstimated=true` dispara el
guard P0 (`Datos estimados — no aptos para decisión`) a través del
nuevo flujo:

1. `app/review/page.jsx` construye el `localQuality` con
   `chartQuality({ bars, meta: { estimated, dataProvider } })`.
2. `ReviewChartPanel` lo pasa como prop a `<UniversalPriceChart localQuality={...}>`.
3. `useChartController` lo entrega a `useChartDataModel` como
   `localSource.quality`.
4. `lib/chartDataModel.js` (migración §3.2) detecta
   `quality.status !== "real"` y devuelve `availability: "blocked"`,
   publicando el `notice.code: "quality-estimated"` que la vista
   renderiza en `.universalChartEstimatedNote`.
