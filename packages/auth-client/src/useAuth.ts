import { useCallback, useEffect, useState } from "react";
import type { AuthClient } from "./client.js";
import type { AuthUser } from "./types.js";

export interface UseAuthResult {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoggingIn: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

/** Reactive wrapper around an AuthClient's session for React components. */
export function useAuth(client: AuthClient): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(() => client.getSession()?.user ?? null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => client.subscribe(() => setUser(client.getSession()?.user ?? null)), [client]);

  const login = useCallback(
    async (email: string, password: string) => {
      setIsLoggingIn(true);
      setError(null);
      try {
        await client.login(email, password);
      } catch (err) {
        setError(err instanceof Error ? err.message : "login failed");
        throw err;
      } finally {
        setIsLoggingIn(false);
      }
    },
    [client],
  );

  const logout = useCallback(() => client.logout(), [client]);

  return { user, isAuthenticated: user !== null, isLoggingIn, error, login, logout };
}
