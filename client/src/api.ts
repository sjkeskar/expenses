// The one way the app talks to the server: JSON in and out, session cookie
// included. A non-2xx response throws ApiError carrying the server's
// message and body (some errors carry details, e.g. look-alike patients).

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown
  ) {
    super(message);
  }
}

// Set by the session (auth/session.tsx): a 401 anywhere means the session
// ended (expired, deactivated, server restarted), so the app signs out.
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export async function api<T>(path: string, { method = "GET", body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/login") onUnauthorized();
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data);
  }
  return data as T;
}
