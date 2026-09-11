import { Banner, Button } from "@wave/ui";
import { saleTotal, type Sale } from "../types";

interface CardPaymentFlowProps {
  sale: Sale;
  onCancel: () => void;
}

export function CardPaymentFlow({ sale, onCancel }: CardPaymentFlowProps) {
  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold">Total due: {saleTotal(sale)} pts</p>
      <Banner variant="info">
        Card payments aren&apos;t available yet — the SumUp integration hasn&apos;t been built. Use scan or cash
        instead.
      </Banner>
      <Button variant="secondary" onClick={onCancel} className="w-full">
        Back
      </Button>
    </div>
  );
}
