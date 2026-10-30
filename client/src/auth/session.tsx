import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler } from "../api";
import type { User } from "../types/api";

interface Session {
  user: User | null;
  loading: boolean;
  signIn(name: string, password: string): Promise<void>;
  // Signs out and reloads into the login page, optionally showing `notice` there.
  signOut(notice?: string): Promise<void>;
  // Re-reads the account (e.g. after a lead hand-over changed this user's role).
  refresh(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

// The login response's reminder, shown once in the app shell.
export const REMINDER_KEY = "sessionReminder";
// A message for the login page after signing out (e.g. "Password changed").
export const NOTICE_KEY = "signedOutNotice";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser((await api<{ user: User }>("/auth/me")).user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    refresh();
    // A page restored from the back/forward cache re-checks its session, so
    // Back after signing out never shows a signed-in screen (BUG-007).
    const onPageShow = (e: PageTransitionEvent) => e.persisted && refresh();
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [refresh]);

  const signIn = async (name: string, password: string) => {
    const res = await api<{ user: User; sessionReminder: string }>("/auth/login", { method: "POST", body: { name, password } });
    sessionStorage.setItem(REMINDER_KEY, res.sessionReminder);
    setUser(res.user);
  };

  // A full page load into /login rather than a client-side navigation:
  // nothing of the last user's screens stays in memory, and there's no
  // in-app navigation left to race the route guards. Plain fetch, because
  // a 401 here (the session may already be gone) needs no handling.
  const signOut = async (notice?: string) => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    sessionStorage.removeItem(REMINDER_KEY);
    if (notice) sessionStorage.setItem(NOTICE_KEY, notice);
    window.location.replace("/login");
  };

  return <SessionContext.Provider value={{ user, loading, signIn, signOut, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
