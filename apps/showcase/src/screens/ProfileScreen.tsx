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
// Refetch the QR this long before its returned expiresAt, so a member
// looking at an already-loaded tab always gets a fresh code well before the
// old one stops scanning at the till (see qrToken.ts's QR_TOKEN_TTL_MS).
const QR_REFRESH_LEAD_MS = 30_000;

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
  const [isRefreshingQr, setIsRefreshingQr] = useState(false);
  const reloadQrRef = useRef<() => void>(() => {});
  const qrRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Loads the QR, schedules a refetch shortly before it expires, and
  // refetches on regaining focus/visibility — a member can sit on this tab
  // for a while before walking to the till, and the QR also goes stale
  // early if it's already been scanned once (see backend CLAUDE.md's M1
  // fix: a successful buvette scan rotates the token immediately, not just
  // on TTL). Deliberately not handled: detecting that out-of-band
  // invalidation in real time — this only refreshes on a timer/focus, not a
  // push/poll for "has this exact QR already been used."
  useEffect(() => {
    let cancelled = false;

    function scheduleRefresh(expiresAt: string) {
      if (qrRefreshTimer.current) {
        clearTimeout(qrRefreshTimer.current);
      }
      const delay = Math.max(0, new Date(expiresAt).getTime() - Date.now() - QR_REFRESH_LEAD_MS);
      qrRefreshTimer.current = setTimeout(load, delay);
    }

    function load() {
      setIsRefreshingQr(true);
      fetchQrCode()
        .then(({ qrPayload, expiresAt }) =>
          QRCode.toDataURL(qrPayload, { width: 320, margin: 2 }).then((dataUrl) => {
            if (cancelled) return;
            setQrDataUrl(dataUrl);
            setQrError(null);
            scheduleRefresh(expiresAt);
          }),
        )
        .catch(() => {
          // Keep whatever QR is already on screen — a blank/loading flash
          // here is worse than a stale image, and the message below makes
          // the staleness visible instead of silent.
          if (!cancelled) setQrError("QR may be outdated — tap to retry.");
        })
        .finally(() => {
          if (!cancelled) setIsRefreshingQr(false);
        });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") load();
    }

    reloadQrRef.current = load;
    load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (qrRefreshTimer.current) clearTimeout(qrRefreshTimer.current);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
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
        {qrDataUrl && (
          <div className="space-y-1">
            <img src={qrDataUrl} alt="Your Wave QR code" className="mx-auto h-72 w-72" />
            {isRefreshingQr && <p className="text-xs text-gray-400">Refreshing…</p>}
          </div>
        )}
        {qrError && (
          <button
            type="button"
            onClick={() => reloadQrRef.current()}
            className="text-sm font-semibold text-red-600 underline"
          >
            {qrError}
          </button>
        )}
        {!qrDataUrl && !qrError && <p className="text-sm text-gray-400">Loading…</p>}
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
