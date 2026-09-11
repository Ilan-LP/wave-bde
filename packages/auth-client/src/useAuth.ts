import { useCallback, useEffect, useState } from "react";
import type { AuthClient } from "./client.js";
import type { AuthUser, RegisterInput } from "./types.js";

export interface UseAuthResult {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoggingIn: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  isRegistering: boolean;
  registerError: string | null;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

/** Reactive wrapper around an AuthClient's session for React components. */
export function useAuth(client: AuthClient): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(() => client.getSession()?.user ?? null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

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

  const register = useCallback(
    async (input: RegisterInput) => {
      setIsRegistering(true);
      setRegisterError(null);
      try {
        await client.register(input);
      } catch (err) {
        setRegisterError(err instanceof Error ? err.message : "registration failed");
        throw err;
      } finally {
        setIsRegistering(false);
      }
    },
    [client],
  );

  const logout = useCallback(() => client.logout(), [client]);

  return {
    user,
    isAuthenticated: user !== null,
    isLoggingIn,
    error,
    login,
    isRegistering,
    registerError,
    register,
    logout,
  };
}
