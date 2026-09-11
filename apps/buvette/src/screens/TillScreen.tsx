import { useEffect, useState } from "react";
import type { Product, ScanResponse } from "@wave/api-types";
import type { UseAuthResult } from "@wave/auth-client";
import { Banner, Button } from "@wave/ui";
import { fetchProducts } from "../lib/products";
import { CardPaymentFlow } from "../components/CardPaymentFlow";
import { CashPaymentFlow } from "../components/CashPaymentFlow";
import { PaymentModeSelector } from "../components/PaymentModeSelector";
import { ScanPaymentFlow } from "../components/ScanPaymentFlow";
import { saleTotal, type PaymentMode, type Sale } from "../types";

interface TillScreenProps {
  auth: UseAuthResult;
}

interface Outcome {
  variant: "success" | "error";
  message: string;
}

export function TillScreen({ auth }: TillScreenProps) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customAmountInput, setCustomAmountInput] = useState("");
  const [sale, setSale] = useState<Sale | null>(null);
  const [mode, setMode] = useState<PaymentMode | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    fetchProducts()
      .then(setProducts)
      .catch(() => setLoadError("Failed to load products."));
  }, []);

  function selectProduct(product: Product) {
    setOutcome(null);
    setSale({ kind: "product", product, quantity: 1 });
  }

  function updateQuantity(delta: number) {
    setSale((current) =>
      current?.kind === "product" ? { ...current, quantity: Math.max(1, current.quantity + delta) } : current,
    );
  }

  function useCustomAmount() {
    const amount = Number(customAmountInput);
    if (!Number.isInteger(amount) || amount < 1) {
      return;
    }
    setOutcome(null);
    setSale({ kind: "custom", amountPoints: amount });
  }

  function changeItem() {
    setSale(null);
    setMode(null);
    setCustomAmountInput("");
  }

  function handleScanComplete(result: ScanResponse) {
    setOutcome({ variant: "success", message: `Sale complete — new balance: ${result.newBalance} pts` });
    setSale(null);
    setMode(null);
  }

  function handleCashComplete() {
    setOutcome({ variant: "success", message: "Cash sale complete." });
    setSale(null);
    setMode(null);
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-6 bg-white p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-wave">Wave — Buvette</h1>
        <Button variant="secondary" onClick={() => void auth.logout()}>
          Log out
        </Button>
      </header>

      {outcome && <Banner variant={outcome.variant}>{outcome.message}</Banner>}

      {!sale && (
        <>
          {loadError && <Banner variant="error">{loadError}</Banner>}
          <div className="grid grid-cols-2 gap-3">
            {products?.map((product) => (
              <Button key={product.id} variant="secondary" onClick={() => selectProduct(product)}>
                {product.name} — {product.pricePoints} pts
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              placeholder="Custom amount (pts)"
              value={customAmountInput}
              onChange={(e) => setCustomAmountInput(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-lg"
            />
            <Button onClick={useCustomAmount}>Use amount</Button>
          </div>
        </>
      )}

      {sale && !mode && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-lg font-semibold">
              {sale.kind === "product" ? sale.product.name : "Custom amount"} — {saleTotal(sale)} pts
            </p>
            {sale.kind === "product" && (
              <div className="mt-2 flex items-center gap-3">
                <Button variant="secondary" onClick={() => updateQuantity(-1)}>
                  −
                </Button>
                <span className="text-lg">{sale.quantity}</span>
                <Button variant="secondary" onClick={() => updateQuantity(1)}>
                  +
                </Button>
              </div>
            )}
            <Button variant="secondary" className="mt-3" onClick={changeItem}>
              Change item
            </Button>
          </div>
          <PaymentModeSelector onSelect={setMode} />
        </div>
      )}

      {sale && mode === "scan" && (
        <ScanPaymentFlow sale={sale} onComplete={handleScanComplete} onCancel={() => setMode(null)} />
      )}
      {sale && mode === "cash" && (
        <CashPaymentFlow sale={sale} onComplete={handleCashComplete} onCancel={() => setMode(null)} />
      )}
      {sale && mode === "card" && <CardPaymentFlow sale={sale} onCancel={() => setMode(null)} />}
    </main>
  );
}
