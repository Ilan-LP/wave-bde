import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import type { ScanResponse } from "@wave/api-types";
import { Banner, Button } from "@wave/ui";
import { submitScan, ScanError } from "../lib/scan";
import { saleTotal, type Sale } from "../types";

interface ScanPaymentFlowProps {
  sale: Sale;
  onComplete: (result: ScanResponse) => void;
  onCancel: () => void;
}

function mapScanError(err: unknown): string {
  if (err instanceof ScanError) {
    switch (err.status) {
      case 401:
        return "Invalid or expired QR code — ask the customer to reopen it.";
      case 402:
        return "Insufficient points balance.";
      case 404:
        return "Product not found.";
      case 409:
        return "This product is no longer active.";
      case 429:
        return "Duplicate scan — please rescan.";
      default:
        return err.message;
    }
  }
  return "Scan failed — please try again.";
}

export function ScanPaymentFlow({ sale, onComplete, onCancel }: ScanPaymentFlowProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  // qr-scanner's stop()/destroy() clears the shared <video>'s stream via an
  // internal, un-cancelable ~300ms-delayed timer. Under React StrictMode's
  // dev-only double-invoke of effects, that delayed clear would otherwise
  // fire after the second (real) mount has already attached its own stream,
  // killing it. Deferring the actual destroy — and canceling it if the
  // component remounts before it fires — lets the throwaway mount's cleanup
  // become a no-op instead of racing the real one.
  const destroyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Avoids a stale-closure double-submit without adding isSubmitting itself
  // to the effect's dependency array (which would restart the camera).
  const isSubmittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (destroyTimeoutRef.current) {
      clearTimeout(destroyTimeoutRef.current);
      destroyTimeoutRef.current = null;
    }

    async function handleDecoded(qrPayload: string) {
      if (isSubmittingRef.current) {
        return;
      }
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setError(null);
      scannerRef.current?.stop();
      try {
        const result = await submitScan(
          sale.kind === "product"
            ? { qrPayload, productId: sale.product.id, quantity: sale.quantity }
            : { qrPayload, customAmount: sale.amountPoints },
        );
        onComplete(result);
      } catch (err) {
        setError(mapScanError(err));
        await scannerRef.current?.start().catch(() => undefined);
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }

    if (!scannerRef.current) {
      const scanner = new QrScanner(video, (result) => void handleDecoded(result.data), {
        highlightScanRegion: true,
        highlightCodeOutline: true,
      });
      scannerRef.current = scanner;
      scanner.start().catch(() => setError("Camera access failed — check camera permissions."));
    }

    return () => {
      destroyTimeoutRef.current = setTimeout(() => {
        scannerRef.current?.destroy();
        scannerRef.current = null;
        destroyTimeoutRef.current = null;
      }, 400);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold">Total: {saleTotal(sale)} pts</p>
      <video ref={videoRef} className="w-full rounded-lg bg-black" muted playsInline />
      {error && <Banner variant="error">{error}</Banner>}
      {isSubmitting && <Banner variant="info">Processing…</Banner>}
      <Button variant="secondary" onClick={onCancel} className="w-full">
        Cancel
      </Button>
    </div>
  );
}
