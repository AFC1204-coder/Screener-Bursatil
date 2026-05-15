# StatsEdge Supabase connector

StatsEdge usa dos conexiones separadas:

- Runtime de la app: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- Administracion puntual: `SUPABASE_ACCESS_TOKEN`, solo para ejecutar `supabase/schema.sql`.

## Variables

En `.env.local`:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
STATSEDGE_OWNER_ID=personal

SUPABASE_ACCESS_TOKEN=your-supabase-personal-access-token
SUPABASE_PROJECT_REF=your-project-ref
```

`SUPABASE_PROJECT_REF` puede omitirse si `SUPABASE_URL` tiene el formato normal `https://ref.supabase.co`.

## Comandos

Comprobar estado:

```bash
npm run supabase:status
```

Ejecutar schema remoto:

```bash
npm run supabase:schema
```

El conector no imprime claves. Solo muestra si existen, el project ref y el estado de `public.scans`.

## Seguridad

No pongas `SUPABASE_SERVICE_ROLE_KEY` ni `SUPABASE_ACCESS_TOKEN` con prefijo `NEXT_PUBLIC_`.
Antes de produccion, rota cualquier clave que haya pasado por el chat o por capturas.
