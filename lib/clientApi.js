// lib/clientApi.js — único punto de fetch del cliente hacia /api/*.
//
// Sustituye a los getJson duplicados en app/page.jsx y app/research-desk/page.jsx,
// y debe usarse también en lib/cloudSyncClient.js si hace fetch directo. La
// autenticación del perímetro viaja por cookie HttpOnly, nunca por token público.

export function requestHeaders(extra = {}) {
  return { ...extra };
}

export async function getJson(url, options = {}) {
  const { headers = {}, timeoutMs = 0, signal, ...fetchOptions } = options || {};
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const abortFromParent = () => controller?.abort(signal?.reason);
  if (signal && controller) {
    if (signal.aborted) abortFromParent();
    else signal.addEventListener("abort", abortFromParent, { once: true });
  }
  try {
    const res = await fetch(url, { ...fetchOptions, headers: requestHeaders(headers), signal: controller?.signal || signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (signal && controller) signal.removeEventListener("abort", abortFromParent);
  }
}

export async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: requestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function deleteJson(url) {
  const res = await fetch(url, { method: "DELETE", headers: requestHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
