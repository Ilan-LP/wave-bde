import { Button } from "@wave/ui";
import type { PaymentMode } from "../types";

interface PaymentModeSelectorProps {
  onSelect: (mode: PaymentMode) => void;
}

export function PaymentModeSelector({ onSelect }: PaymentModeSelectorProps) {
  return (
    <div className="space-y-3">
      <Button size="lg" className="w-full" onClick={() => onSelect("scan")}>
        Scan QR (points)
      </Button>
      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => onSelect("cash")}>
          Cash
        </Button>
        <Button variant="secondary" onClick={() => onSelect("card")}>
          Card (coming soon)
        </Button>
      </div>
    </div>
  );
}
