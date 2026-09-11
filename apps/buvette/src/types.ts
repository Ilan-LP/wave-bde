import type { Product } from "@wave/api-types";

export type Sale = { kind: "product"; product: Product; quantity: number } | { kind: "custom"; amountPoints: number };

export type PaymentMode = "scan" | "cash" | "card";

export function saleTotal(sale: Sale): number {
  return sale.kind === "product" ? sale.product.pricePoints * sale.quantity : sale.amountPoints;
}
