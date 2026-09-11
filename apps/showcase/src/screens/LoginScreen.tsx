import { useState, type FormEvent } from "react";
import type { UseAuthResult } from "@wave/auth-client";
import { Banner, Button } from "@wave/ui";

interface LoginScreenProps {
  auth: UseAuthResult;
  onShowRegister: () => void;
}

export function LoginScreen({ auth, onShowRegister }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await auth.login(email, password);
    } catch {
      // surfaced via auth.error
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <form onSubmit={(e) => void handleSubmit(e)} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-wave">Wave — Profil</h1>
        {auth.error && <Banner variant="error">{auth.error}</Banner>}
        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-3 text-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-3 text-lg"
          />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={auth.isLoggingIn}>
          {auth.isLoggingIn ? "Logging in…" : "Log in"}
        </Button>
        <button
          type="button"
          onClick={onShowRegister}
          className="w-full text-center text-sm font-medium text-wave underline"
        >
          No account yet? Create one
        </button>
      </form>
    </div>
  );
}
