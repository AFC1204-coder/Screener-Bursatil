# Operación diaria real — runbook (2026-11-07)

Objetivo: servir StatsEdge en producción desde el Mac Mini de forma estable y
dejar escrita la rutina diaria (nocturno → salud → aviso). **Nada de este
documento está instalado todavía.** El Mini no era alcanzable desde la red del
portátil el día que se escribió: todo lo que dice «en el Mini» está sin
comprobar allí.

Marcas usadas: **[verificado]** = medido o ejecutado el 2026-11-07 en el
portátil (copia aislada, base local de solo lectura). **[supuesto]** = deducido
del repo o de la memoria del proyecto; hay que confirmarlo en el Mini.

Piezas nuevas (sin instalar, sin comitear):

| Archivo | Qué es |
|---|---|
| `scripts/ops/web-start.sh` | Arranca `next start` con el entorno de `~/.config/statsedge/web.env`; comprueba variables y build; rota logs. |
| `scripts/ops/launchd/com.statsedge.web.plist` | Servicio permanente del servidor web (reinicio automático). |
| `scripts/ops/launchd/web.env.example` | Plantilla del archivo de entorno, **sin secretos**. |
| `scripts/ops/deploy-mini.sh` | Despliegue idempotente desde el portátil (DRY por defecto, `--run`). |
| `scripts/ops/daily-health.sh` | Rutina de la mañana: estado del nocturno + `data-health-check.mjs` + web → aviso. |
| `scripts/ops/launchd/com.statsedge.daily-health.plist` | La rutina a las 08:15. |
| `scripts/ops/notify.sh` | Aviso genérico (ntfy o webhook JSON). Sin `NOTIFY_URL`, solo log. |

---

## 1. Arquitectura actual (real, noviembre de 2026)

```
                    Mac Mini (cristian@192.168.100.107, Postgres 17)
  05:00 launchd ─► com.statsedge.scan-universe-us
                    └─ scripts/ops/nightly-us-guard.sh
                        1. refresh-bars.mjs --write --stale-days=1 (2 intentos, 40 min máx.)
                        2. run-scan-universe-us.sh → scan-universe.mjs --write (2 intentos)
                        3. logs/nightly-us-status.json  + notificación macOS si falla
                    a mano: scripts/ops/nightly-recover.sh [--run]
                    Postgres 17 :5432 (base viva)
                                 ▲
             túnel SSH 127.0.0.1:15432 → Mini:5432 (npm run ops:mini-tunnel:start)
                                 │
  Portátil: next dev (:3320 hoy, contra la copia local :55432), RS semanal
            del domingo (~/backfill-b-2026-11-08.sh por el túnel), auditorías.
```

- **Base viva:** Postgres 17 en el Mini. Supabase está **pausado**; los crons de
  Vercel se quitaron (`534e777`, `vercel.json` = `{}`). [verificado en el repo]
- **Copia local de solo lectura** en el portátil: `127.0.0.1:55432/statsedge_local`
  (última foto de datos: escaneo del 18 oct, precios del 16 oct). [verificado]
- **Nocturno US:** launchd `com.statsedge.scan-universe-us` a las 05:00 hora del
  Mini, vía `nightly-us-guard.sh`. [supuesto: lo dice el dueño; la copia del plist
  que hay en el repo, `scripts/com.statsedge.scan-universe-us.plist`, todavía
  llama a `run-scan-universe-us.sh` directamente]
- **Recuperación:** `scripts/ops/nightly-recover.sh` (DRY por defecto), descrita
  en `research/ops-recuperacion-nocturno.md`.
- **Servidor web en el Mini:** hoy no hay ninguno de producción [supuesto]. La app
  se usa con `next dev` en el portátil. Este runbook propone `com.statsedge.web`.

### Discrepancias con `docs/ops-mini-daily.md` (no se ha editado)

| Ese documento dice | Realidad |
|---|---|
| El nocturno escribe en **Supabase** vía `.env.nightly` (modo `postgrest`) | Supabase está pausado; la base viva es el Postgres del Mini. `.env.nightly` del Mini tiene que apuntar a Postgres [supuesto]. La cabecera de `scripts/run-scan-universe-us.sh` y `.env.nightly.example` siguen describiendo Supabase. |
| El Postgres del Mini «ya no es la fuente de la mesa US» | Es la única fuente. |
| Crons de Vercel (`scan-refresh`, `universe-refresh`, `leaderboards-refresh`…) escriben en Supabase | Quitados. **Nadie** refresca hoy lo que hacían, salvo lo que cubren el nocturno y el RS semanal (ver §6, «huecos»). |
| GHA `refresh-bars.yml`, `rs-*.yml` siguen activos contra Supabase | Si siguen habilitados en GitHub, fallan cada noche/domingo contra un Supabase pausado. Conviene deshabilitarlos en la web de GitHub. [supuesto] |
| Mini en `192.168.0.116` | Ahora `192.168.100.107` (wifi sin 5G). `scripts/ops/mini-tunnel.mjs` sigue con `.116` por defecto: usar `STATSEDGE_MINI_SSH_HOST=192.168.100.107`. |
| El nocturno se lanza con `run-scan-universe-us.sh` | Se lanza con el guardián (barras + reintentos + estado JSON). |
| Next aislado en `:3300` con `next start` a mano y log en `/tmp` | Propuesta: servicio launchd `com.statsedge.web` en `:3000`, logs en `logs/`. |
| `com.statsedge.cron-universe-refresh` llama a Next en `127.0.0.1:3000` | Si ese job sigue cargado en el Mini, **en cuanto `com.statsedge.web` escuche en :3000 empezará a llamarlo a las 22:05** (y al iniciar sesión: `RunAtLoad=true`). Sin `CRON_SECRET` en `web.env` recibirá 401 (inofensivo); con él, ejecutará `universe-refresh` y escribirá en la base. Decide antes de instalar (ver §4.4). |
| No habla de salud de datos, estado JSON ni avisos | §5. |

---

## 2. Producción verificada en el portátil (2026-11-07)

Copia aislada con `rsync` en el scratchpad (`node_modules` enlazado), base
`:55432` abierta con `default_transaction_read_only=on` (cualquier escritura
habría fallado y no falló ninguna), `next start` en `:3340`, Playwright con
Chrome. El servidor de desarrollo `:3320` no se tocó salvo para medirlo.

### 2.1 Build [verificado]

- `npm run build` (Next 16.2.6, webpack): **0 errores, 0 advertencias**, 14 s
  (compilación 10,4 s). 50 páginas; `/stock/[symbol]` y todas las `/api/*` son
  dinámicas, el resto estáticas.
- `.next` ocupa **11 MB sin caché**; `.next/cache` añade **311 MB** (se puede
  borrar después del build; en el Mini conviene conservarla para builds rápidos).
- JS por ruta (suma de chunks del HTML generado; gzip ≈ lo que viaja):

| Ruta | JS crudo | JS gzip |
|---|---|---|
| `/` screener | 1.828 KB | **557 KB** |
| `/stock/AAPL` ficha | 2.186 KB | ~662 KB (medido en navegador) |
| `/market-health` Mercado | 1.350 KB | 408 KB |
| `/review` | 1.557 KB | 475 KB |
| `/lists` Listas | 1.002 KB | 307 KB |
| `/sectors` Sectores | 899 KB | 276 KB |
| común a todas | 833 KB | 255 KB |

- **Dependencias de `next dev`:** ninguna bloqueante. Lo que cambia con
  `NODE_ENV=production`: (1) la cookie de sesión sale con `Secure`; (2) el
  «desbloqueo local» sin token desaparece; (3) `STATSEDGE_SESSION_SECRET` pasa a
  ser obligatorio; (4) sin `STATSEDGE_ACCESS_TOKEN` el proxy devuelve 401 a toda
  `/api`; (5) los contadores de depuración del gráfico se apagan. `pg` es
  externo al bundle: el servidor necesita `node_modules` (no hay salida
  `standalone`), que es lo que hace `deploy-mini.sh`.

### 2.2 Tiempos (Playwright, Chrome) [verificado]

APIs, `fetch` desde el navegador con sesión (servidor recién arrancado = frío):

| | prod frío | prod caliente | dev :3320 1.ª | dev caliente |
|---|---|---|---|---|
| `/api/scans` (21,7 MB JSON; 3,6 MB gzip) | 6,6 s | 2,3–2,4 s | 7,5 s | 2,9–3,1 s |
| `/api/discovery` (4,4 MB, **sin comprimir**) | 2,0 s | 0,30 s | 4,7 s | 0,29–1,4 s |

Páginas, tiempo hasta red inactiva (entre paréntesis, evento `load`):

| Página | prod 1440 frío¹ | prod 1440 caliente | prod 390 frío² | prod 390 caliente | dev 1440 frío | dev 1440 caliente |
|---|---|---|---|---|---|---|
| Screener `/` | 4,4 s (0,39) | 1,8 s | 1,8 s | 1,6 s | 6,7 s (1,2) | 2,0 s |
| Ficha `/stock/AAPL` | 1,5 s | 0,71 s | 0,77 s | 0,64 s | 13,3 s (9,3) | 4,9 s |
| Mercado | **13,4 s** | 0,62 s | 0,67 s | 0,60 s | no medido³ | — |
| Sectores | 2,1 s | 0,79 s | 0,77 s | 0,78 s | 16,3 s (8,0) | 1,5 s |
| Listas | 0,57 s | 0,56 s | 0,56 s | 0,56 s | 1,3 s | 1,1 s |

¹ servidor y navegador fríos. ² navegador frío, servidor ya caliente.
³ no se abrió Mercado contra `:3320` porque esa instancia escribe en la base.

Lectura: producción quita la compilación bajo demanda (ficha y Sectores pasan
de 8–16 s a menos de 2,1 s en frío). Lo que queda lento es **la primera visita
a Mercado tras un arranque** (`/api/coverage` 12,3 s y `/api/market-leadership`
5,6 s la primera vez; luego 0,5 s) y `/api/scans` (2,3 s en caliente: 21,7 MB
de JSON que se serializan en cada petición).

### 2.3 Problemas encontrados en producción [verificado]

1. **Login imposible por HTTP en la LAN.** La cookie `statsedge_session` sale
   `Secure; HttpOnly; SameSite=Lax; Max-Age=7 días`. Abriendo la app por
   `http://192.168.0.103:3340` (IP del portátil), Chrome acepta el token (200)
   pero **descarta la cookie** y todo `/api` sigue en 401: la pantalla de acceso
   vuelve a salir. Por `http://127.0.0.1` funciona porque el navegador trata
   `localhost` como origen seguro. Safari/iOS no se pudo probar (WebKit de
   Playwright no está instalado). Consecuencia: para el móvil hace falta HTTPS
   (§3) o un cambio de código (decisión del dueño, no hecho).
2. **`/api/discovery` viaja sin comprimir** (4,4 MB; `/api/scans` sí lleva gzip
   propio). Irrelevante en la LAN, notable por datos móviles.
3. **Consola:** la ficha (1440) da 9 errores `ERR_NAME_NOT_RESOLVED` de
   `logo.clearbit.com` (el servicio de logos de Clearbit ya no resuelve). Pasa
   igual en desarrollo. El resto de páginas, 0 errores.
4. **Log del servidor:** solo `[social] X sin token` (8 veces). Ninguna
   escritura rechazada por la base de solo lectura en las páginas visitadas.
5. **Endpoints abiertos sin sesión:** `/api/auth/session`,
   `/api/supabase/status` (enseña `mode=pg`, `ownerId` y tablas) y
   `/api/data-providers`. `/api/cron/*` exige `CRON_SECRET` (401 sin él).
   Aceptable en LAN/Tailscale; a revisar si algún día se publica en Internet.
6. **Sin limitación de intentos** en `POST /api/auth/session`. Con un token de
   64 caracteres hex (256 bits) la fuerza bruta no es realista, pero si se
   expone en Internet conviene un límite (§3).

---

## 3. Acceso desde el móvil

| Vía | Cómo | Pros | Contras |
|---|---|---|---|
| **A. HTTP en la LAN** | `STATSEDGE_WEB_HOST=0.0.0.0`, abrir `http://192.168.100.107:3000` | Cero instalación | **No funciona hoy** (cookie `Secure`, §2.3-1). Requeriría un cambio de código (p. ej. variable que desactive `Secure` solo para la LAN). Token y cookie viajan en claro por la wifi. Solo en casa. |
| **B. Tailscale** (recomendada) | Tailscale en el Mini y en el móvil; en el Mini `tailscale serve --bg 3000` | HTTPS con certificado válido (`https://<mini>.<tailnet>.ts.net`), la cookie `Secure` funciona sin tocar código; **funciona dentro y fuera de casa**; nada abierto a Internet; el web puede seguir escuchando solo en `127.0.0.1`. Gratis para uso personal. | Instalar la app en Mini y móvil; ambos deben estar conectados a la tailnet. En el portátil Tailscale 1.96.5 está instalado pero con sesión cerrada [verificado]. |
| C. Cloudflare Tunnel + dominio propio | `cloudflared` en el Mini, dominio en Cloudflare, Cloudflare Access delante | URL pública con HTTPS, sin abrir puertos; Access añade login (correo/OTP) antes de la app | Requiere dominio y cuenta; la app queda en Internet (detrás de Access): hay que revisar endpoints abiertos y limitar intentos. Más piezas que mantener. |
| D. Abrir puerto en el router + certificado | NAT + Let's Encrypt | — | No recomendable: superficie pública directa, IP doméstica, renovaciones. |

**Opción mínima recomendada para uso personal: B (Tailscale serve).** Pasos
cuando el dueño lo decida (no hecho):

1. Mini: instalar Tailscale (app de la Mac App Store o `brew install --cask tailscale`), iniciar sesión.
2. Activar HTTPS en la tailnet (consola de Tailscale → DNS → MagicDNS y HTTPS Certificates).
3. Mini: `tailscale serve --bg 3000` (proxy HTTPS → `127.0.0.1:3000`; persiste tras reinicio).
4. iPhone/Android: app Tailscale, misma cuenta; abrir `https://<nombre-del-mini>.<tailnet>.ts.net`.
5. Pegar el token una vez; la sesión dura 7 días. Guárdalo en el gestor de contraseñas del móvil para no teclear 64 caracteres.

**Login por token, qué implicaría exponerlo más allá de Tailscale:**
- La cookie ya es `HttpOnly` + `Secure` + `SameSite=Lax` + firmada (HMAC) con
  `STATSEDGE_SESSION_SECRET`: correcta para HTTPS.
- Falta limitar intentos en `POST /api/auth/session` (p. ej. 10/min por IP en
  `proxy.js` o regla de Cloudflare) y ocultar `/api/supabase/status` y
  `/api/data-providers` tras la sesión.
- No hay cierre de sesión remoto: para invalidar todas las sesiones hay que
  cambiar `STATSEDGE_SESSION_SECRET` y reiniciar el servicio.
- Con Tailscale nada de esto es urgente: solo los dispositivos de la tailnet ven el Mini.

---

## 4. Arranque permanente y despliegue

### 4.1 Instalación del servicio web (una vez, en el Mini) — SIN HACER

```bash
cd ~/Statsedge-v0.1
mkdir -p ~/.config/statsedge && chmod 700 ~/.config/statsedge
cp scripts/ops/launchd/web.env.example ~/.config/statsedge/web.env
chmod 600 ~/.config/statsedge/web.env
nano ~/.config/statsedge/web.env      # token, secreto de sesión (openssl rand -hex 32), DATABASE_URL
npm run build                         # o, desde el portátil, scripts/ops/deploy-mini.sh --run
bash scripts/ops/web-start.sh         # prueba en primer plano; Ctrl-C
cp scripts/ops/launchd/com.statsedge.web.plist ~/Library/LaunchAgents/
plutil -lint ~/Library/LaunchAgents/com.statsedge.web.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.statsedge.web.plist
curl -s http://127.0.0.1:3000/api/auth/session    # → {"ok":true,"configured":true,…}
```

- `web-start.sh` se probó en el portátil: sale con código 78 si falta el
  archivo de entorno, alguna variable o el build; con todo en orden hace `exec`
  de `next start` (el PID que ve launchd es el de Next) y escucha solo en
  `127.0.0.1`. [verificado; launchd en sí no se probó]
- Es un LaunchAgent (sesión de `cristian`), como el nocturno: el Mini debe
  iniciar sesión automáticamente tras un corte de luz. [supuesto]
- Logs: `logs/web.out.log`, `logs/web.err.log` (rotan a `.1` al pasar de 50 MB,
  en cada arranque), `logs/web-start.log`, `logs/web-launchd.*.log`.

### 4.2 Despliegue (desde el portátil)

```bash
scripts/ops/deploy-mini.sh            # DRY: preflight + lista de archivos que cambiarían + plan
scripts/ops/deploy-mini.sh --run      # rsync → npm ci si hace falta → build → kickstart → humo
```

- Nunca borra en el Mini: `rsync` sin `--delete`; lo que sobrescribe queda en
  `.deploy-backup/<fecha>/`. Excepciones explícitas: `.next.prev` (respaldo del
  build anterior) y `node_modules` cuando hay que ejecutar `npm ci` (solo si
  cambió `package-lock.json`).
- Se niega (exit 4) si hay un scan/refresh-bars/guardián en marcha, si el Mini
  tiene el cerrojo `logs/deploy-mini.lock`, o entre las 04:45 y las 08:00 hora
  del Mini (`--force-window` para saltárselo).
- Si el build falla, restaura `.next.prev` y recarga: el servicio sigue con la
  versión anterior (exit 5).
- Despliega **el árbol de trabajo tal cual**, con lo no comiteado (el log
  registra rama, commit y número de archivos sucios en `.deploy-state/last-deploy.json`).
- Probado en el portátil con `STATSEDGE_DEPLOY_LOCAL=1` hacia una carpeta del
  scratchpad: DRY, `--run`, segunda pasada idempotente (0 archivos), copia de
  respaldo de un archivo cambiado en destino, cerrojo ocupado, entorno ausente.
  **No probado contra el Mini por SSH ni el paso de build/recarga dentro del script.**
- Mientras corre `npm run build`, el servidor en marcha puede dar errores
  durante ~15–30 s (se reescribe `.next` bajo sus pies). Para uso personal es
  aceptable; si molesta, el siguiente paso sería construir en un directorio
  aparte y cambiar un enlace simbólico.

### 4.3 Vuelta atrás

```bash
# en el Mini
cd ~/Statsedge-v0.1
rm -rf .next && mv .next.prev .next                      # build anterior
rsync -a .deploy-backup/<fecha>/ ./                      # código sobrescrito en ese despliegue
launchctl kickstart -k gui/$(id -u)/com.statsedge.web
```

### 4.4 Antes de instalar, comprobar en el Mini

```bash
launchctl list | grep -i statsedge                       # ¿qué jobs siguen cargados?
plutil -p ~/Library/LaunchAgents/com.statsedge.scan-universe-us.plist   # ¿llama al guardián?
lsof -nP -iTCP:3000 -sTCP:LISTEN                         # ¿algo usa ya :3000?
grep -oE '^[A-Z_]+=' .env.nightly .env.local             # nombres, no valores
```

Si `com.statsedge.cron-universe-refresh` (o `cron-scan-refresh`) sigue cargado,
decide: descargarlo (`launchctl bootout gui/$(id -u)/com.statsedge.cron-universe-refresh`)
o mantenerlo y poner `CRON_SECRET` en `web.env` para que vuelva a funcionar.

---

## 5. Rutina diaria e integración de salud

### 5.1 Cadena propuesta: guardián → salud → aviso

```
05:00  com.statsedge.scan-universe-us → nightly-us-guard.sh → logs/nightly-us-status.json
08:15  com.statsedge.daily-health     → daily-health.sh
          1. nightly-us-status.json: result=ok y terminado HOY (UTC)
          2. node scripts/ops/data-health-check.mjs --json --since <hoy−10 días>
          3. GET 127.0.0.1:3000/api/auth/session
          → logs/daily-health-status.json + scripts/ops/notify.sh (error / warn / info)
```

- Se elige un job aparte a las 08:15 en vez de modificar el guardián: no toca
  el nocturno que ya funciona, y además detecta el caso «el nocturno ni
  siquiera arrancó» (Mini dormido, sesión cerrada), que el guardián no puede
  avisar. El guardián sigue con su notificación de macOS y su
  `STATSEDGE_GUARD_WEBHOOK_URL` (que puede ser la misma URL que `NOTIFY_URL`).
- `data-health-check.mjs` lo está terminando otro agente; `daily-health.sh`
  solo lo invoca con `--json` y lee `resultados.*.count` y `fallan`. Si cambia
  ese formato, ajustar la función de resumen.
- En el Mini, `STATSEDGE_HEALTH_DATABASE_URL` es obligatoria (el valor por
  defecto del chequeo es `:55432`, que solo existe en el portátil).
- Probado en el portátil contra `:55432` con estados simulados del nocturno
  (ok; fallo + web caída): exit 1 y 2, mensajes y JSON correctos. [verificado]

### 5.2 Umbrales

Línea base medida hoy en la copia local [verificado]:

| Comprobación | Ventana 18 meses | Desde 2026-10-01 | Desde hoy−10 |
|---|---|---|---|
| a3 picos de una barra | 18 | 0 | 0 |
| a4 barras US en días sin sesión | 107 | 0 | 0 |
| a6 barras guardadas antes del cierre + 30 min | 249 | 5 | 5 |
| a11 parpadeo de etapa oficial (7 nocturnos) | 486 | 486 | 486 |

Con los umbrales por defecto del chequeo (todo 0 y 18 meses) avisaría **todos
los días** por deuda histórica. Propuesta para `daily-health.sh` (ya es su
valor por defecto):

| Nivel | Cuándo |
|---|---|
| **error** (aviso inmediato) | el nocturno no consta `ok` hoy; el chequeo no puede ejecutarse (exit 2); el web no responde |
| **warn** | a3, a4 o a6 > 0 en los últimos 10 días; el refresco de barras falló aunque el scan fuera bien |
| **info** (solo log, o aviso si `HEALTH_NOTIFY_OK=1`) | todo bien; a11 se informa pero no avisa (`HEALTH_MAX_A11=off`) mientras D1 siga abierto |

Calibrar en la semana de prueba: si a6 da 5 cada día por las mismas filas
antiguas, subir `HEALTH_MAX_A6` o acortar `HEALTH_WINDOW_DAYS`; cuando se
arregle D1, poner `HEALTH_MAX_A11=0`.

### 5.3 Avisos

No hay canal definido. `notify.sh` está listo y desconectado: sin `NOTIFY_URL`
escribe en `logs/notify.log`. Probado contra un receptor local: formato ntfy
(texto, cabeceras `Title` en UTF-8, `Priority`, `Tags`), formato JSON
(`source, level, title, message, host, ts`), `NOTIFY_TOKEN`, filtro por nivel,
destino caído o con 500 (registra y sale 0). [verificado]

Lo más simple para uso personal: **ntfy** (app gratis en iOS/Android). Elegir
un topic largo y aleatorio (equivale a una contraseña), suscribirse en el
móvil y poner `NOTIFY_URL=https://ntfy.sh/<topic>` en `web.env`. Telegram
necesitaría un pequeño relay (bot + `chat_id`) delante del formato JSON.

---

## 6. Rutina diaria y semanal

| Cuándo | Qué | Quién |
|---|---|---|
| Diario 05:00 | Nocturno US (barras + scan) | launchd en el Mini |
| Diario 08:15 | `daily-health.sh` → aviso | launchd (propuesto) |
| Mañana, 2 min | Revisión (§6.1) | dueño |
| Domingo | RS semanal: `~/backfill-b-2026-11-08.sh` desde el portátil, con el túnel abierto (`STATSEDGE_MINI_SSH_HOST=192.168.100.107 npm run ops:mini-tunnel:start`) | dueño, a mano |
| Tras cambiar código | `scripts/ops/deploy-mini.sh` (DRY) y `--run` | dueño |

**Huecos conocidos (a confirmar en el Mini):** desde que se quitaron los
crons de Vercel nada refresca Mercado (`market-health`), `leaderboards`,
`universe-refresh` ni el snapshot de Sectores. En la copia local, Mercado dice
«Índices al 22 sep — régimen sin actualizar» y Sectores «Snapshot del 18 oct».
Si en el Mini pasa lo mismo, falta un job (o decidir que esas páginas se
actualicen a mano con «Actualizar»).

### 6.1 Qué mirar cada mañana (2 minutos)

1. **Aviso:** si no hay canal todavía, en el Mini: `cat logs/daily-health-status.json`
   (o `cat logs/nightly-us-status.json` si la rutina de salud no está instalada).
2. **Screener:** abrir la app. La cabecera dice «corte <fecha>, 05:00»: debe ser
   de hoy. Si aparece la banda **«Precios del …»**, los precios llevan 2+
   sesiones sin actualizarse.
3. **Recuento:** «N de M pasan» en un orden de magnitud parecido al de ayer
   (hoy en la copia: 937 de 3.287). Un salto brusco (0, o el doble) merece mirar el log.
4. **Una ficha conocida** (p. ej. AAPL): fecha de cierre = última sesión.
5. Domingo/lunes: que la RS muestre la semana nueva (`RS <fecha>` en la cabecera móvil).

### 6.2 Qué hacer si falla cada pieza

| Pieza | Síntoma | Qué hacer |
|---|---|---|
| Nocturno | `result:"fail"` o fecha vieja | `scripts/ops/nightly-recover.sh` (DRY) → `--run`. Detalle en `research/ops-recuperacion-nocturno.md`. Logs: `logs/nightly-us-guard.log`, `logs/scan-universe-us.err.log`, `logs/refresh-bars-us.err.log`. |
| Nocturno no arrancó | sin `nightly-us-status.json` de hoy y sin líneas nuevas en el log del guardián | ¿Mini dormido o sin sesión? `pmset -g` (evitar reposo), `launchctl list \| grep statsedge`; recuperar con `nightly-recover.sh --run`. |
| Barras | `barsExit` ≠ 0 | El scan corrió con barras viejas. Mirar Yahoo (`curl` del preflight de `nightly-recover.sh`); `--run --force` cuando vuelva. |
| Web caído | la app no carga; aviso «Web: NO responde» | `launchctl print gui/$(id -u)/com.statsedge.web \| head`, `tail -50 logs/web-start.log logs/web.err.log`; `launchctl kickstart -k gui/$(id -u)/com.statsedge.web`. Código 78 en `web-start.log` = falta entorno o build. |
| Login en bucle | el token se acepta y vuelve a pedirlo | Se está entrando por HTTP no local (§2.3-1): usar la URL HTTPS de Tailscale. |
| Base de datos | errores de conexión en `web.err.log`, health exit 2 | `brew services list` (Postgres 17), `pg_isready -h 127.0.0.1 -p 5432`. |
| Salud de datos | aviso warn con a3/a4/a6 | `node scripts/ops/data-health-check.mjs --since <fecha>` (texto con ejemplos). a3 = probable contrasplit sin ajustar; a6 = vela intradía guardada como cierre. No bloquea el uso. |
| Despliegue | exit 3/4/5/6 | 3 preflight (SSH, Node, entorno, disco); 4 ocupado/cerrojo/ventana; 5 build fallido (ya restaurado); 6 el servicio no responde: `logs/web.err.log`. |
| Túnel (portátil) | `:15432` cerrado | `STATSEDGE_MINI_SSH_HOST=192.168.100.107 npm run ops:mini-tunnel:start`. |
| Avisos | no llega nada | `tail logs/notify.log`: «sin NOTIFY_URL» o «ENVÍO FALLIDO http=…». |

---

## 7. Semana de prueba (checklist para el dueño)

Antes del lunes (con el Mini alcanzable):
- [ ] §4.4: inventario de jobs launchd, plist del nocturno, puerto 3000, nombres de variables de `.env.nightly`.
- [ ] Decidir el acceso móvil (recomendado: Tailscale) y el canal de avisos (recomendado: ntfy). Facilitar la URL.
- [ ] Crear `~/.config/statsedge/web.env` (§4.1) con token y secreto **nuevos** de producción.
- [ ] `scripts/ops/deploy-mini.sh` (DRY) y revisar la lista de archivos; luego `--run`.
- [ ] Instalar `com.statsedge.web` y `com.statsedge.daily-health`; `launchctl kickstart gui/$(id -u)/com.statsedge.daily-health` para probar el aviso.

**Lunes**
- [ ] 08:15 llega el aviso (o hay `logs/daily-health-status.json` de hoy). Anotar nivel y contadores a3/a4/a6/a11.
- [ ] Abrir la app desde el móvil fuera de la wifi (datos): login con token, screener, una ficha.
- [ ] Anotar cuánto tarda el screener en el móvil la primera vez.

**Martes**
- [ ] Revisión de 2 minutos (§6.1). ¿Coincide lo que dice el aviso con lo que muestra el screener?
- [ ] Reiniciar el Mini a propósito (o `launchctl kickstart -k …web`): ¿vuelve solo el servicio web?

**Miércoles**
- [ ] Simular un fallo: `launchctl bootout gui/$(id -u)/com.statsedge.web` por la noche → el aviso de las 08:15 debe decir «Web: NO responde». Reinstalar con `bootstrap`.
- [ ] Calibrar umbrales (§5.2) con las cifras de lunes–miércoles.

**Jueves**
- [ ] Hacer un cambio pequeño en el portátil y desplegarlo con `deploy-mini.sh --run` fuera de la ventana nocturna. Comprobar `.deploy-state/last-deploy.json` y que la app sigue entrando.
- [ ] Mirar el tamaño de `logs/` (`du -sh logs`).

**Viernes**
- [ ] Repaso: ¿algún día sin aviso o con aviso falso? ¿algún login repetido en el móvil? ¿la app se cayó sola?
- [ ] Decidir: dejar la rutina tal cual, ajustar umbrales/horario o añadir el job que falta para Mercado/Sectores (§6, huecos).
- [ ] Domingo: RS semanal con `~/backfill-b-…sh`; el lunes, comprobar la semana nueva en la RS.

---

## 8. Qué está verificado y qué no

| Verificado (portátil, 2026-11-07) | Sin verificar |
|---|---|
| Build de producción sin errores ni advertencias | Nada en el Mini (inalcanzable): jobs cargados, `.env.nightly`, Postgres 17, espacio en disco |
| Tiempos frío/caliente prod frente a dev (§2.2) | `launchctl bootstrap` de los dos plist (solo `plutil -lint` OK) |
| Cookie `Secure` descartada por HTTP en LAN (Chrome) | Comportamiento en Safari/iOS |
| `web-start.sh`: errores de configuración y arranque real en `127.0.0.1` | `deploy-mini.sh` por SSH real, `npm ci` y build dentro del script |
| `deploy-mini.sh` en modo local: DRY, run, idempotencia, respaldo, cerrojo | Tailscale serve, ntfy real |
| `notify.sh` contra receptor local; `daily-health.sh` contra `:55432` | Si los huecos de Mercado/Sectores existen también en el Mini |
