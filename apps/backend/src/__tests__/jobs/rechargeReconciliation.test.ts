import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { getCheckoutStatus } from "../../lib/sumup.js";
import { applySumUpCheckoutStatus, CHECKOUT_VALID_MS } from "../../lib/recharge.js";
import { runRechargeReconciliation } from "../../jobs/rechargeReconciliation.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    rechargeCheckout: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../lib/sumup.js", () => ({
  getCheckoutStatus: vi.fn(),
}));

vi.mock("../../lib/recharge.js", () => ({
  applySumUpCheckoutStatus: vi.fn(),
  CHECKOUT_VALID_MS: 30 * 60 * 1000,
}));

const findMany = vi.mocked(prisma.rechargeCheckout.findMany);
const getCheckoutStatusMock = vi.mocked(getCheckoutStatus);
const applySumUpCheckoutStatusMock = vi.mocked(applySumUpCheckoutStatus);

const NOW = new Date("2026-09-11T12:00:00.000Z");

function makeCheckout(id: string) {
  return {
    id,
    pointsAccountId: "pa-1",
    sumupCheckoutId: `sumup-${id}`,
    points: 150,
    amountMinorUnit: 1000,
    currency: "EUR",
    status: "PENDING" as const,
    createdAt: new Date(NOW.getTime() - CHECKOUT_VALID_MS - 1000),
    confirmedAt: null,
  };
}

describe("runRechargeReconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queries for PENDING checkouts older than CHECKOUT_VALID_MS", async () => {
    findMany.mockResolvedValue([]);

    await runRechargeReconciliation();

    expect(findMany).toHaveBeenCalledWith({
      where: { status: "PENDING", createdAt: { lt: new Date(NOW.getTime() - CHECKOUT_VALID_MS) } },
    });
  });

  it("does nothing when there are no stale PENDING checkouts", async () => {
    findMany.mockResolvedValue([]);

    await runRechargeReconciliation();

    expect(getCheckoutStatusMock).not.toHaveBeenCalled();
    expect(applySumUpCheckoutStatusMock).not.toHaveBeenCalled();
  });

  it("checks SumUp and applies the shared transition logic for each stale checkout", async () => {
    const checkout = makeCheckout("recharge-1");
    findMany.mockResolvedValue([checkout] as never);
    getCheckoutStatusMock.mockResolvedValue("PAID");
    applySumUpCheckoutStatusMock.mockResolvedValue({ outcome: "credited", transactionId: "txn-1", newBalance: 650 });

    await runRechargeReconciliation();

    expect(getCheckoutStatusMock).toHaveBeenCalledWith("sumup-recharge-1");
    expect(applySumUpCheckoutStatusMock).toHaveBeenCalledWith({
      rechargeCheckout: checkout,
      sumupStatus: "PAID",
      actorId: null,
      ipAddress: null,
      source: "reconciliation-job",
    });
  });

  it("logs and continues with the rest of the batch when one checkout's SumUp lookup fails", async () => {
    const checkoutA = makeCheckout("recharge-a");
    const checkoutB = makeCheckout("recharge-b");
    findMany.mockResolvedValue([checkoutA, checkoutB] as never);
    getCheckoutStatusMock.mockRejectedValueOnce(new Error("network blip")).mockResolvedValueOnce("PAID");
    applySumUpCheckoutStatusMock.mockResolvedValue({ outcome: "credited", transactionId: "txn-2", newBalance: 800 });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await runRechargeReconciliation();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("recharge-a"),
      expect.any(Error),
    );
    expect(applySumUpCheckoutStatusMock).toHaveBeenCalledTimes(1);
    expect(applySumUpCheckoutStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ rechargeCheckout: checkoutB }),
    );

    consoleError.mockRestore();
  });

  it("does not throw when applySumUpCheckoutStatus itself rejects for one row", async () => {
    const checkout = makeCheckout("recharge-1");
    findMany.mockResolvedValue([checkout] as never);
    getCheckoutStatusMock.mockResolvedValue("PAID");
    applySumUpCheckoutStatusMock.mockRejectedValue(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runRechargeReconciliation()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
