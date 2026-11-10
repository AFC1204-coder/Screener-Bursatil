# Recuperar el nocturno US (Mac Mini)

Una página. Todo se hace en el Mini, desde la raíz del repo.

## 1. ¿Falló?

- **Estado:** `cat logs/nightly-us-status.json`. Lo escribe el guardián (`scripts/ops/nightly-us-guard.sh`) al terminar.
  - `"result":"ok"` con `"finished"` de hoy: todo bien.
  - `"result":"fail"`, o un `finished` de un día anterior: el nocturno falló o no corrió.
  - `scanExit` y `scanAttempts` dicen cuántos intentos se gastaron.
  - `barsExit` distinto de `0` indica que el refresco de barras falló; el scan corrió igualmente, con barras viejas.
- **Detalle:**
  - `tail -50 logs/nightly-us-guard.log`
  - `tail -50 logs/scan-universe-us.err.log`
  - `tail -50 logs/refresh-bars-us.err.log`
- **En el screener:** aparece la banda «Precios del …», que indica 2 o más sesiones sin precios nuevos.

## 2. Recuperar

```bash
scripts/ops/nightly-recover.sh          # DRY: comprueba y dice qué haría (no ejecuta nada)
scripts/ops/nightly-recover.sh --run    # recupera de verdad
```

- **Comprobación previa.** Antes de ejecutar nada, comprueba dos cosas: que la base de datos responde (el host y puerto de `DATABASE_URL`, o el túnel `:15432`) y que Yahoo responde.
  - Si algo falla, sale con código 3 sin tocar nada.
  - Si es el túnel, arráncalo con `node scripts/ops/mini-tunnel.mjs --start`.
- **Qué ejecuta.** Lo mismo que el guardián y con los mismos reintentos:
  - `refresh-bars --write --stale-days=1`: 2 intentos, tope de 40 min cada uno.
  - El scan US: 2 intentos, con 2 min de pausa entre ellos.
- **Es idempotente:**
  - Si hoy ya consta `ok`, no repite nada. Para forzar: `--run --force`.
  - Un cerrojo (`logs/nightly-recover.lock`) impide dos recuperaciones a la vez.
  - Si ya hay un scan o un refresh-bars en marcha, sale con código 4.
- **Registro:** cada corrida queda en `logs/nightly-recover.log`.

## 3. ¿Cuánto tarda?

- **Barras:** unos 18 min a concurrencia 4 cuando hay que bajar todo el universo (5.565 símbolos; `docs/adr-escaneo-nocturno.md`). Con `--stale-days=1` y un solo día perdido suele tardar bastante menos.
- **Scan US:** del orden de decenas de minutos. **No lo he medido en esta sesión.**
- **Peor caso con todos los reintentos:** unas 2 h 30 min (2 × 40 min de barras + 2 scans + pausas).

## 4. ¿Volvió?

1. `cat logs/nightly-us-status.json`: debe decir `"result":"ok"` con la hora de ahora.
2. Abre el screener y recarga. La banda «Precios del …» debe desaparecer: la mediana de las fechas de precio debe quedar a menos de 2 sesiones (`lib/dataAge.js`).
3. Una fila con la miniatura atenuada lleva su propio precio atrasado. El `title` de la miniatura dice de qué día es el precio. Algunas pocas son normales: suspendidas, o sin datos del proveedor.
4. Si todo el lote iba atrasado, el filtro de frescura estaba en pausa (opción B). Al volver los precios, vuelve a recortar solo las filas atrasadas.
