// lib/serviceErrors.js — traductor único de errores de servicio a lenguaje de
// producto.
//
// Módulo sin dependencias a propósito (ni React, ni otros módulos del repo):
// lo consumen tanto la UI (app/page.jsx, salud de mercado, la ficha del valor,
// los paneles de Listas/Sectores) como lógica pura de lib/ que compone avisos
// (lib/snapshotFreshness.js).
//
// Qué problema resuelve: cualquier pantalla que pintaba `e.message` estaba
// enseñando al usuario detalles internos —"Failed to fetch", el nombre del
// servicio de base de datos, códigos HTTP, rutas de API, texto de PostgREST o
// de Cloudflare—. Eso no es solo feo: describe la infraestructura a cualquiera
// que mire la pantalla.
//
// Regla dura: esta función NUNCA devuelve el texto original. Cuando no
// reconoce el error devuelve el `fallback` que le pase el caller, y el mensaje
// crudo es responsabilidad del caller mandarlo a consola para depurar.
//
// El traductor hermano para el escaneo (userFacingScanError, en
// lib/screenerFormat.js) sigue existiendo aparte: su copia habla del ESCANEO
// —"prueba con un universo más pequeño"— y no encaja fuera de ese flujo.

const USER_FACING_SERVICE_ERROR_PATTERNS = Object.freeze([
  {
    // Navegador ("Failed to fetch") y Node/undici ("fetch failed"): dos textos
    // distintos para lo mismo, la conexión no llegó a establecerse.
    test: /\bECONNRESET\b|\bECONNREFUSED\b|\bENOTFOUND\b|\bEAI_AGAIN\b|\bfetch failed\b|\bfailed to fetch\b|\bnetwork\b.*\berror\b/i,
    message: "No se pudo conectar con el servidor de datos. Comprueba tu conexión e inténtalo de nuevo.",
  },
  {
    test: /\bAbortError\b|\bTimeoutError\b|\boperation was aborted\b|\baborted a request\b|\bsignal is aborted\b|\bETIMEDOUT\b|\btimed out\b|\btime-?out\b|no respondió en/i,
    message: "El servidor de datos tardó demasiado en responder. Inténtalo de nuevo en unos minutos.",
  },
  {
    test: /\bHTTP 5\d\d\b|\bError code 5\d\d\b|\bCloudflare\b/i,
    message: "El servidor de datos tuvo un problema temporal. Inténtalo de nuevo en unos minutos.",
  },
  {
    test: /\bHTTP 4\d\d\b|\bunauthorized\b|\bforbidden\b|\bno autorizado\b/i,
    message: "El servidor de datos rechazó la petición. Vuelve a entrar e inténtalo de nuevo.",
  },
]);

export const DEFAULT_SERVICE_ERROR_MESSAGE = "Estos datos no están disponibles ahora mismo. Inténtalo de nuevo en unos minutos.";

export function userFacingServiceError(rawMessage, fallback = DEFAULT_SERVICE_ERROR_MESSAGE) {
  const text = String(rawMessage == null ? "" : rawMessage).trim();
  if (!text) return fallback;
  const match = USER_FACING_SERVICE_ERROR_PATTERNS.find((entry) => entry.test.test(text));
  return match ? match.message : fallback;
}
