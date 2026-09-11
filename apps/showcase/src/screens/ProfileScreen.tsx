import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { UseAuthResult } from "@wave/auth-client";
import { Banner, Button } from "@wave/ui";
import QRCode from "qrcode";
import { confirmRecharge, fetchBalance, fetchQrCode, startRecharge } from "../lib/profile";

// Sanity bounds mirrored from the backend's MIN_RECHARGE_POINTS/
// MAX_RECHARGE_POINTS (apps/backend/src/routes/me.ts) so the form can reject
// out-of-range amounts before making a request, not a second source of
// truth — the backend re-validates regardless.
const MIN_RECHARGE_POINTS = 1;
const MAX_RECHARGE_POINTS = 3000;
// Display-only mirror of the backend's POINTS_PER_EUR peg (sumup.ts) — used
// here purely to label the amount input, not to compute anything sent to
// the server.
const POINTS_PER_EUR = 15;
const POLL_INTERVAL_MS = 3000;

interface ProfileScreenProps {
  auth: UseAuthResult;
}

interface Outcome {
  variant: "success" | "error" | "info";
  message: string;
}

export function ProfileScreen({ auth }: ProfileScreenProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const [amountInput, setAmountInput] = useState("");
  const [isStartingRecharge, setIsStartingRecharge] = useState(false);
  const [pendingRechargeId, setPendingRechargeId] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadBalance = useCallback(() => {
    fetchBalance()
      .then((value) => {
        setBalance(value);
        setBalanceError(null);
      })
      .catch(() => setBalanceError("Failed to load balance."));
  }, []);

  useEffect(loadBalance, [loadBalance]);

  useEffect(() => {
    fetchQrCode()
      .then(({ qrPayload }) => QRCode.toDataURL(qrPayload, { width: 320, margin: 2 }))
      .then(setQrDataUrl)
      .catch(() => setQrError("Failed to load QR code."));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    setPendingRechargeId(null);
    setPaymentUrl(null);
  }, []);

  // Stop polling if the member navigates away from the tab mid-recharge.
  useEffect(() => stopPolling, [stopPolling]);

  const pollConfirm = useCallback(
    async (rechargeId: string) => {
      try {
        const result = await confirmRecharge(rechargeId);
        if (result.status === "PENDING") {
          return;
        }
        stopPolling();
        if (result.status === "CONFIRMED") {
          setOutcome({ variant: "success", message: `Recharge complete — +${result.points} pts.` });
          if (result.newBalance !== undefined) {
            setBalance(result.newBalance);
          } else {
            loadBalance();
          }
          setAmountInput("");
        } else {
          setOutcome({ variant: "error", message: result.error ?? "Payment failed or was cancelled." });
        }
      } catch (err) {
        stopPolling();
        setOutcome({ variant: "error", message: err instanceof Error ? err.message : "Failed to check payment status." });
      }
    },
    [loadBalance, stopPolling],
  );

  async function handleRecharge(e: FormEvent) {
    e.preventDefault();
    const points = Number(amountInput);
    if (!Number.isInteger(points) || points < MIN_RECHARGE_POINTS || points > MAX_RECHARGE_POINTS) {
      setOutcome({
        variant: "error",
        message: `Enter an amount between ${MIN_RECHARGE_POINTS} and ${MAX_RECHARGE_POINTS} points.`,
      });
      return;
    }

    setIsStartingRecharge(true);
    setOutcome(null);
    try {
      const recharge = await startRecharge({ points });
      // Best-effort auto-open; SumUp's page may still be blocked as a popup
      // since this runs after an await, outside the click's user-gesture
      // window in some browsers — the visible "Open payment page" link
      // below is the reliable fallback either way.
      window.open(recharge.hostedCheckoutUrl, "_blank", "noopener,noreferrer");
      setPaymentUrl(recharge.hostedCheckoutUrl);
      setPendingRechargeId(recharge.rechargeId);
      setOutcome({
        variant: "info",
        message: "Complete the payment in the new tab, then come back here — it's picked up automatically.",
      });
      pollTimer.current = setInterval(() => void pollConfirm(recharge.rechargeId), POLL_INTERVAL_MS);
    } catch (err) {
      setOutcome({ variant: "error", message: err instanceof Error ? err.message : "Failed to start recharge." });
    } finally {
      setIsStartingRecharge(false);
    }
  }

  function cancelRecharge() {
    stopPolling();
    setOutcome(null);
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-wave">Profil</h1>
        <Button variant="secondary" onClick={() => void auth.logout()}>
          Log out
        </Button>
      </header>

      {outcome && <Banner variant={outcome.variant}>{outcome.message}</Banner>}

      <section className="space-y-2 rounded-lg border border-gray-200 p-4 text-center">
        <p className="text-sm font-medium text-gray-500">Balance</p>
        {balanceError && <Banner variant="error">{balanceError}</Banner>}
        {balance !== null && <p className="text-3xl font-bold text-wave">{balance} pts</p>}
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 p-4 text-center">
        <p className="text-sm font-medium text-gray-500">Your QR code</p>
        {qrError && <Banner variant="error">{qrError}</Banner>}
        {qrDataUrl && <img src={qrDataUrl} alt="Your Wave QR code" className="mx-auto h-72 w-72" />}
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 p-4">
        <p className="text-sm font-medium text-gray-500">Recharge points</p>
        <form onSubmit={(e) => void handleRecharge(e)} className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700" htmlFor="recharge-amount">
              Amount (pts)
            </label>
            <input
              id="recharge-amount"
              type="number"
              min={MIN_RECHARGE_POINTS}
              max={MAX_RECHARGE_POINTS}
              required
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={pendingRechargeId !== null}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            {amountInput !== "" && !Number.isNaN(Number(amountInput)) && (
              <p className="mt-1 text-xs text-gray-500">≈ {(Number(amountInput) / POINTS_PER_EUR).toFixed(2)} €</p>
            )}
          </div>
          {pendingRechargeId === null ? (
            <Button type="submit" disabled={isStartingRecharge}>
              {isStartingRecharge ? "Starting…" : "Recharge by card"}
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={cancelRecharge}>
              Cancel
            </Button>
          )}
        </form>
        {pendingRechargeId !== null && (
          <div className="space-y-2 text-center">
            <p className="text-sm text-gray-500">Waiting for payment confirmation…</p>
            {paymentUrl && (
              <a href={paymentUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-wave underline">
                Open payment page
              </a>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
