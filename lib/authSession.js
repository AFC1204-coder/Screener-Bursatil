import { createHmac } from "crypto";

export const SESSION_COOKIE = "statsedge_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function timingSafeEqual(a = "", b = "") {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function appAccessToken() {
  return String(process.env.STATSEDGE_ACCESS_TOKEN || "").trim();
}

function sessionSecret() {
  const explicit = String(process.env.STATSEDGE_SESSION_SECRET || "").trim();
  if (explicit) return explicit;
  if (process.env.NODE_ENV === "production") return "";
  return appAccessToken();
}

function sign(payload = "") {
  const secret = sessionSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createStatsEdgeSession(now = Date.now()) {
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v1.${expiresAt}`;
  const signature = sign(payload);
  if (!signature) throw new Error("STATSEDGE_SESSION_SECRET no configurado");
  return `${payload}.${signature}`;
}

export function isStatsEdgeSessionValid(value = "", now = Date.now()) {
  const [version, expiresAtRaw, signature, ...extra] = String(value || "").split(".");
  if (extra.length || version !== "v1" || !expiresAtRaw || !signature) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return timingSafeEqual(signature, sign(`${version}.${expiresAtRaw}`));
}

export function matchesStatsEdgeAccessToken(token = "") {
  const expected = appAccessToken();
  return Boolean(expected) && timingSafeEqual(String(token || "").trim(), expected);
}

export function authOpenForLocalDev() {
  return !appAccessToken() && process.env.NODE_ENV !== "production";
}
