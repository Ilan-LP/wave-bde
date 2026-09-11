import type { AuthSession, AuthUser, RegisterInput } from "./types.js";
import { loadSession, saveSession, clearSession } from "./tokenStorage.js";

// Treat the access token as due for refresh slightly before its real expiry
// so a request can't race the token expiring mid-flight.
const EXPIRY_SAFETY_MARGIN_MS = 10_000;

interface TokenPairResponseBody {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface AuthClient {
  getSession(): AuthSession | null;
  login(email: string, password: string): Promise<AuthSession>;
  /**
   * Registers a new self-service account, then immediately logs in with the
   * same credentials — POST /auth/register issues no tokens of its own (see
   * CLAUDE.md's Authentication section), so this reuses the existing login()
   * flow rather than duplicating session handling.
   */
  register(input: RegisterInput): Promise<AuthSession>;
  logout(): Promise<void>;
  getValidAccessToken(): Promise<string | null>;
  /** Attaches a valid Authorization header, refreshing first if needed. */
  authorizedFetch(path: string, init?: RequestInit): Promise<Response>;
  subscribe(listener: () => void): () => void;
}

function toSession(body: TokenPairResponseBody): AuthSession {
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    accessTokenExpiresAt: Date.now() + body.expiresIn * 1000,
    user: body.user,
  };
}

async function readErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? "request failed";
}

/**
 * Framework-agnostic session/token client shared by every Wave frontend.
 * Persists the session in localStorage so a reload doesn't force a re-login,
 * and transparently rotates the access token via /auth/refresh when it's
 * close to expiring (see CLAUDE.md's Authentication section for the
 * rotation/reuse-detection contract this talks to).
 */
export function createAuthClient(apiUrl: string): AuthClient {
  let session: AuthSession | null = loadSession();
  const listeners = new Set<() => void>();

  function setSession(next: AuthSession | null): void {
    session = next;
    if (next) {
      saveSession(next);
    } else {
      clearSession();
    }
    listeners.forEach((listener) => listener());
  }

  async function login(email: string, password: string): Promise<AuthSession> {
    const res = await fetch(`${apiUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }
    const next = toSession((await res.json()) as TokenPairResponseBody);
    setSession(next);
    return next;
  }

  async function register(input: RegisterInput): Promise<AuthSession> {
    const res = await fetch(`${apiUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }
    return login(input.email, input.password);
  }

  async function logout(): Promise<void> {
    const current = session;
    setSession(null);
    if (!current) {
      return;
    }
    // Best-effort: an unreachable backend shouldn't block clearing the local
    // session, since the operator still needs to be able to log out.
    await fetch(`${apiUrl}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    }).catch(() => undefined);
  }

  async function refresh(): Promise<string | null> {
    const current = session;
    if (!current) {
      return null;
    }
    const res = await fetch(`${apiUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (!res.ok) {
      setSession(null);
      return null;
    }
    const next = toSession((await res.json()) as TokenPairResponseBody);
    setSession(next);
    return next.accessToken;
  }

  async function getValidAccessToken(): Promise<string | null> {
    if (!session) {
      return null;
    }
    if (session.accessTokenExpiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
      return session.accessToken;
    }
    return refresh();
  }

  async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await getValidAccessToken();
    if (!token) {
      throw new Error("not authenticated");
    }
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${apiUrl}${path}`, { ...init, headers });
    if (res.status === 401) {
      // The token was valid moments ago and still got rejected (e.g. the
      // member was deactivated or the token revoked mid-session) — treat the
      // session as dead rather than retrying.
      setSession(null);
    }
    return res;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    getSession: () => session,
    login,
    register,
    logout,
    getValidAccessToken,
    authorizedFetch,
    subscribe,
  };
}
