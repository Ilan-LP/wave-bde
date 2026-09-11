import { useState, type FormEvent } from "react";
import type { UseAuthResult } from "@wave/auth-client";
import { Banner, Button } from "@wave/ui";

// Mirrored from apps/backend/src/lib/password.ts's MIN_PASSWORD_LENGTH — not
// a second source of truth, this is client-side UX only, the backend
// re-validates regardless (same convention as ProfileScreen's mirrored
// MIN_RECHARGE_POINTS/POINTS_PER_EUR constants).
const MIN_PASSWORD_LENGTH = 8;

interface RegisterScreenProps {
  auth: UseAuthResult;
  onShowLogin: () => void;
}

export function RegisterScreen({ auth, onShowLogin }: RegisterScreenProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setValidationError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setValidationError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== confirmPassword) {
      setValidationError("passwords do not match");
      return;
    }

    try {
      await auth.register({ email, password, firstName, lastName });
    } catch {
      // surfaced via auth.registerError
    }
  }

  const error = validationError ?? auth.registerError;

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <form onSubmit={(e) => void handleSubmit(e)} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-wave">Wave — Create account</h1>
        {error && <Banner variant="error">{error}</Banner>}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700" htmlFor="firstName">
              First name
            </label>
            <input
              id="firstName"
              type="text"
              required
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-3 text-lg"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700" htmlFor="lastName">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              required
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-3 text-lg"
            />
          </div>
        </div>
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
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-3 text-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="confirmPassword">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-3 text-lg"
          />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={auth.isRegistering}>
          {auth.isRegistering ? "Creating account…" : "Create account"}
        </Button>
        <button
          type="button"
          onClick={onShowLogin}
          className="w-full text-center text-sm font-medium text-wave underline"
        >
          Already have an account? Log in
        </button>
      </form>
    </div>
  );
}
