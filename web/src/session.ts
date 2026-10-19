import { getSession, setUnauthorizedHandler, type Role, type Session } from "./api";
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

const RANK: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };
export const atLeast = (s: Session | undefined, role: Role): boolean => !!s?.role && RANK[s.role] >= RANK[role];
