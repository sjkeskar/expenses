import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";
import { api, ApiError } from "../api";

// Loads `path` and reloads on demand; a null path waits (nothing is loaded
// yet). `data` stays undefined until the first load.
//
// A screen never handles its own load failures (BUG-021). How one is shown
// depends only on what the user already has in front of them:
// - The first load of `path` fails: the error is thrown during render, to
//   the screen's error boundary (components/ErrorBoundary.tsx, placed on
//   every route by App.tsx), which says what went wrong and offers a way on.
// - A reload fails while `path`'s data is showing (e.g. after an action):
//   the data stays, and the error is shown as a message.
// - `optional` data (a widget, a badge, a dialog's list) never takes the
//   screen down: its failure is a message, and `data` stays undefined.
// - A 401 is neither: the session has ended, and the app is signing out.
export function useApi<T>(path: string | null, { optional = false }: { optional?: boolean } = {}) {
  const { message } = App.useApp();
  const notify = useRef(message);
  notify.current = message;
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<{ path: string; error: Error }>();
  const loaded = useRef<string | null>(null); // the path `data` belongs to
  const reload = useCallback(async () => {
    if (path === null) return;
    try {
      setData(await api<T>(path));
      loaded.current = path;
      setError(undefined);
      setFailure(undefined);
    } catch (e) {
      const err = e as Error;
      setError(err.message);
      if (err instanceof ApiError && err.status === 401) return;
      if (optional || loaded.current === path) notify.current.error(err.message);
      else setFailure({ path, error: err });
    }
  }, [path, optional]);
  useEffect(() => {
    reload();
  }, [reload]);
  if (failure && failure.path === path) throw failure.error;
  return { data, error, reload };
}

// Runs an action at most once at a time — a second click while one is in
// flight is ignored, so a double-click never sends two requests (BUG-010).
// Failures are shown as a message; the returned promise resolves to
// whether it succeeded.
export function useAction<A extends unknown[]>(action: (...args: A) => Promise<unknown>) {
  const { message } = App.useApp();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async (...args: A) => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    try {
      await action(...args);
      return true;
    } catch (e) {
      message.error((e as Error).message);
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return [run, busy] as const;
}
