// lib/clientApi.js — único punto de fetch del cliente hacia /api/*.
//
// Sustituye a los getJson duplicados en app/page.jsx y app/research-desk/page.jsx,
// y debe usarse también en lib/cloudSyncClient.js si hace fetch directo.
//
// Env requerida en Vercel + .env.local:
//   NEXT_PUBLIC_STATSEDGE_ACCESS_TOKEN=<mismo valor que STATSEDGE_ACCESS_TOKEN>

const TOKEN = process.env.NEXT_PUBLIC_STATSEDGE_ACCESS_TOKEN || "";

export function authHeaders(extra = {}) {
  return {
    ...(TOKEN ? { "x-statsedge-token": TOKEN } : {}),
    ...extra,
  };
}

export async function getJson(url) {
  const res = await fetch(url, { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function deleteJson(url) {
  const res = await fetch(url, { method: "DELETE", headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
