import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { getTransactionByClientId } from "../../lib/sumup.js";
import { applyCardCheckoutStatus, CARD_CHECKOUT_STALE_MS } from "../../lib/buvetteCard.js";
import { runBuvetteCardReconciliation } from "../../jobs/buvetteCardReconciliation.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    buvetteCardCheckout: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../lib/sumup.js", () => ({
  getTransactionByClientId: vi.fn(),
}));

vi.mock("../../lib/buvetteCard.js", () => ({
  applyCardCheckoutStatus: vi.fn(),
  CARD_CHECKOUT_STALE_MS: 2 * 60 * 1000,
}));

const findMany = vi.mocked(prisma.buvetteCardCheckout.findMany);
const getTransactionByClientIdMock = vi.mocked(getTransactionByClientId);
const applyCardCheckoutStatusMock = vi.mocked(applyCardCheckoutStatus);

const NOW = new Date("2026-09-13T12:00:00.000Z");

function makeCheckout(id: string) {
  return {
    id,
    readerId: "rdr_1",
    clientTransactionId: `ctx-${id}`,
    amountPoints: 100,
    amountMinorUnit: 667,
    currency: "EUR",
    status: "PENDING" as const,
    cancelRequestedAt: null,
    metadata: null,
    createdAt: new Date(NOW.getTime() - CARD_CHECKOUT_STALE_MS - 1000),
    resolvedAt: null,
  };
}

describe("runBuvetteCardReconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queries for PENDING checkouts older than CARD_CHECKOUT_STALE_MS", async () => {
    findMany.mockResolvedValue([]);

    await runBuvetteCardReconciliation();

    expect(findMany).toHaveBeenCalledWith({
      where: { status: "PENDING", createdAt: { lt: new Date(NOW.getTime() - CARD_CHECKOUT_STALE_MS) } },
    });
  });

  it("does nothing when there are no stale PENDING checkouts", async () => {
    findMany.mockResolvedValue([]);

    await runBuvetteCardReconciliation();

    expect(getTransactionByClientIdMock).not.toHaveBeenCalled();
    expect(applyCardCheckoutStatusMock).not.toHaveBeenCalled();
  });

  it("checks SumUp and applies the shared transition logic for each stale checkout", async () => {
    const checkout = makeCheckout("card-1");
    findMany.mockResolvedValue([checkout] as never);
    getTransactionByClientIdMock.mockResolvedValue("SUCCESSFUL");
    applyCardCheckoutStatusMock.mockResolvedValue({ outcome: "resolved", status: "SUCCESSFUL" });

    await runBuvetteCardReconciliation();

    expect(getTransactionByClientIdMock).toHaveBeenCalledWith("ctx-card-1");
    expect(applyCardCheckoutStatusMock).toHaveBeenCalledWith({
      cardCheckout: checkout,
      sumupStatus: "SUCCESSFUL",
      actorId: null,
      ipAddress: null,
      source: "reconciliation-job",
    });
  });

  it("logs and continues with the rest of the batch when one checkout's SumUp lookup fails", async () => {
    const checkoutA = makeCheckout("card-a");
    const checkoutB = makeCheckout("card-b");
    findMany.mockResolvedValue([checkoutA, checkoutB] as never);
    getTransactionByClientIdMock.mockRejectedValueOnce(new Error("network blip")).mockResolvedValueOnce("FAILED");
    applyCardCheckoutStatusMock.mockResolvedValue({ outcome: "resolved", status: "FAILED" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await runBuvetteCardReconciliation();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("card-a"), expect.any(Error));
    expect(applyCardCheckoutStatusMock).toHaveBeenCalledTimes(1);
    expect(applyCardCheckoutStatusMock).toHaveBeenCalledWith(expect.objectContaining({ cardCheckout: checkoutB }));

    consoleError.mockRestore();
  });

  it("does not throw when applyCardCheckoutStatus itself rejects for one row", async () => {
    const checkout = makeCheckout("card-1");
    findMany.mockResolvedValue([checkout] as never);
    getTransactionByClientIdMock.mockResolvedValue("SUCCESSFUL");
    applyCardCheckoutStatusMock.mockRejectedValue(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runBuvetteCardReconciliation()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
