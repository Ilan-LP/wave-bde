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
    // Undoes the "not configured" test's vi.doMock below — doMock
    // registrations otherwise outlive resetModules() and leak into every
    // later test in this file that imports lib/sumup.js.
    vi.doUnmock("../../config/env.js");
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

  describe("Readers API", () => {
    it("lists readers for the configured merchant", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [{ id: "rdr_1", name: "Frontdesk", status: "paired", device: { identifier: "U1", model: "solo" } }],
          }),
        });

      const { listReaders } = await import("../../lib/sumup.js");
      const readers = await listReaders();

      expect(readers).toEqual([
        { id: "rdr_1", name: "Frontdesk", status: "paired", device: { identifier: "U1", model: "solo" } },
      ]);
      const [readersUrl] = fetchMock.mock.calls[1] as [string];
      expect(readersUrl).toBe("https://api.sumup.com/v0.1/merchants/test-sumup-merchant-code/readers");
    });

    it("pairs a reader with the given pairing code and name", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "rdr_1", name: "Frontdesk", status: "paired", device: { identifier: "U1", model: "solo" } }),
        });

      const { pairReader } = await import("../../lib/sumup.js");
      const reader = await pairReader({ pairingCode: "4WLFDSBF", name: "Frontdesk" });

      expect(reader.id).toBe("rdr_1");
      const [, pairInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(pairInit.body as string);
      expect(body).toEqual({ pairing_code: "4WLFDSBF", name: "Frontdesk" });
    });

    it("throws when pairing fails", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
        .mockResolvedValueOnce({ ok: false, status: 422, statusText: "Reader Offline", text: async () => "offline" });

      const { pairReader } = await import("../../lib/sumup.js");

      await expect(pairReader({ pairingCode: "X", name: "Y" })).rejects.toThrow(/SumUp reader pairing failed: 422/);
    });

    it("starts a reader checkout and returns the client_transaction_id", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: { client_transaction_id: "ctx-1" } }),
        });

      const { createReaderCheckout } = await import("../../lib/sumup.js");
      const checkout = await createReaderCheckout({ readerId: "rdr_1", amountMinorUnit: 1000 });

      expect(checkout).toEqual({ clientTransactionId: "ctx-1" });
      const [checkoutUrl, checkoutInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(checkoutUrl).toBe("https://api.sumup.com/v0.1/merchants/test-sumup-merchant-code/readers/rdr_1/checkout");
      const body = JSON.parse(checkoutInit.body as string);
      expect(body).toEqual({ total_amount: { currency: "EUR", minor_unit: 2, value: 1000 } });
    });

    it("throws when reader checkout creation fails", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
        .mockResolvedValueOnce({ ok: false, status: 422, statusText: "Reader Offline", text: async () => "offline" });

      const { createReaderCheckout } = await import("../../lib/sumup.js");

      await expect(createReaderCheckout({ readerId: "rdr_1", amountMinorUnit: 1000 })).rejects.toThrow(
        /SumUp reader checkout creation failed: 422/,
      );
    });

    it("terminates a reader checkout", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const { terminateReaderCheckout } = await import("../../lib/sumup.js");
      await expect(terminateReaderCheckout("rdr_1")).resolves.toBeUndefined();

      const [terminateUrl, terminateInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(terminateUrl).toBe("https://api.sumup.com/v0.1/merchants/test-sumup-merchant-code/readers/rdr_1/terminate");
      expect(terminateInit.method).toBe("POST");
    });

    it("throws when terminate fails", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found", text: async () => "gone" });

      const { terminateReaderCheckout } = await import("../../lib/sumup.js");

      await expect(terminateReaderCheckout("rdr_1")).rejects.toThrow(/SumUp reader terminate failed: 404/);
    });

    it("looks up a transaction by client_transaction_id", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "SUCCESSFUL" }) });

      const { getTransactionByClientId } = await import("../../lib/sumup.js");
      const status = await getTransactionByClientId("ctx-1");

      expect(status).toBe("SUCCESSFUL");
      const [lookupUrl] = fetchMock.mock.calls[1] as [string];
      expect(lookupUrl).toBe(
        "https://api.sumup.com/v2.1/merchants/test-sumup-merchant-code/transactions?client_transaction_id=ctx-1",
      );
    });

    it("treats a 404 transaction lookup as still PENDING, not an error", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found", text: async () => "" });

      const { getTransactionByClientId } = await import("../../lib/sumup.js");

      await expect(getTransactionByClientId("ctx-1")).resolves.toBe("PENDING");
    });

    it("throws on a non-404 transaction lookup failure", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1", expires_in: 3600 }) })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server Error", text: async () => "boom" });

      const { getTransactionByClientId } = await import("../../lib/sumup.js");

      await expect(getTransactionByClientId("ctx-1")).rejects.toThrow(/SumUp transaction lookup failed: 500/);
    });
  });
});
