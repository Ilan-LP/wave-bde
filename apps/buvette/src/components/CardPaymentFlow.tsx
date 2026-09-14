import { useEffect, useRef, useState } from "react";
import type { CardCheckoutStatus } from "@wave/api-types";
import { Banner, Button } from "@wave/ui";
import { cancelCardCheckout, pollCardCheckout, startCardCheckout, CardPaymentError } from "../lib/cardPayment";
import { clearStoredReaderId, getStoredReaderId, ReaderPicker } from "./ReaderPicker";
import { saleTotal, type Sale } from "../types";

// How often the till polls for a resolved outcome while a card checkout is
// PENDING — same order of magnitude as the showcase Profil tab's existing
// SumUp recharge poll, no faster than needed given SumUp's own 60-second
// device window.
const POLL_INTERVAL_MS = 2000;

interface CardPaymentFlowProps {
  sale: Sale;
  onComplete: () => void;
  onCancel: () => void;
}

// POST /buvette/card/checkout can 404 for two unrelated reasons — the
// backend already tells them apart via distinct messages ("reader not
// found" vs "product not found", see apps/backend/src/routes/buvette.ts),
// so branch on that instead of assuming which one happened.
function isReaderNotFoundError(err: unknown): boolean {
  return err instanceof CardPaymentError && err.status === 404 && err.message === "reader not found";
}

function mapCardError(err: unknown): string {
  if (err instanceof CardPaymentError) {
    switch (err.status) {
      case 404:
        return isReaderNotFoundError(err)
          ? "Card reader not found — it may have been unpaired. Choose a different reader."
          : "Product not found.";
      case 409:
        return "This reader already has a payment in progress.";
      case 502:
        return "Could not reach the card reader — try again.";
      case 503:
        return "Card payment isn't available right now.";
      default:
        return err.message;
    }
  }
  return "Card payment failed — please try again.";
}

export function CardPaymentFlow({ sale, onComplete, onCancel }: CardPaymentFlowProps) {
  const [readerId, setReaderId] = useState<string | null>(() => getStoredReaderId());
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [status, setStatus] = useState<CardCheckoutStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set only when the checkout-start 404 is reader-specific — drives the
  // "choose a different reader" affordance below, instead of leaving a stale
  // localStorage entry as the only way out of a re-paired/unpaired reader.
  const [readerNotFound, setReaderNotFound] = useState(false);
  // Guards against React 18 StrictMode's dev-only double-invoke starting two
  // checkouts for the same sale (see ScanPaymentFlow.tsx for the equivalent
  // concern with the camera).
  const startedRef = useRef(false);

  useEffect(() => {
    if (!readerId || startedRef.current) {
      return;
    }
    startedRef.current = true;
    setError(null);
    setReaderNotFound(false);

    startCardCheckout(
      sale.kind === "product"
        ? { readerId, productId: sale.product.id, quantity: sale.quantity }
        : { readerId, customAmount: sale.amountPoints },
    )
      .then((result) => {
        setCheckoutId(result.checkoutId);
        setStatus(result.status);
      })
      .catch((err: unknown) => {
        startedRef.current = false;
        setError(mapCardError(err));
        setReaderNotFound(isReaderNotFoundError(err));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerId]);

  useEffect(() => {
    if (!checkoutId || status !== "PENDING") {
      return;
    }
    const interval = setInterval(() => {
      pollCardCheckout(checkoutId)
        .then((result) => setStatus(result.status))
        .catch((err: unknown) => setError(mapCardError(err)));
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkoutId, status]);

  useEffect(() => {
    if (status === "SUCCESSFUL") {
      onComplete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function handleCancelOrBack() {
    if (!checkoutId || status !== "PENDING") {
      onCancel();
      return;
    }
    setCancelling(true);
    // Best-effort: the checkout itself is only ever resolved by the next
    // poll observing SumUp's actual outcome (see CLAUDE.md's "Buvette Card
    // Payment" section) — this just requests the termination and keeps
    // polling, it does not assume the payment actually stopped.
    cancelCardCheckout(checkoutId).catch((err: unknown) => setError(mapCardError(err)));
  }

  function handleChooseDifferentReader() {
    clearStoredReaderId();
    startedRef.current = false;
    setReaderNotFound(false);
    setError(null);
    setCheckoutId(null);
    setStatus(null);
    setReaderId(null);
  }

  if (!readerId) {
    return <ReaderPicker onSelect={setReaderId} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold">Total: {saleTotal(sale)} pts</p>
      {error && <Banner variant="error">{error}</Banner>}
      {readerNotFound && (
        <Button variant="secondary" onClick={handleChooseDifferentReader} className="w-full">
          Choose a different reader
        </Button>
      )}
      {!error && status === "PENDING" && (
        <Banner variant="info">{cancelling ? "Cancelling…" : "Present card on the reader…"}</Banner>
      )}
      {status === "FAILED" && <Banner variant="error">Card payment failed.</Banner>}
      {status === "CANCELLED" && <Banner variant="error">Card payment cancelled.</Banner>}
      <Button
        variant="secondary"
        onClick={handleCancelOrBack}
        className="w-full"
        disabled={cancelling && status === "PENDING"}
      >
        {status === "PENDING" ? "Cancel" : "Back"}
      </Button>
    </div>
  );
}
