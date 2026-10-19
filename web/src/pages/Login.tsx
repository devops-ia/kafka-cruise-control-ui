import { useState } from "preact/hooks";
import { ApiError, login } from "../api";
import { refreshSession, useSession } from "../session";

export function Login() {
  const s = useSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    setBusy(true);
    setError("");
    try {
      await login(String(f.get("username")), String(f.get("password")));
      await refreshSession();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(status === 429 ? "Too many failed attempts. Wait a few minutes and try again." : status === 401 ? "Wrong user name or password." : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="login">
      <h1>Cruise Control</h1>
      {s?.mode === "oidc" ? (
        <div class="stack">
          <p>Sign in with your organisation account.</p>
          {(s.providers ?? []).map((p) => (
            <a key={p} class="button primary" href={`/api/auth/${encodeURIComponent(p)}/login`}>
              Sign in with {p}
            </a>
          ))}
        </div>
      ) : (
        <form onSubmit={submit} class="stack">
          <label>
            User name
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error && (
            <p class="state error" role="alert">
              {error}
            </p>
          )}
          <button class="primary" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
      )}
    </main>
  );
}
