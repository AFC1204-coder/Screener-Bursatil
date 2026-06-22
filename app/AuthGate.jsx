"use client";

import { useEffect, useState } from "react";
import { LockKeyhole, Loader2 } from "lucide-react";

export default function AuthGate({ children }) {
  const [status, setStatus] = useState({ loading: true, authenticated: false, requiresToken: false, productionLocked: false });
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (active) setStatus({ loading: false, ...data });
      })
      .catch(() => {
        if (active) setStatus({ loading: false, authenticated: false, requiresToken: true, productionLocked: false });
      });
    return () => {
      active = false;
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
      setStatus({ loading: false, authenticated: true, requiresToken: false, productionLocked: false });
    } catch (err) {
      setError(err.message || "No autorizado");
    } finally {
      setSubmitting(false);
    }
  }

  if (status.loading) {
    return (
      <main className="authGate">
        <div className="authGatePanel authGateInline">
          <Loader2 size={18} className="authGateSpin" />
          <span>Comprobando acceso</span>
        </div>
      </main>
    );
  }

  if (status.authenticated || (!status.requiresToken && !status.productionLocked)) return children;

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
