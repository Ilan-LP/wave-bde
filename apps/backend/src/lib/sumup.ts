import { env } from "../config/env.js";

const TOKEN_URL = "https://api.sumup.com/token";
const CHECKOUTS_URL = "https://api.sumup.com/v0.1/checkouts";
const MERCHANTS_URL = "https://api.sumup.com/v0.1/merchants";
const TRANSACTIONS_URL = "https://api.sumup.com/v2.1/merchants";

// The only points<->currency peg defined anywhere in this app (see
// CLAUDE.md "SumUp Integration"). Any future payment flow — including the
// till's still-unbuilt card mode — must reuse pointsToAmountMinorUnits()
// below rather than defining its own rate.
const POINTS_PER_EUR = 15;
export const SUMUP_CURRENCY = "EUR";

export type SumUpCheckoutStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED";

export interface SumUpCheckout {
  id: string;
  status: SumUpCheckoutStatus;
  hostedCheckoutUrl?: string;
}

function requireCredentials(): { clientId: string; clientSecret: string; merchantCode: string } {
  if (!env.isSumUpConfigured) {
    throw new Error("SumUp is not configured (SUMUP_CLIENT_ID/SUMUP_CLIENT_SECRET/SUMUP_MERCHANT_CODE)");
  }
  return {
    clientId: env.sumupClientId!,
    clientSecret: env.sumupClientSecret!,
    merchantCode: env.sumupMerchantCode!,
  };
}

/**
 * Points -> minor currency units (cents), rounded to the nearest cent at
 * the POINTS_PER_EUR peg above.
 */
export function pointsToAmountMinorUnits(points: number): number {
  return Math.round((points * 100) / POINTS_PER_EUR);
}

let cachedToken: { accessToken: string; expiresAt: number } | undefined;

/**
 * OAuth2 client-credentials token, cached in memory and refetched slightly
 * before actual expiry (mirrors the shape of googleDrive.ts's auth client,
 * without pulling in a second dependency — this is a plain fetch call).
 */
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.accessToken;
  }

  const { clientId, clientSecret } = requireCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`SumUp OAuth token request failed: ${response.status} ${response.statusText} ${errorBody}`);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: body.access_token,
    // Refresh a minute early so a request never races the token's own expiry.
    expiresAt: now + (body.expires_in - 60) * 1000,
  };
  return cachedToken.accessToken;
}

/**
 * Creates a SumUp hosted checkout for a remote/self-service payment — no
 * physical card reader involved (that's the SumUp Readers API, a different
 * endpoint family this module does not implement; see CLAUDE.md's SumUp
 * Integration section for why the till's still-unbuilt card mode needs a
 * separate create-checkout call even though it shares this module's OAuth,
 * conversion, and confirmation-polling logic).
 *
 * Confirmation is NOT synchronous: the payer is redirected to
 * hostedCheckoutUrl, and the caller must poll getCheckoutStatus afterwards
 * (see src/routes/me.ts's POST /recharge/:id/confirm). This is the one
 * confirmation pattern this app uses — do not add a second one (e.g. a
 * webhook receiver) without updating this doc comment.
 */
export async function createHostedCheckout(params: {
  checkoutReference: string;
  amountMinorUnit: number;
  description: string;
  validUntil?: Date;
}): Promise<SumUpCheckout> {
  const { merchantCode } = requireCredentials();
  const token = await getAccessToken();

  const response = await fetch(CHECKOUTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      checkout_reference: params.checkoutReference,
      amount: params.amountMinorUnit / 100,
      currency: SUMUP_CURRENCY,
      merchant_code: merchantCode,
      description: params.description,
      valid_until: params.validUntil?.toISOString(),
      hosted_checkout: { enabled: true },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`SumUp checkout creation failed: ${response.status} ${response.statusText} ${errorBody}`);
  }

  const body = (await response.json()) as {
    id: string;
    status: SumUpCheckoutStatus;
    hosted_checkout_url?: string;
  };
  return { id: body.id, status: body.status, hostedCheckoutUrl: body.hosted_checkout_url };
}

/** Live status check against SumUp — the "poll" half of the confirmation pattern above. */
export async function getCheckoutStatus(checkoutId: string): Promise<SumUpCheckoutStatus> {
  const token = await getAccessToken();
  const response = await fetch(`${CHECKOUTS_URL}/${checkoutId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`SumUp checkout status check failed: ${response.status} ${response.statusText} ${errorBody}`);
  }

  const body = (await response.json()) as { status: SumUpCheckoutStatus };
  return body.status;
}

// ---------------------------------------------------------------------------
// Readers API (card-present, in-person payments on a paired physical
// reader) — a different endpoint family from the hosted checkout above, used
// by the buvette till's card payment mode (see src/routes/buvette.ts,
// src/lib/buvetteCard.ts). Shares this module's OAuth/credentials exactly
// like the hosted-checkout functions do.
//
// Built against the v0.1 Readers REST API (POST /v0.1/merchants/{code}/...),
// the same API family/version as the hosted checkout above and the standard
// merchant-OAuth integration model. SumUp's docs also describe a separate,
// older v1 "Terminal Payments Cloud API" (POST /v1/readers/{id}/checkouts)
// gated by a distinct "Affiliate Key" this app has no concept of — that is
// NOT what this module implements. If the configured SumUp account actually
// uses the affiliate/POS integration model instead of standard merchant
// OAuth, these calls will not work and need porting to that API instead.
export interface SumUpReader {
  id: string;
  name: string;
  status: "unknown" | "processing" | "paired" | "expired";
  device: { identifier: string; model: string };
}

/** Lists readers already paired with this merchant account. */
export async function listReaders(): Promise<SumUpReader[]> {
  const { merchantCode } = requireCredentials();
  const token = await getAccessToken();

  const response = await fetch(`${MERCHANTS_URL}/${merchantCode}/readers`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`SumUp reader list request failed: ${response.status} ${response.statusText} ${errorBody}`);
  }

  const body = (await response.json()) as { items: SumUpReader[] };
  return body.items;
}

/**
 * Pairs a physical reader with this merchant account using the pairing code
 * shown on the device's own screen — a one-time, physical setup action, not
 * something a cashier does per sale. BUREAU-only at the route level (see
 * POST /buvette/readers/pair).
 */
export async function pairReader(params: { pairingCode: string; name: string }): Promise<SumUpReader> {
  const { merchantCode } = requireCredentials();
  const token = await getAccessToken();

  const response = await fetch(`${MERCHANTS_URL}/${merchantCode}/readers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pairing_code: params.pairingCode, name: params.name }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`SumUp reader pairing failed: ${response.status} ${response.statusText} ${errorBody}`);
  }

  return (await response.json()) as SumUpReader;
}

/**
 * Starts a card-present checkout on a paired reader. Asynchronous on SumUp's
 * side: the device must be online, and SumUp then has 60 seconds to start
 * the payment on it — any other checkout for the same device is rejected
 * during that window (mirrored server-side by the PENDING-per-reader guard
 * in POST /buvette/card/checkout). There is no synchronous outcome here;
 * the caller must poll getTransactionByClientId with the returned id (see
 * that function's doc comment for why — SumUp exposes no dedicated
 * reader-checkout status endpoint).
 */
export async function createReaderCheckout(params: {
  readerId: string;
  amountMinorUnit: number;
}): Promise<{ clientTransactionId: string }> {
  const { merchantCode } = requireCredentials();
  const token = await getAccessToken();

  const response = await fetch(`${MERCHANTS_URL}/${merchantCode}/readers/${params.readerId}/checkout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      total_amount: {
        currency: SUMUP_CURRENCY,
        minor_unit: 2,
        value: params.amountMinorUnit,
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`SumUp reader checkout creation failed: ${response.status} ${response.statusText} ${errorBody}`);
  }

  const body = (await response.json()) as { data: { client_transaction_id: string } };
  return { clientTransactionId: body.data.client_transaction_id };
}

/**
 * Requests SumUp stop the current transaction on a reader. Asynchronous and
 * gives no confirmation it worked, and only has any effect while the device
 * is online and still waiting for cardholder action — if the card has
 * already been presented, this can do nothing. Callers must never treat a
 * successful call here as proof the charge was actually stopped; the caller
 * (see src/lib/buvetteCard.ts) still resolves the checkout from SumUp's
 * actual transaction status, never from this call's own success.
 */
export async function terminateReaderCheckout(readerId: string): Promise<void> {
  const { merchantCode } = requireCredentials();
  const token = await getAccessToken();

  const response = await fetch(`${MERCHANTS_URL}/${merchantCode}/readers/${readerId}/terminate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`SumUp reader terminate failed: ${response.status} ${response.statusText} ${errorBody}`);
  }
}

export type SumUpTransactionStatus = "PENDING" | "SUCCESSFUL" | "CANCELLED" | "FAILED" | "REFUNDED" | "CHARGE_BACK";

/**
 * Looks up the transaction a reader checkout produced, by the
 * client_transaction_id createReaderCheckout returned — the "poll" half of
 * the reader-checkout flow. SumUp's Readers API has no dedicated
 * status-by-checkout-id endpoint; the transaction only exists once SumUp has
 * actually started processing the payment, so a 404 here means no
 * transaction has been created yet and the checkout should be treated as
 * still PENDING, not as an error.
 */
export async function getTransactionByClientId(clientTransactionId: string): Promise<SumUpTransactionStatus> {
  const { merchantCode } = requireCredentials();
  const token = await getAccessToken();

  const response = await fetch(
    `${TRANSACTIONS_URL}/${merchantCode}/transactions?client_transaction_id=${encodeURIComponent(clientTransactionId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (response.status === 404) {
    return "PENDING";
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`SumUp transaction lookup failed: ${response.status} ${response.statusText} ${errorBody}`);
  }

  const body = (await response.json()) as { status: SumUpTransactionStatus };
  return body.status;
}
