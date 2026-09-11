import type {
  ApiErrorResponse,
  BalanceResponse,
  QrCodeResponse,
  RechargeConfirmResponse,
  RechargeRequest,
  RechargeResponse,
} from "@wave/api-types";
import { authClient } from "./authClient";

export class ProfileError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    throw new ProfileError(res.status, (body as ApiErrorResponse).error ?? "request failed");
  }
  return body as T;
}

export async function fetchBalance(): Promise<number> {
  const res = await authClient.authorizedFetch("/me/balance");
  const body = await parseOrThrow<BalanceResponse>(res);
  return body.balance;
}

export async function fetchQrCode(): Promise<QrCodeResponse> {
  const res = await authClient.authorizedFetch("/me/qrcode");
  return parseOrThrow<QrCodeResponse>(res);
}

export async function startRecharge(request: RechargeRequest): Promise<RechargeResponse> {
  const res = await authClient.authorizedFetch("/me/recharge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return parseOrThrow<RechargeResponse>(res);
}

// 202 (still PENDING) is not an error — parseOrThrow's res.ok check covers
// it (202 is ok), so the caller reads response.status off the body's own
// `status` field rather than an HTTP error path. 402 (failed/cancelled) is
// also parsed as a normal body, not thrown, since the caller needs its
// `error` message displayed rather than caught as an exception — only a
// genuine transport/unexpected-status failure throws here.
export async function confirmRecharge(rechargeId: string): Promise<RechargeConfirmResponse> {
  const res = await authClient.authorizedFetch(`/me/recharge/${rechargeId}/confirm`, {
    method: "POST",
  });
  const body = await res.json();
  if (!res.ok && res.status !== 402) {
    throw new ProfileError(res.status, (body as ApiErrorResponse).error ?? "request failed");
  }
  return body as RechargeConfirmResponse;
}
