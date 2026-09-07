"use client";

import { useEffect, useState } from "react";
import { LockKeyhole, Loader2 } from "lucide-react";
import {
  AUTH_SLOW_BAR_DELAY_MS,
  AUTH_VERIFY_SLOW_MS,
  clearAuthSessionHint,
  hasPlausibleAuthSession,
  initialAuthGateStatus,
  isAuthGateOpen,
  normalizeAuthSessionStatus,
  optimisticAuthGateStatus,
  persistAuthSessionHint,
  shouldRenderAuthChildren,
} from "@/lib/authBoot";

function AuthVerifyBar({ slow = false }) {
  return (
    <div className="authVerifyBar" role="status" aria-live="polite">
      <Loader2 size={14} className="authGateSpin" aria-hidden="true" />
      <span>{slow ? "Comprobando acceso (tarda más de lo habitual)…" : "Comprobando acceso…"}</span>
    </div>
  );
}

export default function AuthGate({ children }) {
  const [status, setStatus] = useState(initialAuthGateStatus);
  const [showSlowBar, setShowSlowBar] = useState(false);
  const [verifySlow, setVerifySlow] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (hasPlausibleAuthSession()) {
      setStatus(optimisticAuthGateStatus());
    }
    let active = true;
    const slowBarTimer = window.setTimeout(() => {
      if (active) setShowSlowBar(true);
    }, AUTH_SLOW_BAR_DELAY_MS);
    const slowVerifyTimer = window.setTimeout(() => {
      if (active) setVerifySlow(true);
    }, AUTH_VERIFY_SLOW_MS);

    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        const next = normalizeAuthSessionStatus(data);
        if (next.authenticated || isAuthGateOpen(next)) persistAuthSessionHint();
        else clearAuthSessionHint();
        setStatus(next);
      })
      .catch(() => {
        if (!active) return;
        clearAuthSessionHint();
        setStatus({
          loading: false,
          verifying: false,
          authenticated: false,
          requiresToken: true,
          productionLocked: false,
        });
      })
      .finally(() => {
        if (!active) return;
        setShowSlowBar(false);
        setVerifySlow(false);
      });

    return () => {
      active = false;
      window.clearTimeout(slowBarTimer);
      window.clearTimeout(slowVerifyTimer);
    };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setToken("");
      persistAuthSessionHint();
      setStatus({
        loading: false,
        verifying: false,
        authenticated: true,
        requiresToken: false,
        productionLocked: false,
      });
    } catch (err) {
      setError(err.message || "No autorizado");
    } finally {
      setSubmitting(false);
    }
  }

  if (shouldRenderAuthChildren(status)) {
    return (
      <>
        {status.verifying && showSlowBar ? <AuthVerifyBar slow={verifySlow} /> : null}
        {children}
      </>
    );
  }

  if (status.verifying) {
    return (
      <>
        {showSlowBar ? <AuthVerifyBar slow={verifySlow} /> : null}
        <main className="authGate authGatePending" aria-busy="true" aria-label="Comprobando acceso" />
      </>
    );
  }

  return (
    <main className="authGate">
      <form className="authGatePanel" onSubmit={submit}>
        <div className="authGateIcon" aria-hidden="true">
          <LockKeyhole size={18} />
        </div>
        <h1>Acceso a StatsEdge</h1>
        <p className="muted">
          {status.productionLocked
            ? "Configura STATSEDGE_ACCESS_TOKEN en el servidor para cerrar el perímetro."
            : "Introduce el token privado para iniciar una sesión segura."}
        </p>
        {!status.productionLocked ? (
          <>
            <label className="field">
              Token
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoFocus
              />
            </label>
            {error ? <div className="authGateError">{error}</div> : null}
            <button className="btn btnPrimary" type="submit" disabled={submitting || !token.trim()}>
              {submitting ? "Validando..." : "Entrar"}
            </button>
          </>
        ) : null}
      </form>
    </main>
  );
}
