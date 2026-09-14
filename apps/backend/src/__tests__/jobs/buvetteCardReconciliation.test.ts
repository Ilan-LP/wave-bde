import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { getTransactionByClientId } from "../../lib/sumup.js";
import {
  applyCardCheckoutStatus,
  recheckForcedCancellation,
  CARD_CHECKOUT_STALE_MS,
  FORCED_CANCEL_RECHECK_DELAY_MS,
} from "../../lib/buvetteCard.js";
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
  recheckForcedCancellation: vi.fn(),
  CARD_CHECKOUT_STALE_MS: 2 * 60 * 1000,
  FORCED_CANCEL_RECHECK_DELAY_MS: 5 * 60 * 1000,
}));

const findMany = vi.mocked(prisma.buvetteCardCheckout.findMany);
const getTransactionByClientIdMock = vi.mocked(getTransactionByClientId);
const applyCardCheckoutStatusMock = vi.mocked(applyCardCheckoutStatus);
const recheckForcedCancellationMock = vi.mocked(recheckForcedCancellation);

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
    forcedCancelAt: null,
    forcedCancelRecheckedAt: null,
    metadata: null,
    createdAt: new Date(NOW.getTime() - CARD_CHECKOUT_STALE_MS - 1000),
    resolvedAt: null,
  };
}

function makeForcedCancelCheckout(id: string) {
  return {
    ...makeCheckout(id),
    status: "CANCELLED" as const,
    forcedCancelAt: new Date(NOW.getTime() - FORCED_CANCEL_RECHECK_DELAY_MS - 1000),
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

  it("queries for stale PENDING checkouts and due forced-cancel-recheck checkouts", async () => {
    findMany.mockResolvedValue([]);

    await runBuvetteCardReconciliation();

    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: { status: "PENDING", createdAt: { lt: new Date(NOW.getTime() - CARD_CHECKOUT_STALE_MS) } },
    });
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: "CANCELLED",
        forcedCancelAt: { not: null, lt: new Date(NOW.getTime() - FORCED_CANCEL_RECHECK_DELAY_MS) },
        forcedCancelRecheckedAt: null,
      },
    });
  });

  it("does nothing when there are no stale PENDING or forced-cancel-recheck checkouts", async () => {
    findMany.mockResolvedValue([]);

    await runBuvetteCardReconciliation();

    expect(getTransactionByClientIdMock).not.toHaveBeenCalled();
    expect(applyCardCheckoutStatusMock).not.toHaveBeenCalled();
    expect(recheckForcedCancellationMock).not.toHaveBeenCalled();
  });

  it("checks SumUp and applies the shared transition logic for each stale PENDING checkout", async () => {
    const checkout = makeCheckout("card-1");
    findMany.mockResolvedValueOnce([checkout] as never).mockResolvedValueOnce([]);
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
      forcedCancel: false,
    });
  });

  it("forces a stale-PENDING checkout to CANCELLED when cancelRequestedAt is past the grace period and SumUp still shows no transaction", async () => {
    const checkout = {
      ...makeCheckout("card-1"),
      cancelRequestedAt: new Date(NOW.getTime() - 9000), // > the mirrored 8s CANCEL_GRACE_MS
    };
    findMany.mockResolvedValueOnce([checkout] as never).mockResolvedValueOnce([]);
    getTransactionByClientIdMock.mockResolvedValue("PENDING");
    applyCardCheckoutStatusMock.mockResolvedValue({ outcome: "resolved", status: "CANCELLED" });

    await runBuvetteCardReconciliation();

    expect(applyCardCheckoutStatusMock).toHaveBeenCalledWith({
      cardCheckout: checkout,
      sumupStatus: "CANCELLED",
      actorId: null,
      ipAddress: null,
      source: "reconciliation-job",
      forcedCancel: true,
    });
  });

  it("does not force-cancel a stale-PENDING checkout when cancelRequestedAt is within the grace period", async () => {
    const checkout = {
      ...makeCheckout("card-1"),
      cancelRequestedAt: new Date(NOW.getTime() - 1000), // < the mirrored 8s CANCEL_GRACE_MS
    };
    findMany.mockResolvedValueOnce([checkout] as never).mockResolvedValueOnce([]);
    getTransactionByClientIdMock.mockResolvedValue("PENDING");
    applyCardCheckoutStatusMock.mockResolvedValue({ outcome: "still-pending" });

    await runBuvetteCardReconciliation();

    expect(applyCardCheckoutStatusMock).toHaveBeenCalledWith({
      cardCheckout: checkout,
      sumupStatus: "PENDING",
      actorId: null,
      ipAddress: null,
      source: "reconciliation-job",
      forcedCancel: false,
    });
  });

  it("logs and continues with the rest of the batch when one stale-PENDING checkout's SumUp lookup fails", async () => {
    const checkoutA = makeCheckout("card-a");
    const checkoutB = makeCheckout("card-b");
    findMany.mockResolvedValueOnce([checkoutA, checkoutB] as never).mockResolvedValueOnce([]);
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
    findMany.mockResolvedValueOnce([checkout] as never).mockResolvedValueOnce([]);
    getTransactionByClientIdMock.mockResolvedValue("SUCCESSFUL");
    applyCardCheckoutStatusMock.mockRejectedValue(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runBuvetteCardReconciliation()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("checks SumUp and re-resolves each due forced-cancel-recheck checkout", async () => {
    const checkout = makeForcedCancelCheckout("card-fc-1");
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([checkout] as never);
    getTransactionByClientIdMock.mockResolvedValue("SUCCESSFUL");
    recheckForcedCancellationMock.mockResolvedValue({ outcome: "corrected-to-successful" });

    await runBuvetteCardReconciliation();

    expect(getTransactionByClientIdMock).toHaveBeenCalledWith("ctx-card-fc-1");
    expect(recheckForcedCancellationMock).toHaveBeenCalledWith({
      cardCheckout: checkout,
      sumupStatus: "SUCCESSFUL",
    });
  });

  it("console.errors distinctly when a forced-cancel recheck is corrected to SUCCESSFUL", async () => {
    const checkout = makeForcedCancelCheckout("card-fc-1");
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([checkout] as never);
    getTransactionByClientIdMock.mockResolvedValue("SUCCESSFUL");
    recheckForcedCancellationMock.mockResolvedValue({ outcome: "corrected-to-successful" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await runBuvetteCardReconciliation();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("card-fc-1"));

    consoleError.mockRestore();
  });

  it("logs and continues with the rest of the batch when one forced-cancel-recheck's SumUp lookup fails", async () => {
    const checkoutA = makeForcedCancelCheckout("card-fc-a");
    const checkoutB = makeForcedCancelCheckout("card-fc-b");
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([checkoutA, checkoutB] as never);
    getTransactionByClientIdMock.mockRejectedValueOnce(new Error("network blip")).mockResolvedValueOnce("FAILED");
    recheckForcedCancellationMock.mockResolvedValue({ outcome: "confirmed-cancelled" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await runBuvetteCardReconciliation();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("card-fc-a"), expect.any(Error));
    expect(recheckForcedCancellationMock).toHaveBeenCalledTimes(1);
    expect(recheckForcedCancellationMock).toHaveBeenCalledWith(expect.objectContaining({ cardCheckout: checkoutB }));

    consoleError.mockRestore();
  });
});
