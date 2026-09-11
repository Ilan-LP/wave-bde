import { useState } from "react";
import { Banner, Button } from "@wave/ui";
import { saleTotal, type Sale } from "../types";

interface CashPaymentFlowProps {
  sale: Sale;
  onComplete: () => void;
  onCancel: () => void;
}

export function CashPaymentFlow({ sale, onComplete, onCancel }: CashPaymentFlowProps) {
  const total = saleTotal(sale);
  const [tendered, setTendered] = useState("");

  const tenderedAmount = Number(tendered);
  const hasValidTendered = tendered !== "" && Number.isFinite(tenderedAmount) && tenderedAmount >= 0;
  const change = hasValidTendered ? tenderedAmount - total : null;

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
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button onClick={onComplete} disabled={change === null || change < 0} className="flex-1">
          Complete sale
        </Button>
      </div>
    </div>
  );
}
