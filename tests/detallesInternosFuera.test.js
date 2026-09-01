// tests/detallesInternosFuera.test.js — nada interno llega a la pantalla.
//
// Un mensaje crudo del servidor no es solo feo: describe la infraestructura a
// cualquiera que mire la pantalla. El commit 296da0c cerró dos vías (las rutas
// de cron en el panel de cobertura y loadUniverse); estos tests fijan las que
// quedaban vivas:
//
//   - la restauración del último snapshot, que era la fuente real del banner
//     "Supabase: Failed to fetch. Se restaura la última copia local disponible";
//   - el motivo de frescura que compone el servidor (staleReason), que podía
//     traer 240 caracteres del error del proveedor;
//   - el nombre de una variable de entorno en el aviso de integración con X.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSnapshotFreshnessNotice } from "@/lib/snapshotFreshness";
import { DEFAULT_SERVICE_ERROR_MESSAGE, userFacingServiceError } from "@/lib/serviceErrors";

describe("userFacingServiceError", () => {
  it("traduce el fallo de red del navegador y el de Node", () => {
    // Dos textos distintos para el mismo problema: "Failed to fetch" lo lanza
    // el navegador, "fetch failed" undici en el servidor.
    for (const raw of ["TypeError: Failed to fetch", "fetch failed", "connect ECONNREFUSED 127.0.0.1:54322"]) {
      const message = userFacingServiceError(raw);
      expect(message).toMatch(/no se pudo conectar/i);
      expect(message).not.toContain(raw);
    }
  });

  it("traduce timeouts y abortos", () => {
    for (const raw of ["The operation was aborted due to timeout", "ETIMEDOUT", "/api/coverage no respondió en 30s"]) {
      expect(userFacingServiceError(raw)).toMatch(/tardó demasiado/i);
    }
  });

  it("NUNCA devuelve el texto original cuando no lo reconoce", () => {
    const raw = 'PostgREST error: relation "public.scans" does not exist';
    const message = userFacingServiceError(raw);

    expect(message).toBe(DEFAULT_SERVICE_ERROR_MESSAGE);
    expect(message).not.toMatch(/postgrest|supabase|public\.scans/i);
  });

  it("sin mensaje devuelve el fallback que pide el caller", () => {
    expect(userFacingServiceError("", "La copia en la nube no está disponible.")).toBe("La copia en la nube no está disponible.");
    expect(userFacingServiceError(null)).toBe(DEFAULT_SERVICE_ERROR_MESSAGE);
    expect(userFacingServiceError(undefined)).toBe(DEFAULT_SERVICE_ERROR_MESSAGE);
  });

  it("ninguna traducción nombra el servicio de base de datos", () => {
    const samples = ["Failed to fetch", "ETIMEDOUT", "Supabase HTTP 503", "HTTP 401 unauthorized", "algo raro"];
    for (const raw of samples) {
      expect(userFacingServiceError(raw)).not.toMatch(/supabase|postgrest|cloudflare/i);
    }
  });
});

describe("aviso de snapshot restaurado", () => {
  it("no arrastra el motivo crudo del servidor al banner", () => {
    const notice = buildSnapshotFreshnessNotice({
      stale: true,
      staleForMs: 120000,
      staleReason: "Cloudflare 521: Web server is down",
    });

    expect(notice.detail).not.toMatch(/cloudflare|web server/i);
    expect(notice.detail).toMatch(/problema temporal|tardó demasiado|no se pudo conectar/i);
  });
});

// ── Barrido estático sobre el código de pantalla ──────────────────────────
// Mismo patrón que tests/noTradingViewWidget.test.js: lo que no puede existir
// en el fuente se comprueba sobre el fuente.
const UI_ROOTS = ["app", "lib"];
const EXTENSIONS = [".js", ".jsx"];
// Las rutas de API viven en app/api (ahí la ruta ES el módulo) y los módulos
// de cliente necesitan la URL para llamarla: lo que se persigue aquí son las
// rutas metidas dentro de un texto que se pinta.
// Módulos de SERVIDOR que leen configuración de despliegue: ahí el nombre de
// la variable es el dato con el que trabajan, y su salida no se pinta.
const SKIP = ["app/api/", "lib/supabaseServer.js", "lib/internalAuth.js"];

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

describe("nada interno en el texto de la interfaz", () => {
  it("ningún nombre de variable de entorno viaja en un mensaje", () => {
    // El caso reportado: "X no configurado: define X_BEARER_TOKEN o
    // TWITTER_BEARER_TOKEN en el entorno", visible dos veces (ficha y salud de
    // mercado). Las variables se leen de process.env; lo que no pueden hacer
    // es acabar dentro de un string que la interfaz muestre.
    const offenders = UI_FILES.filter((file) => {
      const source = readFileSync(file, "utf8");
      return source
        .split("\n")
        // process.env / envValue: lectura de configuración, no texto de pantalla.
        // console.*: el log del servidor SÍ puede (y debe) nombrar la variable.
        .some((line) => !line.includes("process.env") && !line.includes("envValue(")
          && !line.includes("console.") && !line.trimStart().startsWith("//")
          && /["'`][^"'`]*\b[A-Z][A-Z0-9]*_(TOKEN|KEY|SECRET|BEARER)[A-Z0-9_]*\b[^"'`]*["'`]/.test(line));
    });

    expect(offenders).toEqual([]);
  });

  it("la integración con X no se anuncia como error del producto", () => {
    const social = readFileSync("lib/socialSentiment.js", "utf8");
    const route = readFileSync("app/api/social-sentiment/route.js", "utf8");

    // El mensaje de "sin token" ya no nombra variables...
    expect(social).not.toMatch(/error:\s*"[^"]*BEARER_TOKEN/);
    // ...y la respuesta de "no configurado" NO lleva campo `error`, porque
    // lib/clientApi.js convierte cualquier `error` del cuerpo en excepción y
    // eso saltaba por encima de la rama que oculta la sección.
    const notConfiguredBlock = route.slice(route.indexOf("if (!result.configured)"), route.indexOf("const sentiment"));
    expect(notConfiguredBlock).toContain("emptySocial");
    expect(notConfiguredBlock).not.toMatch(/^\s*error:/m);
  });
});

describe("página 404 del producto", () => {
  const notFound = readFileSync("app/not-found.jsx", "utf8");

  it("existe y está en castellano", () => {
    expect(notFound).toContain("Esta página no existe");
    // Sin rastro de la página de fábrica de Next (en inglés y sin diseño).
    expect(notFound).toMatch(/Volver al screener/);
    expect(notFound).not.toMatch(/<h1[^>]*>\s*(404|Not Found|Page not found)/i);
  });

  it("no dice qué ruta falló ni por qué", () => {
    expect(notFound).not.toMatch(/usePathname|location\.pathname|error\.message/);
  });
});

// El score de estructura se retiró de la cabecera junto con el veredicto del
// sistema (principio 1: la herramienta clasifica, no recomienda). El dato
// sigue calculándose y se lee en el desglose de N3, SIEMPRE desde
// `setupPattern` — nunca desde la raíz de la respuesta de company-brief, que
// era el bug original (cabecera en guion con el dato calculado).
describe("score de estructura en la ficha", () => {
  const client = readFileSync("app/stock/[symbol]/StockClient.jsx", "utf8");

  it("no se lee de la raíz de la respuesta", () => {
    const code = client.split("\n").filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")).join("\n");
    expect(code).not.toMatch(/\bdata\??\.patternQualityScore/);
  });

  it("la cabecera ya no pinta el score del sistema", () => {
    expect(client).not.toMatch(/stockVerdictScore/);
  });

  it("el desglose de N3 lo lee del patrón calculado", () => {
    expect(client).toMatch(/label: "Score patrón", value: Number\.isFinite\(setupPattern\.patternQualityScore\)/);
  });
});

// ── La palabra "Supabase" no se enseña ────────────────────────────────────
// El banner reportado —"Supabase: Failed to fetch. Se restaura la última copia
// local disponible"— salía de encadenar dos capas: un prefijo `Supabase: ` en
// la UI (había NUEVE) y un mensaje "Timeout consultando Supabase." compuesto en
// el servidor (había DOS). Traducir solo una capa no bastaba, y por eso este
// test barre el nombre del servicio en TODAS las cadenas, no en un puñado de
// sitios conocidos.
//
// Lo que sí puede seguir nombrándolo: las rutas de import, las claves internas
// ("supabase-disabled" y compañía), los nombres de variables de entorno y los
// console.* del servidor. Todo eso es infraestructura, no texto de pantalla.
const SERVICE_NAME = /supabase/i;
const INTERNAL_STRING = [
  /^["'`]@\/lib\/supabase/i,          // import de módulo
  /^["'`]\/api\/supabase/i,           // ruta interna llamada por el cliente
  /^["'`]supabase[a-z0-9_-]*["'`]$/i, // clave de estado: "supabase", "supabase-disabled", "supabase-skip"
  /SUPABASE_[A-Z_]+/,                 // nombre de variable de entorno
];
// Exentos con motivo, no por comodidad:
//   investorStatusLabel (tres copias) TRADUCE la palabra — necesita nombrarla
//     para sustituirla por "nube"; es la red de seguridad, no una fuga.
//   coveragePlan / screenerPipeline: plan de cobertura y diagnóstico de fallos
//     de escaneo. Hoy NINGUNA superficie los pinta (`failSummary` en
//     app/page.jsx se calcula y no se usa). Si algún día se muestran, hay que
//     traducirlos antes: por eso quedan escritos aquí y no borrados del test.
const NAME_EXEMPT = [
  "app/research-desk/page.jsx",
  "app/review/page.jsx",
  "lib/coveragePlan.js",
  "lib/screenerFormat.js",
  "lib/screenerPipeline.js",
];

const STRING_LITERAL = /(?:"[^"\n]*"|'[^'\n]*'|`[^`\n]*`)/g;

// ── Jerga de implementación no llega a la pantalla ─────────────────────────
// Complementa el barrido de Supabase: frases que explican cómo está hecho el
// sistema en lugar de qué le pasa a los datos del usuario (UX-COPY-1).
const FORBIDDEN_UI_PHRASES = [
  "contrato de capas",
  "antes de v3",
  "proyección de decisión",
  "audítalas",
  "límite de tamaño de la restauración",
  "no cabe entero en la restauración",
  "actualización en segundo plano",
  "Datos cacheados",
  "Capas del preset",
  "copia en la nube no está activada",
  "la copia en la nube",
  "Inventario sin materializar",
  "Proveedor parcial",
  "filtros guardados en la nube",
];
const FORBIDDEN_UI_WORDS = [
  /\bhydrate\b/i,
  /\blocalStorage\b/i,
];
// Módulos donde «contrato» es terminología de metodología de listas o
// diagnósticos internos, no copy de producto del screener principal.
const JARGON_EXEMPT = [
  "app/lists/page.jsx",
  "lib/screenerContracts.js",
  "lib/listRationale.js",
  "lib/screenerFilters.js",
  "lib/rcReadiness.js",
  "lib/screenerFilterCatalog.js",
  "lib/scanLightProjection.js",
  "lib/screenerPipeline.js",
  "lib/cloudSyncClient.js",
  "lib/supabaseServer.js",
  "lib/nightlyAbsence.js",
  "lib/marketBreadth.js",
  "app/research-desk/page.jsx",
  "app/review/page.jsx",
  "app/components/screener/WeeklyChangesLine.jsx",
  "lib/screenerFormat.js",
];

describe("jerga de implementación fuera de la interfaz", () => {
  it("ninguna cadena de app/ ni lib/ repite frases prohibidas de UX-COPY-1", () => {
    const offenders = [];
    for (const file of UI_FILES) {
      if (JARGON_EXEMPT.some((exempt) => file.endsWith(exempt))) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (line.includes("console.")) return;
        for (const literal of line.match(STRING_LITERAL) || []) {
          for (const phrase of FORBIDDEN_UI_PHRASES) {
            if (literal.includes(phrase)) offenders.push(`${file}:${index + 1} «${phrase}» en ${literal.trim().slice(0, 80)}`);
          }
          for (const pattern of FORBIDDEN_UI_WORDS) {
            if (pattern.test(literal)) offenders.push(`${file}:${index + 1} ${pattern} en ${literal.trim().slice(0, 80)}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("el nombre del servicio de base de datos no llega a la pantalla", () => {
  it("ninguna cadena de app/ ni lib/ lo nombra", () => {
    const offenders = [];
    for (const file of UI_FILES.concat(sourceFiles("app").filter((f) => f.includes("app/api/")))) {
      if (NAME_EXEMPT.some((exempt) => file.endsWith(exempt))) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (line.includes("console.")) return;
        for (const literal of line.match(STRING_LITERAL) || []) {
          if (!SERVICE_NAME.test(literal)) continue;
          if (INTERNAL_STRING.some((allowed) => allowed.test(literal))) continue;
          offenders.push(`${file}:${index + 1} ${literal.trim().slice(0, 80)}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it("el traductor de estado sigue cubriendo el caso por si vuelve", () => {
    // investorStatusLabel es la red: aunque un mensaje se cuele, la palabra no
    // se pinta. El test anterior evita que haga falta; este, que desaparezca.
    expect(readFileSync("lib/screenerFormat.js", "utf8")).toMatch(/replaceAll\("Supabase", "nube"\)/);
  });
});
