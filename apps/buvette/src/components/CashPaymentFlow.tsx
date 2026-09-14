import { useState } from "react";
import { Banner, Button } from "@wave/ui";
import { CashSaleError, submitCashSale } from "../lib/cashSale";
import { saleTotal, type Sale } from "../types";

interface CashPaymentFlowProps {
  sale: Sale;
  onComplete: () => void;
  onCancel: () => void;
}

function mapCashSaleError(err: unknown): string {
  if (err instanceof CashSaleError) {
    switch (err.status) {
      case 404:
        return "Product not found.";
      case 409:
        return "Product is not active.";
      default:
        return err.message;
    }
  }
  return "Could not record the sale — please try again.";
}

export function CashPaymentFlow({ sale, onComplete, onCancel }: CashPaymentFlowProps) {
  const total = saleTotal(sale);
  const [tendered, setTendered] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tenderedAmount = Number(tendered);
  const hasValidTendered = tendered !== "" && Number.isFinite(tenderedAmount) && tenderedAmount >= 0;
  const change = hasValidTendered ? tenderedAmount - total : null;

  function handleComplete() {
    setError(null);
    setSubmitting(true);
    submitCashSale(sale.kind === "product" ? { productId: sale.product.id, quantity: sale.quantity } : { customAmount: sale.amountPoints })
      .then(() => {
        onComplete();
      })
      .catch((err: unknown) => {
        setError(mapCashSaleError(err));
        setSubmitting(false);
      });
  }

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold">Total due: {total} pts</p>
      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="tendered">
          Amount tendered
        </label>
        <input
          id="tendered"
          type="number"
          min={0}
          inputMode="decimal"
          value={tendered}
          onChange={(e) => setTendered(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-3 text-lg"
        />
      </div>
      {change !== null && change < 0 && <Banner variant="error">Amount tendered is less than the total due.</Banner>}
      {change !== null && change >= 0 && <Banner variant="success">Change due: {change} pts</Banner>}
      {error && <Banner variant="error">{error}</Banner>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} className="flex-1" disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleComplete} disabled={change === null || change < 0 || submitting} className="flex-1">
          {submitting ? "Recording sale…" : "Complete sale"}
        </Button>
      </div>
    </div>
  );
}
