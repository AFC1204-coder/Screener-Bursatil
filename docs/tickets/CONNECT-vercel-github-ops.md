# CONNECT — Vercel + GitHub (checklist dueño)

Estado auditado **2026-09-02** desde el repo `AFC1204-coder/Screener-Bursatil`.

## Ya está hecho (no tocar salvo rotación de claves)

### GitHub Actions
- Repo conectado y workflows **activos** (último nocturno US: success 2026-09-01).
- **Secrets** en `Settings → Secrets and variables → Actions`:
  - `SUPABASE_URL` ✓
  - `SUPABASE_SERVICE_ROLE_KEY` ✓
- **Variable** de repositorio (no secreto):
  - `STATSEDGE_VCP_UNIFIED=1` ✓ (para el nocturno US con columna VCP)
- Rama por defecto del repo: `codex/statsedge-ui-polish` (los crons `schedule` solo corren ahí).

### Localhost
- Todo lo que usas en el día a día vive en **`.env.local`** (no va a git).
- Si cargas ~3300 filas desde la nube, ya tienes Supabase bien en local.

---

## Lo que falta: Vercel (solo si usas deploy / crons de Vercel)

El **CLI de Vercel en esta máquina no está logueado** (`vercel login` caducado). El conector MCP de Vercel tampoco tiene equipo vinculado. **Tú** debes completar esto en el dashboard (5–10 min).

### 1. Conectar GitHub → Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository**
2. Autoriza **GitHub** si pide permisos.
3. Repo: `AFC1204-coder/Screener-Bursatil`
4. **Production Branch:** `codex/statsedge-ui-polish` (no `main` si no es la que usas).
5. Framework: Next.js (auto). Deploy.

Si el proyecto **ya existe**: `Project → Settings → Git` → confirmar el mismo repo y rama.

### 2. Variables de entorno en Vercel

`Project → Settings → Environment Variables`

Copia **los mismos valores** que en tu `.env.local` (no pegues secretos en chats ni en git):

| Variable | Production | Preview | Notas |
|----------|------------|---------|--------|
| `SUPABASE_URL` | ✓ | ✓ | Obligatorio para nube |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | ✓ | Obligatorio; nunca `NEXT_PUBLIC_` |
| `STATSEDGE_OWNER_ID` | ✓ | opcional | Default `personal` |
| `STATSEDGE_VCP_UNIFIED` | `1` | `1` | VCP en crons/API de Vercel |
| `CRON_SECRET` | ✓ | — | Protege `/api/cron/*` en `vercel.json` |
| `STATSEDGE_ACCESS_TOKEN` | si quieres login | — | Opcional; en local sueles ir sin |
| `STATSEDGE_SESSION_SECRET` | si quieres login | — | Par con access token |

Tras guardar: **Redeploy** production para que cojan las vars.

### 3. Crons de Vercel

`vercel.json` define crons (`scan-refresh`, `universe-refresh`, etc.). Solo funcionan en **plan con crons** y con `CRON_SECRET` configurado. El **nocturno US principal** lo hace **GitHub Actions** (`scan-universe.yml`), no este cron.

### 4. Comprobar

- Deploy verde en Vercel.
- Abrir URL de production → screener carga datos (no «copia en la nube no activada»).
- GitHub → Actions → «Scan universe (US, nightly)» → última run success (o `workflow_dispatch` manual).

---

## Si solo usas localhost

**No necesitas Vercel** para desarrollar. Solo asegúrate de:

```bash
# .env.local (ejemplo)
STATSEDGE_VCP_UNIFIED=1
```

y los `SUPABASE_*` que ya tienes.

---

## Rotación / sincronización de secretos

- **GitHub Secrets** y **Vercel env** son independientes: cambiar uno no cambia el otro.
- Para alinear: copia manual desde Supabase dashboard → ambos sitios.
- No commitear `.env.local`.

## Cambio de código pendiente (orquestador)

- `.github/workflows/scan-universe.yml` pasa `STATSEDGE_VCP_UNIFIED` desde variable de repo (commit en rama de trabajo).
