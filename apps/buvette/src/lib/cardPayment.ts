import type {
  ApiErrorResponse,
  CardCheckoutRequest,
  CardCheckoutResponse,
  CardCheckoutStatusResponse,
  ReadersResponse,
} from "@wave/api-types";
import { authClient } from "./authClient";

export class CardPaymentError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T | ApiErrorResponse;
  if (!res.ok) {
    throw new CardPaymentError(res.status, (body as ApiErrorResponse).error ?? "request failed");
  }
  return body as T;
}

export async function fetchReaders(): Promise<ReadersResponse["readers"]> {
  const res = await authClient.authorizedFetch("/buvette/readers");
  const body = await parse<ReadersResponse>(res);
  return body.readers;
}

export async function startCardCheckout(request: CardCheckoutRequest): Promise<CardCheckoutResponse> {
  const res = await authClient.authorizedFetch("/buvette/card/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return parse<CardCheckoutResponse>(res);
}

export async function pollCardCheckout(checkoutId: string): Promise<CardCheckoutStatusResponse> {
  const res = await authClient.authorizedFetch(`/buvette/card/checkout/${checkoutId}/confirm`, {
    method: "POST",
  });
  return parse<CardCheckoutStatusResponse>(res);
}

export async function cancelCardCheckout(checkoutId: string): Promise<CardCheckoutStatusResponse> {
  const res = await authClient.authorizedFetch(`/buvette/card/checkout/${checkoutId}/cancel`, {
    method: "POST",
  });
  return parse<CardCheckoutStatusResponse>(res);
}
