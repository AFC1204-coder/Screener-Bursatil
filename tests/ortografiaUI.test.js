// tests/ortografiaUI.test.js — las tildes de la interfaz no dependen de quién
// escribió la línea.
//
// El análisis de 2026-08-14 contó ~80 cadenas visibles sin tilde o sin ñ
// ("Vista rapida" como H1, "Accion recomendada", "Auditoria", "GRUPO LIDER",
// "Anadir a watchlist", "Si"/"No"...). El patrón es el de
// tests/detallesInternosFuera.test.js: lo que no puede existir en el fuente
// se comprueba sobre el fuente — una lista cerrada de palabras que en español
// SIEMPRE llevan tilde (o ñ) y que aparecían sin ella dentro de literales.
//
// No es un corrector: es una lista curada de las faltas ya vistas, para que
// no vuelvan. Palabras ambiguas (esta/está, si/sí sueltos) no entran como
// token; los casos concretos van como frases exactas.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const UI_ROOTS = ["app", "lib"];
const EXTENSIONS = [".js", ".jsx"];

// Capa de datos y módulos recién rehechos, fuera de este barrido:
//  - weeklyStage / screenerPipeline: sus labels se PERSISTEN en filas y
//    proyecciones; la traducción es en display (lib/stageDisplay.js).
//  - el gráfico entero se rehizo en 00ebdf9 y quedó explícitamente fuera del
//    alcance de la tarea de interfaz; cuando se toque, quitar la exención.
//  - app/api/: mensajes de servidor, mismo criterio que detallesInternosFuera.
const SKIP = [
  "lib/weeklyStage.js",
  "lib/screenerPipeline.js",
  "app/api/",
  "app/UniversalPriceChart.jsx",
  "app/ChartPreferences.jsx",
  "app/chartNativeAdapter.js",
  "app/useChartController.js",
  "app/useChartDataModel.js",
  "app/useChartDrawings.js",
  "app/useChartInteraction.js",
  "app/useChartViewport.js",
  "lib/chartDataModel.js",
  "lib/chartDataQuality.js",
  "lib/chartInteractionMachine.js",
  "lib/chartNavigation.js",
  "lib/chartSeriesModel.js",
  "lib/chartSettings.js",
  "lib/chartViewportLifecycle.js",
  "lib/chartViewportModel.js",
];

// token sin tilde → forma correcta (solo para el mensaje de error).
const MISSPELLED = {
  Accion: "Acción", accion: "acción", acciones: null, // "acciones" es correcta: solo el singular sin tilde falla
  Auditoria: "Auditoría", auditoria: "auditoría",
  Navegacion: "Navegación", navegacion: "navegación",
  rapida: "rápida", rapidas: "rápidas", rapido: "rápido", rapidos: "rápidos", Rapida: "Rápida",
  regimen: "régimen", Regimen: "Régimen",
  pais: "país", paises: "países", Pais: "País", Paises: "Países",
  ultimo: "último", ultima: "última", Ultimo: "Último", Ultima: "Última",
  unica: "única", unicas: "únicas", unico: "único",
  Anadir: "Añadir", anadir: "añadir", anadidos: "añadidos", anadido: "añadido", anade: "añade",
  todavia: "todavía", Todavia: "Todavía",
  grafico: "gráfico", graficos: "gráficos", Grafico: "Gráfico", grafica: "gráfica",
  metrica: "métrica", metricas: "métricas", Metrica: "Métrica", Metricas: "Métricas",
  tecnico: "técnico", tecnica: "técnica", tecnicos: "técnicos", tecnicas: "técnicas",
  Historico: "Histórico", historico: "histórico",
  cotizacion: "cotización", Cotizacion: "Cotización",
  Documentacion: "Documentación", documentacion: "documentación",
  automaticamente: "automáticamente",
  confirmacion: "confirmación", investigacion: "investigación",
  revision: "revisión", posicion: "posición", resolucion: "resolución", decision: "decisión",
  observacion: "observación", clasificacion: "clasificación", integracion: "integración",
  acumulacion: "acumulación", distribucion: "distribución", contraccion: "contracción",
  transicion: "transición", categoria: "categoría",
  Japon: "Japón", Sudafrica: "Sudáfrica", Mexico: "México", Taiwan: "Taiwán",
  fragiles: "frágiles", fragil: "frágil", Fragil: "Frágil", Lider: "Líder", lider: "líder", lideres: "líderes",
  senal: "señal", senales: "señales", pequena: "pequeña", tamano: "tamaño", jovenes: "jóvenes",
  heuristico: "heurístico", heuristicas: "heurísticas",
  automatica: "automática", automatico: "automático", automaticas: "automáticas",
  metodologica: "metodológica", metodologico: "metodológico", metodologicas: "metodológicas", metodologicos: "metodológicos",
  numerica: "numérica", numerico: "numérico", sintesis: "síntesis",
  aqui: "aquí", Aqui: "Aquí", simbolo: "símbolo", simbolos: "símbolos", Simbolo: "Símbolo",
  dia: "día", dias: "días", Dia: "Día",
  aun: "aún", Aun: "Aún",
  mas: "más", Mas: "Más",
  tambien: "también", ningun: "ningún", proximos: "próximos", caracteristicas: "características", segun: "según",
  util: "útil", debil: "débil", Debil: "Débil", debiles: "débiles", Debiles: "Débiles",
  vacia: "vacía", valido: "válido", invalido: "inválido",
  minima: "mínima", minimo: "mínimo",
};

const TOKENS = Object.keys(MISSPELLED).filter((token) => MISSPELLED[token]);
const TOKEN_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}_-])(${TOKENS.join("|")})(?![\\p{L}\\p{N}_-])`, "u");

// Frases exactas que no se pueden cazar por token suelto.
const PHRASES = [/\? "Si" : "No"/];

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

const UI_FILES = UI_ROOTS.flatMap((root) => sourceFiles(root))
  .filter((file) => !SKIP.some((skip) => file.includes(skip)));

const STRING_LITERAL = /(?:"[^"\n]*"|'[^'\n]*'|`[^`\n]*`)/g;
// Texto JSX plano entre etiquetas (">Vista rapida</a>"): ahí no viven
// identificadores ni claves, solo texto de pantalla. Se excluyen segmentos
// con interpolaciones ({...}).
const JSX_TEXT = />([^<>{}"'`]+)</g;

// Literales exentos EXACTOS, con motivo (claves/tokens, nunca texto visible):
//   "decision"  — clave de modo/objeto (p.ej. metric keys, imports de dominio).
//   "senal"     — nombre del token de diseño --senal (tokens-v2.css).
//   "debil"     — matcher lowercased contra datos legados ("Debil / mixta").
const EXACT_EXEMPT = new Set(['"decision"', '"senal"', '"debil"', "'decision'", "'senal'", "'debil'"]);

// Dentro de un template literal, lo que va en ${...} es código, no texto.
function stripInterpolations(literal) {
  return literal.startsWith("`") ? literal.replace(/\$\{[^}]*\}/g, "") : literal;
}

describe("ortografía de los textos de la interfaz", () => {
  it("ninguna cadena visible contiene las faltas de la lista", () => {
    const offenders = [];
    for (const file of UI_FILES) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (trimmed.startsWith("import ") || trimmed.startsWith("} from ") || / from "@?\//.test(line)) return;
        for (const rawLiteral of line.match(STRING_LITERAL) || []) {
          if (EXACT_EXEMPT.has(rawLiteral)) continue;
          const literal = stripInterpolations(rawLiteral);
          const match = literal.match(TOKEN_PATTERN);
          if (match) {
            offenders.push(`${file}:${index + 1} [${match[1]} → ${MISSPELLED[match[1]]}] ${literal.trim().slice(0, 80)}`);
          }
        }
        for (const jsxText of [...line.matchAll(JSX_TEXT)].map((m) => m[1])) {
          const match = jsxText.match(TOKEN_PATTERN);
          if (match) {
            offenders.push(`${file}:${index + 1} [${match[1]} → ${MISSPELLED[match[1]]}] >${jsxText.trim().slice(0, 80)}<`);
          }
        }
        if (PHRASES.some((phrase) => phrase.test(line))) {
          offenders.push(`${file}:${index + 1} [Si → Sí] ${trimmed.slice(0, 80)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
