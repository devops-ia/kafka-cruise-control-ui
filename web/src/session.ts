import { getSession, setUnauthorizedHandler, type Session } from "./api";
import { createStore, useStore } from "./store";

export const session = createStore<Session | undefined>(undefined);
export const useSession = () => useStore(session);

export async function refreshSession(): Promise<void> {
  session.set(await getSession());
}

// A 401 anywhere drops back to the login screen without changing the URL, so the same page shows after signing in.
setUnauthorizedHandler(() => {
  refreshSession().catch(() => session.set({ authenticated: false, mode: "local" }));
});

export const isAdmin = (s: Session | undefined): boolean => s?.role === "admin";
