import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";
import { api } from "../api";

// Loads `path` and reloads on demand; a null path waits (nothing is loaded
// yet). `data` stays undefined until the first load.
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => {
    if (path === null) return;
    try {
      setData(await api<T>(path));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    reload();
  }, [reload]);
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
