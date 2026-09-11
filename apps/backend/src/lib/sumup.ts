import { env } from "../config/env.js";

const TOKEN_URL = "https://api.sumup.com/token";
const CHECKOUTS_URL = "https://api.sumup.com/v0.1/checkouts";

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
