// Cierra la sesión HttpOnly y recarga para que AuthGate pida el token de nuevo.

export async function restartStatsEdgeSession() {
  try {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin" });
  } catch {
    // Si falla el DELETE, el reload igualmente fuerza AuthGate a revalidar.
  }
  if (typeof window !== "undefined") window.location.reload();
}
