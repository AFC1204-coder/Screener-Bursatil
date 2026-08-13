#!/usr/bin/env bash
#
# vfc — verificación de cierre de tarea.
#
# Automatiza los cinco pasos que el dueño del repo repite a mano cada vez
# que un modelo termina una tarea (~15 veces al día): alcance del diff,
# lectura del diff, tests, comprobación de alcance, y estado del entorno
# de desarrollo. Ver AGENTS.md para la gobernanza del repo.
#
# Uso:
#   ./scripts/verificar.sh [--limpiar] [patrón_alcance ...]
#   ./vfc [--limpiar] [patrón_alcance ...]
#
# Sin argumentos de alcance: solo lista los archivos tocados, sin juzgar.
# Con argumentos: cualquier archivo tocado que no case con ninguno de los
# patrones dados se marca como fuera de alcance.
#
# --limpiar: mata los procesos del servidor de desarrollo y borra .next.
#            No arranca nada. Sin esta opción el script no mata ni borra.

set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

# --- Colores (solo si el terminal los soporta) --------------------------
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  C_RED=$(tput setaf 1); C_GREEN=$(tput setaf 2); C_YELLOW=$(tput setaf 3)
  C_BLUE=$(tput setaf 4); C_BOLD=$(tput bold); C_RESET=$(tput sgr0)
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi

ok()    { echo "${C_GREEN}✓${C_RESET} $*"; }
warn()  { echo "${C_YELLOW}⚠${C_RESET} $*"; }
bad()   { echo "${C_RED}✗${C_RESET} $*"; }
info()  { echo "${C_BLUE}·${C_RESET} $*"; }
header(){ echo; echo "${C_BOLD}$*${C_RESET}"; }

EXIT_CODE=0
NEEDS_REVIEW=()

# --- Parseo de argumentos -------------------------------------------------
LIMPIAR=0
SCOPE_PATTERNS=()
for arg in "$@"; do
  case "$arg" in
    --limpiar) LIMPIAR=1 ;;
    *) SCOPE_PATTERNS+=("$arg") ;;
  esac
done

echo "${C_BOLD}=== vfc — verificación de cierre de tarea ===${C_RESET}"
echo "Repo: $(pwd)"
echo "Rama: $(git branch --show-current 2>/dev/null || echo '?')"

################################################################################
# PARTE A — ALCANCE
#
# Motivo: el dueño necesita ver, de un vistazo, qué se tocó y si algo se
# salió del pedido original. Antes lo hacía leyendo `git status` a ojo.
################################################################################
header "PARTE A — Alcance"

CHANGED_FILES=$(git status --porcelain | awk '{print $2}')
CHANGED_COUNT=$(echo "$CHANGED_FILES" | grep -c . || true)

if [ "$CHANGED_COUNT" -eq 0 ]; then
  info "No hay archivos modificados ni sin trackear."
else
  info "Archivos modificados/sin trackear: $CHANGED_COUNT"
  git status --short | sed 's/^/  /'
fi

# Archivos sensibles: su modificación ha causado incidentes reales (un
# subagente leyó .env.local y consultó Supabase saltándose el MCP de
# solo lectura). Cualquier toque a estos archivos se marca en rojo.
SENSITIVE_PATTERNS=('.env.local' '.mcp.json' 'scripts/mcp/' 'supabase/schema.sql' 'AGENTS.md')
SENSITIVE_HIT=0
if [ "$CHANGED_COUNT" -gt 0 ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    for pat in "${SENSITIVE_PATTERNS[@]}"; do
      case "$f" in
        "$pat"|"$pat"*)
          bad "Archivo sensible tocado: $f"
          SENSITIVE_HIT=1
          ;;
      esac
    done
  done <<< "$CHANGED_FILES"
fi
if [ "$SENSITIVE_HIT" -eq 1 ]; then
  NEEDS_REVIEW+=("Se tocaron archivos sensibles (.env.local, .mcp.json, scripts/mcp/, supabase/schema.sql o AGENTS.md)")
  EXIT_CODE=1
fi

# Comprobación de alcance declarado. Motivo: cambios que tocaron archivos
# fuera de lo pedido han pasado desapercibidos hasta revisión manual.
OUT_OF_SCOPE=()
if [ ${#SCOPE_PATTERNS[@]} -gt 0 ] && [ "$CHANGED_COUNT" -gt 0 ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    in_scope=0
    for pat in "${SCOPE_PATTERNS[@]}"; do
      case "$f" in
        "$pat"|"$pat"*) in_scope=1 ;;
      esac
    done
    [ "$in_scope" -eq 0 ] && OUT_OF_SCOPE+=("$f")
  done <<< "$CHANGED_FILES"

  if [ ${#OUT_OF_SCOPE[@]} -gt 0 ]; then
    warn "Archivos fuera del alcance declarado (${SCOPE_PATTERNS[*]}):"
    for f in "${OUT_OF_SCOPE[@]}"; do
      echo "  ${C_YELLOW}-${C_RESET} $f"
    done
    NEEDS_REVIEW+=("${#OUT_OF_SCOPE[@]} archivo(s) fuera del alcance declarado")
    EXIT_CODE=1
  else
    ok "Todos los archivos tocados caen dentro del alcance declarado."
  fi
elif [ ${#SCOPE_PATTERNS[@]} -eq 0 ]; then
  info "No se pasó alcance esperado; solo se lista, sin juzgar."
fi

header "Diff completo"
if [ "$CHANGED_COUNT" -eq 0 ]; then
  info "(sin cambios)"
else
  git --no-pager diff
  # git diff no incluye archivos nuevos sin trackear; se muestran aparte.
  UNTRACKED=$(git status --porcelain | awk '$1 == "??" {print $2}')
  if [ -n "$UNTRACKED" ]; then
    info "Archivos sin trackear (no aparecen en git diff):"
    echo "$UNTRACKED" | sed 's/^/  /'
  fi
fi

################################################################################
# PARTE B — TRAMPAS EN LOS TESTS
#
# Motivo: la forma más fácil de que un cambio "pase" tests sin probar nada
# es marcar el test como .skip/.only, o debilitar una aserción concreta a
# un chequeo genérico. Ninguna de las dos cosas se ve en el resumen de
# `npm test` — hay que mirar el diff de los propios tests.
################################################################################
header "PARTE B — Trampas en los tests"

TEST_FILES_CHANGED=$(echo "$CHANGED_FILES" | grep -E '\.(test|spec)\.[jt]sx?$' || true)

if [ -z "$TEST_FILES_CHANGED" ]; then
  info "No se modificaron archivos de test."
else
  SKIP_ONLY_HIT=0
  while IFS= read -r tf; do
    [ -z "$tf" ] && continue
    [ -f "$tf" ] || continue
    HITS=$(grep -nE '\.(skip|only)\(' "$tf" || true)
    if [ -n "$HITS" ]; then
      warn "$tf contiene .skip/.only:"
      echo "$HITS" | sed 's/^/    /'
      SKIP_ONLY_HIT=1
    fi
  done <<< "$TEST_FILES_CHANGED"
  if [ "$SKIP_ONLY_HIT" -eq 1 ]; then
    NEEDS_REVIEW+=(".skip/.only presente en tests modificados")
    EXIT_CODE=1
  else
    ok "Sin .skip/.only en tests modificados."
  fi

  # Aserciones debilitadas: se detectan en las líneas AÑADIDAS del diff que
  # contienen expect.anything()/toBeDefined()/toBeTruthy(). Se reportan sin
  # juzgar, porque pueden ser legítimas — la decisión es del dueño.
  WEAK_HITS=$(git --no-pager diff -- $TEST_FILES_CHANGED 2>/dev/null \
    | grep -E '^\+' | grep -v '^\+\+\+' \
    | grep -E 'expect\.anything\(\)|toBeDefined\(\)|toBeTruthy\(\)|toBeFalsy\(\)' || true)
  if [ -n "$WEAK_HITS" ]; then
    info "Aserciones potencialmente debilitadas en el diff (revisar si es intencional):"
    echo "$WEAK_HITS" | sed 's/^/  /'
  else
    info "Sin aserciones genéricas nuevas detectadas en el diff de tests."
  fi
fi

################################################################################
# PARTE C — LOS TESTS
#
# Motivo: ha habido informes que decían "los tests pasan" cuando en la
# terminal del dueño fallaban. Este bloque ejecuta la suite de verdad y
# reporta el resultado tal cual sale, no lo que un modelo dice que salió.
################################################################################
header "PARTE C — Tests (npm test)"

TEST_LOG=$(mktemp)
if npm test > "$TEST_LOG" 2>&1; then
  TEST_STATUS=0
else
  TEST_STATUS=1
fi

# vitest imprime algo como:
#  Test Files  12 passed (12)
#       Tests  84 passed (84)
SUMMARY_FILES=$(grep -E '^\s*Test Files' "$TEST_LOG" | tail -1)
SUMMARY_TESTS=$(grep -E '^\s*Tests' "$TEST_LOG" | tail -1)
FAILED_BLOCKS=$(grep -E '^\s*(FAIL|✗|×)' "$TEST_LOG" || true)

if [ "$TEST_STATUS" -eq 0 ]; then
  ok "npm test terminó sin errores."
else
  bad "npm test terminó con errores (código de salida != 0)."
  NEEDS_REVIEW+=("npm test falló")
  EXIT_CODE=1
fi

[ -n "$SUMMARY_FILES" ] && echo "  $SUMMARY_FILES"
[ -n "$SUMMARY_TESTS" ] && echo "  $SUMMARY_TESTS"

if [ -z "$SUMMARY_FILES" ] && [ -z "$SUMMARY_TESTS" ]; then
  warn "No se pudo extraer el resumen habitual de vitest; últimas líneas del log:"
  tail -20 "$TEST_LOG" | sed 's/^/  /'
fi

if [ -n "$FAILED_BLOCKS" ]; then
  echo
  info "Fallos reportados:"
  echo "$FAILED_BLOCKS" | sed 's/^/  /'
fi

rm -f "$TEST_LOG"

################################################################################
# PARTE D — EL ENTORNO
#
# Motivo: esta semana hubo dos servidores de desarrollo corriendo a la vez
# (uno viejo en :3000, uno nuevo en :3001) y costó media hora de confusión
# hasta detectarlo. Este bloque detecta procesos "next dev" y en qué puerto
# escuchan cada uno.
################################################################################
header "PARTE D — Entorno de desarrollo"

# Se buscan procesos de next dev (o el wrapper npm run dev) por línea de
# comando, no solo por nombre, para no perder wrappers de npm/node.
DEV_PIDS=$(pgrep -f "next dev|next-dev|npm run dev" 2>/dev/null || true)

# `next dev --webpack` bifurca un proceso hijo que es el que realmente
# escucha el puerto — el pid que matchea el patrón de arriba casi nunca es
# el que tiene el socket abierto. Por eso hay que bajar hasta 3 niveles de
# hijos para encontrar el puerto real.
collect_descendants() {
  local pid="$1"
  local depth="$2"
  local out="$pid"
  [ "$depth" -le 0 ] && { echo "$out"; return; }
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    out="$out $(collect_descendants "$child" $((depth - 1)))"
  done
  echo "$out"
}

# Primera pasada: descarta autocapturas (pgrep/grep) y procesos que ya
# murieron entre el pgrep y el ps.
DEV_CANDIDATES=""
if [ -n "$DEV_PIDS" ]; then
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    # Evita capturarse a sí mismo o a pgrep/grep.
    CMD=$(ps -p "$pid" -o command= 2>/dev/null || true)
    [ -z "$CMD" ] && continue
    case "$CMD" in
      *pgrep*|*"grep -f"*) continue ;;
    esac
    DEV_CANDIDATES="$DEV_CANDIDATES $pid"
  done <<< "$DEV_PIDS"
fi

# UN servidor arrancado con `npm run dev` produce DOS procesos que casan con
# el patrón de arriba: el wrapper de npm y el `next dev` que lanza como hijo.
# Contarlos por separado disparaba el aviso de "dos servidores" con uno solo
# corriendo (falso positivo real, 2026-08-13: PID 9000 `npm run dev` y PID
# 9017 `next dev --webpack`, ambos en :3000, siendo 9017 hijo de 9000).
#
# Criterio: un candidato cuyo ancestro también es candidato pertenece al
# mismo árbol y no es un servidor aparte. Se sube la cadena de PPID entera,
# no solo un nivel, porque entre el wrapper y el servidor puede haber un
# `sh -c` intermedio que no casa con el patrón.
#
# Esto NO afecta al caso que motivó el aviso (10 de agosto: uno en el :3000
# de este proyecto y otro en el :3100 de /private/tmp): dos servidores
# lanzados desde terminales distintas cuelgan cada uno de su propia shell,
# que no casa con el patrón, así que ninguno es ancestro del otro y siguen
# contando como dos.
has_dev_ancestor() {
  local parent
  parent=$(ps -p "$1" -o ppid= 2>/dev/null | tr -d ' ')
  while [ -n "$parent" ] && [ "$parent" -gt 1 ] 2>/dev/null; do
    case " $DEV_CANDIDATES " in
      *" $parent "*) return 0 ;;
    esac
    parent=$(ps -p "$parent" -o ppid= 2>/dev/null | tr -d ' ')
  done
  return 1
}

DEV_SERVERS=()
for pid in $DEV_CANDIDATES; do
  has_dev_ancestor "$pid" && continue
  CMD=$(ps -p "$pid" -o command= 2>/dev/null || true)
  [ -z "$CMD" ] && continue
  ALL_PIDS=$(collect_descendants "$pid" 3)
  PORTS=$(lsof -iTCP -sTCP:LISTEN -Pn -a -p "$(echo "$ALL_PIDS" | tr ' ' ',')" 2>/dev/null \
    | awk 'NR>1 {print $9}' | sed -E 's/.*:([0-9]+)$/\1/' | sort -un | tr '\n' ',' | sed 's/,$//')
  # Los pids del árbol viajan en la entrada para que --limpiar siga matando
  # también a los hijos, que ya no se listan por separado.
  DEV_SERVERS+=("$pid|${PORTS:-?}|$(echo "$ALL_PIDS" | tr ' ' ',')|$CMD")
done

DEV_COUNT=${#DEV_SERVERS[@]}
if [ "$DEV_COUNT" -eq 0 ]; then
  info "No hay servidores de desarrollo corriendo."
elif [ "$DEV_COUNT" -eq 1 ]; then
  IFS='|' read -r pid ports tree cmd <<< "${DEV_SERVERS[0]}"
  ok "Un servidor de desarrollo corriendo (PID $pid, puerto ${ports:-?})."
else
  bad "Hay $DEV_COUNT servidores de desarrollo corriendo a la vez — esto ya ha costado media hora de confusión:"
  for entry in "${DEV_SERVERS[@]}"; do
    IFS='|' read -r pid ports tree cmd <<< "$entry"
    echo "  ${C_RED}-${C_RESET} PID $pid, puerto ${ports:-?}: $cmd"
  done
  NEEDS_REVIEW+=("$DEV_COUNT servidores de desarrollo corriendo simultáneamente")
  EXIT_CODE=1
fi

if [ -d ".next" ]; then
  info ".next existe ($(du -sh .next 2>/dev/null | cut -f1))."
else
  info ".next no existe."
fi

# --limpiar: solo actúa cuando se pasa explícitamente. Sin esta opción el
# script no mata procesos ni borra nada — así lo pidió el dueño.
if [ "$LIMPIAR" -eq 1 ]; then
  header "--limpiar: limpiando entorno"
  if [ "$DEV_COUNT" -gt 0 ]; then
    for entry in "${DEV_SERVERS[@]}"; do
      IFS='|' read -r pid ports tree cmd <<< "$entry"
      # Se mata el árbol entero, no solo la raíz: los hijos ya no se listan
      # por separado, y matar el wrapper de npm no siempre arrastra al hijo.
      KILLED=""
      for tpid in $(echo "$tree" | tr ',' ' '); do
        kill "$tpid" 2>/dev/null && KILLED="$KILLED $tpid"
      done
      if [ -n "$KILLED" ]; then
        ok "Matado PID$KILLED (puerto ${ports:-?})."
      else
        warn "No se pudo matar PID $pid."
      fi
    done
  else
    info "No había servidores de desarrollo que matar."
  fi

  if [ -d ".next" ]; then
    rm -rf .next
    ok ".next borrado."
  else
    info ".next no existía."
  fi

  info "No se arranca nada — eso lo hace el dueño."
fi

################################################################################
# PARTE E — VEREDICTO
################################################################################
header "PARTE E — Veredicto"

if [ "$SENSITIVE_HIT" -eq 0 ] && { [ ${#SCOPE_PATTERNS[@]} -eq 0 ] || [ ${#OUT_OF_SCOPE[@]} -eq 0 ]; }; then
  ok "Alcance: limpio."
else
  bad "Alcance: revisar (ver Parte A)."
fi

if [ "$TEST_STATUS" -eq 0 ]; then
  ok "Tests: pasan."
else
  bad "Tests: fallan (ver Parte C)."
fi

if [ "$DEV_COUNT" -le 1 ]; then
  ok "Entorno: en orden ($DEV_COUNT servidor(es) de desarrollo)."
else
  bad "Entorno: $DEV_COUNT servidores de desarrollo a la vez."
fi

if [ ${#NEEDS_REVIEW[@]} -eq 0 ]; then
  ok "Nada pendiente de revisión manual."
else
  warn "Revisar a mano:"
  for item in "${NEEDS_REVIEW[@]}"; do
    echo "  ${C_YELLOW}-${C_RESET} $item"
  done
fi

echo
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "${C_GREEN}${C_BOLD}=== TODO EN ORDEN ===${C_RESET}"
else
  echo "${C_RED}${C_BOLD}=== HAY ALGO QUE REVISAR ===${C_RESET}"
fi

exit "$EXIT_CODE"
