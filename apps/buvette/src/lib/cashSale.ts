import type { ApiErrorResponse, CashSaleRequest, CashSaleResponse } from "@wave/api-types";
import { authClient } from "./authClient";

export class CashSaleError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function submitCashSale(request: CashSaleRequest): Promise<CashSaleResponse> {
  const res = await authClient.authorizedFetch("/buvette/cash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = (await res.json()) as CashSaleResponse | ApiErrorResponse;
  if (!res.ok) {
    throw new CashSaleError(res.status, (body as ApiErrorResponse).error ?? "cash sale failed");
  }
  return body as CashSaleResponse;
}
