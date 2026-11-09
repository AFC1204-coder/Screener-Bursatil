# Backup de la base del Mini (2026-11-08)

## Por qué
Con Supabase pausado, la base `statsedge` del Mini (3,9 GB: `daily_bars` 2,0 GB, `scan_results` 1,1 GB, `fundamental_snapshots` 352 MB…) es la **única copia** de los datos. No había ninguna copia programada: solo los volcados manuales de `daily_bars` del 8-nov. (El único backup programado en el Mini, `com.oddsmark.local-db-backup`, es de otro proyecto.)

## Qué hay hecho (en el repo y en el Mini; todo SIN activar la programación)
- `scripts/ops/backup-db.sh`: `pg_dump -Fc -Z 6` a un `.partial`; verificación (`pg_restore -l` + tamaño mínimo 50 MB); solo entonces se renombra a `statsedge-YYYYMMDD-HHMMSS.dump` (UTC) y se escribe su `.sha256`. Bloqueo contra ejecuciones simultáneas, comprobación de espacio (≥ 5 GiB), gancho de subida opcional `STATSEDGE_BACKUP_UPLOAD_CMD "<archivo>"` (si falla → `degraded`, la copia local sigue válida), retención, estado en `logs/db-backup-status.json` (`ok | degraded | fail`) y aviso por `notify.sh` en `degraded`/`fail`. Salida: 0 ok o degraded · 1 fallo · 3 ya había otra en marcha.
- `scripts/ops/db-backup-retention.mjs`: 7 diarios + 4 semanales + 3 mensuales; nunca borra el último; solo toca archivos con el patrón del nombre (y su `.sha256`).
- `scripts/ops/launchd/com.statsedge.db-backup.plist`: 03:30 hora local, **no instalado** (instrucciones en su cabecera).
- Tests: `tests/dbBackupRetention.test.js` (10) y `tests/dbBackupScript.test.js` (9: camino feliz, pg_dump que falla, volcado pequeño, ilegible, subida que falla/funciona, bloqueo, poco espacio, retención real).
- Destino local en el Mini: `~/statsedge-backups/db-nightly/`.

## Pendiente (decisiones del usuario)
1. **Programar el job** (cargar el plist). Hasta entonces no hay copia nocturna.
2. **Drive**: `rclone` en el Mini, con permiso `drive.file` (solo ve lo que crea) y `rclone crypt` para cifrar antes de subir; el gancho de subida ya existe. Falta: cuenta de Google y espacio libre, instalar `rclone` y que el usuario autorice la cuenta una vez en su navegador. Tamaño orientativo: ~0,7 GB por volcado × 14 conservados ≈ 10 GB (cuidado con los 15 GB gratuitos, compartidos con Gmail y Fotos).
3. Subir los volcados antiguos del portátil (`statsedge-2026-10-18-1946.dump` 775 MB, `Downloads/statsedge-2026-10-06.dump` 355 MB, `statsedge-backups/statsedge-2026-09-03.dump` 704 MB) y, solo tras verificar la subida, decidir si se borran en local.
4. ~~Restauración~~ **Probada (2026-11-08, ~18:35 CET).** Volcado real de la base viva: 841.657.287 B (803 MiB), 57 s, `sha256` correcto, estado `ok`. Restaurado con `pg_restore --no-owner -j 2` en una base temporal `statsedge_restore_test` (67 s, 0 errores): 29 tablas en ambas y recuentos idénticos en `daily_bars` (4.385.889), `scan_results` (64.710), `fundamental_snapshots` (57.368), `rs_weekly_items` (287.753), `universe_snapshot_symbols` (120.423), `scans` (163), `app_settings` (222) y `scan_symbol_history` (5.043). Base temporal borrada. Pendiente de probar: restauración desde un volcado descargado de Drive y con el cifrado de `rclone crypt`.

## Estado de Drive (2026-11-08, ~19:00 CET)
- `rclone` v1.76.0 instalado en el Mini (Homebrew). Remoto `gdrive-statsedge:` autorizado por el usuario con `scope=drive.file` (solo ve lo que rclone crea); carpeta `statsedge-backups` creada. Cuenta de Drive: 100 GiB, 43 GiB libres. `rclone.conf` con permisos 600.
- **Aviso de rclone:** el `client_id` compartido de rclone para Drive «dejará de funcionar durante 2026». Hoy funciona; hay que crear un `client_id` propio (https://rclone.org/drive/#making-your-own-client-id) antes de que se retire.
- **Incidente menor:** `rclone config create` imprimió la configuración (con token de acceso y de refresco) en el terminal y la sesión de Claude la leyó. Alcance limitado a `drive.file`. Si se quiere borrón y cuenta nueva: revocar en https://myaccount.google.com/permissions y repetir la autorización descartando la salida (`>/dev/null`). Los scripts nuevos ya descartan esa salida.
- Hecho y probado (28 tests): `scripts/ops/backup-upload-drive.sh` (sube SOLO al remoto cifrado `gdrive-crypt:`, verifica tamaño, poda Drive con la misma política) y `scripts/ops/drive-crypt-setup.sh` (lo ejecuta el usuario: pide dos contraseñas, crea `gdrive-crypt:` y hace una prueba de ida y vuelta). Desplegados en el Mini. Sin remoto cifrado el gancho sale con 2 y no sube nada (comprobado).
- **Pendiente:** (1) el usuario ejecuta `drive-crypt-setup.sh` y guarda las dos contraseñas FUERA del Mini; (2) conectar el gancho al job (`STATSEDGE_BACKUP_UPLOAD_CMD` en el plist) y recargarlo; (3) subir un volcado real y simular la restauración desde Drive descifrando; (4) subir los volcados antiguos del portátil; (5) `client_id` propio.

## Drive cifrado: probado de extremo a extremo (2026-11-08, ~20:15 CET)
- Remoto cifrado `gdrive-crypt:` creado por el usuario con `drive-crypt-setup.sh` (dos contraseñas guardadas por él fuera del Mini; las dos primeras que se generaron salieron en el chat y se descartaron). Nombres cifrados en Drive.
- Plist `com.statsedge.db-backup` recargado con `STATSEDGE_BACKUP_UPLOAD_CMD=/Users/cristian/Statsedge-v0.1/scripts/ops/backup-upload-drive.sh`: desde la madrugada del 9-nov hace volcado → verificación → subida cifrada → poda local y de Drive.
- Subida real de `statsedge-20261108-172529.dump`: 841.657.287 B, ~20 min (19:27→~19:48 CET), tamaño verificado, 802,9 MiB en Drive.
- **Restauración desde Drive:** descargado y descifrado (841.657.287 B), `sha256` idéntico al local (`228fcd93…2363`), `pg_restore -l` lo lee (62 tablas con datos).
- Pendiente: comprobar mañana el primer disparo real a las 03:30 (`logs/db-backup-status.json`, `uploadExit`); subir los volcados antiguos del portátil; `client_id` propio de Drive antes de que retiren el compartido; `NOTIFY_URL` para que los avisos lleguen al móvil.
