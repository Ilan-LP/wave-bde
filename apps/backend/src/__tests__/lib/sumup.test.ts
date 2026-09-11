import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("lib/sumup", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("converts points to minor currency units at the 15pts/EUR peg, rounded to the nearest cent", async () => {
    const { pointsToAmountMinorUnits } = await import("../../lib/sumup.js");

    expect(pointsToAmountMinorUnits(15)).toBe(100);
    expect(pointsToAmountMinorUnits(150)).toBe(1000);
    expect(pointsToAmountMinorUnits(1)).toBe(7); // 100/15 = 6.67 -> rounds to 7
  });

  it("requests an OAuth token, then creates a hosted checkout using it", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-1", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "checkout-1", status: "PENDING", hosted_checkout_url: "https://pay.example/1" }),
      });

    const { createHostedCheckout } = await import("../../lib/sumup.js");

    const checkout = await createHostedCheckout({
      checkoutReference: "ref-1",
      amountMinorUnit: 1000,
      description: "Wave points recharge (150 pts)",
    });

    expect(checkout).toEqual({ id: "checkout-1", status: "PENDING", hostedCheckoutUrl: "https://pay.example/1" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe("https://api.sumup.com/token");
    expect(String(tokenInit.body)).toContain("grant_type=client_credentials");

    const [checkoutUrl, checkoutInit] = fetchMock.mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(checkoutUrl).toBe("https://api.sumup.com/v0.1/checkouts");
    expect(checkoutInit.headers.Authorization).toBe("Bearer token-1");
    const body = JSON.parse(checkoutInit.body as string);
    expect(body).toMatchObject({
      checkout_reference: "ref-1",
      amount: 10,
      currency: "EUR",
      merchant_code: "test-sumup-merchant-code",
      hosted_checkout: { enabled: true },
    });
  });

  it("reuses a cached access token instead of requesting a new one for a second call", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "PAID" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "PAID" }) });

    const { getCheckoutStatus } = await import("../../lib/sumup.js");

    await getCheckoutStatus("checkout-1");
    await getCheckoutStatus("checkout-1");

    // One token request, two status checks — no second OAuth call.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when the OAuth token request fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "bad creds" });

    const { getCheckoutStatus } = await import("../../lib/sumup.js");

    await expect(getCheckoutStatus("checkout-1")).rejects.toThrow(/SumUp OAuth token request failed: 401/);
  });

  it("throws when checkout creation fails", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: false, status: 400, statusText: "Bad Request", text: async () => "boom" });

    const { createHostedCheckout } = await import("../../lib/sumup.js");

    await expect(
      createHostedCheckout({ checkoutReference: "ref-1", amountMinorUnit: 1000, description: "x" }),
    ).rejects.toThrow(/SumUp checkout creation failed: 400/);
  });

  it("throws a clear error when SumUp credentials are not configured", async () => {
    vi.doMock("../../config/env.js", () => ({
      env: { isSumUpConfigured: false, sumupClientId: undefined, sumupClientSecret: undefined, sumupMerchantCode: undefined },
    }));

    const { getCheckoutStatus } = await import("../../lib/sumup.js");

    await expect(getCheckoutStatus("checkout-1")).rejects.toThrow(/SumUp is not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
