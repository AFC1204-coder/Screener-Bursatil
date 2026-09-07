import { STORAGE_KEYS } from "@/lib/localState";

export const AUTH_SESSION_HINT_KEY = "statsedge.authSessionHint.v1";
export const AUTH_SLOW_BAR_DELAY_MS = 350;
export const AUTH_VERIFY_SLOW_MS = 8_000;

export function normalizeAuthSessionStatus(data = {}) {
  return {
    loading: false,
    verifying: false,
    authenticated: Boolean(data.authenticated),
    requiresToken: Boolean(data.requiresToken),
    productionLocked: Boolean(data.productionLocked),
  };
}

export function isAuthGateOpen(status = {}) {
  return status.authenticated || (!status.requiresToken && !status.productionLocked);
}

export function hasPlausibleAuthSession() {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(AUTH_SESSION_HINT_KEY) === "1") return true;
    return Boolean(
      localStorage.getItem(STORAGE_KEYS.screenerSession)
      || localStorage.getItem(STORAGE_KEYS.scans),
    );
  } catch {
    return false;
  }
}

export function persistAuthSessionHint() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AUTH_SESSION_HINT_KEY, "1");
  } catch {
    // Sin espacio o modo privado: el arranque optimista sigue con otras señales.
  }
}

export function clearAuthSessionHint() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(AUTH_SESSION_HINT_KEY);
  } catch {
    // Ignorar.
  }
}

/** Estado inicial idéntico en SSR y primer paint del cliente (paridad de hidratación). */
export function initialAuthGateStatus() {
  return {
    loading: true,
    verifying: true,
    authenticated: false,
    requiresToken: false,
    productionLocked: false,
  };
}

/** Tras mount: reabre el gate si hay señal local de sesión (AuthGate useEffect). */
export function optimisticAuthGateStatus() {
  const plausible = hasPlausibleAuthSession();
  return {
    ...initialAuthGateStatus(),
    authenticated: plausible,
  };
}

export function shouldRenderAuthChildren(status = {}, plausible = hasPlausibleAuthSession()) {
  if (status.verifying) return plausible && Boolean(status.authenticated);
  return isAuthGateOpen(status);
}
